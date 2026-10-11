import type { RowDataPacket } from 'mysql2';

import { asNumber, bitToBool } from '../support/bit.js';
import { execute, query } from '../support/db.js';
import { failed, validateFailed } from '../support/errors.js';
import { camelToSnake, ident, snakeToCamel } from '../support/ident.js';
import { nextId } from '../support/id.js';

export interface ColumnMeta {
  column: string;
  field: string;
  dataType: string;
  columnType: string;
  nullable: boolean;
}

export interface ModuleFieldValue {
  fieldId: string;
  fieldValue: unknown;
}

export interface RecordQuery {
  organizationId: string;
  current: number;
  pageSize: number;
  keyword?: string;
  keywordColumns: string[];
  equals: Record<string, unknown>;
  inIds?: string[];
  inField?: string;
  inValues?: string[];
  ownerIds?: string[];
  inPool?: boolean;
  poolColumn?: string;
  sortField?: string;
  sortDesc?: boolean;
}

const columnsCache = new Map<string, ColumnMeta[]>();

const BLOB_FIELD_TYPES = new Set([
  'TEXTAREA',
  'INPUT_MULTIPLE',
  'MEMBER_MULTIPLE',
  'DEPARTMENT_MULTIPLE',
  'SELECT_MULTIPLE',
  'CHECKBOX',
  'DATA_SOURCE_MULTIPLE',
  'ATTACHMENT',
  'LINK',
  'PICTURE',
  'SUB_PRODUCT',
  'SUB_PRICE',
]);

export async function tableColumns(table: string): Promise<ColumnMeta[]> {
  const cached = columnsCache.get(table);
  if (cached) {
    return cached;
  }
  const rows = await query<RowDataPacket & {
    columnName: string;
    dataType: string;
    columnType: string;
    nullable: string;
  }>(
    `SELECT COLUMN_NAME AS columnName, DATA_TYPE AS dataType, COLUMN_TYPE AS columnType, IS_NULLABLE AS nullable
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`,
    [table],
  );
  const columns = rows.map((row) => ({
    column: row.columnName,
    field: snakeToCamel(row.columnName),
    dataType: row.dataType,
    columnType: row.columnType,
    nullable: row.nullable === 'YES',
  }));
  columnsCache.set(table, columns);
  return columns;
}

export function columnByField(columns: ColumnMeta[], field: string): ColumnMeta | undefined {
  return columns.find((column) => column.field === field || column.column === field || column.column === camelToSnake(field));
}

function isBit(column: ColumnMeta): boolean {
  return column.dataType === 'bit' || (column.dataType === 'tinyint' && column.columnType.includes('(1)'));
}

function isNumber(column: ColumnMeta): boolean {
  return ['bigint', 'int', 'integer', 'decimal', 'double', 'float', 'smallint', 'mediumint'].includes(column.dataType);
}

export function readCell(column: ColumnMeta, value: unknown): unknown {
  if (value == null) {
    return null;
  }
  if (isBit(column)) {
    return bitToBool(value);
  }
  if (typeof value === 'bigint' || (typeof value === 'string' && isNumber(column))) {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) || column.dataType === 'decimal' ? numeric : String(value);
  }
  if (Buffer.isBuffer(value)) {
    return value.toString('utf8');
  }
  return value;
}

/** 数字列收到空字符串时写成 NULL。MySQL 严格模式会拒绝 '' 写入 decimal。 */
export function isBlankNumber(column: ColumnMeta, value: unknown): boolean {
  return isNumber(column) && typeof value === 'string' && value.trim() === '';
}

function writeCell(column: ColumnMeta, value: unknown): unknown {
  if (value == null || isBlankNumber(column, value)) {
    return null;
  }
  if (isBit(column)) {
    return value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0;
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return value;
}

function mapRow(columns: ColumnMeta[], row: RowDataPacket): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const column of columns) {
    record[column.field] = readCell(column, row[column.column]);
  }
  return record;
}

async function run<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof Error && error.name === 'AppError') {
      throw error;
    }
    const message = error instanceof Error ? error.message.split('\n')[0] : '数据保存失败';
    throw failed(message ?? '数据保存失败');
  }
}

export async function pageRecords(table: string, request: RecordQuery): Promise<{ list: Record<string, unknown>[]; total: number }> {
  const columns = await tableColumns(table);
  const where: string[] = [];
  const params: unknown[] = [];
  if (columnByField(columns, 'organizationId')) {
    where.push(`${ident('organization_id')} = ?`);
    params.push(request.organizationId);
  }
  if (request.poolColumn && columnByField(columns, request.poolColumn)) {
    where.push(`${ident(request.poolColumn)} = ?`);
    params.push(request.inPool ? 1 : 0);
  }
  for (const [field, value] of Object.entries(request.equals)) {
    if (value == null || value === '') {
      continue;
    }
    const column = columnByField(columns, field);
    if (!column) {
      continue;
    }
    where.push(`${ident(column.column)} = ?`);
    params.push(writeCell(column, value));
  }
  if (request.ownerIds) {
    const owner = columnByField(columns, 'owner');
    if (owner) {
      if (request.ownerIds.length === 0) {
        return { list: [], total: 0 };
      }
      where.push(`${ident(owner.column)} IN (${request.ownerIds.map(() => '?').join(', ')})`);
      params.push(...request.ownerIds);
    }
  }
  if (request.inIds) {
    if (request.inIds.length === 0) {
      return { list: [], total: 0 };
    }
    where.push(`${ident('id')} IN (${request.inIds.map(() => '?').join(', ')})`);
    params.push(...request.inIds);
  }
  if (request.inValues) {
    if (request.inValues.length === 0) {
      return { list: [], total: 0 };
    }
    const column = columnByField(columns, request.inField || 'id');
    if (column) {
      where.push(`${ident(column.column)} IN (${request.inValues.map(() => '?').join(', ')})`);
      params.push(...request.inValues);
    }
  }
  const keyword = request.keyword?.trim();
  if (keyword) {
    const likes = request.keywordColumns
      .map((field) => columnByField(columns, field))
      .filter((column): column is ColumnMeta => Boolean(column));
    if (likes.length > 0) {
      where.push(`(${likes.map((column) => `${ident(column.column)} LIKE ?`).join(' OR ')})`);
      params.push(...likes.map(() => `%${keyword}%`));
    }
  }
  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const totals = await query<RowDataPacket & { total: number }>(
    `SELECT COUNT(*) AS total FROM ${ident(table)} ${clause}`,
    params,
  );
  const sort = columnByField(columns, request.sortField || 'createTime') ?? columnByField(columns, 'id');
  const direction = request.sortDesc === false ? 'ASC' : 'DESC';
  const offset = (request.current - 1) * request.pageSize;
  const rows = await query<RowDataPacket>(
    `SELECT * FROM ${ident(table)} ${clause} ORDER BY ${ident(sort?.column ?? 'id')} ${direction} LIMIT ? OFFSET ?`,
    [...params, request.pageSize, offset],
  );
  return {
    total: asNumber(totals[0]?.total),
    list: rows.map((row) => mapRow(columns, row)),
  };
}

export async function findRecord(table: string, id: string, organizationId: string): Promise<Record<string, unknown> | null> {
  const columns = await tableColumns(table);
  const org = columnByField(columns, 'organizationId');
  const rows = await query<RowDataPacket>(
    org
      ? `SELECT * FROM ${ident(table)} WHERE id = ? AND organization_id = ? LIMIT 1`
      : `SELECT * FROM ${ident(table)} WHERE id = ? LIMIT 1`,
    org ? [id, organizationId] : [id],
  );
  return rows[0] ? mapRow(columns, rows[0]) : null;
}

export async function insertRecord(table: string, values: Record<string, unknown>): Promise<void> {
  const columns = await tableColumns(table);
  const used: ColumnMeta[] = [];
  const params: unknown[] = [];
  for (const column of columns) {
    if (values[column.field] === undefined) {
      continue;
    }
    used.push(column);
    params.push(writeCell(column, values[column.field]));
  }
  if (used.length === 0) {
    throw validateFailed('没有可保存的字段');
  }
  await run(() => execute(
    `INSERT INTO ${ident(table)} (${used.map((column) => ident(column.column)).join(', ')})
     VALUES (${used.map(() => '?').join(', ')})`,
    params,
  ));
}

export async function updateRecord(
  table: string,
  id: string,
  organizationId: string,
  values: Record<string, unknown>,
): Promise<void> {
  const columns = await tableColumns(table);
  const used: ColumnMeta[] = [];
  const params: unknown[] = [];
  for (const column of columns) {
    if (column.field === 'id' || column.field === 'organizationId' || values[column.field] === undefined) {
      continue;
    }
    used.push(column);
    params.push(writeCell(column, values[column.field]));
  }
  if (used.length === 0) {
    return;
  }
  const org = columnByField(columns, 'organizationId');
  params.push(id);
  if (org) {
    params.push(organizationId);
  }
  await run(() => execute(
    `UPDATE ${ident(table)} SET ${used.map((column) => `${ident(column.column)} = ?`).join(', ')}
     WHERE id = ?${org ? ' AND organization_id = ?' : ''}`,
    params,
  ));
}

export async function deleteRecords(table: string, ids: string[], organizationId: string): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const columns = await tableColumns(table);
  const marks = ids.map(() => '?').join(', ');
  const org = columnByField(columns, 'organizationId');
  await run(() => execute(
    org
      ? `DELETE FROM ${ident(table)} WHERE organization_id = ? AND id IN (${marks})`
      : `DELETE FROM ${ident(table)} WHERE id IN (${marks})`,
    org ? [organizationId, ...ids] : ids,
  ));
}

export async function loadModuleFields(
  fieldTable: string | undefined,
  blobTable: string | undefined,
  resourceIds: string[],
): Promise<Map<string, ModuleFieldValue[]>> {
  const grouped = new Map<string, ModuleFieldValue[]>();
  if (resourceIds.length === 0) {
    return grouped;
  }
  const marks = resourceIds.map(() => '?').join(', ');
  const merged = new Map<string, Map<string, unknown>>();
  if (fieldTable) {
    const rows = await query<RowDataPacket & { resource_id: string; field_id: string; field_value: string }>(
      `SELECT resource_id, field_id, field_value FROM ${ident(fieldTable)} WHERE resource_id IN (${marks})`,
      resourceIds,
    );
    for (const row of rows) {
      const fields = merged.get(row.resource_id) ?? new Map<string, unknown>();
      fields.set(row.field_id, parseStoredValue(row.field_value));
      merged.set(row.resource_id, fields);
    }
  }
  if (blobTable) {
    const rows = await query<RowDataPacket & { resource_id: string; field_id: string; field_value: string }>(
      `SELECT resource_id, field_id, field_value FROM ${ident(blobTable)} WHERE resource_id IN (${marks})`,
      resourceIds,
    );
    for (const row of rows) {
      const fields = merged.get(row.resource_id) ?? new Map<string, unknown>();
      fields.set(row.field_id, parseStoredValue(row.field_value));
      merged.set(row.resource_id, fields);
    }
  }
  for (const [resourceId, fields] of merged) {
    grouped.set(resourceId, [...fields.entries()].map(([fieldId, fieldValue]) => ({ fieldId, fieldValue })));
  }
  return grouped;
}

function parseStoredValue(value: string): unknown {
  if (value.startsWith('{') || value.startsWith('[')) {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }
  return value;
}

export function isBlobField(type: string | undefined, value: unknown): boolean {
  if (type && BLOB_FIELD_TYPES.has(type)) {
    return true;
  }
  if (value != null && typeof value === 'object') {
    return true;
  }
  return typeof value === 'string' && value.length > 200;
}

export async function replaceModuleFields(
  fieldTable: string | undefined,
  blobTable: string | undefined,
  resourceId: string,
  values: ModuleFieldValue[],
  fieldTypes: Map<string, string>,
): Promise<void> {
  if (!fieldTable && !blobTable) {
    return;
  }
  if (fieldTable) {
    await execute(`DELETE FROM ${ident(fieldTable)} WHERE resource_id = ?`, [resourceId]);
  }
  if (blobTable) {
    await execute(`DELETE FROM ${ident(blobTable)} WHERE resource_id = ?`, [resourceId]);
  }
  for (const item of values) {
    if (!item.fieldId || item.fieldValue == null || item.fieldValue === '' || (Array.isArray(item.fieldValue) && item.fieldValue.length === 0)) {
      continue;
    }
    const stored = typeof item.fieldValue === 'string' ? item.fieldValue : JSON.stringify(item.fieldValue);
    const blob = isBlobField(fieldTypes.get(item.fieldId), item.fieldValue);
    const table = blob ? blobTable : fieldTable;
    if (!table) {
      continue;
    }
    await execute(
      `INSERT INTO ${ident(table)} (id, resource_id, field_id, field_value) VALUES (?, ?, ?, ?)`,
      [nextId(), resourceId, item.fieldId, stored],
    );
  }
}

export async function deleteModuleFields(
  fieldTable: string | undefined,
  blobTable: string | undefined,
  resourceIds: string[],
): Promise<void> {
  if (resourceIds.length === 0) {
    return;
  }
  const marks = resourceIds.map(() => '?').join(', ');
  if (fieldTable) {
    await execute(`DELETE FROM ${ident(fieldTable)} WHERE resource_id IN (${marks})`, resourceIds);
  }
  if (blobTable) {
    await execute(`DELETE FROM ${ident(blobTable)} WHERE resource_id IN (${marks})`, resourceIds);
  }
}

export async function sumAmount(table: string, organizationId: string, inPool?: boolean, poolColumn?: string): Promise<number> {
  const columns = await tableColumns(table);
  if (!columnByField(columns, 'amount')) {
    return 0;
  }
  const where = ['organization_id = ?'];
  const params: unknown[] = [organizationId];
  if (poolColumn && columnByField(columns, poolColumn)) {
    where.push(`${ident(poolColumn)} = ?`);
    params.push(inPool ? 1 : 0);
  }
  const rows = await query<RowDataPacket & { total: string | number | null }>(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM ${ident(table)} WHERE ${where.join(' AND ')}`,
    params,
  );
  return asNumber(rows[0]?.total);
}
