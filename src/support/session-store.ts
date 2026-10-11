import { randomBytes, timingSafeEqual } from 'node:crypto';

import { config } from '../config/index.js';
import type { SessionUser } from './session-user.js';

interface SessionRecord {
  user: SessionUser;
  csrfToken: string;
  expiresAt: number;
}

/**
 * 进程内会话。前端用 X-AUTH-TOKEN + CSRF-TOKEN 识别登录态，
 * 不依赖 Java Shiro 的 Cookie。多实例部署时再换成 Redis。
 */
class MemorySessionStore {
  private readonly sessions = new Map<string, SessionRecord>();

  constructor() {
    const timer = setInterval(() => this.sweep(), 60_000);
    timer.unref();
  }

  create(user: Omit<SessionUser, 'sessionId' | 'csrfToken'>): SessionUser {
    const sessionId = randomBytes(16).toString('hex');
    const csrfToken = randomBytes(24).toString('hex');
    const sessionUser: SessionUser = { ...user, sessionId, csrfToken };
    this.sessions.set(sessionId, {
      user: sessionUser,
      csrfToken,
      expiresAt: Date.now() + config.sessionTtlMs,
    });
    return sessionUser;
  }

  get(sessionId: string | undefined): SessionUser | null {
    if (!sessionId) {
      return null;
    }
    const record = this.sessions.get(sessionId);
    if (!record) {
      return null;
    }
    if (record.expiresAt < Date.now()) {
      this.sessions.delete(sessionId);
      return null;
    }
    record.expiresAt = Date.now() + config.sessionTtlMs;
    return record.user;
  }

  replace(sessionId: string, user: Omit<SessionUser, 'sessionId' | 'csrfToken'>): SessionUser | null {
    const record = this.sessions.get(sessionId);
    if (!record || record.expiresAt < Date.now()) {
      return null;
    }
    const next: SessionUser = {
      ...user,
      sessionId,
      csrfToken: record.csrfToken,
    };
    record.user = next;
    record.expiresAt = Date.now() + config.sessionTtlMs;
    return next;
  }

  destroy(sessionId: string | undefined): void {
    if (sessionId) {
      this.sessions.delete(sessionId);
    }
  }

  csrfMatches(sessionId: string, token: string | undefined): boolean {
    const record = this.sessions.get(sessionId);
    if (!record || !token) {
      return false;
    }
    const left = Buffer.from(record.csrfToken);
    const right = Buffer.from(token);
    if (left.length !== right.length) {
      return false;
    }
    return timingSafeEqual(left, right);
  }

  kick(userId: string): void {
    for (const [id, record] of this.sessions) {
      if (record.user.id === userId) {
        this.sessions.delete(id);
      }
    }
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, record] of this.sessions) {
      if (record.expiresAt < now) {
        this.sessions.delete(id);
      }
    }
  }
}

export const sessionStore = new MemorySessionStore();
