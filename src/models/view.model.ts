import type { RowDataPacket } from 'mysql2';

import { asNumber, bitToBool } from '../support/bit.js';
import { execute, query, withTransaction } from '../support/db.js';
import { notFound, validateFailed } from '../support/errors.js';
import { nextId } from '../support/id.js';

export interface ViewRecord {
  id: string;
  userId: string;
  name: string;
  fixed: boolean;
  enable: boolean;
  resourceType: string;
  organizationId: string;
  pos: number;
  searchMode: string;
  conditions: Array<Record<string, unknown>>;
}

interface ViewRow extends RowDataPacket {
  id: string;
  user_id: string;
  name: string;
  fixed: unknown;
  enable: unknown;
  resource_type: string;
  organization_id: string;
  pos: number | string;
  search_mode: string;
}

interface ConditionRow extends RowDataPacket {
  name: string;
  value: string | null;
  value_type: string | null;
  type: string | null;
  multiple_value: unknown;
  operator: string | null;
}

function mapCondition(row: ConditionRow): Record<string, unknown> {
  let value: unknown = row.value;
  if (row.value && (row.value_type === 'array' || row.value.startsWith('[') || row.value.startsWith('{'))) {
    try {
      value = JSON.parse(row.value) as unknown;
    } catch {
      value = row.value;
    }
  }
  return {
    name: row.name,
    value,
    valueType: row.value_type,
    type: row.type,
    multipleValue: bitToBool(row.multiple_value),
    operator: row.operator,
  };
}

async function conditionsOf(viewId: string): Promise<Array<Record<string, unknown>>> {
  const rows = await query<ConditionRow>(
    `SELECT name, value, value_type, type, multiple_value, operator
     FROM sys_user_view_condition WHERE sys_user_view_id = ?`,
    [viewId],
  );
  return rows.map(mapCondition);
}

function mapView(row: ViewRow, conditions: Array<Record<string, unknown>> = []): ViewRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    fixed: bitToBool(row.fixed),
    enable: bitToBool(row.enable),
    resourceType: row.resource_type,
    organizationId: row.organization_id,
    pos: asNumber(row.pos),
    searchMode: row.search_mode,
    conditions,
  };
}

export async function listViews(resourceType: string, userId: string, organizationId: string): Promise<ViewRecord[]> {
  const rows = await query<ViewRow>(
    `SELECT id, user_id, name, fixed, enable, resource_type, organization_id, pos, search_mode
     FROM sys_user_view
     WHERE resource_type = ? AND organization_id = ? AND user_id = ?
     ORDER BY pos`,
    [resourceType, organizationId, userId],
  );
  return rows.map((row) => mapView(row));
}

export async function getView(id: string, organizationId: string): Promise<ViewRecord> {
  const rows = await query<ViewRow>(
    `SELECT id, user_id, name, fixed, enable, resource_type, organization_id, pos, search_mode
     FROM sys_user_view WHERE id = ? AND organization_id = ? LIMIT 1`,
    [id, organizationId],
  );
  const row = rows[0];
  if (!row) {
    throw notFound('视图不存在');
  }
  return mapView(row, await conditionsOf(row.id));
}

export async function saveView(input: {
  id?: string;
  name: string;
  resourceType: string;
  organizationId: string;
  userId: string;
  searchMode?: string;
  conditions?: Array<Record<string, unknown>>;
}): Promise<ViewRecord> {
  const name = input.name.trim();
  if (!name) {
    throw validateFailed('视图名称不能为空');
  }
  const now = Date.now();
  const id = input.id || nextId();
  await withTransaction(async (tx) => {
    if (input.id) {
      await tx.execute(
        `UPDATE sys_user_view
         SET name = ?, search_mode = ?, update_time = ?, update_user = ?
         WHERE id = ? AND organization_id = ?`,
        [name, input.searchMode || 'AND', now, input.userId, id, input.organizationId],
      );
    } else {
      const posRows = await tx.query<RowDataPacket & { pos: number | string | null }>(
        `SELECT MAX(pos) AS pos FROM sys_user_view
         WHERE organization_id = ? AND user_id = ? AND resource_type = ?`,
        [input.organizationId, input.userId, input.resourceType],
      );
      await tx.execute(
        `INSERT INTO sys_user_view
         (id, user_id, name, fixed, resource_type, organization_id, pos, enable, search_mode,
          create_time, update_time, create_user, update_user)
         VALUES (?, ?, ?, 0, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
        [
          id,
          input.userId,
          name,
          input.resourceType,
          input.organizationId,
          asNumber(posRows[0]?.pos) + 4096,
          input.searchMode || 'AND',
          now,
          now,
          input.userId,
          input.userId,
        ],
      );
    }
    if (input.conditions) {
      await tx.execute('DELETE FROM sys_user_view_condition WHERE sys_user_view_id = ?', [id]);
      for (const condition of input.conditions) {
        const value = condition.value;
        const stored = value == null ? null : typeof value === 'string' ? value : JSON.stringify(value);
        await tx.execute(
          `INSERT INTO sys_user_view_condition
           (id, sys_user_view_id, name, value, value_type, type, multiple_value, operator,
            create_time, update_time, create_user, update_user)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            nextId(),
            id,
            String(condition.name ?? ''),
            stored,
            Array.isArray(value) ? 'array' : 'string',
            condition.type ?? null,
            condition.multipleValue ? 1 : 0,
            condition.operator ?? null,
            now,
            now,
            input.userId,
            input.userId,
          ],
        );
      }
    }
  });
  return getView(id, input.organizationId);
}

export async function deleteView(id: string, organizationId: string): Promise<void> {
  await getView(id, organizationId);
  await execute('DELETE FROM sys_user_view_condition WHERE sys_user_view_id = ?', [id]);
  await execute('DELETE FROM sys_user_view WHERE id = ? AND organization_id = ?', [id, organizationId]);
}

export async function toggleView(id: string, organizationId: string, field: 'fixed' | 'enable'): Promise<void> {
  const view = await getView(id, organizationId);
  const next = field === 'fixed' ? !view.fixed : !view.enable;
  await execute(`UPDATE sys_user_view SET ${field} = ?, update_time = ? WHERE id = ? AND organization_id = ?`, [
    next ? 1 : 0,
    Date.now(),
    id,
    organizationId,
  ]);
}

export async function moveView(input: {
  organizationId: string;
  moveId: string;
  targetId: string;
  moveMode: string;
}): Promise<void> {
  const target = await getView(input.targetId, input.organizationId);
  const delta = input.moveMode === 'BEFORE' ? -1 : 1;
  await execute('UPDATE sys_user_view SET pos = ?, update_time = ? WHERE id = ? AND organization_id = ?', [
    target.pos + delta,
    Date.now(),
    input.moveId,
    input.organizationId,
  ]);
}
