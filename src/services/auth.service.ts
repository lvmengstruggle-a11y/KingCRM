import { ADMIN_USER_ID, DEFAULT_ADMIN_PASSWORD } from '../config/index.js';
import { insertLoginLog } from '../models/login-log.model.js';
import { findMembership, listOrganizationIds } from '../models/organization.model.js';
import { listPermissionIds, listRoles } from '../models/role.model.js';
import { findPassword, findUserByKey, updateLanguage, type UserRecord } from '../models/user.model.js';
import { md5, md5Equals } from '../support/coding.js';
import { failed, unauthorized } from '../support/errors.js';
import { rsaKeyStore } from '../support/rsa.js';
import { sessionStore } from '../support/session-store.js';
import type { SessionUser } from '../support/session-user.js';

export interface LoginInput {
  username: string;
  password: string;
  platform: string;
  loginAddress: string;
  organizationId?: string;
}

export class AuthService {
  getPublicKey(): string {
    return rsaKeyStore.getPublicKey();
  }

  async login(input: LoginInput, current: SessionUser | null): Promise<SessionUser> {
    const username = this.decryptField(input.username, '用户名');
    const password = this.decryptField(input.password, '密码');
    const user = await this.loadAccount(username.trim());

    if (current && current.id !== user.id && current.id !== username.trim()) {
      throw failed('请先退出当前登录用户');
    }

    const stored = await findPassword(user.id);
    if (!stored || !md5Equals(password.trim(), stored)) {
      throw unauthorized('用户名或密码错误');
    }

    const sessionUser = await this.buildSessionUser(user, input.organizationId);
    const created = sessionStore.create(stripSecrets(sessionUser));
    await insertLoginLog({
      operator: created.id,
      loginAddress: input.loginAddress,
      platform: input.platform,
    });
    return created;
  }

  async refresh(sessionUser: SessionUser, organizationId?: string): Promise<SessionUser> {
    const user = await findUserByKey(sessionUser.id);
    if (!user) {
      sessionStore.destroy(sessionUser.sessionId);
      throw unauthorized('用户未登录');
    }
    const rebuilt = await this.buildSessionUser(user, organizationId || sessionUser.lastOrganizationId);
    const replaced = sessionStore.replace(sessionUser.sessionId, stripSecrets(rebuilt));
    if (!replaced) {
      throw unauthorized('用户未登录');
    }
    return replaced;
  }

  logout(sessionId: string | undefined): string {
    sessionStore.destroy(sessionId);
    return 'logout success';
  }

  async changeLanguage(userId: string, language: string): Promise<void> {
    await updateLanguage(userId, language);
  }

  private decryptField(cipherText: string, label: string): string {
    try {
      return rsaKeyStore.decrypt(cipherText);
    } catch {
      throw failed(`${label}解密失败，请重新获取公钥`);
    }
  }

  private async loadAccount(userKey: string): Promise<UserRecord> {
    const user = await findUserByKey(userKey);
    if (!user) {
      throw unauthorized('用户名或密码错误');
    }
    return user;
  }

  private async buildSessionUser(
    user: UserRecord,
    requestedOrgId: string | undefined,
  ): Promise<Omit<SessionUser, 'sessionId' | 'csrfToken'>> {
    const isAdmin = user.id === ADMIN_USER_ID;
    const organizationIds = await listOrganizationIds(user.id, isAdmin);
    const organizationId = pickOrganization(requestedOrgId, user.lastOrganizationId, organizationIds);

    const membership = organizationId ? await findMembership(user.id, organizationId) : null;
    if (!isAdmin && (!membership || !membership.enable)) {
      throw unauthorized('用户名或密码错误');
    }

    const roles = organizationId ? await listRoles(user.id, organizationId) : [];
    const permissionIds = organizationId ? await listPermissionIds(user.id, organizationId) : [];
    const passwordHash = await findPassword(user.id);

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      password: '',
      enable: membership ? membership.enable : true,
      createTime: user.createTime,
      updateTime: user.updateTime,
      language: user.language,
      lastOrganizationId: organizationId,
      phone: user.phone,
      source: 'LOCAL',
      createUser: user.createUser,
      updateUser: user.updateUser,
      platformInfo: null,
      avatar: user.avatar,
      permissionIds,
      organizationIds,
      roles,
      departmentId: membership?.departmentId ?? null,
      departmentName: membership?.departmentName ?? null,
      defaultPwd: isDefaultPassword(user, passwordHash),
    };
  }
}

export const authService = new AuthService();

function pickOrganization(
  requested: string | undefined,
  lastOrganizationId: string | null,
  organizationIds: string[],
): string {
  if (requested && organizationIds.includes(requested)) {
    return requested;
  }
  if (lastOrganizationId && organizationIds.includes(lastOrganizationId)) {
    return lastOrganizationId;
  }
  return organizationIds[0] ?? '';
}

function isDefaultPassword(user: UserRecord, passwordHash: string | null): boolean {
  if (!passwordHash) {
    return false;
  }
  if (user.id === ADMIN_USER_ID) {
    return passwordHash.toLowerCase() === md5(DEFAULT_ADMIN_PASSWORD);
  }
  if (user.phone && user.phone.length >= 6) {
    return passwordHash.toLowerCase() === md5(user.phone.slice(-6));
  }
  return false;
}

function stripSecrets(
  user: Omit<SessionUser, 'sessionId' | 'csrfToken'>,
): Omit<SessionUser, 'sessionId' | 'csrfToken'> {
  return { ...user, password: '' };
}
