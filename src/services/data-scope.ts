import type { RowDataPacket } from 'mysql2';

import { ADMIN_USER_ID } from '../config/index.js';
import { listDepartments } from '../models/department.model.js';
import { listRoles } from '../models/role.model.js';
import { query } from '../support/db.js';

/** 未限制时返回 undefined。否则返回当前用户允许查看的负责人 ID。 */
export async function visibleOwnerIds(organizationId: string, userId: string): Promise<string[] | undefined> {
  if (!userId || userId === ADMIN_USER_ID) {
    return undefined;
  }
  const roles = await listRoles(userId, organizationId);
  if (roles.length === 0 || roles.some((role) => role.id === 'org_admin' || role.dataScope === 'ALL')) {
    return undefined;
  }
  const ids = new Set<string>();
  const departmentId = await userDepartmentId(organizationId, userId);
  if (roles.some((role) => role.dataScope === 'SELF')) {
    ids.add(userId);
  }
  if (departmentId && roles.some((role) => role.dataScope === 'DEPT')) {
    for (const id of await memberIds(organizationId, [departmentId])) {
      ids.add(id);
    }
  }
  if (departmentId && roles.some((role) => role.dataScope === 'DEPT_AND_CHILD')) {
    const departments = await listDepartments(organizationId);
    for (const id of await memberIds(organizationId, expandDepartment(departments, departmentId))) {
      ids.add(id);
    }
  }
  const customRoleIds = roles.filter((role) => role.dataScope === 'DEPT_CUSTOM').map((role) => role.id);
  if (customRoleIds.length > 0) {
    for (const id of await memberIds(organizationId, await roleDepartmentIds(customRoleIds))) {
      ids.add(id);
    }
  }
  return [...ids];
}

async function userDepartmentId(organizationId: string, userId: string): Promise<string> {
  const rows = await query<RowDataPacket & { department_id: string | null }>(
    'SELECT department_id FROM sys_organization_user WHERE organization_id = ? AND user_id = ? LIMIT 1',
    [organizationId, userId],
  );
  return rows[0]?.department_id ?? '';
}

async function memberIds(organizationId: string, departmentIds: string[]): Promise<string[]> {
  if (departmentIds.length === 0) {
    return [];
  }
  const marks = departmentIds.map(() => '?').join(', ');
  const rows = await query<RowDataPacket & { user_id: string }>(
    `SELECT user_id FROM sys_organization_user WHERE organization_id = ? AND department_id IN (${marks})`,
    [organizationId, ...departmentIds],
  );
  return rows.map((row) => row.user_id);
}

async function roleDepartmentIds(roleIds: string[]): Promise<string[]> {
  const marks = roleIds.map(() => '?').join(', ');
  const rows = await query<RowDataPacket & { department_id: string }>(
    `SELECT department_id FROM sys_role_scope_dept WHERE role_id IN (${marks})`,
    roleIds,
  );
  return rows.map((row) => row.department_id);
}

function expandDepartment(departments: Array<{ id: string; parentId: string }>, rootId: string): string[] {
  const children = new Map<string, string[]>();
  for (const department of departments) {
    const list = children.get(department.parentId) ?? [];
    list.push(department.id);
    children.set(department.parentId, list);
  }
  const ids: string[] = [];
  const pending = [rootId];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || ids.includes(current)) {
      continue;
    }
    ids.push(current);
    pending.push(...(children.get(current) ?? []));
  }
  return ids;
}
