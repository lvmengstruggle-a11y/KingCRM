import type { FastifyRequest } from 'fastify';

import { ADMIN_USER_ID } from '../config/index.js';
import { forbidden, unauthorized, validateFailed } from './errors.js';
import type { SessionUser } from './session-user.js';

export function requireUser(request: FastifyRequest): SessionUser {
  if (!request.sessionUser) {
    throw unauthorized();
  }
  return request.sessionUser;
}

export function requireOrganization(request: FastifyRequest): string {
  const user = requireUser(request);
  const organizationId = request.organizationId || user.lastOrganizationId;
  if (!organizationId) {
    throw validateFailed('缺少组织');
  }
  if (user.id !== ADMIN_USER_ID && !user.organizationIds.includes(organizationId)) {
    throw forbidden('没有该组织的访问权限');
  }
  return organizationId;
}
