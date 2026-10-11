import { listCommanderUserIds } from '../models/department.model.js';
import {
  listDepartmentNames,
  listUserNames,
  listUserOptions,
  listAdminOptions,
  pageOrganizationUsers,
  type UserPageRecord,
} from '../models/organization-user.model.js';
import { listUserRoles } from '../models/role.model.js';
import { validateFailed } from '../support/errors.js';
import { normalizePage, toPager, type Pager } from '../support/pager.js';
import { translateRoleName } from '../support/permission.js';

export interface UserPageItem extends UserPageRecord {
  departmentName: string | null;
  supervisorName: string | null;
  createUserName: string | null;
  updateUserName: string | null;
  commander: boolean;
  roles: Array<{ id: string; name: string; userId: string }>;
  userGroups: [];
}

export class OrganizationUserService {
  async list(input: {
    organizationId: string;
    departmentIds: string[];
    keyword?: string;
    current?: number;
    pageSize?: number;
    sort?: { name: string; type: string };
    filters?: unknown[];
    combineSearch?: { conditions?: unknown[] };
  }): Promise<Pager<UserPageItem>> {
    if (input.filters && input.filters.length > 0) {
      throw validateFailed('筛选条件尚未迁移');
    }
    if (input.combineSearch?.conditions && input.combineSearch.conditions.length > 0) {
      throw validateFailed('组合搜索尚未迁移');
    }
    const departmentIds = input.departmentIds.filter((id) => id && id.toUpperCase() !== 'NONE');
    if (departmentIds.length === 0) {
      throw validateFailed('部门不能为空');
    }
    const page = normalizePage(input.current, input.pageSize);
    const result = await pageOrganizationUsers({
      organizationId: input.organizationId,
      departmentIds,
      keyword: input.keyword,
      sort: input.sort,
      page,
    });
    const list = await this.attach(result.list, departmentIds[0] ?? '');
    return toPager(list, result.total, page);
  }

  async options(organizationId: string, includeDisabled: boolean) {
    return listUserOptions(organizationId, includeDisabled);
  }

  async adminOptions(organizationId: string, includeDisabled: boolean) {
    return listAdminOptions(organizationId, includeDisabled);
  }

  private async attach(list: UserPageRecord[], focusDepartmentId: string): Promise<UserPageItem[]> {
    if (list.length === 0) {
      return [];
    }
    const organizationId = list[0]?.organizationId ?? '';
    const userIds = list.map((item) => item.userId);
    const roles = await listUserRoles(userIds, organizationId);
    const names = await listUserNames(list.flatMap((item) => [item.createUser, item.updateUser, item.supervisorId ?? '']));
    const departments = await listDepartmentNames(list.map((item) => item.departmentId ?? ''));
    const commanders = new Set(await listCommanderUserIds(focusDepartmentId));
    const rolesByUser = new Map<string, UserPageItem['roles']>();
    for (const role of roles) {
      const current = rolesByUser.get(role.userId) ?? [];
      current.push({
        id: role.id,
        name: translateRoleName(role.name, role.internal),
        userId: role.userId,
      });
      rolesByUser.set(role.userId, current);
    }
    return list.map((item) => ({
      ...item,
      departmentName: item.departmentId ? departments.get(item.departmentId) ?? null : null,
      supervisorName: item.supervisorId ? names.get(item.supervisorId) ?? null : null,
      createUserName: names.get(item.createUser) ?? null,
      updateUserName: names.get(item.updateUser) ?? null,
      commander: commanders.has(item.userId),
      roles: rolesByUser.get(item.userId) ?? [],
      userGroups: [],
    }));
  }
}

export const organizationUserService = new OrganizationUserService();
