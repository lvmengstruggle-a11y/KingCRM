import type { RowDataPacket } from 'mysql2';

import { asNumber, bitToBool } from '../support/bit.js';
import { query } from '../support/db.js';
import { allPermissionIds } from '../support/permission-catalog.js';
import type { SessionRole } from '../support/session-user.js';

interface RoleRow extends RowDataPacket {
  id: string;
  name: string;
  data_scope: string;
  organization_id: string;
}

interface PermissionRow extends RowDataPacket {
  permission_id: string;
}

export async function listRoles(userId: string, organizationId: string): Promise<SessionRole[]> {
  const rows = await query<RoleRow>(
    `SELECT sr.id, sr.name, sr.data_scope, sr.organization_id
     FROM sys_role sr
              INNER JOIN sys_user_role sur ON sr.id = sur.role_id
     WHERE sur.user_id = ? AND sr.organization_id = ?`,
    [userId, organizationId],
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    dataScope: row.data_scope,
    organizationId: row.organization_id,
  }));
}

export async function listPermissionIds(userId: string, organizationId: string): Promise<string[]> {
  const rows = await query<PermissionRow>(
    `SELECT DISTINCT rp.permission_id
     FROM sys_role_permission rp
              INNER JOIN sys_user_role sur ON sur.role_id = rp.role_id
              INNER JOIN sys_role sr ON sr.id = sur.role_id
     WHERE sur.user_id = ? AND sr.organization_id = ?`,
    [userId, organizationId],
  );
  const ids = rows.map((row) => row.permission_id);
  const roles = await listRoles(userId, organizationId);
  if (!roles.some((role) => role.id === 'org_admin')) {
    return ids;
  }
  return [...new Set([...ids, ...allPermissionIds()])];
}

export interface RoleRecord {
  id: string;
  name: string;
  internal: boolean;
  dataScope: string;
  description: string | null;
  organizationId: string;
  createTime: number;
  updateTime: number;
  createUser: string;
  updateUser: string;
}

interface RoleDetailRow extends RowDataPacket {
  id: string;
  name: string;
  internal: unknown;
  data_scope: string;
  description: string | null;
  organization_id: string;
  create_time: number | string;
  update_time: number | string;
  create_user: string;
  update_user: string;
  user_id?: string;
}

export async function listOrganizationRoles(organizationId: string): Promise<RoleRecord[]> {
  const rows = await query<RoleDetailRow>(
    `SELECT id, name, internal, data_scope, description, organization_id,
            create_time, update_time, create_user, update_user
     FROM sys_role
     WHERE organization_id = ?
     ORDER BY create_time`,
    [organizationId],
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    internal: bitToBool(row.internal),
    dataScope: row.data_scope,
    description: row.description,
    organizationId: row.organization_id,
    createTime: asNumber(row.create_time),
    updateTime: asNumber(row.update_time),
    createUser: row.create_user,
    updateUser: row.update_user,
  }));
}

export interface UserRoleLink {
  id: string;
  name: string;
  userId: string;
  internal: boolean;
  dataScope: string;
  organizationId: string;
}

export async function listUserRoles(userIds: string[], organizationId: string): Promise<UserRoleLink[]> {
  if (userIds.length === 0) {
    return [];
  }
  const marks = userIds.map(() => '?').join(',');
  const rows = await query<RoleDetailRow>(
    `SELECT sr.id, sr.name, sr.data_scope, sr.organization_id, sr.internal, sur.user_id
     FROM sys_role sr
              INNER JOIN sys_user_role sur ON sr.id = sur.role_id
     WHERE sur.user_id IN (${marks}) AND sr.organization_id = ?`,
    [...userIds, organizationId],
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    userId: row.user_id ?? '',
    internal: bitToBool(row.internal),
    dataScope: row.data_scope,
    organizationId: row.organization_id,
  }));
}
