import type { RowDataPacket } from 'mysql2';

import { asNumber, bitToBool } from '../support/bit.js';
import { execute, query, withTransaction } from '../support/db.js';
import { failed, notFound } from '../support/errors.js';
import { nextId } from '../support/id.js';
import { translate } from '../support/i18n.js';

export async function listDict(module: string, organizationId: string) {
  const rows = await query<RowDataPacket & {
    id: string;
    name: string;
    module: string;
    type: string;
    pos: number | string;
    organization_id: string;
    create_time: number | string;
    update_time: number | string;
    create_user: string;
    update_user: string;
  }>(
    `SELECT id, name, module, type, pos, organization_id, create_time, update_time, create_user, update_user
     FROM sys_dict WHERE module = ? AND organization_id = ? ORDER BY pos`,
    [module, organizationId],
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    module: row.module,
    type: row.type,
    pos: asNumber(row.pos),
    organizationId: row.organization_id,
    createTime: asNumber(row.create_time),
    updateTime: asNumber(row.update_time),
    createUser: row.create_user,
    updateUser: row.update_user,
  }));
}

export async function addDict(module: string, name: string, organizationId: string, userId: string): Promise<void> {
  const rows = await query<RowDataPacket & { pos: number | string | null }>(
    'SELECT MAX(pos) AS pos FROM sys_dict WHERE module = ? AND organization_id = ?',
    [module, organizationId],
  );
  const now = Date.now();
  await execute(
    `INSERT INTO sys_dict
       (id, name, module, type, pos, organization_id, create_time, update_time, create_user, update_user)
     VALUES (?, ?, ?, 'TEXT', ?, ?, ?, ?, ?, ?)`,
    [nextId(), name, module, asNumber(rows[0]?.pos) + 4096, organizationId, now, now, userId, userId],
  );
}

export async function updateDict(id: string, name: string, userId: string): Promise<void> {
  await execute('UPDATE sys_dict SET name = ?, update_time = ?, update_user = ? WHERE id = ?', [name, Date.now(), userId, id]);
}

export async function deleteDict(id: string): Promise<void> {
  await execute('DELETE FROM sys_dict WHERE id = ?', [id]);
}

export async function switchDict(module: string, organizationId: string, enable: boolean): Promise<void> {
  const rows = await query<RowDataPacket>(
    'SELECT module FROM sys_dict_config WHERE module = ? AND organization_id = ?',
    [module, organizationId],
  );
  if (rows.length > 0) {
    await execute(
      'UPDATE sys_dict_config SET enabled = ? WHERE module = ? AND organization_id = ?',
      [enable ? 1 : 0, module, organizationId],
    );
    return;
  }
  await execute(
    'INSERT INTO sys_dict_config (module, organization_id, enabled) VALUES (?, ?, ?)',
    [module, organizationId, enable ? 1 : 0],
  );
}

export async function dictConfig(module: string, organizationId: string) {
  const dictList = await listDict(module, organizationId);
  const systemName = module === 'OPPORTUNITY_FAIL_RS'
    ? translate('system.auto.closed', '系统自动关闭')
    : translate('system.auto.recycle', '系统自动回收');
  const rows = await query<RowDataPacket & { enabled: unknown }>(
    'SELECT enabled FROM sys_dict_config WHERE module = ? AND organization_id = ? LIMIT 1',
    [module, organizationId],
  );
  return {
    enable: rows[0] ? bitToBool(rows[0].enabled) : false,
    dictList: [...dictList, { id: 'system', name: systemName, module }],
  };
}

export async function listModules(organizationId: string) {
  const rows = await query<RowDataPacket & {
    id: string;
    organization_id: string;
    module_key: string;
    enable: unknown;
    pos: number | string;
  }>(
    `SELECT id, organization_id, module_key, enable, pos
     FROM sys_module WHERE organization_id = ? ORDER BY pos`,
    [organizationId],
  );
  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    moduleKey: row.module_key,
    enable: bitToBool(row.enable),
    pos: asNumber(row.pos),
    disabled: false,
  }));
}

export async function switchModule(id: string, userId: string): Promise<void> {
  const rows = await query<RowDataPacket & { enable: unknown }>(
    'SELECT enable FROM sys_module WHERE id = ? LIMIT 1',
    [id],
  );
  if (!rows[0]) {
    return;
  }
  await execute(
    'UPDATE sys_module SET enable = ?, update_time = ?, update_user = ? WHERE id = ?',
    [bitToBool(rows[0].enable) ? 0 : 1, Date.now(), userId, id],
  );
}

export async function advancedSearchEnabled(): Promise<boolean> {
  const rows = await query<RowDataPacket & { param_value: string | null }>(
    'SELECT param_value FROM sys_parameter WHERE param_key = ? LIMIT 1',
    ['advance.search.setting'],
  );
  if (!rows[0]) {
    return true;
  }
  return rows[0].param_value?.toLowerCase() !== 'false';
}

export async function switchAdvancedSearch(): Promise<void> {
  const current = await advancedSearchEnabled();
  const next = current ? 'false' : 'true';
  const rows = await query<RowDataPacket>(
    'SELECT param_key FROM sys_parameter WHERE param_key = ?',
    ['advance.search.setting'],
  );
  if (rows.length > 0) {
    await execute('UPDATE sys_parameter SET param_value = ? WHERE param_key = ?', [next, 'advance.search.setting']);
    return;
  }
  await execute(
    'INSERT INTO sys_parameter (param_key, param_value, type) VALUES (?, ?, ?)',
    ['advance.search.setting', next, 'TEXT'],
  );
}

export async function sortDict(id: string, start: number, end: number, userId: string): Promise<void> {
  const rows = await query<RowDataPacket & { module: string; organization_id: string }>(
    'SELECT module, organization_id FROM sys_dict WHERE id = ? LIMIT 1',
    [id],
  );
  const current = rows[0];
  if (!current) {
    throw notFound('字典不存在');
  }
  await withTransaction(async (tx) => {
    if (start < end) {
      await tx.execute(
        'UPDATE sys_dict SET pos = pos - 1 WHERE module = ? AND organization_id = ? AND pos > ? AND pos <= ?',
        [current.module, current.organization_id, start, end],
      );
    } else if (start > end) {
      await tx.execute(
        'UPDATE sys_dict SET pos = pos + 1 WHERE module = ? AND organization_id = ? AND pos >= ? AND pos < ?',
        [current.module, current.organization_id, end, start],
      );
    }
    await tx.execute(
      'UPDATE sys_dict SET pos = ?, update_user = ?, update_time = ? WHERE id = ?',
      [end, userId, Date.now(), id],
    );
  });
}

export async function sortModule(id: string, start: number, end: number, userId: string): Promise<void> {
  const rows = await query<RowDataPacket & { organization_id: string }>(
    'SELECT organization_id FROM sys_module WHERE id = ? LIMIT 1',
    [id],
  );
  const current = rows[0];
  if (!current) {
    throw notFound('模块不存在');
  }
  await withTransaction(async (tx) => {
    if (start < end) {
      await tx.execute(
        'UPDATE sys_module SET pos = pos - 1 WHERE organization_id = ? AND pos > ? AND pos <= ?',
        [current.organization_id, start, end],
      );
    } else if (start > end) {
      await tx.execute(
        'UPDATE sys_module SET pos = pos + 1 WHERE organization_id = ? AND pos >= ? AND pos < ?',
        [current.organization_id, end, start],
      );
    }
    await tx.execute(
      'UPDATE sys_module SET pos = ?, update_user = ?, update_time = ? WHERE id = ?',
      [end, userId, Date.now(), id],
    );
  });
}

export interface LogPageFilter {
  current: number;
  pageSize: number;
  keyword?: string;
  operator?: string;
  startTime?: number;
  endTime?: number;
  type?: string;
  module?: string;
}

export async function pageLoginLogs(organizationId: string, filter: LogPageFilter) {
  assertTimeRange(filter.startTime, filter.endTime);
  const where = ['sou.organization_id = ?'];
  const params: unknown[] = [organizationId];
  if (filter.operator) {
    where.push('log.operator = ?');
    params.push(filter.operator);
  }
  if (filter.keyword) {
    where.push('su.name LIKE ?');
    params.push(`%${filter.keyword}%`);
  }
  if (filter.startTime != null && filter.endTime != null) {
    where.push('log.create_time BETWEEN ? AND ?');
    params.push(filter.startTime, filter.endTime);
  }
  const whereSql = where.join(' AND ');
  const countRows = await query<RowDataPacket & { total: number }>(
    `SELECT COUNT(*) AS total
     FROM sys_login_log log
              INNER JOIN sys_organization_user sou ON log.operator = sou.user_id
              LEFT JOIN sys_user su ON su.id = log.operator
     WHERE ${whereSql}`,
    params,
  );
  const rows = await query<RowDataPacket & {
    id: string;
    create_time: number | string;
    operator: string;
    login_address: string | null;
    platform: string | null;
    operatorName: string | null;
  }>(
    `SELECT log.id, log.create_time, log.operator, log.login_address, log.platform, su.name AS operatorName
     FROM sys_login_log log
              INNER JOIN sys_organization_user sou ON log.operator = sou.user_id
              LEFT JOIN sys_user su ON su.id = log.operator
     WHERE ${whereSql}
     ORDER BY log.create_time DESC
     LIMIT ? OFFSET ?`,
    [...params, filter.pageSize, (filter.current - 1) * filter.pageSize],
  );
  return {
    total: asNumber(countRows[0]?.total),
    list: rows.map((row) => ({
      id: row.id,
      createTime: asNumber(row.create_time),
      operator: row.operator,
      operatorName: row.operatorName ?? '',
      loginAddress: row.login_address,
      platform: row.platform,
    })),
  };
}

export async function pageOperationLogs(organizationId: string, filter: LogPageFilter) {
  assertTimeRange(filter.startTime, filter.endTime);
  const where = ['log.organization_id = ?'];
  const params: unknown[] = [organizationId];
  if (filter.operator) {
    where.push('log.create_user = ?');
    params.push(filter.operator);
  }
  if (filter.type) {
    where.push('log.type = ?');
    params.push(filter.type);
  }
  if (filter.module) {
    where.push('log.module LIKE ?');
    params.push(`${filter.module}%`);
  }
  if (filter.keyword) {
    where.push('log.resource_name LIKE ?');
    params.push(`%${filter.keyword}%`);
  }
  if (filter.startTime != null && filter.endTime != null) {
    where.push('log.create_time BETWEEN ? AND ?');
    params.push(filter.startTime, filter.endTime);
  }
  const whereSql = where.join(' AND ');
  const countRows = await query<RowDataPacket & { total: number }>(
    `SELECT COUNT(*) AS total
     FROM sys_operation_log log
              INNER JOIN sys_user su ON su.id = log.create_user
     WHERE ${whereSql}`,
    params,
  );
  const rows = await query<RowDataPacket & {
    id: string;
    type: string;
    module: string;
    resource_name: string | null;
    detail: string | null;
    create_time: number | string;
    create_user: string;
    operatorName: string | null;
  }>(
    `SELECT log.id, log.type, log.module, log.resource_name, log.detail, log.create_time, log.create_user, su.name AS operatorName
     FROM sys_operation_log log
              INNER JOIN sys_user su ON su.id = log.create_user
     WHERE ${whereSql}
     ORDER BY log.create_time DESC
     LIMIT ? OFFSET ?`,
    [...params, filter.pageSize, (filter.current - 1) * filter.pageSize],
  );
  return {
    total: asNumber(countRows[0]?.total),
    list: rows.map((row) => ({
      id: row.id,
      type: row.type,
      module: row.module,
      resourceName: row.resource_name,
      detail: row.detail ?? '',
      createTime: asNumber(row.create_time),
      operator: row.create_user,
      operatorName: row.operatorName ?? '',
    })),
  };
}

export async function operationLogDetail(id: string, organizationId: string) {
  const rows = await query<RowDataPacket & {
    id: string;
    type: string;
    module: string;
    resource_name: string | null;
    detail: string | null;
    create_time: number | string;
    create_user: string;
    operatorName: string | null;
    organization_id: string;
  }>(
    `SELECT log.id, log.type, log.module, log.resource_name, log.detail, log.create_time, log.create_user,
            log.organization_id, su.name AS operatorName
     FROM sys_operation_log log
              LEFT JOIN sys_user su ON su.id = log.create_user
     WHERE log.id = ? LIMIT 1`,
    [id],
  );
  const row = rows[0];
  if (!row || row.organization_id !== organizationId) {
    throw notFound('日志不存在');
  }
  const blobs = await query<RowDataPacket & { original_value: unknown; modified_value: unknown }>(
    'SELECT original_value, modified_value FROM sys_operation_log_blob WHERE id = ? LIMIT 1',
    [id],
  );
  return {
    id: row.id,
    type: row.type,
    module: row.module,
    resourceName: row.resource_name,
    detail: row.detail ?? '',
    createTime: asNumber(row.create_time),
    operator: row.create_user,
    operatorName: row.operatorName ?? '',
    diffs: jsonDiffs(blobText(blobs[0]?.original_value), blobText(blobs[0]?.modified_value)),
  };
}

function assertTimeRange(startTime?: number, endTime?: number): void {
  if (startTime != null && endTime != null && startTime > endTime) {
    throw failed('开始时间必须早于结束时间');
  }
}

function blobText(value: unknown): string {
  if (value == null) {
    return '';
  }
  if (Buffer.isBuffer(value)) {
    return value.toString('utf8');
  }
  return String(value);
}

function jsonDiffs(before: string, after: string) {
  const left = parseObject(before);
  const right = parseObject(after);
  if (!left && !right) {
    return [];
  }
  const keys = new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})]);
  const diffs = [];
  for (const column of keys) {
    const oldValue = left?.[column];
    const newValue = right?.[column];
    if (JSON.stringify(oldValue) === JSON.stringify(newValue)) {
      continue;
    }
    const type = oldValue === undefined ? 'add' : newValue === undefined ? 'removed' : 'modified';
    diffs.push({
      column,
      columnName: translate(column, column),
      oldValue: oldValue ?? '',
      newValue: newValue ?? '',
      oldValueName: displayValue(oldValue),
      newValueName: displayValue(newValue),
      type,
    });
  }
  return diffs;
}

function parseObject(text: string): Record<string, unknown> | null {
  if (!text) {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function displayValue(value: unknown): string | number {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return value;
  }
  return JSON.stringify(value);
}
