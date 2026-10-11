import { listOrganizationRoles, type RoleRecord } from '../models/role.model.js';
import { listUserNames } from '../models/organization-user.model.js';
import { translateRoleName } from '../support/permission.js';

export interface RoleListItem extends RoleRecord {
  name: string;
  createUserName: string | null;
  updateUserName: string | null;
}

export class RoleQueryService {
  async list(organizationId: string): Promise<RoleListItem[]> {
    const roles = await listOrganizationRoles(organizationId);
    const names = await listUserNames(roles.flatMap((role) => [role.createUser, role.updateUser]));
    return roles.map((role) => ({
      ...role,
      name: translateRoleName(role.name, role.internal),
      createUserName: names.get(role.createUser) ?? null,
      updateUserName: names.get(role.updateUser) ?? null,
    }));
  }
}

export const roleQueryService = new RoleQueryService();
