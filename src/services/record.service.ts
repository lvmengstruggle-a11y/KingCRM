import type { RowDataPacket } from 'mysql2';

import { getFormConfig } from '../models/form.model.js';
import {
  columnByField,
  deleteModuleFields,
  deleteRecords,
  findRecord,
  insertRecord,
  isBlankNumber,
  loadModuleFields,
  pageRecords,
  replaceModuleFields,
  sumAmount,
  tableColumns,
  updateRecord,
  type ModuleFieldValue,
} from '../models/record.model.js';
import { firstStageId } from '../models/stage.model.js';
import { execute, query } from '../support/db.js';
import { AppError, notFound, validateFailed } from '../support/errors.js';
import { nextId } from '../support/id.js';
import { normalizePage, toPager, type Pager } from '../support/pager.js';
import { ResultCode } from '../support/result.js';
import { approvalService } from './approval.service.js';
import type { EntitySpec } from './crm-catalog.js';
import { visibleOwnerIds } from './data-scope.js';

const TEXT_DEFAULTS: Record<string, string> = {
  products: '[]',
  approvalStatus: 'APPROVED',
  archivedStatus: 'UNARCHIVED',
  planStatus: 'PENDING',
  followMethod: 'OTHER',
  method: 'OTHER',
  type: 'CUSTOMER',
  content: '',
  transitionType: 'NONE',
  status: '1',
};

const PARENT_FIELDS = ['customerId', 'opportunityId', 'clueId', 'contractId', 'poolId', 'paymentPlanId'];

export function asObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {};
  }
  return body as Record<string, unknown>;
}

export function asIds(body: unknown): string[] {
  if (Array.isArray(body)) {
    return body.map((item) => String(item)).filter(Boolean);
  }
  const record = asObject(body);
  const raw = record.ids ?? record.batchIds ?? record.mergeIds;
  if (!Array.isArray(raw)) {
    throw validateFailed('请选择数据');
  }
  return raw.map((item) => String(item)).filter(Boolean);
}

function moduleFieldsOf(body: Record<string, unknown>): ModuleFieldValue[] {
  if (!Array.isArray(body.moduleFields)) {
    return [];
  }
  return body.moduleFields.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return [];
    }
    const field = item as Record<string, unknown>;
    const fieldId = field.fieldId;
    if (typeof fieldId !== 'string' || !fieldId) {
      return [];
    }
    return [{ fieldId, fieldValue: field.fieldValue }];
  });
}

async function buildValues(
  spec: EntitySpec,
  body: Record<string, unknown>,
  organizationId: string,
  userId: string,
  creating: boolean,
): Promise<Record<string, unknown>> {
  const columns = await tableColumns(spec.table);
  const now = Date.now();
  const values: Record<string, unknown> = {};
  for (const column of columns) {
    if (body[column.field] !== undefined && column.field !== 'moduleFields') {
      values[column.field] = body[column.field];
    }
  }
  if (creating) {
    values.id = typeof body.id === 'string' && body.id ? body.id : nextId();
    values.organizationId = organizationId;
    values.createTime = now;
    values.createUser = userId;
  }
  values.updateTime = now;
  values.updateUser = userId;
  if (creating && spec.poolColumn && values.inSharedPool === undefined) {
    values.inSharedPool = spec.inPool === true;
  }
  if (creating && values.owner == null && columnByField(columns, 'owner') && !columnByField(columns, 'owner')?.nullable) {
    values.owner = userId;
  }
  if (creating && values.stage == null && spec.stageTable) {
    values.stage = (await firstStageId(spec.stageTable, organizationId)) ?? '';
  }
  if (creating && values.number == null && columnByField(columns, 'number')) {
    values.number = `N${now}`;
  }
  if (creating && values.pos == null && columnByField(columns, 'pos')) {
    values.pos = now;
  }
  for (const column of columns) {
    if (!isBlankNumber(column, values[column.field])) {
      continue;
    }
    values[column.field] = column.nullable || creating ? null : 0;
  }
  for (const column of columns) {
    if (!creating || column.nullable || values[column.field] != null) {
      continue;
    }
    if (column.field in TEXT_DEFAULTS && column.dataType !== 'bit') {
      values[column.field] = TEXT_DEFAULTS[column.field];
      continue;
    }
    if (column.dataType === 'bit' || column.columnType.includes('tinyint(1)')) {
      values[column.field] = column.field === 'enable' ? false : true;
      continue;
    }
    if (['bigint', 'int', 'decimal', 'double', 'float'].includes(column.dataType)) {
      values[column.field] = 0;
      continue;
    }
    values[column.field] = '';
  }
  if (creating && columnByField(columns, 'name') && String(values.name ?? '').trim() === '' && spec.table !== 'follow_up_record' && spec.table !== 'follow_up_plan') {
    throw validateFailed('名称不能为空');
  }
  return values;
}

async function userNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const names = new Map<string, string>();
  if (unique.length === 0) {
    return names;
  }
  const rows = await query<RowDataPacket & { id: string; name: string }>(
    `SELECT id, name FROM sys_user WHERE id IN (${unique.map(() => '?').join(', ')})`,
    unique,
  );
  for (const row of rows) {
    names.set(row.id, row.name);
  }
  return names;
}

async function departments(organizationId: string, userIds: string[]): Promise<Map<string, { id: string; name: string }>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  const result = new Map<string, { id: string; name: string }>();
  if (unique.length === 0) {
    return result;
  }
  const rows = await query<RowDataPacket & { user_id: string; department_id: string | null; department_name: string | null }>(
    `SELECT ou.user_id, ou.department_id, d.name AS department_name
     FROM sys_organization_user ou
     LEFT JOIN sys_department d ON d.id = ou.department_id
     WHERE ou.organization_id = ? AND ou.user_id IN (${unique.map(() => '?').join(', ')})`,
    [organizationId, ...unique],
  );
  for (const row of rows) {
    if (row.department_id) {
      result.set(row.user_id, { id: row.department_id, name: row.department_name ?? '' });
    }
  }
  return result;
}

async function attachFields(spec: EntitySpec, records: Record<string, unknown>[]): Promise<void> {
  const ids = records.map((record) => String(record.id));
  const fields = await loadModuleFields(spec.fieldTable, spec.blobTable, ids);
  for (const record of records) {
    record.moduleFields = fields.get(String(record.id)) ?? [];
    if (record.followTime != null && record.latestFollowUpTime == null) {
      record.latestFollowUpTime = record.followTime;
    }
  }
}

async function attachNames(organizationId: string, records: Record<string, unknown>[]): Promise<Record<string, { id: string; name: string }[]>> {
  const ids = records.flatMap((record) => [record.owner, record.createUser, record.updateUser, record.follower].map((item) => String(item ?? '')));
  const names = await userNames(ids);
  const depts = await departments(organizationId, records.map((record) => String(record.owner ?? '')));
  const options = [...names.entries()].map(([id, name]) => ({ id, name }));
  for (const record of records) {
    record.ownerName = names.get(String(record.owner ?? '')) ?? null;
    record.createUserName = names.get(String(record.createUser ?? '')) ?? null;
    record.updateUserName = names.get(String(record.updateUser ?? '')) ?? null;
    record.followerName = names.get(String(record.follower ?? '')) ?? null;
    const department = depts.get(String(record.owner ?? ''));
    record.departmentId = department?.id ?? null;
    record.departmentName = department?.name ?? null;
  }
  return {
    owner: options,
    createUser: options,
    updateUser: options,
    follower: options,
  };
}

const RELATION_TABLES: Array<[string, string]> = [
  ['customerId', 'customer'],
  ['opportunityId', 'opportunity'],
  ['contractId', 'contract'],
  ['clueId', 'clue'],
  ['contactId', 'customer_contact'],
  ['businessTitleId', 'business_title'],
];

async function relationOptions(records: Record<string, unknown>[]): Promise<Record<string, { id: string; name: string }[]>> {
  const result: Record<string, { id: string; name: string }[]> = {};
  for (const [key, table] of RELATION_TABLES) {
    const ids = [...new Set(records.map((record) => String(record[key] ?? '')).filter(Boolean))];
    if (ids.length === 0) {
      continue;
    }
    const rows = await query<RowDataPacket & { id: string; name: string }>(
      `SELECT id, name FROM ${table} WHERE id IN (${ids.map(() => '?').join(', ')})`,
      ids,
    );
    if (rows.length > 0) {
      result[key] = rows.map((row) => ({ id: row.id, name: row.name }));
    }
  }
  return result;
}

async function attachPaidAmount(records: Record<string, unknown>[]): Promise<void> {
  const ids = records.map((record) => String(record.id ?? '')).filter(Boolean);
  if (ids.length === 0) {
    return;
  }
  const rows = await query<RowDataPacket & { contract_id: string; paid: string | number | null }>(
    `SELECT contract_id, SUM(record_amount) AS paid
     FROM contract_payment_record
     WHERE contract_id IN (${ids.map(() => '?').join(', ')})
     GROUP BY contract_id`,
    ids,
  );
  const paid = new Map(rows.map((row) => [row.contract_id, Number(row.paid ?? 0)]));
  for (const record of records) {
    record.alreadyPayAmount = paid.get(String(record.id)) ?? 0;
  }
}

async function optionMapFor(spec: EntitySpec, organizationId: string, base: Record<string, { id: string; name: string }[]>): Promise<Record<string, { id: string; name: string }[]>> {
  const config = await getFormConfig(spec.formKey, organizationId);
  const optionMap = { ...base };
  const userKeys = new Set(['owner', 'createUser', 'updateUser', 'follower']);
  for (const field of config.fields) {
    const businessKey = typeof field.businessKey === 'string' ? field.businessKey : '';
    const isMember = ['MEMBER', 'MEMBER_MULTIPLE', 'USER_SELECT'].includes(String(field.type));
    if (isMember || userKeys.has(businessKey)) {
      optionMap[field.id] = base.owner ?? [];
      if (businessKey) {
        optionMap[businessKey] = base[businessKey] ?? base.owner ?? [];
      }
    }
  }
  return optionMap;
}

async function scopeOwnerIds(organizationId: string, userId: string, viewId: unknown): Promise<string[] | undefined> {
  const allowed = await visibleOwnerIds(organizationId, userId);
  let viewIds: string[] | undefined;
  if (viewId === 'SELF') {
    viewIds = userId ? [userId] : [];
  } else if (viewId === 'DEPARTMENT') {
    viewIds = await departmentMemberIds(organizationId, userId);
  }
  if (!allowed) {
    return viewIds;
  }
  if (!viewIds) {
    return allowed;
  }
  const permit = new Set(allowed);
  return viewIds.filter((id) => permit.has(id));
}

async function departmentMemberIds(organizationId: string, userId: string): Promise<string[]> {
  const rows = await query<RowDataPacket & { department_id: string | null }>(
    'SELECT department_id FROM sys_organization_user WHERE organization_id = ? AND user_id = ? LIMIT 1',
    [organizationId, userId],
  );
  const departmentId = rows[0]?.department_id;
  if (!departmentId) {
    return userId ? [userId] : [];
  }
  const members = await query<RowDataPacket & { user_id: string }>(
    'SELECT user_id FROM sys_organization_user WHERE organization_id = ? AND department_id = ?',
    [organizationId, departmentId],
  );
  return members.map((row) => row.user_id);
}

async function assertVisible(
  spec: EntitySpec,
  organizationId: string,
  userId: string,
  record: Record<string, unknown>,
): Promise<void> {
  if (spec.inPool) {
    return;
  }
  if (spec.table === 'customer') {
    const shared = await collaborationIds(userId);
    if (shared.includes(String(record.id ?? ''))) {
      return;
    }
  }
  const allowed = await visibleOwnerIds(organizationId, userId);
  if (!allowed || !Object.prototype.hasOwnProperty.call(record, 'owner')) {
    return;
  }
  if (!allowed.includes(String(record.owner ?? ''))) {
    throw new AppError(403, ResultCode.FORBIDDEN, '没有权限');
  }
}

async function collaborationIds(userId: string): Promise<string[]> {
  const rows = await query<RowDataPacket & { customer_id: string }>(
    'SELECT customer_id FROM customer_collaboration WHERE user_id = ?',
    [userId],
  );
  return rows.map((row) => row.customer_id);
}

export async function pageEntity(
  spec: EntitySpec,
  organizationId: string,
  userId: string,
  body: unknown,
  extra?: { inField?: string; inValues?: string[] },
): Promise<Pager<Record<string, unknown>> & { optionMap: Record<string, { id: string; name: string }[]> }> {
  const record = asObject(body);
  const page = normalizePage(Number(record.current), Number(record.pageSize));
  const equals: Record<string, unknown> = {};
  for (const field of PARENT_FIELDS) {
    if (record[field] != null && record[field] !== '') {
      equals[field] = record[field];
    }
  }
  let inIds: string[] | undefined;
  if (record.viewId === 'CUSTOMER_COLLABORATION' && spec.table === 'customer') {
    inIds = await collaborationIds(userId);
  }
  const nested = PARENT_FIELDS.some((field) => equals[field] != null);
  const result = await pageRecords(spec.table, {
    organizationId,
    current: page.current,
    pageSize: page.pageSize,
    keyword: typeof record.keyword === 'string' ? record.keyword : undefined,
    keywordColumns: spec.keywordColumns,
    equals,
    inIds,
    inField: extra?.inField,
    inValues: extra?.inValues,
    ownerIds: inIds || nested || spec.inPool ? undefined : await scopeOwnerIds(organizationId, userId, record.viewId),
    inPool: spec.inPool,
    poolColumn: spec.poolColumn,
    sortField: typeof record.sort === 'object' && record.sort && 'name' in record.sort ? String((record.sort as { name?: string }).name ?? '') : undefined,
    sortDesc: typeof record.sort === 'object' && record.sort ? (record.sort as { type?: string }).type !== 'asc' : true,
  });
  await attachFields(spec, result.list);
  const names = await attachNames(organizationId, result.list);
  if (spec.table === 'contract') {
    await attachPaidAmount(result.list);
  }
  return {
    ...toPager(result.list, result.total, page),
    optionMap: await optionMapFor(spec, organizationId, { ...names, ...(await relationOptions(result.list)) }),
  };
}

export async function getEntity(spec: EntitySpec, id: string, organizationId: string, userId = ''): Promise<Record<string, unknown>> {
  const record = await findRecord(spec.table, id, organizationId);
  if (!record) {
    throw notFound('数据不存在');
  }
  await assertVisible(spec, organizationId, userId, record);
  await attachFields(spec, [record]);
  const names = await attachNames(organizationId, [record]);
  if (spec.table === 'contract') {
    await attachPaidAmount([record]);
  }
  record.optionMap = await optionMapFor(spec, organizationId, { ...names, ...(await relationOptions([record])) });
  return record;
}

export async function opportunityContacts(
  opportunitySpec: EntitySpec,
  contactSpec: EntitySpec,
  organizationId: string,
  userId: string,
  opportunityId: string,
): Promise<{ list: Record<string, unknown>[]; optionMap: Record<string, { id: string; name: string }[]> }> {
  const opportunity = await findRecord(opportunitySpec.table, opportunityId, organizationId);
  if (!opportunity) {
    throw notFound('商机不存在');
  }
  await assertVisible(opportunitySpec, organizationId, userId, opportunity);
  const contactId = String(opportunity.contactId ?? '');
  if (!contactId) {
    return { list: [], optionMap: {} };
  }
  const contact = await findRecord(contactSpec.table, contactId, organizationId);
  if (!contact) {
    return { list: [], optionMap: {} };
  }
  await attachFields(contactSpec, [contact]);
  const names = await attachNames(organizationId, [contact]);
  const relations = await relationOptions([contact]);
  const customer = relations.customerId?.find((item) => item.id === String(contact.customerId ?? ''));
  if (customer) {
    contact.customerName = customer.name;
  }
  return {
    list: [contact],
    optionMap: await optionMapFor(contactSpec, organizationId, { ...names, ...relations }),
  };
}

async function fieldTypes(spec: EntitySpec, organizationId: string): Promise<Map<string, string>> {
  const config = await getFormConfig(spec.formKey, organizationId);
  return new Map(config.fields.map((field) => [field.id, String(field.type)]));
}

async function touchFollow(values: Record<string, unknown>, userId: string): Promise<void> {
  const now = Date.now();
  const targets: Array<[string, unknown]> = [
    ['customer', values.customerId],
    ['clue', values.clueId],
    ['opportunity', values.opportunityId],
  ];
  for (const [table, id] of targets) {
    if (typeof id === 'string' && id) {
      await execute(
        `UPDATE ${table} SET follower = ?, follow_time = ?, update_time = ? WHERE id = ?`,
        [userId, now, now, id],
      );
    }
  }
}

async function rememberOwner(customerId: string, owner: string, operator: string): Promise<void> {
  const now = Date.now();
  await execute('UPDATE customer_owner SET end_time = ? WHERE customer_id = ? AND end_time = 0', [now, customerId]);
  await execute(
    `INSERT INTO customer_owner (id, customer_id, owner, collection_time, end_time, operator)
     VALUES (?, ?, ?, ?, 0, ?)`,
    [nextId(), customerId, owner, now, operator],
  );
}

export async function addEntity(spec: EntitySpec, organizationId: string, userId: string, body: unknown): Promise<Record<string, unknown>> {
  const record = asObject(body);
  const values = await buildValues(spec, record, organizationId, userId, true);
  await insertRecord(spec.table, values);
  await replaceModuleFields(spec.fieldTable, spec.blobTable, String(values.id), moduleFieldsOf(record), await fieldTypes(spec, organizationId));
  if (spec.table === 'follow_up_record') {
    await touchFollow(values, userId);
  }
  if (spec.table === 'customer' && typeof values.owner === 'string' && values.owner) {
    await rememberOwner(String(values.id), values.owner, userId);
  }
  const formKey = approvalService.formKeyByTable(spec.table);
  if (formKey) {
    await approvalService.afterCreate(formKey, String(values.id), organizationId);
  }
  return getEntity(spec, String(values.id), organizationId, userId);
}

export async function updateEntity(spec: EntitySpec, organizationId: string, userId: string, body: unknown): Promise<Record<string, unknown>> {
  const record = asObject(body);
  const id = String(record.id ?? '');
  if (!id) {
    throw validateFailed('缺少数据 ID');
  }
  const current = await findRecord(spec.table, id, organizationId);
  if (!current) {
    throw notFound('数据不存在');
  }
  await assertVisible(spec, organizationId, userId, current);
  const formKey = approvalService.formKeyByTable(spec.table);
  const previousStatus = String(current.approvalStatus ?? '');
  if (formKey) {
    await approvalService.guardAction(formKey, organizationId, previousStatus, 'UPDATE');
  }
  const values = await buildValues(spec, record, organizationId, userId, false);
  if (spec.table === 'opportunity' && values.stage && values.stage !== current.stage) {
    values.lastStage = current.stage;
  }
  await updateRecord(spec.table, id, organizationId, values);
  if (Array.isArray(record.moduleFields)) {
    await replaceModuleFields(spec.fieldTable, spec.blobTable, id, moduleFieldsOf(record), await fieldTypes(spec, organizationId));
  }
  if (spec.table === 'customer' && typeof values.owner === 'string' && values.owner && values.owner !== current.owner) {
    await rememberOwner(id, values.owner, userId);
  }
  if (formKey) {
    await approvalService.afterUpdate(formKey, id, organizationId, userId, previousStatus);
  }
  return getEntity(spec, id, organizationId, userId);
}

export async function removeEntities(spec: EntitySpec, organizationId: string, userId: string, ids: string[]): Promise<void> {
  const formKey = approvalService.formKeyByTable(spec.table);
  const removable: string[] = [];
  const held: string[] = [];
  for (const id of ids) {
    const current = await findRecord(spec.table, id, organizationId);
    if (current) {
      await assertVisible(spec, organizationId, userId, current);
      if (formKey) {
        await approvalService.guardAction(formKey, organizationId, String(current.approvalStatus ?? ''), 'DELETE');
        const waiting = await approvalService.interceptDelete(formKey, id, organizationId, userId);
        if (waiting) {
          held.push(id);
          continue;
        }
      }
    }
    removable.push(id);
  }
  ids = removable;
  await deleteModuleFields(spec.fieldTable, spec.blobTable, ids);
  if (ids.length > 0 && spec.table === 'customer') {
    const marks = ids.map(() => '?').join(', ');
    await execute(`DELETE FROM customer_owner WHERE customer_id IN (${marks})`, ids);
    await execute(`DELETE FROM customer_collaboration WHERE customer_id IN (${marks})`, ids);
    await execute(`DELETE FROM customer_relation WHERE source_customer_id IN (${marks}) OR target_customer_id IN (${marks})`, [...ids, ...ids]);
  }
  await deleteRecords(spec.table, ids, organizationId);
  if (held.length) {
    throw validateFailed('已发起删除审批，审批通过后才会删除');
  }
}

export async function batchEdit(spec: EntitySpec, organizationId: string, userId: string, body: unknown): Promise<void> {
  const record = asObject(body);
  const ids = asIds(record);
  const formKey = approvalService.formKeyByTable(spec.table);
  const previousStatus = new Map<string, string>();
  for (const id of ids) {
    const current = await findRecord(spec.table, id, organizationId);
    if (current) {
      await assertVisible(spec, organizationId, userId, current);
      if (formKey) {
        const status = String(current.approvalStatus ?? '');
        previousStatus.set(id, status);
        await approvalService.guardAction(formKey, organizationId, status, 'UPDATE');
      }
    }
  }
  const fieldId = String(record.fieldId ?? '');
  if (!fieldId) {
    throw validateFailed('请选择字段');
  }
  const columns = await tableColumns(spec.table);
  const column = columnByField(columns, fieldId);
  const now = Date.now();
  if (column) {
    for (const id of ids) {
      await updateRecord(spec.table, id, organizationId, { [column.field]: record.fieldValue, updateTime: now, updateUser: userId });
    }
  } else {
    const types = await fieldTypes(spec, organizationId);
    for (const id of ids) {
      const existing = await loadModuleFields(spec.fieldTable, spec.blobTable, [id]);
      const fields = (existing.get(id) ?? []).filter((item) => item.fieldId !== fieldId);
      fields.push({ fieldId, fieldValue: record.fieldValue });
      await replaceModuleFields(spec.fieldTable, spec.blobTable, id, fields, types);
    }
  }
  if (formKey) {
    for (const id of ids) {
      await approvalService.afterUpdate(formKey, id, organizationId, userId, previousStatus.get(id) ?? '');
    }
  }
}

export async function transferOwners(spec: EntitySpec, organizationId: string, userId: string, body: unknown): Promise<void> {
  const record = asObject(body);
  const owner = record.owner == null ? '' : String(record.owner);
  if (!owner) {
    throw validateFailed('请选择负责人');
  }
  for (const id of asIds(record)) {
    await updateEntity(spec, organizationId, userId, { id, owner });
  }
}

export async function moveToPool(spec: EntitySpec, organizationId: string, userId: string, body: unknown): Promise<void> {
  const record = asObject(body);
  const ids = record.id ? [String(record.id)] : asIds(record);
  for (const id of ids) {
    const current = await findRecord(spec.table, id, organizationId);
    if (current) {
      await assertVisible(spec, organizationId, userId, current);
    }
  }
  const now = Date.now();
  for (const id of ids) {
    await updateRecord(spec.table, id, organizationId, {
      inSharedPool: true,
      poolId: record.poolId ?? null,
      reasonId: record.reasonId ?? null,
      owner: null,
      updateTime: now,
      updateUser: userId,
    });
  }
}

export async function pickRecords(spec: EntitySpec, organizationId: string, userId: string, body: unknown): Promise<void> {
  const record = asObject(body);
  const ids = record.customerId ? [String(record.customerId)] : record.id ? [String(record.id)] : asIds(record);
  const now = Date.now();
  for (const id of ids) {
    await updateRecord(spec.table, id, organizationId, {
      inSharedPool: false,
      owner: userId,
      collectionTime: now,
      frozen: false,
      updateTime: now,
      updateUser: userId,
    });
  }
}

export async function assignRecords(spec: EntitySpec, organizationId: string, userId: string, body: unknown): Promise<void> {
  const record = asObject(body);
  const owner = String(record.assignUserId ?? record.owner ?? '');
  if (!owner) {
    throw validateFailed('请选择负责人');
  }
  const ids = record.customerId ? [String(record.customerId)] : asIds(record);
  await transferOwners(spec, organizationId, userId, { ids, owner });
  const now = Date.now();
  for (const id of ids) {
    await updateRecord(spec.table, id, organizationId, { inSharedPool: false, collectionTime: now, frozen: false });
  }
}

export async function freezeRecord(spec: EntitySpec, organizationId: string, userId: string, body: unknown, frozen: boolean): Promise<void> {
  const record = asObject(body);
  const id = String(record.id ?? '');
  if (!id) {
    throw validateFailed('缺少数据 ID');
  }
  const days = Number(record.freezeDays ?? 0);
  await updateRecord(spec.table, id, organizationId, {
    frozen,
    freezeReason: record.reason ?? null,
    unfreezeTime: frozen && days > 0 ? Date.now() + days * 86_400_000 : null,
    updateTime: Date.now(),
    updateUser: userId,
  });
}

export async function entityStatistic(spec: EntitySpec, organizationId: string): Promise<{ amount: number; averageAmount: number }> {
  const amount = await sumAmount(spec.table, organizationId, spec.inPool, spec.poolColumn);
  const page = await pageRecords(spec.table, {
    organizationId,
    current: 1,
    pageSize: 1,
    keywordColumns: spec.keywordColumns,
    equals: {},
    inPool: spec.inPool,
    poolColumn: spec.poolColumn,
  });
  return {
    amount,
    averageAmount: page.total > 0 ? amount / page.total : 0,
  };
}

export async function entityOptions(spec: EntitySpec, organizationId: string, userId: string, body: unknown): Promise<Pager<{ id: string; name: string }>> {
  const record = asObject(body);
  const result = await pageEntity(spec, organizationId, userId, { ...record, viewId: record.viewId ?? 'ALL' });
  return {
    ...result,
    list: result.list.map((item) => ({ id: String(item.id), name: String(item.name ?? '') })),
  };
}

export async function updateStage(spec: EntitySpec, organizationId: string, userId: string, body: unknown): Promise<void> {
  const record = asObject(body);
  const id = String(record.id ?? '');
  const stage = String(record.stage ?? '');
  if (!id || !stage) {
    throw validateFailed('请选择阶段');
  }
  const current = await findRecord(spec.table, id, organizationId);
  if (!current) {
    throw notFound('数据不存在');
  }
  await updateRecord(spec.table, id, organizationId, {
    stage,
    lastStage: current.stage ?? null,
    reasonId: record.failureReason ?? record.reasonId ?? current.reasonId,
    updateTime: Date.now(),
    updateUser: userId,
  });
}

export async function setFlag(spec: EntitySpec, id: string, organizationId: string, userId: string, values: Record<string, unknown>): Promise<void> {
  const current = await findRecord(spec.table, id, organizationId);
  if (!current) {
    throw notFound('数据不存在');
  }
  await updateRecord(spec.table, id, organizationId, { ...values, updateTime: Date.now(), updateUser: userId });
}
