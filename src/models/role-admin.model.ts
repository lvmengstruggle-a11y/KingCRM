import type { RowDataPacket } from 'mysql2';

import { asNumber, bitToBool } from '../support/bit.js';
import { execute, query, type Tx } from '../support/db.js';
import { nextId } from '../support/id.js';

export async function countRoleName(organizationId: string, name: string, excludeId?: string): Promise<number> {
  const rows = await query<RowDataPacket & { total: number }>(
    'SELECT COUNT(*) AS total FROM sys_role WHERE organization_id = ? AND name = ? AND (? IS NULL OR id <> ?)',
    [organizationId, name, excludeId ?? null, excludeId ?? null],
  );
  return asNumber(rows[0]?.total);
}

export async function findRole(id: string) {
  const rows = await query<RowDataPacket & {
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
  }>(
    `SELECT id, name, internal, data_scope, description, organization_id, create_time, update_time, create_user, update_user
     FROM sys_role WHERE id = ? LIMIT 1`,
    [id],
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
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
  };
}

export async function listRolePermissionIds(roleId: string): Promise<string[]> {
  const rows = await query<RowDataPacket & { permission_id: string }>(
    'SELECT permission_id FROM sys_role_permission WHERE role_id = ?',
    [roleId],
  );
  return rows.map((row) => row.permission_id);
}

export async function listRoleDeptIds(roleId: string): Promise<string[]> {
  const rows = await query<RowDataPacket & { department_id: string }>(
    'SELECT department_id FROM sys_role_scope_dept WHERE role_id = ?',
    [roleId],
  );
  return rows.map((row) => row.department_id);
}

export async function insertRole(tx: Tx, input: {
  id: string;
  name: string;
  dataScope: string;
  description: string | null;
  organizationId: string;
  userId: string;
}): Promise<void> {
  const now = Date.now();
  await tx.execute(
    `INSERT INTO sys_role
       (id, name, internal, data_scope, description, organization_id, create_time, update_time, create_user, update_user)
     VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
    [input.id, input.name, input.dataScope, input.description, input.organizationId, now, now, input.userId, input.userId],
  );
}

export async function updateRoleRow(tx: Tx, input: {
  id: string;
  name: string | null;
  dataScope: string;
  description: string | null;
  userId: string;
}): Promise<void> {
  await tx.execute(
    `UPDATE sys_role
     SET name = COALESCE(?, name), data_scope = ?, description = ?, update_time = ?, update_user = ?
     WHERE id = ?`,
    [input.name, input.dataScope, input.description, Date.now(), input.userId, input.id],
  );
}

export async function replaceRolePermissions(tx: Tx, roleId: string, permissionIds: string[]): Promise<void> {
  await tx.execute('DELETE FROM sys_role_permission WHERE role_id = ?', [roleId]);
  for (const permissionId of permissionIds) {
    await tx.execute(
      'INSERT INTO sys_role_permission (id, role_id, permission_id) VALUES (?, ?, ?)',
      [nextId(), roleId, permissionId],
    );
  }
}

export async function replaceRoleDepts(tx: Tx, roleId: string, deptIds: string[]): Promise<void> {
  await tx.execute('DELETE FROM sys_role_scope_dept WHERE role_id = ?', [roleId]);
  for (const departmentId of deptIds) {
    await tx.execute(
      'INSERT INTO sys_role_scope_dept (id, role_id, department_id) VALUES (?, ?, ?)',
      [nextId(), roleId, departmentId],
    );
  }
}

export async function deleteRole(tx: Tx, roleId: string): Promise<void> {
  await tx.execute('DELETE FROM sys_role_permission WHERE role_id = ?', [roleId]);
  await tx.execute('DELETE FROM sys_role_scope_dept WHERE role_id = ?', [roleId]);
  await tx.execute('DELETE FROM sys_user_role WHERE role_id = ?', [roleId]);
  await tx.execute('DELETE FROM sys_role WHERE id = ?', [roleId]);
}

export async function replaceUserRoles(tx: Tx, userId: string, organizationId: string, roleIds: string[], operatorId: string): Promise<void> {
  await tx.execute(
    `DELETE sur FROM sys_user_role sur
              INNER JOIN sys_role sr ON sr.id = sur.role_id
     WHERE sur.user_id = ? AND sr.organization_id = ?`,
    [userId, organizationId],
  );
  const now = Date.now();
  for (const roleId of roleIds) {
    await tx.execute(
      `INSERT INTO sys_user_role (id, role_id, user_id, create_time, update_time, create_user, update_user)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [nextId(), roleId, userId, now, now, operatorId, operatorId],
    );
  }
}

export async function pageRoleUsers(roleId: string, keyword: string | undefined, current: number, pageSize: number) {
  const where = ['sur.role_id = ?'];
  const params: unknown[] = [roleId];
  if (keyword) {
    where.push('(su.name LIKE ? OR su.phone LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  const whereSql = where.join(' AND ');
  const countRows = await query<RowDataPacket & { total: number }>(
    `SELECT COUNT(*) AS total
     FROM sys_user_role sur
              INNER JOIN sys_user su ON su.id = sur.user_id
     WHERE ${whereSql}`,
    params,
  );
  const rows = await query<RowDataPacket & { id: string; user_id: string; name: string; phone: string | null; email: string | null }>(
    `SELECT sur.id, sur.user_id, su.name, su.phone, su.email
     FROM sys_user_role sur
              INNER JOIN sys_user su ON su.id = sur.user_id
     WHERE ${whereSql}
     ORDER BY sur.create_time DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, (current - 1) * pageSize],
  );
  return {
    total: asNumber(countRows[0]?.total),
    list: rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      userName: row.name,
      phone: row.phone,
      email: row.email,
    })),
  };
}

export async function relateUsers(tx: Tx, roleId: string, userIds: string[], operatorId: string): Promise<string[]> {
  if (userIds.length === 0) {
    return [];
  }
  const marks = userIds.map(() => '?').join(',');
  const existing = await tx.query<RowDataPacket & { user_id: string }>(
    `SELECT user_id FROM sys_user_role WHERE role_id = ? AND user_id IN (${marks})`,
    [roleId, ...userIds],
  );
  const owned = new Set(existing.map((row) => row.user_id));
  const now = Date.now();
  const added: string[] = [];
  for (const userId of userIds) {
    if (owned.has(userId)) {
      continue;
    }
    await tx.execute(
      `INSERT INTO sys_user_role (id, role_id, user_id, create_time, update_time, create_user, update_user)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [nextId(), roleId, userId, now, now, operatorId, operatorId],
    );
    added.push(userId);
  }
  return added;
}

export async function userIdsByDepartments(departmentIds: string[]): Promise<string[]> {
  if (departmentIds.length === 0) {
    return [];
  }
  const marks = departmentIds.map(() => '?').join(',');
  const rows = await query<RowDataPacket & { user_id: string }>(
    `SELECT user_id FROM sys_organization_user WHERE department_id IN (${marks})`,
    departmentIds,
  );
  return rows.map((row) => row.user_id);
}

export async function userIdsByRoles(roleIds: string[]): Promise<string[]> {
  if (roleIds.length === 0) {
    return [];
  }
  const marks = roleIds.map(() => '?').join(',');
  const rows = await query<RowDataPacket & { user_id: string }>(
    `SELECT user_id FROM sys_user_role WHERE role_id IN (${marks})`,
    roleIds,
  );
  return rows.map((row) => row.user_id);
}

export async function listRoleMemberIds(roleId: string): Promise<string[]> {
  const rows = await query<RowDataPacket & { user_id: string }>(
    'SELECT user_id FROM sys_user_role WHERE role_id = ?',
    [roleId],
  );
  return rows.map((row) => row.user_id);
}

export interface RoleTreeUser {
  id: string;
  name: string;
  parentId: string;
  enable: boolean;
  enabled: boolean;
  nodeType: 'USER';
}

export async function listDeptUsersForRole(
  organizationId: string,
  roleId: string,
  includeDisabled: boolean,
): Promise<RoleTreeUser[]> {
  const rows = await query<RowDataPacket & {
    id: string;
    name: string;
    parent_id: string | null;
    enable: unknown;
  }>(
    `SELECT temp.id, temp.name, temp.department_id AS parent_id,
            IF(temp.user_enable = 1, IF(sur.id IS NULL, 1, 0), 0) AS enable
     FROM (
              SELECT su.id, su.name, sou.department_id, sou.enable AS user_enable
              FROM sys_organization_user sou
                       INNER JOIN sys_user su ON sou.user_id = su.id
              WHERE sou.organization_id = ?
                  ${includeDisabled ? '' : 'AND sou.enable = 1'}
          ) temp
              LEFT JOIN sys_user_role sur ON temp.id = sur.user_id AND sur.role_id = ?`,
    [organizationId, roleId],
  );
  return rows.map((row) => {
    const enable = bitToBool(row.enable);
    return {
      id: row.id,
      name: row.name,
      parentId: row.parent_id ?? 'NONE',
      enable,
      enabled: enable,
      nodeType: 'USER' as const,
    };
  });
}

export async function listUsersUnderOtherRoles(organizationId: string, roleId: string): Promise<RoleTreeUser[]> {
  const memberIds = new Set(await listRoleMemberIds(roleId));
  const rows = await query<RowDataPacket & { id: string; name: string; parent_id: string }>(
    `SELECT su.id, su.name, sur.role_id AS parent_id
     FROM sys_organization_user sou
              INNER JOIN sys_user su ON sou.user_id = su.id
              INNER JOIN sys_user_role sur ON su.id = sur.user_id AND sur.role_id <> ?
     WHERE sou.organization_id = ?`,
    [roleId, organizationId],
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    enable: true,
    enabled: !memberIds.has(row.id),
    nodeType: 'USER' as const,
  }));
}

export async function listSelectableUsers(organizationId: string, roleId: string, includeDisabled: boolean) {
  const memberIds = new Set(await listRoleMemberIds(roleId));
  const rows = await query<RowDataPacket & { id: string; name: string; avatar: string | null; enable: unknown }>(
    `SELECT su.id, su.name, sue.avatar, sou.enable
     FROM sys_user su
              INNER JOIN sys_organization_user sou ON su.id = sou.user_id AND sou.organization_id = ?
              LEFT JOIN sys_user_extend sue ON su.id = sue.id
     WHERE 1 = 1
         ${includeDisabled ? '' : 'AND sou.enable = 1'}`,
    [organizationId],
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    avatar: row.avatar ?? '',
    enable: bitToBool(row.enable),
    enabled: !memberIds.has(row.id),
  }));
}

export async function deleteUserRole(id: string): Promise<string | null> {
  const rows = await query<RowDataPacket & { user_id: string }>(
    'SELECT user_id FROM sys_user_role WHERE id = ? LIMIT 1',
    [id],
  );
  await execute('DELETE FROM sys_user_role WHERE id = ?', [id]);
  return rows[0]?.user_id ?? null;
}
