import type { RowDataPacket } from 'mysql2';

import { query } from '../support/db.js';

export interface BoardPoint {
  name: string;
  value: number;
}

export interface OpportunityBoard {
  total: number;
  amount: number;
  unfollowed: number;
  bySource: BoardPoint[];
  byOwnerCount: BoardPoint[];
  byOwnerAmount: BoardPoint[];
  unfollowedByOwner: BoardPoint[];
  byProduct: BoardPoint[];
  trendCount: BoardPoint[];
  trendAmount: BoardPoint[];
}

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

function dayKey(ms: number): string {
  const shifted = new Date(Number(ms) + SHANGHAI_OFFSET_MS);
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${month}-${day}`;
}

function scopeSql(deptIds: string[]): { sql: string; params: string[] } {
  if (deptIds.length === 0) {
    return { sql: '', params: [] };
  }
  const marks = deptIds.map(() => '?').join(', ');
  return {
    sql: ` AND o.owner IN (SELECT user_id FROM sys_organization_user WHERE organization_id = ? AND department_id IN (${marks}))`,
    params: deptIds,
  };
}

async function sourceLabels(): Promise<Map<string, string>> {
  const rows = await query<RowDataPacket & { prop: string | null }>(
    `SELECT b.prop
     FROM sys_module_field m
     JOIN sys_module_field_blob b ON b.id = m.id
     WHERE m.internal_key = 'opportunitySource'
     LIMIT 1`,
    [],
  );
  const labels = new Map<string, string>();
  const prop = rows[0]?.prop;
  if (!prop) {
    return labels;
  }
  try {
    const parsed = JSON.parse(prop) as { options?: Array<{ label?: string; value?: string }> };
    for (const option of parsed.options ?? []) {
      if (option.value) {
        labels.set(String(option.value), option.label || String(option.value));
      }
    }
  } catch {
    return labels;
  }
  return labels;
}

export async function opportunityBoard(
  organizationId: string,
  start: number,
  end: number,
  deptIds: string[],
): Promise<OpportunityBoard> {
  const scope = scopeSql(deptIds);
  const where = `o.organization_id = ? AND o.create_time >= ? AND o.create_time <= ?${scope.sql}`;
  const params = [organizationId, start, end, ...(scope.params.length ? [organizationId, ...scope.params] : [])];
  const summary = await query<RowDataPacket & { total: number | string; amount: number | string; unfollowed: number | string }>(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(o.amount), 0) AS amount,
            SUM(CASE WHEN o.follow_time IS NULL OR o.follow_time = 0 THEN 1 ELSE 0 END) AS unfollowed
     FROM opportunity o
     WHERE ${where}`,
    params,
  );
  const owners = await query<RowDataPacket & { name: string | null; total: number | string; amount: number | string; unfollowed: number | string }>(
    `SELECT COALESCE(u.name, '未分配') AS name,
            COUNT(*) AS total,
            COALESCE(SUM(o.amount), 0) AS amount,
            SUM(CASE WHEN o.follow_time IS NULL OR o.follow_time = 0 THEN 1 ELSE 0 END) AS unfollowed
     FROM opportunity o
     LEFT JOIN sys_user u ON u.id = o.owner
     WHERE ${where}
     GROUP BY name
     ORDER BY total DESC
     LIMIT 12`,
    params,
  );
  const sources = await query<RowDataPacket & { axis: string | null; total: number | string }>(
    `SELECT f.field_value AS axis, COUNT(*) AS total
     FROM opportunity o
     JOIN opportunity_field f ON f.resource_id = o.id
     JOIN sys_module_field m ON m.id = f.field_id AND m.internal_key = 'opportunitySource'
     WHERE ${where}
     GROUP BY f.field_value
     ORDER BY total DESC`,
    params,
  );
  const days = await query<RowDataPacket & { create_time: number | string; total: number | string; amount: number | string }>(
    `SELECT o.create_time, 1 AS total, COALESCE(o.amount, 0) AS amount
     FROM opportunity o
     WHERE ${where}`,
    params,
  );
  const labels = await sourceLabels();
  const trendCount = new Map<string, number>();
  const trendAmount = new Map<string, number>();
  for (const row of days) {
    const key = dayKey(Number(row.create_time));
    trendCount.set(key, (trendCount.get(key) ?? 0) + Number(row.total ?? 0));
    trendAmount.set(key, (trendAmount.get(key) ?? 0) + Number(row.amount ?? 0));
  }
  const trendKeys = [...trendCount.keys()].sort();
  const row = summary[0];
  return {
    total: Number(row?.total ?? 0),
    amount: Number(row?.amount ?? 0),
    unfollowed: Number(row?.unfollowed ?? 0),
    bySource: sources.map((item) => ({
      name: labels.get(String(item.axis ?? '')) || String(item.axis ?? '') || '未填写',
      value: Number(item.total ?? 0),
    })),
    byOwnerCount: owners.map((item) => ({ name: item.name || '未分配', value: Number(item.total ?? 0) })),
    byOwnerAmount: owners.map((item) => ({ name: item.name || '未分配', value: Number(item.amount ?? 0) })),
    unfollowedByOwner: owners
      .map((item) => ({ name: item.name || '未分配', value: Number(item.unfollowed ?? 0) }))
      .filter((item) => item.value > 0),
    byProduct: [{ name: '未关联产品', value: Number(row?.total ?? 0) }].filter((item) => item.value > 0),
    trendCount: trendKeys.map((name) => ({ name, value: trendCount.get(name) ?? 0 })),
    trendAmount: trendKeys.map((name) => ({ name, value: trendAmount.get(name) ?? 0 })),
  };
}
