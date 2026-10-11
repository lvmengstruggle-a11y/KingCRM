import { listDepartments } from '../models/department.model.js';
import {
  clearStatusFlag,
  countTicketsByStatus,
  countTicketsByTemplate,
  deleteRoute,
  deleteStatus,
  deleteTemplate,
  findConfig,
  findStatus,
  findTemplate,
  firstDepartmentId,
  insertConfig,
  insertStatus,
  insertTemplate,
  listRoutes,
  listStatuses,
  listTemplates,
  saveRoute,
  updateConfig,
  updateStatus,
  updateTemplate,
  type TicketConfig,
  type TicketStatus,
  type TicketTemplate,
} from '../models/ticket-setting.model.js';
import { withTransaction } from '../support/db.js';
import { validateFailed } from '../support/errors.js';
import { nextId } from '../support/id.js';

export async function ensureTicketBasics(organizationId: string, userId: string): Promise<void> {
  const [statuses, templates, config] = await Promise.all([
    listStatuses(organizationId),
    listTemplates(organizationId),
    findConfig(organizationId),
  ]);
  if (statuses.length > 0 && templates.length > 0 && config) {
    return;
  }
  const now = Date.now();
  const departmentId = await firstDepartmentId(organizationId);
  await withTransaction(async (tx) => {
    if (statuses.length === 0) {
      const seeds: Array<Pick<TicketStatus, 'name' | 'color' | 'pos' | 'isInitial' | 'isTerminal'>> = [
        { name: '待处理', color: '#b8d900', pos: 1, isInitial: true, isTerminal: false },
        { name: '处理中', color: '#3290f9', pos: 2, isInitial: false, isTerminal: false },
        { name: '待确认', color: '#9c2189', pos: 3, isInitial: false, isTerminal: false },
        { name: '已完成', color: '#00b5ad', pos: 4, isInitial: false, isTerminal: true },
      ];
      for (const seed of seeds) {
        await insertStatus(tx, {
          id: nextId(),
          organizationId,
          stopTiming: false,
          ...seed,
        }, userId, now);
      }
    }
    if (templates.length === 0) {
      await insertTemplate(tx, {
        id: nextId(),
        organizationId,
        name: '默认模板',
        enable: true,
        pos: 1,
        enableCustomer: true,
        enableCc: true,
        enableHandler: false,
        enableDeadline: true,
        enableMobile: false,
        mobileRequired: false,
        enableMail: false,
        mailRequired: false,
      }, userId, now);
    }
    if (!config) {
      await insertConfig(tx, defaultConfig(organizationId, departmentId), userId, now);
    }
  });
}

function defaultConfig(organizationId: string, departmentId: string | null): TicketConfig {
  return {
    id: nextId(),
    organizationId,
    defaultDepartmentId: departmentId,
    lastHandlerId: null,
    handlerCanClose: true,
    publisherCanClose: true,
    replyAfterClose: false,
    allowStatusBack: false,
    notifyAssign: true,
    notifyReplyPublisher: true,
    notifyReplyHandler: true,
    notifyReplyCc: true,
    notifyReplyFollow: true,
    notifyInternalHandler: true,
    notifyStatusPublisher: false,
    notifyClosePublisher: false,
    notifyRestartHandler: true,
    satisfyEnabled: true,
  };
}

export async function listTicketTemplates(organizationId: string): Promise<TicketTemplate[]> {
  return listTemplates(organizationId);
}

export async function saveTicketTemplate(input: {
  organizationId: string;
  userId: string;
  id?: string;
  name: string;
  enable: boolean;
  pos?: number;
  enableCustomer: boolean;
  enableCc: boolean;
  enableHandler: boolean;
  enableDeadline: boolean;
  enableMobile: boolean;
  mobileRequired: boolean;
  enableMail: boolean;
  mailRequired: boolean;
}): Promise<TicketTemplate> {
  const name = input.name.trim();
  if (!name) {
    throw validateFailed('模板名称不能为空');
  }
  const now = Date.now();
  const current = await listTemplates(input.organizationId);
  const savedId = input.id || nextId();
  await withTransaction(async (tx) => {
    if (input.id) {
      const existing = await findTemplate(input.id, input.organizationId, tx);
      if (!existing) {
        throw validateFailed('模板不存在');
      }
      await updateTemplate(tx, {
        ...existing,
        ...input,
        id: input.id,
        name,
        pos: input.pos ?? existing.pos,
      }, input.userId, now);
      return;
    }
    const pos = current.reduce((max, item) => Math.max(max, item.pos), 0) + 1;
    await insertTemplate(tx, {
      id: savedId,
      organizationId: input.organizationId,
      name,
      enable: input.enable,
      pos,
      enableCustomer: input.enableCustomer,
      enableCc: input.enableCc,
      enableHandler: input.enableHandler,
      enableDeadline: input.enableDeadline,
      enableMobile: input.enableMobile,
      mobileRequired: input.mobileRequired,
      enableMail: input.enableMail,
      mailRequired: input.mailRequired,
    }, input.userId, now);
  });
  const saved = await findTemplate(savedId, input.organizationId);
  if (!saved) {
    throw validateFailed('模板保存失败');
  }
  return saved;
}

export async function removeTicketTemplate(id: string, organizationId: string): Promise<void> {
  const existing = await findTemplate(id, organizationId);
  if (!existing) {
    throw validateFailed('模板不存在');
  }
  if (await countTicketsByTemplate(id, organizationId) > 0) {
    throw validateFailed('该模板下已有工单');
  }
  await withTransaction(async (tx) => {
    await deleteTemplate(tx, id, organizationId);
  });
}

export async function listTicketStatuses(organizationId: string): Promise<TicketStatus[]> {
  return listStatuses(organizationId);
}

export async function saveTicketStatus(input: {
  organizationId: string;
  userId: string;
  id?: string;
  name: string;
  color: string;
  isInitial: boolean;
  isTerminal: boolean;
  stopTiming: boolean;
}): Promise<void> {
  const name = input.name.trim();
  if (!name) {
    throw validateFailed('状态名称不能为空');
  }
  const statuses = await listStatuses(input.organizationId);
  const current = input.id ? statuses.find((item) => item.id === input.id) : undefined;
  if (input.id && !current) {
    throw validateFailed('状态不存在');
  }
  if (current?.isInitial && !input.isInitial && !statuses.some((item) => item.id !== current.id && item.isInitial)) {
    throw validateFailed('至少保留一个初始状态');
  }
  if (current?.isTerminal && !input.isTerminal && !statuses.some((item) => item.id !== current.id && item.isTerminal)) {
    throw validateFailed('至少保留一个结束状态');
  }
  const now = Date.now();
  await withTransaction(async (tx) => {
    const id = input.id || nextId();
    const row: TicketStatus = {
      id,
      organizationId: input.organizationId,
      name,
      color: input.color || '#3290f9',
      pos: current?.pos ?? statuses.reduce((max, item) => Math.max(max, item.pos), 0) + 1,
      isInitial: input.isInitial,
      isTerminal: input.isTerminal,
      stopTiming: input.stopTiming,
    };
    if (current) {
      await updateStatus(tx, row, input.userId, now);
    } else {
      await insertStatus(tx, row, input.userId, now);
    }
    if (row.isInitial) {
      await clearStatusFlag(tx, input.organizationId, 'is_initial', id);
    }
    if (row.isTerminal) {
      await clearStatusFlag(tx, input.organizationId, 'is_terminal', id);
    }
  });
}

export async function sortTicketStatuses(organizationId: string, userId: string, ids: string[]): Promise<void> {
  const statuses = await listStatuses(organizationId);
  if (ids.length !== statuses.length || ids.some((id) => !statuses.some((item) => item.id === id))) {
    throw validateFailed('状态排序不完整');
  }
  const now = Date.now();
  await withTransaction(async (tx) => {
    for (let index = 0; index < ids.length; index += 1) {
      const status = statuses.find((item) => item.id === ids[index]);
      if (!status) {
        continue;
      }
      await updateStatus(tx, { ...status, pos: index + 1 }, userId, now);
    }
  });
}

export async function removeTicketStatus(id: string, organizationId: string): Promise<void> {
  const status = await findStatus(id, organizationId);
  if (!status) {
    throw validateFailed('状态不存在');
  }
  if (status.isInitial || status.isTerminal) {
    throw validateFailed('初始状态和结束状态不能删除');
  }
  if (await countTicketsByStatus(id, organizationId) > 0) {
    throw validateFailed('该状态仍被工单使用');
  }
  await withTransaction(async (tx) => {
    await deleteStatus(tx, id, organizationId);
  });
}

export async function listTicketRoutes(organizationId: string) {
  return listRoutes(organizationId);
}

export async function saveTicketRoute(input: {
  organizationId: string;
  userId: string;
  templateId: string;
  departmentId: string;
}): Promise<void> {
  const template = await findTemplate(input.templateId, input.organizationId);
  if (!template) {
    throw validateFailed('模板不存在');
  }
  const departments = await listDepartments(input.organizationId);
  if (!departments.some((item) => item.id === input.departmentId)) {
    throw validateFailed('部门不存在');
  }
  const now = Date.now();
  await withTransaction(async (tx) => {
    await saveRoute(tx, {
      id: nextId(),
      organizationId: input.organizationId,
      templateId: input.templateId,
      departmentId: input.departmentId,
      lastHandlerId: null,
    }, input.userId, now);
  });
}

export async function removeTicketRoute(id: string, organizationId: string): Promise<void> {
  await withTransaction(async (tx) => {
    await deleteRoute(tx, id, organizationId);
  });
}

export async function getTicketConfig(organizationId: string, userId: string): Promise<TicketConfig> {
  await ensureTicketBasics(organizationId, userId);
  const config = await findConfig(organizationId);
  if (!config) {
    throw validateFailed('工单配置不存在');
  }
  return config;
}

export async function saveTicketConfig(input: {
  organizationId: string;
  userId: string;
  defaultDepartmentId: string | null;
  handlerCanClose: boolean;
  publisherCanClose: boolean;
  replyAfterClose: boolean;
  allowStatusBack: boolean;
  notifyAssign: boolean;
  notifyReplyPublisher: boolean;
  notifyReplyHandler: boolean;
  notifyReplyCc: boolean;
  notifyReplyFollow: boolean;
  notifyInternalHandler: boolean;
  notifyStatusPublisher: boolean;
  notifyClosePublisher: boolean;
  notifyRestartHandler: boolean;
  satisfyEnabled: boolean;
}): Promise<void> {
  if (input.defaultDepartmentId) {
    const departments = await listDepartments(input.organizationId);
    if (!departments.some((item) => item.id === input.defaultDepartmentId)) {
      throw validateFailed('部门不存在');
    }
  }
  const now = Date.now();
  await withTransaction(async (tx) => {
    const current = await findConfig(input.organizationId, tx);
    const row: TicketConfig = {
      ...input,
      id: current?.id ?? nextId(),
      organizationId: input.organizationId,
      lastHandlerId: current?.lastHandlerId ?? null,
    };
    if (current) {
      await updateConfig(tx, row, input.userId, now);
    } else {
      await insertConfig(tx, row, input.userId, now);
    }
  });
}
