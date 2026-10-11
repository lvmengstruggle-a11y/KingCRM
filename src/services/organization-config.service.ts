import {
  findConfigContent,
  findOrganizationConfig,
  insertConfigContent,
  insertOrganizationConfig,
  listConfigContents,
  updateConfigContent,
  updateSyncResource,
} from '../models/organization-config.model.js';
import { countEmail, countPhone, findEmployeesByContact, updateEmployee } from '../models/employee.model.js';
import { insertDepartment, listDepartments, nextDepartmentPos, type DepartmentRecord } from '../models/department.model.js';
import { validateFailed } from '../support/errors.js';
import { nextId } from '../support/id.js';
import { withTransaction } from '../support/db.js';
import { assertPublicHost, sendMail, testSmtp, type SmtpInput } from '../support/smtp.js';
import { employeeService } from './employee.service.js';

const EMAIL = 'EMAIL';
const THIRD = 'THIRD';

const emptyEmail = {
  host: '',
  port: '',
  account: '',
  password: '',
  from: '',
  recipient: '',
  ssl: 'false',
  tsl: 'false',
};

export async function getEmailConfig(organizationId: string): Promise<typeof emptyEmail> {
  const config = await findOrganizationConfig(organizationId, EMAIL);
  if (!config) {
    return { ...emptyEmail };
  }
  const detail = await findConfigContent(config.id, EMAIL);
  if (!detail?.content) {
    return { ...emptyEmail };
  }
  return { ...emptyEmail, ...JSON.parse(detail.content) };
}

export async function saveEmailConfig(organizationId: string, userId: string, email: SmtpInput): Promise<void> {
  if (email.host) {
    await assertPublicHost(email.host);
  }
  await saveJsonDetail(organizationId, userId, EMAIL, EMAIL, '邮件设置', email);
}

export async function verifyEmailConfig(email: SmtpInput): Promise<void> {
  await testSmtp(email);
}

export async function listThirdPartyConfigs(organizationId: string): Promise<Array<Record<string, unknown>>> {
  const config = await findOrganizationConfig(organizationId, THIRD);
  if (!config) {
    return [];
  }
  const details = await listConfigContents(config.id);
  return details.flatMap((detail) => {
    try {
      return [JSON.parse(detail.content) as Record<string, unknown>];
    } catch {
      return [];
    }
  });
}

export interface DirectorySyncResult {
  created: number;
  updated: number;
  skipped: number;
}

export async function saveThirdPartyConfig(
  organizationId: string,
  userId: string,
  body: { type: string; verify?: boolean; config?: Record<string, unknown> },
): Promise<DirectorySyncResult | null> {
  await saveJsonDetail(organizationId, userId, THIRD, body.type, body.type, body);
  const config = body.config ?? {};
  if (config.startEnable === true && ['WECOM', 'DINGTALK', 'LARK'].includes(body.type)) {
    return syncDirectory(organizationId, userId, body.type, config);
  }
  return null;
}

export async function testThirdParty(body: { type: string; config?: Record<string, unknown> }): Promise<boolean> {
  try {
    return Boolean(await accessToken(body.type, body.config ?? {}));
  } catch {
    return false;
  }
}

const mailCodes = new Map<string, { code: string; email: string; expire: number }>();

export async function sendMailCode(organizationId: string, userId: string, email: string): Promise<void> {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw validateFailed('邮箱格式不正确');
  }
  const mail = await getEmailConfig(organizationId);
  if (!mail.host) {
    throw validateFailed('请先在企业设置中配置邮箱');
  }
  const code = String(Math.floor(100000 + Math.random() * 900000));
  mailCodes.set(userId, { code, email, expire: Date.now() + 10 * 60 * 1000 });
  await sendMail(mail, email, 'KingCRM 验证码', `您的验证码是 ${code}，10 分钟内有效。`);
}

export function consumeMailCode(userId: string, email: string, code: string): void {
  const saved = mailCodes.get(userId);
  if (!saved || saved.expire < Date.now() || saved.email !== email || saved.code !== code) {
    throw validateFailed('验证码不正确或已过期');
  }
  mailCodes.delete(userId);
}

export async function switchThirdParty(organizationId: string, userId: string, type: string): Promise<void> {
  const config = await findOrganizationConfig(organizationId, THIRD);
  const id = config?.id ?? await insertOrganizationConfig({ organizationId, type: THIRD, userId });
  await updateSyncResource(id, type, userId);
}

export async function latestSyncResource(organizationId: string) {
  const config = await findOrganizationConfig(organizationId, THIRD);
  if (!config) {
    return {
      id: '',
      createUser: '',
      updateUser: '',
      createTime: 0,
      updateTime: 0,
      type: '',
      organizationId,
      sync: false,
      syncResource: 'WECOM',
      enable: false,
    };
  }
  return {
    id: config.id,
    createUser: config.createUser,
    updateUser: config.updateUser,
    createTime: config.createTime,
    updateTime: config.updateTime,
    type: config.type,
    organizationId: config.organizationId,
    sync: config.sync,
    syncResource: config.syncResource || 'WECOM',
    enable: config.enable,
  };
}

async function saveJsonDetail(
  organizationId: string,
  userId: string,
  configType: string,
  detailType: string,
  name: string,
  value: unknown,
): Promise<void> {
  let config = await findOrganizationConfig(organizationId, configType);
  if (!config) {
    await insertOrganizationConfig({ organizationId, type: configType, userId });
    config = await findOrganizationConfig(organizationId, configType);
  }
  if (!config) {
    return;
  }
  const content = JSON.stringify(value);
  const current = await findConfigContent(config.id, detailType);
  if (current) {
    await updateConfigContent(current.id, content, userId);
    return;
  }
  await insertConfigContent({
    configId: config.id,
    type: detailType,
    name,
    content,
    userId,
  });
}

interface ExternalDepartment {
  id: string;
  name: string;
  parentId: string;
}

interface DirectoryUser {
  name: string;
  phone: string;
  email: string;
  position: string;
  gender: boolean;
  genderKnown: boolean;
  departmentKey: string;
}

async function syncDirectory(
  organizationId: string,
  userId: string,
  type: string,
  config: Record<string, unknown>,
): Promise<DirectorySyncResult> {
  const token = await accessToken(type, config);
  if (!token) {
    throw validateFailed('连接失败，请检查企业 ID 和应用密钥');
  }
  const departments = await listDepartments(organizationId);
  const root = localRoot(departments);
  if (!root) {
    throw validateFailed('请先创建部门，再开启通讯录同步');
  }
  const directory = await loadDirectory(type, token);
  const departmentIds = await mapDepartments(organizationId, userId, root.id, departments, directory.departments);
  const result: DirectorySyncResult = { created: 0, updated: 0, skipped: 0 };
  for (const person of directory.users) {
    if (result.created + result.updated >= 200) {
      result.skipped += 1;
      continue;
    }
    const departmentId = departmentIds.get(person.departmentKey) || root.id;
    const matched = await matchEmployee(organizationId, person.phone, person.email);
    if (matched === 'conflict' || !person.name) {
      result.skipped += 1;
      continue;
    }
    if (matched) {
      await withTransaction((tx) => updateEmployee(tx, {
        orgUserId: matched.id,
        userId: matched.userId,
        name: person.name,
        phone: matched.phone ?? '',
        email: matched.email ?? '',
        gender: person.genderKnown ? person.gender : matched.gender,
        departmentId,
        employeeId: matched.employeeId ?? '',
        employeeType: matched.employeeType ?? '',
        supervisorId: matched.supervisorId ?? '',
        position: person.position || matched.position || '',
        workCity: matched.workCity ?? '',
        enable: matched.enable,
        onboardingDate: matched.onboardingDate,
        operatorId: userId,
      }));
      result.updated += 1;
      continue;
    }
    if (!/^1\d{10}$/.test(person.phone) || !person.email.includes('@')) {
      result.skipped += 1;
      continue;
    }
    if (await countPhone(person.phone, '') > 0 || await countEmail(person.email, '') > 0) {
      result.skipped += 1;
      continue;
    }
    await employeeService.add({
      name: person.name,
      phone: person.phone,
      email: person.email,
      gender: person.gender,
      departmentId,
      position: person.position,
      enable: true,
    }, organizationId, userId);
    result.created += 1;
  }
  return result;
}

function localRoot(departments: DepartmentRecord[]): DepartmentRecord | undefined {
  const ids = new Set(departments.map((item) => item.id));
  return departments.find((item) => !item.parentId || !ids.has(item.parentId)) ?? departments[0];
}

async function mapDepartments(
  organizationId: string,
  userId: string,
  rootId: string,
  existing: DepartmentRecord[],
  external: ExternalDepartment[],
): Promise<Map<string, string>> {
  const mapped = new Map<string, string>();
  const known = [...existing];
  const pending = [...external];
  for (let round = 0; round < pending.length + 1; round += 1) {
    let moved = false;
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const item = pending[index];
      if (!item.name) {
        pending.splice(index, 1);
        continue;
      }
      if (item.parentId === '0') {
        mapped.set(item.id, rootId);
        pending.splice(index, 1);
        moved = true;
        continue;
      }
      const parent = item.parentId === 'ROOT' ? rootId : mapped.get(item.parentId);
      if (!parent) {
        continue;
      }
      const current = known.find((row) => row.name === item.name && row.parentId === parent);
      const id = current?.id ?? await createDepartment(organizationId, userId, item.name, parent);
      if (!current) {
        known.push({ id, name: item.name, parentId: parent, organizationId, pos: 0, resource: 'INTERNAL' });
      }
      mapped.set(item.id, id);
      pending.splice(index, 1);
      moved = true;
    }
    if (!moved) {
      break;
    }
  }
  return mapped;
}

async function createDepartment(organizationId: string, userId: string, name: string, parentId: string): Promise<string> {
  const id = nextId();
  const pos = await nextDepartmentPos(organizationId);
  await insertDepartment({ id, name, parentId, organizationId, pos, userId });
  return id;
}

async function matchEmployee(organizationId: string, phone: string, email: string) {
  const rows = await findEmployeesByContact(organizationId, phone, email);
  const userIds = new Set(rows.map((row) => row.userId));
  if (userIds.size > 1) {
    return 'conflict' as const;
  }
  return rows[0] ?? null;
}

async function accessToken(type: string, config: Record<string, unknown>): Promise<string> {
  const secret = textOf(config.appSecret);
  const corpId = textOf(config.corpId);
  const appId = textOf(config.appId) || corpId;
  if (!secret || !appId) {
    return '';
  }
  if (type === 'WECOM') {
    const data = await requestJson(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(secret)}`);
    return Number(data.errcode) === 0 ? String(data.access_token ?? '') : '';
  }
  if (type === 'DINGTALK') {
    const data = await requestJson(`https://oapi.dingtalk.com/gettoken?appkey=${encodeURIComponent(appId)}&appsecret=${encodeURIComponent(secret)}`);
    return Number(data.errcode) === 0 ? String(data.access_token ?? '') : '';
  }
  if (type === 'LARK') {
    const data = await requestJson('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: secret }),
    });
    return Number(data.code) === 0 ? String(data.tenant_access_token ?? '') : '';
  }
  return '';
}

async function loadDirectory(type: string, token: string): Promise<{ departments: ExternalDepartment[]; users: DirectoryUser[] }> {
  if (type === 'WECOM') {
    return loadWecom(token);
  }
  if (type === 'DINGTALK') {
    return loadDingtalk(token);
  }
  return loadLark(token);
}

async function loadWecom(token: string): Promise<{ departments: ExternalDepartment[]; users: DirectoryUser[] }> {
  const deptData = await requestJson(`https://qyapi.weixin.qq.com/cgi-bin/department/list?access_token=${encodeURIComponent(token)}`);
  if (Number(deptData.errcode) !== 0) {
    throw validateFailed('通讯录拉取失败');
  }
  const departments = asList(deptData.department).map((item) => ({
    id: String(item.id ?? ''),
    name: textOf(item.name),
    parentId: String(item.parentid ?? '0'),
  }));
  const root = departments.find((item) => item.parentId === '0') ?? departments[0];
  const userData = await requestJson(`https://qyapi.weixin.qq.com/cgi-bin/user/list?access_token=${encodeURIComponent(token)}&department_id=${encodeURIComponent(root?.id || '1')}&fetch_child=1`);
  if (Number(userData.errcode) !== 0) {
    throw validateFailed('通讯录拉取失败');
  }
  return {
    departments,
    users: asList(userData.userlist).map((item) => {
      const deptIds = Array.isArray(item.department) ? item.department.map((id) => String(id)) : [];
      const gender = String(item.gender ?? '');
      return {
        name: textOf(item.name),
        phone: phoneOf(item.mobile),
        email: textOf(item.email) || textOf(item.biz_mail),
        position: textOf(item.position),
        gender: gender === '1',
        genderKnown: gender === '1' || gender === '2',
        departmentKey: String(item.main_department ?? deptIds[0] ?? ''),
      };
    }),
  };
}

async function loadDingtalk(token: string): Promise<{ departments: ExternalDepartment[]; users: DirectoryUser[] }> {
  const departments: ExternalDepartment[] = [];
  await collectDingtalkDepartments(token, '1', departments, 0);
  const deptIds = ['1', ...departments.map((item) => item.id)].slice(0, 15);
  const users: DirectoryUser[] = [];
  const seen = new Set<string>();
  for (const deptId of deptIds) {
    const data = await requestJson(`https://oapi.dingtalk.com/topapi/v2/user/list?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dept_id: Number(deptId), cursor: 0, size: 100 }),
    });
    if (Number(data.errcode) !== 0) {
      throw validateFailed('通讯录拉取失败');
    }
    const result = data.result && typeof data.result === 'object' ? data.result as Record<string, unknown> : {};
    for (const item of asList(result.list)) {
      const key = textOf(item.userid) || phoneOf(item.mobile) || textOf(item.email);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      users.push({
        name: textOf(item.name),
        phone: phoneOf(item.mobile),
        email: textOf(item.email) || textOf(item.org_email),
        position: textOf(item.title),
        gender: true,
        genderKnown: false,
        departmentKey: deptId === '1' ? '' : deptId,
      });
    }
  }
  return { departments, users };
}

async function collectDingtalkDepartments(token: string, parentId: string, collected: ExternalDepartment[], depth: number): Promise<void> {
  if (depth > 3 || collected.length >= 40) {
    return;
  }
  const data = await requestJson(`https://oapi.dingtalk.com/topapi/v2/department/listsub?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dept_id: Number(parentId) }),
  });
  if (Number(data.errcode) !== 0) {
    throw validateFailed('通讯录拉取失败');
  }
  for (const item of asList(data.result)) {
    const id = String(item.dept_id ?? '');
    if (!id) {
      continue;
    }
    collected.push({ id, name: textOf(item.name), parentId: parentId === '1' ? 'ROOT' : parentId });
    await collectDingtalkDepartments(token, id, collected, depth + 1);
  }
}

async function loadLark(token: string): Promise<{ departments: ExternalDepartment[]; users: DirectoryUser[] }> {
  const deptData = await requestJson('https://open.feishu.cn/open-apis/contact/v3/departments/0/children?page_size=50', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (Number(deptData.code) !== 0) {
    throw validateFailed('通讯录拉取失败');
  }
  const deptPayload = deptData.data && typeof deptData.data === 'object' ? deptData.data as Record<string, unknown> : {};
  const departments = asList(deptPayload.items).map((item) => ({
    id: textOf(item.open_department_id) || textOf(item.department_id),
    name: textOf(item.name),
    parentId: 'ROOT',
  }));
  const userData = await requestJson('https://open.feishu.cn/open-apis/contact/v3/users/find_by_department?department_id=0&page_size=50', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (Number(userData.code) !== 0) {
    throw validateFailed('通讯录拉取失败');
  }
  const userPayload = userData.data && typeof userData.data === 'object' ? userData.data as Record<string, unknown> : {};
  return {
    departments,
    users: asList(userPayload.items).map((item) => {
      const deptIds = Array.isArray(item.department_ids) ? item.department_ids.map((id) => String(id)) : [];
      return {
        name: textOf(item.name),
        phone: phoneOf(item.mobile),
        email: textOf(item.email) || textOf(item.enterprise_email),
        position: textOf(item.job_title),
        gender: true,
        genderKnown: false,
        departmentKey: deptIds[0] ?? '',
      };
    }),
  };
}

async function requestJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
  return await response.json() as Record<string, unknown>;
}

function asList(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
}

function textOf(value: unknown): string {
  return String(value ?? '').trim();
}

function phoneOf(value: unknown): string {
  const digits = textOf(value).replace(/\D/g, '');
  return digits.length >= 11 ? digits.slice(-11) : '';
}
