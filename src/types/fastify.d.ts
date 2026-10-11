import type { SessionUser } from '../support/session-user.js';

declare module 'fastify' {
  interface FastifyRequest {
    sessionUser: SessionUser | null;
    organizationId?: string;
  }
}
