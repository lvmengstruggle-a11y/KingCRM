import type { FastifyReply, FastifyRequest } from 'fastify';

import { ADMIN_USER_ID } from '../../config/index.js';
import { listPermissionIds, listRoles } from '../../models/role.model.js';
import { requireOrganization, requireUser } from '../../support/context.js';
import { forbidden } from '../../support/errors.js';

/**
 * 管理员拥有全部权限。其他用户按当前组织的权限点校验，多个权限满足其一即可。
 */
export function requirePermission(...permissions: string[]) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const user = requireUser(request);
    if (user.id === ADMIN_USER_ID) {
      return;
    }
    const organizationId = requireOrganization(request);
    const roles = organizationId === user.lastOrganizationId
      ? user.roles
      : await listRoles(user.id, organizationId);
    if (roles.some((role) => role.id === 'org_admin')) {
      return;
    }
    const owned = organizationId === user.lastOrganizationId
      ? user.permissionIds
      : await listPermissionIds(user.id, organizationId);
    if (!permissions.some((permission) => owned.includes(permission))) {
      throw forbidden();
    }
  };
}
