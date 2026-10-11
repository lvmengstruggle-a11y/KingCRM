import { listDepartments } from '../models/department.model.js';
import {
  countRoleName,
  deleteRole,
  deleteUserRole,
  findRole,
  insertRole,
  listDeptUsersForRole,
  listRoleDeptIds,
  listRolePermissionIds,
  listSelectableUsers,
  listUsersUnderOtherRoles,
  pageRoleUsers,
  relateUsers,
  replaceRoleDepts,
  replaceRolePermissions,
  updateRoleRow,
  userIdsByDepartments,
  userIdsByRoles,
} from '../models/role-admin.model.js';
import { listUserNames } from '../models/organization-user.model.js';
import { insertOperationLog } from '../models/operation-log.model.js';
import { failed, notFound } from '../support/errors.js';
import { nextId } from '../support/id.js';
import { allPermissionIds, permissionCatalog } from '../support/permission-catalog.js';
import { translateRoleName } from '../support/permission.js';
import { normalizePage, toPager } from '../support/pager.js';
import { buildTree } from '../support/tree.js';
import { withTransaction } from '../support/db.js';
import { roleQueryService } from './role.service.js';

const DATA_SCOPES = new Set(['ALL', 'DEPT_CUSTOM', 'DEPT_AND_CHILD', 'DEPT', 'SELF']);

export class RoleAdminService {
  catalog() {
    return permissionCatalog();
  }

  async get(id: string, organizationId: string) {
    const role = await this.require(id, organizationId);
    const names = await listUserNames([role.createUser, role.updateUser]);
    return {
      ...role,
      name: translateRoleName(role.name, role.internal),
      createUserName: names.get(role.createUser) ?? null,
      updateUserName: names.get(role.updateUser) ?? null,
      deptIds: await listRoleDeptIds(id),
      permissions: permissionCatalog(new Set(
        role.id === 'org_admin' ? allPermissionIds() : await listRolePermissionIds(id),
      )),
    };
  }

  async add(input: RoleWrite, organizationId: string, userId: string) {
    const dataScope = input.dataScope && DATA_SCOPES.has(input.dataScope) ? input.dataScope : 'SELF';
    if (await countRoleName(organizationId, input.name) > 0) {
      throw failed('角色已存在');
    }
    const id = nextId();
    await withTransaction(async (tx) => {
      await insertRole(tx, {
        id,
        name: input.name,
        dataScope,
        description: input.description ?? null,
        organizationId,
        userId,
      });
      if (dataScope === 'DEPT_CUSTOM') {
        await replaceRoleDepts(tx, id, input.deptIds ?? []);
      }
      await replaceRolePermissions(tx, id, enabledIds(input.permissions));
    });
    return findRole(id);
  }

  async update(input: Partial<RoleWrite> & { id: string }, organizationId: string, userId: string) {
    const current = await this.require(input.id, organizationId);
    const name = current.internal ? current.name : (input.name?.trim() || current.name);
    if (!current.internal && name !== current.name && await countRoleName(organizationId, name, current.id) > 0) {
      throw failed('角色已存在');
    }
    const dataScope = input.dataScope && DATA_SCOPES.has(input.dataScope) ? input.dataScope : current.dataScope;
    await withTransaction(async (tx) => {
      await updateRoleRow(tx, {
        id: current.id,
        name: current.internal ? null : name,
        dataScope,
        description: input.description ?? current.description,
        userId,
      });
      await replaceRoleDepts(tx, current.id, dataScope === 'DEPT_CUSTOM' ? (input.deptIds ?? []) : []);
      if (input.permissions) {
        await replaceRolePermissions(tx, current.id, enabledIds(input.permissions));
      }
    });
    return this.get(current.id, organizationId);
  }

  async remove(id: string, organizationId: string, userId: string): Promise<void> {
    const role = await this.require(id, organizationId);
    if (role.internal) {
      throw failed('内置角色不能删除');
    }
    await withTransaction((tx) => deleteRole(tx, id));
    await insertOperationLog({
      organizationId,
      type: 'DELETE',
      module: 'SYSTEM_ROLE',
      resourceId: id,
      resourceName: translateRoleName(role.name, role.internal),
      operator: userId,
      path: '/role/delete',
      method: 'GET',
    });
  }

  async userPage(input: { roleId: string; keyword?: string; current?: number; pageSize?: number }, organizationId: string) {
    await this.require(input.roleId, organizationId);
    const page = normalizePage(input.current, input.pageSize);
    const result = await pageRoleUsers(input.roleId, input.keyword, page.current, page.pageSize);
    return toPager(result.list, result.total, page);
  }

  async relate(input: { roleId: string; userIds?: string[]; deptIds?: string[]; roleIds?: string[] }, organizationId: string, operatorId: string) {
    const role = await this.require(input.roleId, organizationId);
    const ids = new Set<string>([
      ...(input.userIds ?? []),
      ...(await userIdsByDepartments(input.deptIds ?? [])),
      ...(await userIdsByRoles(input.roleIds ?? [])),
    ]);
    const added = await withTransaction((tx) => relateUsers(tx, role.id, [...ids], operatorId));
    if (added.length > 0) {
      await insertOperationLog({
        organizationId,
        type: 'ADD',
        module: 'SYSTEM_ROLE',
        resourceId: role.id,
        resourceName: translateRoleName(role.name, role.internal),
        operator: operatorId,
        path: '/role/user/relate',
        method: 'POST',
      });
    }
  }

  async removeUser(id: string, organizationId: string, operatorId: string): Promise<void> {
    const userId = await deleteUserRole(id);
    if (!userId) {
      throw notFound('角色成员不存在');
    }
    await insertOperationLog({
      organizationId,
      type: 'DELETE',
      module: 'SYSTEM_ROLE',
      resourceId: id,
      resourceName: userId,
      operator: operatorId,
      path: '/role/user/delete',
      method: 'GET',
    });
  }

  async deptUserTree(organizationId: string, roleId: string, includeDisabled: boolean) {
    await this.require(roleId, organizationId);
    const departments = await listDepartments(organizationId);
    const users = await listDeptUsersForRole(organizationId, roleId, includeDisabled);
    return buildTree([
      ...departments.map((department) => ({
        id: department.id,
        name: department.name,
        parentId: department.parentId,
        organizationId,
        nodeType: 'ORG' as const,
        enable: true,
        enabled: true,
      })),
      ...users.map((user) => ({ ...user, organizationId })),
    ]);
  }

  async roleUserTree(organizationId: string, roleId: string) {
    await this.require(roleId, organizationId);
    const roles = await roleQueryService.list(organizationId);
    const users = await listUsersUnderOtherRoles(organizationId, roleId);
    return buildTree([
      ...roles.filter((role) => role.id !== roleId).map((role) => ({
        id: role.id,
        name: role.name,
        parentId: 'NONE',
        organizationId,
        nodeType: 'ROLE' as const,
        internal: role.internal,
        enabled: true,
      })),
      ...users.map((user) => ({ ...user, organizationId })),
    ]);
  }

  async roleTree(organizationId: string) {
    const roles = await roleQueryService.list(organizationId);
    return buildTree(roles.map((role) => ({
      id: role.id,
      name: role.name,
      parentId: 'NONE',
      organizationId,
      nodeType: 'ROLE' as const,
      internal: role.internal,
      enabled: true,
    })));
  }

  async userOptions(organizationId: string, roleId: string, includeDisabled: boolean) {
    await this.require(roleId, organizationId);
    return listSelectableUsers(organizationId, roleId, includeDisabled);
  }

  private async require(id: string, organizationId: string) {
    const role = await findRole(id);
    if (!role || role.organizationId !== organizationId) {
      throw notFound('角色不存在');
    }
    return role;
  }
}

export const roleAdminService = new RoleAdminService();

export interface RoleWrite {
  name: string;
  dataScope?: string;
  description?: string;
  deptIds?: string[];
  permissions?: Array<{ id: string; enable?: boolean }>;
}

function enabledIds(permissions: RoleWrite['permissions']): string[] {
  return (permissions ?? []).filter((item) => item.enable).map((item) => item.id);
}
