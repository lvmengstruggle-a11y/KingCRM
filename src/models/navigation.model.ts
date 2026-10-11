import type { RowDataPacket } from 'mysql2';

import { asNumber, bitToBool } from '../support/bit.js';
import { query, withTransaction } from '../support/db.js';

export interface NavigationRecord {
  id: string;
  organizationId: string;
  navigationKey: string;
  enable: boolean;
  pos: number;
}

interface NavigationRow extends RowDataPacket {
  id: string;
  organization_id: string;
  navigation_key: string;
  enable: unknown;
  pos: number | string;
}

export async function listNavigation(organizationId: string): Promise<NavigationRecord[]> {
  const rows = await query<NavigationRow>(
    `SELECT id, navigation_key, enable, organization_id, pos
     FROM sys_navigation
     WHERE organization_id = ?
     ORDER BY pos`,
    [organizationId],
  );
  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    navigationKey: row.navigation_key,
    enable: bitToBool(row.enable),
    pos: asNumber(row.pos),
  }));
}

export async function moveNavigation(id: string, organizationId: string, start: number, end: number, userId: string): Promise<boolean> {
  const rows = await query<RowDataPacket & { id: string }>(
    'SELECT id FROM sys_navigation WHERE id = ? AND organization_id = ? LIMIT 1',
    [id, organizationId],
  );
  if (!rows[0]) {
    return false;
  }
  await withTransaction(async (tx) => {
    if (start < end) {
      await tx.execute(
        'UPDATE sys_navigation SET pos = pos - 1 WHERE organization_id = ? AND pos > ? AND pos <= ?',
        [organizationId, start, end],
      );
    } else if (start > end) {
      await tx.execute(
        'UPDATE sys_navigation SET pos = pos + 1 WHERE organization_id = ? AND pos >= ? AND pos < ?',
        [organizationId, end, start],
      );
    }
    await tx.execute(
      'UPDATE sys_navigation SET pos = ?, update_user = ?, update_time = ? WHERE id = ? AND organization_id = ?',
      [end, userId, Date.now(), id, organizationId],
    );
  });
  return true;
}
