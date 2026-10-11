import type { FastifyReply, FastifyRequest } from 'fastify';

import { forbidden, unauthorized } from '../../support/errors.js';
import { sessionStore } from '../../support/session-store.js';

const PUBLIC_ROUTES = new Set([
  'GET /health',
  'GET /get-key',
  'POST /login',
  'GET /logout',
  'GET /is-login',
  'GET /ui/display/info',
  'GET /ui/display/preview',
  'POST /ticket/public/add',
  'POST /ticket/public/satisfy',
  'POST /ticket/public/satisfy/lookup',
]);

function routeKey(request: FastifyRequest): string {
  const path = request.url.split('?')[0] ?? request.url;
  return `${request.method.toUpperCase()} ${path}`;
}

function isPublicFile(request: FastifyRequest): boolean {
  if (request.method.toUpperCase() !== 'GET') {
    return false;
  }
  const path = request.url.split('?')[0] ?? '';
  return path.startsWith('/pic/preview/')
    || path.startsWith('/pic/download/')
    || path.startsWith('/attachment/preview/')
    || path.startsWith('/attachment/download/');
}

function isPublicSso(request: FastifyRequest): boolean {
  if (request.method.toUpperCase() !== 'GET') {
    return false;
  }
  const path = request.url.split('?')[0] ?? '';
  return path.startsWith('/sso/callback');
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

/**
 * 除匿名接口外，要求 X-AUTH-TOKEN 对应有效会话。
 * 写操作额外校验 CSRF-TOKEN，与前端 axios 拦截器一致。
 */
export async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const sessionId = headerValue(request.headers['x-auth-token']);
  const sessionUser = sessionStore.get(sessionId);
  request.sessionUser = sessionUser;
  request.organizationId = headerValue(request.headers['organization-id']);

  if (PUBLIC_ROUTES.has(routeKey(request)) || isPublicFile(request) || isPublicSso(request)) {
    return;
  }

  if (!sessionUser || !sessionId) {
    throw unauthorized();
  }

  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const csrf = headerValue(request.headers['csrf-token']);
    if (!sessionStore.csrfMatches(sessionId, csrf)) {
      throw forbidden('CSRF 校验失败');
    }
  }
}
