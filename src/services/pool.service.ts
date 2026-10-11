import type { RowDataPacket } from 'mysql2';

import { getFormConfig } from '../models/form.model.js';
import { asNumber, bitToBool } from '../support/bit.js';
import { execute, query, withTransaction } from '../support/db.js';
import { notFound, validateFailed } from '../support/errors.js';
import { nextId } from '../support/id.js';
import { normalizePage, toPager, type Pager } from '../support/pager.js';
import { asObject } from './record.service.js';

interface PoolSpec {
  table: string;
  pickTable: string;
  recycleTable: string;
  hiddenTable: string;
  recordTable: string;
  formKey: string;
}

export const customerPool: PoolSpec = {
  table: 'customer_pool',
  pickTable: 'customer_pool_pick_rule',
  recycleTable: 'customer_pool_recycle_rule',
  hiddenTable: 'customer_pool_hidden_field',
  recordTable: 'customer',
  formKey: 'customer',
};

export const cluePool: PoolSpec = {
  table: 'clue_pool',
  pickTable: 'clue_pool_pick_rule',
  recycleTable: 'clue_pool_recycle_rule',
  hiddenTable: 'clue_pool_hidden_field',
  recordTable: 'clue',
  formKey: 'clue',
};

function parseIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }
  if (typeof value !== 'string' || !value) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return value.split(',').filter(Boolean);
  }
}

function parseConditions(value: string | null): unknown[] {
  if (!value) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function namesOf(ids: string[]): Promise<Map<string, string>> {
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

export async function pagePools(spec: PoolSpec, organizationId: string, body: unknown): Promise<Pager<Record<string, unknown>>> {
  const request = asObject(body);
  const page = normalizePage(Number(request.current), Number(request.pageSize));
  const keyword = typeof request.keyword === 'string' ? request.keyword.trim() : '';
  const where = ['organization_id = ?'];
  const params: unknown[] = [organizationId];
  if (keyword) {
    where.push('name LIKE ?');
    params.push(`%${keyword}%`);
  }
  const clause = where.join(' AND ');
  const totals = await query<RowDataPacket & { total: number }>(
    `SELECT COUNT(*) AS total FROM ${spec.table} WHERE ${clause}`,
    params,
  );
  const rows = await query<RowDataPacket>(
    `SELECT * FROM ${spec.table} WHERE ${clause} ORDER BY create_time DESC LIMIT ? OFFSET ?`,
    [...params, page.pageSize, (page.current - 1) * page.pageSize],
  );
  const ids = rows.map((row) => String(row.id));
  const picks = new Map<string, RowDataPacket>();
  const recycles = new Map<string, RowDataPacket>();
  const hidden = new Map<string, string[]>();
  if (ids.length > 0) {
    const marks = ids.map(() => '?').join(', ');
    for (const row of await query<RowDataPacket>(`SELECT * FROM ${spec.pickTable} WHERE pool_id IN (${marks})`, ids)) {
      picks.set(String(row.pool_id), row);
    }
    for (const row of await query<RowDataPacket>(`SELECT * FROM ${spec.recycleTable} WHERE pool_id IN (${marks})`, ids)) {
      recycles.set(String(row.pool_id), row);
    }
    for (const row of await query<RowDataPacket & { pool_id: string; field_id: string }>(
      `SELECT pool_id, field_id FROM ${spec.hiddenTable} WHERE pool_id IN (${marks})`,
      ids,
    )) {
      const list = hidden.get(row.pool_id) ?? [];
      list.push(row.field_id);
      hidden.set(row.pool_id, list);
    }
  }
  const userIds = rows.flatMap((row) => [...parseIds(row.scope_id), ...parseIds(row.owner_id), String(row.create_user ?? ''), String(row.update_user ?? '')]);
  const userNames = await namesOf(userIds);
  const form = await getFormConfig(spec.formKey, organizationId);
  const list = rows.map((row) => {
    const scopeIds = parseIds(row.scope_id);
    const ownerIds = parseIds(row.owner_id);
    const pick = picks.get(String(row.id));
    const recycle = recycles.get(String(row.id));
    const hiddenIds = new Set(hidden.get(String(row.id)) ?? []);
    return {
      id: row.id,
      name: row.name,
      organizationId: row.organization_id,
      scopeId: String(row.scope_id ?? '[]'),
      ownerId: String(row.owner_id ?? '[]'),
      enable: bitToBool(row.enable),
      auto: bitToBool(row.auto),
      createTime: asNumber(row.create_time),
      updateTime: asNumber(row.update_time),
      createUser: row.create_user,
      updateUser: row.update_user,
      createUserName: userNames.get(String(row.create_user ?? '')) ?? '',
      updateUserName: userNames.get(String(row.update_user ?? '')) ?? '',
      members: scopeIds.map((id) => ({ id, name: userNames.get(id) ?? id })),
      owners: ownerIds.map((id) => ({ id, name: userNames.get(id) ?? id })),
      pickRule: {
        limitOnNumber: pick ? bitToBool(pick.limit_on_number) : false,
        pickNumber: pick?.pick_number ?? null,
        limitPreOwner: pick ? bitToBool(pick.limit_pre_owner) : false,
        pickIntervalDays: pick?.pick_interval_days ?? null,
        limitNew: pick ? bitToBool(pick.limit_new) : false,
        newPickInterval: pick?.new_pick_interval ?? null,
      },
      recycleRule: {
        operator: recycle?.operator ?? 'AND',
        conditions: parseConditions(recycle?.condition == null ? null : String(recycle.condition)),
      },
      fieldConfigs: form.fields.map((field) => ({
        fieldId: field.id,
        fieldName: field.name,
        editable: true,
        enable: !hiddenIds.has(field.id),
      })),
    };
  });
  return toPager(list, asNumber(totals[0]?.total), page);
}

export async function savePool(spec: PoolSpec, organizationId: string, userId: string, body: unknown): Promise<Record<string, unknown>> {
  const request = asObject(body);
  const name = String(request.name ?? '').trim();
  if (!name) {
    throw validateFailed('名称不能为空');
  }
  const now = Date.now();
  const id = request.id ? String(request.id) : nextId();
  const scopeId = JSON.stringify(parseIds(request.scopeIds ?? request.scopeId));
  const ownerId = JSON.stringify(parseIds(request.ownerIds ?? request.ownerId));
  const pick = asObject(request.pickRule);
  const recycle = asObject(request.recycleRule);
  const hiddenIds = Array.isArray(request.hiddenFieldIds) ? request.hiddenFieldIds.map((item) => String(item)) : [];
  await withTransaction(async (tx) => {
    if (request.id) {
      await tx.execute(
        `UPDATE ${spec.table}
         SET name = ?, scope_id = ?, owner_id = ?, enable = ?, auto = ?, update_time = ?, update_user = ?
         WHERE id = ? AND organization_id = ?`,
        [name, scopeId, ownerId, request.enable === false ? 0 : 1, request.auto === true ? 1 : 0, now, userId, id, organizationId],
      );
    } else {
      await tx.execute(
        `INSERT INTO ${spec.table}
         (id, name, scope_id, organization_id, owner_id, enable, auto, create_time, update_time, create_user, update_user)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, name, scopeId, organizationId, ownerId, request.enable === false ? 0 : 1, request.auto === true ? 1 : 0, now, now, userId, userId],
      );
    }
    await tx.execute(`DELETE FROM ${spec.pickTable} WHERE pool_id = ?`, [id]);
    await tx.execute(
      `INSERT INTO ${spec.pickTable}
       (id, pool_id, limit_on_number, pick_number, limit_pre_owner, pick_interval_days, limit_new, new_pick_interval,
        create_user, create_time, update_user, update_time)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nextId(),
        id,
        pick.limitOnNumber ? 1 : 0,
        pick.pickNumber ?? null,
        pick.limitPreOwner ? 1 : 0,
        pick.pickIntervalDays ?? null,
        pick.limitNew ? 1 : 0,
        pick.newPickInterval ?? null,
        userId,
        now,
        userId,
        now,
      ],
    );
    await tx.execute(`DELETE FROM ${spec.recycleTable} WHERE pool_id = ?`, [id]);
    await tx.execute(
      `INSERT INTO ${spec.recycleTable}
       (id, pool_id, operator, \`condition\`, create_time, update_time, create_user, update_user)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [nextId(), id, recycle.operator ?? 'AND', JSON.stringify(recycle.conditions ?? []), now, now, userId, userId],
    );
    await tx.execute(`DELETE FROM ${spec.hiddenTable} WHERE pool_id = ?`, [id]);
    for (const fieldId of hiddenIds) {
      await tx.execute(`INSERT INTO ${spec.hiddenTable} (pool_id, field_id) VALUES (?, ?)`, [id, fieldId]);
    }
  });
  const page = await pagePools(spec, organizationId, { current: 1, pageSize: 500, keyword: name });
  return page.list.find((item) => item.id === id) ?? { id, name };
}

export async function switchPool(spec: PoolSpec, id: string, organizationId: string): Promise<void> {
  const rows = await query<RowDataPacket & { enable: unknown }>(
    `SELECT enable FROM ${spec.table} WHERE id = ? AND organization_id = ? LIMIT 1`,
    [id, organizationId],
  );
  if (!rows[0]) {
    throw notFound('公海不存在');
  }
  await execute(`UPDATE ${spec.table} SET enable = ?, update_time = ? WHERE id = ?`, [
    bitToBool(rows[0].enable) ? 0 : 1,
    Date.now(),
    id,
  ]);
}

export async function deletePool(spec: PoolSpec, id: string, organizationId: string): Promise<void> {
  const used = await query<RowDataPacket & { total: number }>(
    `SELECT COUNT(*) AS total FROM ${spec.recordTable} WHERE organization_id = ? AND pool_id = ? AND in_shared_pool = 1`,
    [organizationId, id],
  );
  if (asNumber(used[0]?.total) > 0) {
    throw validateFailed('公海中仍有数据，不能删除');
  }
  await execute(`DELETE FROM ${spec.pickTable} WHERE pool_id = ?`, [id]);
  await execute(`DELETE FROM ${spec.recycleTable} WHERE pool_id = ?`, [id]);
  await execute(`DELETE FROM ${spec.hiddenTable} WHERE pool_id = ?`, [id]);
  await execute(`DELETE FROM ${spec.table} WHERE id = ? AND organization_id = ?`, [id, organizationId]);
}

export async function poolHasRecords(spec: PoolSpec, id: string, organizationId: string): Promise<boolean> {
  const used = await query<RowDataPacket & { total: number }>(
    `SELECT COUNT(*) AS total FROM ${spec.recordTable} WHERE organization_id = ? AND pool_id = ? AND in_shared_pool = 1`,
    [organizationId, id],
  );
  return asNumber(used[0]?.total) > 0;
}

export async function pageRules(organizationId: string, body: unknown): Promise<Pager<Record<string, unknown>>> {
  const request = asObject(body);
  const page = normalizePage(Number(request.current), Number(request.pageSize));
  const totals = await query<RowDataPacket & { total: number }>(
    'SELECT COUNT(*) AS total FROM opportunity_rule WHERE organization_id = ?',
    [organizationId],
  );
  const rows = await query<RowDataPacket>(
    `SELECT * FROM opportunity_rule WHERE organization_id = ? ORDER BY create_time DESC LIMIT ? OFFSET ?`,
    [organizationId, page.pageSize, (page.current - 1) * page.pageSize],
  );
  const userIds = rows.flatMap((row) => [...parseIds(row.scope_id), ...parseIds(row.owner_id), String(row.create_user ?? ''), String(row.update_user ?? '')]);
  const userNames = await namesOf(userIds);
  return toPager(rows.map((row) => ({
    id: row.id,
    name: row.name,
    enable: bitToBool(row.enable),
    auto: bitToBool(row.auto),
    operator: row.operator ?? 'AND',
    organizationId: row.organization_id,
    ownerId: String(row.owner_id ?? '[]'),
    scopeId: String(row.scope_id ?? '[]'),
    condition: String(row.condition ?? '[]'),
    conditions: parseConditions(row.condition == null ? null : String(row.condition)),
    createUser: row.create_user,
    updateUser: row.update_user,
    createUserName: userNames.get(String(row.create_user ?? '')) ?? '',
    updateUserName: userNames.get(String(row.update_user ?? '')) ?? '',
    createTime: asNumber(row.create_time),
    updateTime: asNumber(row.update_time),
    members: parseIds(row.scope_id).map((id) => ({ id, name: userNames.get(id) ?? id })),
    owners: parseIds(row.owner_id).map((id) => ({ id, name: userNames.get(id) ?? id })),
  })), asNumber(totals[0]?.total), page);
}

export async function saveRule(organizationId: string, userId: string, body: unknown): Promise<{ id: string }> {
  const request = asObject(body);
  const name = String(request.name ?? '').trim();
  if (!name) {
    throw validateFailed('规则名称不能为空');
  }
  const now = Date.now();
  const id = request.id ? String(request.id) : nextId();
  const values = [
    name,
    JSON.stringify(parseIds(request.ownerIds ?? request.ownerId)),
    JSON.stringify(parseIds(request.scopeIds ?? request.scopeId)),
    request.enable === false ? 0 : 1,
    request.auto === true ? 1 : 0,
    request.operator ?? 'AND',
    JSON.stringify(request.conditions ?? []),
    now,
    userId,
  ];
  if (request.id) {
    await execute(
      `UPDATE opportunity_rule
       SET name = ?, owner_id = ?, scope_id = ?, enable = ?, auto = ?, operator = ?, \`condition\` = ?, update_time = ?, update_user = ?
       WHERE id = ? AND organization_id = ?`,
      [...values, id, organizationId],
    );
  } else {
    await execute(
      `INSERT INTO opportunity_rule
       (id, name, organization_id, owner_id, scope_id, enable, auto, operator, \`condition\`, create_time, update_time, create_user, update_user)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, name, organizationId, values[1], values[2], values[3], values[4], values[5], values[6], now, now, userId, userId],
    );
  }
  return { id };
}

export async function switchRule(id: string, organizationId: string): Promise<void> {
  const rows = await query<RowDataPacket & { enable: unknown }>(
    'SELECT enable FROM opportunity_rule WHERE id = ? AND organization_id = ? LIMIT 1',
    [id, organizationId],
  );
  if (!rows[0]) {
    throw notFound('规则不存在');
  }
  await execute('UPDATE opportunity_rule SET enable = ?, update_time = ? WHERE id = ?', [
    bitToBool(rows[0].enable) ? 0 : 1,
    Date.now(),
    id,
  ]);
}

export async function deleteRule(id: string, organizationId: string): Promise<void> {
  await execute('DELETE FROM opportunity_rule WHERE id = ? AND organization_id = ?', [id, organizationId]);
}

export async function listCapacity(table: 'customer_capacity' | 'clue_capacity', organizationId: string): Promise<Record<string, unknown>[]> {
  const rows = await query<RowDataPacket>(
    `SELECT * FROM ${table} WHERE organization_id = ? ORDER BY create_time DESC`,
    [organizationId],
  );
  const userIds = rows.flatMap((row) => parseIds(row.scope_id));
  const userNames = await namesOf(userIds);
  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    scopeId: String(row.scope_id ?? '[]'),
    capacity: row.capacity == null ? null : asNumber(row.capacity),
    createUser: row.create_user,
    updateUser: row.update_user,
    createTime: asNumber(row.create_time),
    updateTime: asNumber(row.update_time),
    members: parseIds(row.scope_id).map((id) => ({ id, name: userNames.get(id) ?? id })),
    filters: parseConditions(row.filter == null ? null : String(row.filter)),
  }));
}

export async function saveCapacity(table: 'customer_capacity' | 'clue_capacity', organizationId: string, userId: string, body: unknown): Promise<{ id: string }> {
  const request = asObject(body);
  const now = Date.now();
  const id = request.id ? String(request.id) : nextId();
  const scopeId = JSON.stringify(parseIds(request.scopeIds ?? request.scopeId));
  const capacity = request.capacity == null || request.capacity === '' ? null : Number(request.capacity);
  if (request.id) {
    await execute(
      `UPDATE ${table} SET scope_id = ?, capacity = ?, update_time = ?, update_user = ? WHERE id = ? AND organization_id = ?`,
      [scopeId, capacity, now, userId, id, organizationId],
    );
  } else {
    await execute(
      `INSERT INTO ${table} (id, organization_id, scope_id, capacity, create_time, update_time, create_user, update_user)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, organizationId, scopeId, capacity, now, now, userId, userId],
    );
  }
  return { id };
}

export async function deleteCapacity(table: 'customer_capacity' | 'clue_capacity', id: string, organizationId: string): Promise<void> {
  await execute(`DELETE FROM ${table} WHERE id = ? AND organization_id = ?`, [id, organizationId]);
}
