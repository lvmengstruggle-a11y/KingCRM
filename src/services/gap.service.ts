import type { RowDataPacket } from 'mysql2';

import { getFormConfig } from '../models/form.model.js';
import { findRecord, pageRecords, tableColumns, updateRecord } from '../models/record.model.js';
import { bitToBool } from '../support/bit.js';
import { execute, query, withTransaction } from '../support/db.js';
import { notFound } from '../support/errors.js';
import { ident } from '../support/ident.js';
import { nextId } from '../support/id.js';
import { normalizePage, toPager, type Pager } from '../support/pager.js';
import { entities, entityByPrefix, type EntitySpec } from './crm-catalog.js';
import { addEntity, asObject, pageEntity } from './record.service.js';

const SEARCH_MODULES = [
  'searchAdvancedClue',
  'searchAdvancedCluePool',
  'searchAdvancedCustomer',
  'searchAdvancedPublic',
  'searchAdvancedContact',
  'searchAdvancedOpportunity',
];

export async function saveSearchConfig(organizationId: string, userId: string, body: unknown): Promise<void> {
  const request = asObject(body);
  const fields = asObject(request.searchFields);
  const sortSetting = JSON.stringify(Array.isArray(request.sortSetting) ? request.sortSetting : SEARCH_MODULES);
  const display = request.resultDisplay === true ? 1 : 0;
  const now = Date.now();
  const rows: Array<[string, string]> = [];
  for (const [moduleType, value] of Object.entries(fields)) {
    const ids = Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
    for (const fieldId of ids) {
      rows.push([moduleType, fieldId]);
    }
  }
  if (rows.length === 0) {
    rows.push(['_meta', '_meta']);
  }
  await withTransaction(async (tx) => {
    await tx.execute('DELETE FROM sys_user_search_config WHERE organization_id = ? AND user_id = ?', [organizationId, userId]);
    for (const [moduleType, fieldId] of rows) {
      await tx.execute(
        `INSERT INTO sys_user_search_config
         (id, field_id, type, user_id, module_type, sort_setting, result_display, organization_id, create_time, update_time, create_user, update_user)
         VALUES (?, ?, 'FIELD', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [nextId(), fieldId, userId, moduleType, sortSetting, display, organizationId, now, now, userId, userId],
      );
    }
  });
}

export async function getSearchConfig(organizationId: string, userId: string): Promise<Record<string, unknown>> {
  const rows = await query<RowDataPacket>(
    'SELECT field_id, module_type, sort_setting, result_display FROM sys_user_search_config WHERE organization_id = ? AND user_id = ?',
    [organizationId, userId],
  );
  const searchFields: Record<string, string[]> = {};
  for (const row of rows) {
    const moduleType = String(row.module_type);
    if (moduleType === '_meta' || String(row.field_id) === '_meta') {
      continue;
    }
    searchFields[moduleType] = [...(searchFields[moduleType] ?? []), String(row.field_id)];
  }
  let sortSetting = SEARCH_MODULES;
  if (rows[0]?.sort_setting) {
    try {
      const parsed = JSON.parse(String(rows[0].sort_setting));
      if (Array.isArray(parsed)) {
        sortSetting = parsed.map((item) => String(item));
      }
    } catch {
      sortSetting = SEARCH_MODULES;
    }
  }
  return {
    searchFields,
    resultDisplay: rows[0] ? bitToBool(rows[0].result_display) : false,
    sortSetting,
  };
}

export async function resetSearchConfig(organizationId: string, userId: string): Promise<void> {
  await execute('DELETE FROM sys_user_search_config WHERE organization_id = ? AND user_id = ?', [organizationId, userId]);
}

export async function saveMaskConfig(organizationId: string, userId: string, body: unknown): Promise<void> {
  const fields = asObject(asObject(body).searchFields);
  const now = Date.now();
  await withTransaction(async (tx) => {
    await tx.execute('DELETE FROM sys_search_field_mask_config WHERE organization_id = ?', [organizationId]);
    for (const [moduleType, value] of Object.entries(fields)) {
      const ids = Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
      for (const fieldId of ids) {
        await tx.execute(
          `INSERT INTO sys_search_field_mask_config
           (id, field_id, type, module_type, organization_id, create_time, update_time, create_user, update_user)
           VALUES (?, ?, 'FIELD', ?, ?, ?, ?, ?, ?)`,
          [nextId(), fieldId, moduleType, organizationId, now, now, userId, userId],
        );
      }
    }
  });
}

export async function getMaskConfig(organizationId: string): Promise<{ searchFields: Record<string, string[]> }> {
  const rows = await query<RowDataPacket>(
    'SELECT field_id, module_type FROM sys_search_field_mask_config WHERE organization_id = ?',
    [organizationId],
  );
  const searchFields: Record<string, string[]> = {};
  for (const row of rows) {
    const moduleType = String(row.module_type);
    searchFields[moduleType] = [...(searchFields[moduleType] ?? []), String(row.field_id)];
  }
  return { searchFields };
}

export async function checkRepeat(organizationId: string, body: unknown): Promise<{ repeat: boolean; name: string }> {
  const request = asObject(body);
  const value = String(request.value ?? '').trim();
  const spec = entityByFormKey(String(request.formKey ?? ''));
  if (!spec || !value) {
    return { repeat: false, name: '' };
  }
  const columns = await tableColumns(spec.table);
  const used = spec.keywordColumns
    .map((field) => columns.find((column) => column.field === field))
    .filter((column) => column != null);
  if (used.length === 0) {
    return { repeat: false, name: '' };
  }
  const params: unknown[] = [organizationId, ...used.map(() => value)];
  let exclude = '';
  if (request.id) {
    exclude = ' AND id <> ?';
    params.push(String(request.id));
  }
  const rows = await query<RowDataPacket & { name: string | null }>(
    `SELECT name FROM ${ident(spec.table)} WHERE organization_id = ? AND (${used.map((column) => `${ident(column!.column)} = ?`).join(' OR ')})${exclude} LIMIT 1`,
    params,
  );
  return { repeat: rows.length > 0, name: String(rows[0]?.name ?? '') };
}

export async function sourcePage(spec: EntitySpec, organizationId: string, userId: string, body: unknown) {
  return pageEntity(spec, organizationId, userId, body);
}

export async function emptyPage(body: unknown): Promise<Pager<never> & { optionMap: Record<string, never> }> {
  const record = asObject(body);
  const page = normalizePage(Number(record.current), Number(record.pageSize));
  return { ...toPager([], 0, page), optionMap: {} };
}

export async function businessTitlePage(organizationId: string, body: unknown) {
  const record = asObject(body);
  const page = normalizePage(Number(record.current), Number(record.pageSize));
  const result = await pageRecords('business_title', {
    organizationId,
    current: page.current,
    pageSize: page.pageSize,
    keyword: typeof record.keyword === 'string' ? record.keyword : undefined,
    keywordColumns: ['name'],
    equals: {},
  });
  return { ...toPager(result.list, result.total, page), optionMap: {} };
}

export async function sourceDetail(organizationId: string, body: unknown): Promise<Record<string, unknown>[]> {
  const request = asObject(body);
  const spec = entityByFormKey(String(request.dataSourceType ?? ''));
  const ids = Array.isArray(request.sourceIds) ? request.sourceIds.map((item) => String(item)).filter(Boolean) : [];
  if (!spec || ids.length === 0) {
    return [];
  }
  const page = await pageEntity(spec, organizationId, 'admin', { current: 1, pageSize: ids.length }, { inField: 'id', inValues: ids });
  return page.list;
}

export async function transformClue(organizationId: string, userId: string, body: unknown): Promise<Record<string, unknown>> {
  const request = asObject(body);
  const clueId = String(request.clueId ?? request.id ?? '');
  const clue = await findRecord('clue', clueId, organizationId);
  if (!clue) {
    throw notFound('线索不存在');
  }
  const customer = await addEntity(entityByPrefix('/account'), organizationId, userId, {
    name: clue.name,
    owner: clue.owner || userId,
    phone: clue.phone,
  });
  if (request.oppCreated === true) {
    await addEntity(entityByPrefix('/opportunity'), organizationId, userId, {
      name: String(request.oppName ?? clue.name ?? ''),
      customerId: customer.id,
      owner: clue.owner || userId,
    });
  }
  await updateRecord('clue', clueId, organizationId, {
    transitionId: customer.id,
    transitionType: 'CUSTOMER',
    inSharedPool: false,
    updateTime: Date.now(),
    updateUser: userId,
  });
  return customer;
}

export async function pageByCustomer(
  spec: EntitySpec,
  organizationId: string,
  userId: string,
  body: unknown,
  viaContract: boolean,
) {
  if (!viaContract) {
    return pageEntity(spec, organizationId, userId, body);
  }
  const customerId = String(asObject(body).customerId ?? '');
  const ids = customerId ? await contractIds(organizationId, customerId) : undefined;
  return pageEntity(spec, organizationId, userId, body, customerId ? { inField: 'contractId', inValues: ids } : undefined);
}

export async function contractStatistic(organizationId: string, customerId: string): Promise<{ totalAmount: number }> {
  const rows = await query<RowDataPacket & { total: number | string | null }>(
    'SELECT COALESCE(SUM(amount), 0) AS total FROM contract WHERE organization_id = ? AND customer_id = ?',
    [organizationId, customerId],
  );
  return { totalAmount: Number(rows[0]?.total ?? 0) };
}

export async function planStatistic(organizationId: string, customerId: string): Promise<{ totalPlanAmount: number }> {
  const ids = await contractIds(organizationId, customerId);
  if (ids.length === 0) {
    return { totalPlanAmount: 0 };
  }
  const rows = await query<RowDataPacket & { total: number | string | null }>(
    `SELECT COALESCE(SUM(plan_amount), 0) AS total FROM contract_payment_plan
     WHERE organization_id = ? AND contract_id IN (${ids.map(() => '?').join(', ')})`,
    [organizationId, ...ids],
  );
  return { totalPlanAmount: Number(rows[0]?.total ?? 0) };
}

export async function recordStatistic(organizationId: string, customerId: string): Promise<{ totalAmount: number; receivedAmount: number; pendingAmount: number }> {
  const plan = await planStatistic(organizationId, customerId);
  const ids = await contractIds(organizationId, customerId);
  if (ids.length === 0) {
    return { totalAmount: 0, receivedAmount: 0, pendingAmount: 0 };
  }
  const rows = await query<RowDataPacket & { total: number | string | null }>(
    `SELECT COALESCE(SUM(record_amount), 0) AS total FROM contract_payment_record
     WHERE organization_id = ? AND contract_id IN (${ids.map(() => '?').join(', ')})`,
    [organizationId, ...ids],
  );
  const receivedAmount = Number(rows[0]?.total ?? 0);
  const totalAmount = plan.totalPlanAmount;
  return { totalAmount, receivedAmount, pendingAmount: Math.max(totalAmount - receivedAmount, 0) };
}

export async function invoiceStatistic(organizationId: string, customerId: string): Promise<{ contractAmount: number; invoicedAmount: number; uninvoicedAmount: number }> {
  const contractAmount = (await contractStatistic(organizationId, customerId)).totalAmount;
  const ids = await contractIds(organizationId, customerId);
  if (ids.length === 0) {
    return { contractAmount, invoicedAmount: 0, uninvoicedAmount: contractAmount };
  }
  const rows = await query<RowDataPacket & { total: number | string | null }>(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM contract_invoice
     WHERE organization_id = ? AND contract_id IN (${ids.map(() => '?').join(', ')})`,
    [organizationId, ...ids],
  );
  const invoicedAmount = Number(rows[0]?.total ?? 0);
  return { contractAmount, invoicedAmount, uninvoicedAmount: Math.max(contractAmount - invoicedAmount, 0) };
}

export async function globalCounts(organizationId: string, userId: string, keyword: string): Promise<Array<{ key: string; count: number }>> {
  const targets: Array<[string, string]> = [
    ['searchAdvancedCustomer', '/account'],
    ['searchAdvancedPublic', '/pool/account'],
    ['searchAdvancedContact', '/account/contact'],
    ['searchAdvancedClue', '/lead'],
    ['searchAdvancedCluePool', '/pool/lead'],
    ['searchAdvancedOpportunity', '/opportunity'],
  ];
  const counts = await Promise.all(targets.map(async ([key, prefix]) => {
    const page = await pageEntity(entityByPrefix(prefix), organizationId, userId, { keyword, current: 1, pageSize: 1 });
    return { key, count: page.total };
  }));
  return counts;
}

export async function moveRecord(table: string, organizationId: string, body: unknown): Promise<void> {
  const request = asObject(body);
  const moveId = String(request.moveId ?? '');
  const targetId = String(request.targetId ?? '');
  const rows = await query<RowDataPacket & { pos: number | string | null }>(
    `SELECT pos FROM ${ident(table)} WHERE id = ? AND organization_id = ? LIMIT 1`,
    [targetId, organizationId],
  );
  if (!rows[0]) {
    throw notFound('数据不存在');
  }
  const pos = Number(rows[0].pos ?? 0) + (request.moveMode === 'BEFORE' ? -1 : 1);
  await execute(`UPDATE ${ident(table)} SET pos = ?, update_time = ? WHERE id = ? AND organization_id = ?`, [
    pos,
    Date.now(),
    moveId,
    organizationId,
  ]);
}

export async function copyPrice(organizationId: string, userId: string, id: string): Promise<Record<string, unknown>> {
  const current = await findRecord('product_price', id, organizationId);
  if (!current) {
    throw notFound('价格表不存在');
  }
  return addEntity(entityByPrefix('/price'), organizationId, userId, {
    ...current,
    id: undefined,
    name: `${String(current.name ?? '价格')} 副本`,
  });
}

export async function displayConfig(formKey: string, organizationId: string) {
  return getFormConfig(formKey, organizationId);
}

function entityByFormKey(formKey: string): EntitySpec | undefined {
  return entities.find((entity) => entity.formKey === formKey && entity.inPool !== true)
    ?? entities.find((entity) => entity.formKey === formKey);
}

async function contractIds(organizationId: string, customerId: string): Promise<string[]> {
  const rows = await query<RowDataPacket & { id: string }>(
    'SELECT id FROM contract WHERE organization_id = ? AND customer_id = ?',
    [organizationId, customerId],
  );
  return rows.map((row) => String(row.id));
}
