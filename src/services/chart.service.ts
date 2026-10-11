import type { RowDataPacket } from 'mysql2';

import { columnByField, tableColumns, type ColumnMeta } from '../models/record.model.js';
import type { EntitySpec } from './crm-catalog.js';
import { asObject } from './record.service.js';
import { query } from '../support/db.js';
import { ident } from '../support/ident.js';

export interface ChartPoint {
  categoryAxis: string;
  categoryAxisName: string;
  subCategoryAxis: string | null;
  subCategoryAxisName: string | null;
  valueAxis: number;
}

export async function buildChart(entity: EntitySpec, organizationId: string, body: unknown): Promise<ChartPoint[]> {
  const config = asObject(asObject(body).chartConfig);
  const columns = await tableColumns(entity.table);
  const category = await resolveColumn(columns, String(asObject(config.categoryAxis).fieldId || 'owner'));
  const sub = await resolveColumn(columns, String(asObject(config.subCategoryAxis).fieldId || ''));
  const sumAmount = String(asObject(config.valueAxis).aggregateMethod || '').toUpperCase().includes('SUM')
    && Boolean(columnByField(columns, 'amount'));
  if (!category) {
    return [];
  }

  const where = ['t.organization_id = ?'];
  const params: unknown[] = [organizationId];
  if (entity.poolColumn && columnByField(columns, entity.poolColumn)) {
    where.push(`t.${ident(entity.poolColumn)} = ?`);
    params.push(entity.inPool ? 1 : 0);
  }
  const valueSql = sumAmount ? 'COALESCE(SUM(t.amount), 0)' : 'COUNT(*)';
  const subSelect = sub ? `, IFNULL(CAST(t.${ident(sub)} AS CHAR), '') AS sub_axis` : '';
  const subGroup = sub ? ', sub_axis' : '';
  const rows = await query<RowDataPacket & { axis: string; sub_axis?: string; total: number | string }>(
    `SELECT IFNULL(CAST(t.${ident(category)} AS CHAR), '') AS axis${subSelect}, ${valueSql} AS total
     FROM ${ident(entity.table)} t
     WHERE ${where.join(' AND ')}
     GROUP BY axis${subGroup}
     ORDER BY total DESC
     LIMIT 30`,
    params,
  );
  const categoryNames = await axisNames(category, rows.map((row) => row.axis), entity.stageTable);
  const subNames = sub ? await axisNames(sub, rows.map((row) => row.sub_axis ?? ''), entity.stageTable) : new Map<string, string>();
  return rows.map((row) => ({
    categoryAxis: row.axis,
    categoryAxisName: categoryNames.get(row.axis) || row.axis || '未分组',
    subCategoryAxis: sub ? (row.sub_axis ?? '') : null,
    subCategoryAxisName: sub ? (subNames.get(row.sub_axis ?? '') || row.sub_axis || '未分组') : null,
    valueAxis: Number(row.total ?? 0),
  }));
}

async function resolveColumn(columns: ColumnMeta[], fieldId: string): Promise<string | undefined> {
  if (!fieldId) {
    return undefined;
  }
  const direct = columnByField(columns, fieldId);
  if (direct) {
    return direct.column;
  }
  if (!/^[a-z0-9]+$/i.test(fieldId)) {
    return undefined;
  }
  const rows = await query<RowDataPacket & { internal_key: string | null }>(
    'SELECT internal_key FROM sys_module_field WHERE id = ? LIMIT 1',
    [fieldId],
  );
  const key = rows[0]?.internal_key;
  return key ? columnByField(columns, key)?.column : undefined;
}

async function axisNames(column: string, values: string[], stageTable?: string): Promise<Map<string, string>> {
  const ids = [...new Set(values.filter(Boolean))];
  const names = new Map<string, string>();
  if (ids.length === 0) {
    return names;
  }
  const marks = ids.map(() => '?').join(', ');
  if (column === 'owner' || column === 'create_user' || column === 'update_user') {
    const rows = await query<RowDataPacket & { id: string; name: string }>(
      `SELECT id, name FROM sys_user WHERE id IN (${marks})`,
      ids,
    );
    rows.forEach((row) => names.set(row.id, row.name));
    return names;
  }
  if (column === 'stage' && stageTable) {
    const rows = await query<RowDataPacket & { id: string; name: string }>(
      `SELECT id, name FROM ${ident(stageTable)} WHERE id IN (${marks})`,
      ids,
    );
    rows.forEach((row) => names.set(row.id, row.name));
  }
  return names;
}
