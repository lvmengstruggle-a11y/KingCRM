import type { RowDataPacket } from 'mysql2';

import { asString, bitToBool } from '../support/bit.js';
import { query } from '../support/db.js';

interface OrgUserRow extends RowDataPacket {
  organization_id: string;
  department_id: string | null;
  enable: unknown;
  department_name: string | null;
}

export interface OrgMembership {
  organizationId: string;
  departmentId: string | null;
  departmentName: string | null;
  enable: boolean;
}

export async function firstOrganizationId(): Promise<string | null> {
  const rows = await query<RowDataPacket & { id: string }>('SELECT id FROM sys_organization ORDER BY id LIMIT 1');
  return rows[0]?.id ?? null;
}

export async function listOrganizationIds(userId: string, isAdmin: boolean): Promise<string[]> {
  if (isAdmin) {
    const rows = await query<RowDataPacket & { id: string }>('SELECT id FROM sys_organization');
    return rows.map((row) => row.id);
  }
  const rows = await query<OrgUserRow>(
    `SELECT organization_id
     FROM sys_organization_user
     WHERE user_id = ? AND enable = 1`,
    [userId],
  );
  return rows.map((row) => row.organization_id);
}

export async function findMembership(userId: string, organizationId: string): Promise<OrgMembership | null> {
  const rows = await query<OrgUserRow>(
    `SELECT sou.organization_id,
            sou.department_id,
            sou.enable,
            sd.name AS department_name
     FROM sys_organization_user sou
              LEFT JOIN sys_department sd ON sd.id = sou.department_id
     WHERE sou.user_id = ? AND sou.organization_id = ?
     LIMIT 1`,
    [userId, organizationId],
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    organizationId: row.organization_id,
    departmentId: asString(row.department_id),
    departmentName: asString(row.department_name),
    enable: bitToBool(row.enable),
  };
}
