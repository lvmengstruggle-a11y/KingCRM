import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { listDepartments } from '../models/department.model.js';
import { getFormConfig, type FormField } from '../models/form.model.js';
import { firstOrganizationId } from '../models/organization.model.js';
import {
  addParticipant,
  addReplyFiles,
  departmentCommanders,
  findSatisfy,
  findTicket,
  findTicketByNumber,
  insertEvent,
  insertInternalReply,
  insertReply,
  insertSatisfy,
  insertTicket,
  findCustomerForTicket,
  findEnabledMember,
  isFollowed,
  isRelated,
  listCc,
  listCustomerOptions,
  listEnabledUsers,
  listEvents,
  listFields,
  listFileIds,
  listFiles,
  listFollowers,
  listInternalReplies,
  listReplies,
  lockTicket,
  markRecycled,
  numberExists,
  pageTickets as pageTicketRows,
  purgeTicket,
  recordExists,
  replaceCc,
  replaceFields,
  replaceTicketFiles,
  roleDepartments,
  setFollow,
  updateTicketAssign,
  updateTicketBody,
  updateTicketPriority,
  updateTicketStatus,
  type ModuleFieldValue,
  type TicketRecord,
} from '../models/ticket.model.js';
import { findConfig, findTemplate, listStatuses, listTemplates, type TicketConfig, type TicketTemplate } from '../models/ticket-setting.model.js';
import { ADMIN_USER_ID } from '../config/index.js';
import { deleteTempFile } from './file.service.js';
import { assignOnCreate } from './ticket-assign.service.js';
import { notifyTicket, type TicketNotice } from './ticket-notify.service.js';
import { ensureTicketBasics } from './ticket-setting.service.js';
import type { Tx } from '../support/db.js';
import { withTransaction } from '../support/db.js';
import { AppError, validateFailed } from '../support/errors.js';
import { nextId } from '../support/id.js';
import { toPager, type Pager } from '../support/pager.js';
import { Permission } from '../support/permission.js';
import { ResultCode } from '../support/result.js';
import type { SessionUser } from '../support/session-user.js';

const PUBLIC_PUBLISHER_ID = 'public';
const publicHits = new Map<string, number[]>();
const BLOB_TYPES = new Set(['TEXTAREA', 'INPUT_MULTIPLE', 'SELECT_MULTIPLE', 'ATTACHMENT', 'PICTURE']);
const PRIORITIES = [
  { value: 1, label: '一般' },
  { value: 2, label: '紧急' },
  { value: 3, label: '高' },
  { value: 4, label: '低' },
];

export interface TicketActor {
  user: SessionUser;
  organizationId: string;
}

interface Scope {
  scopeAll: boolean;
  departmentIds: string[];
}

export async function pageTickets(actor: TicketActor, input: {
  view: 'all' | 'mine' | 'handling' | 'department' | 'cc' | 'recycle';
  keyword: string;
  statusId: string;
  priority: number;
  templateId: string;
  handlerId: string;
  customerId: string;
  current: number;
  pageSize: number;
  canRecycle: boolean;
}): Promise<Pager<Record<string, unknown>>> {
  if (input.view === 'recycle' && !input.canRecycle) {
    throw invisible();
  }
  await ensureTicketBasics(actor.organizationId, actor.user.id);
  const scope = await scopeOf(actor);
  const departmentId = actor.user.departmentId;
  const result = await pageTicketRows({
    organizationId: actor.organizationId,
    view: input.view,
    userId: actor.user.id,
    departmentId,
    scopeAll: scope.scopeAll,
    scopeDepartmentIds: scope.departmentIds,
    keyword: input.keyword,
    statusId: input.statusId,
    priority: input.priority,
    templateId: input.templateId,
    handlerId: input.handlerId,
    customerId: input.customerId,
    current: input.current,
    pageSize: input.pageSize,
  });
  return toPager(result.list.map(listItem), result.total, { current: input.current, pageSize: input.pageSize });
}

export async function getTicket(actor: TicketActor, id: string): Promise<Record<string, unknown>> {
  const ticket = await requireVisible(actor, id);
  const [fields, replies, internalReplies, events, ccUsers, files, satisfy, followed, config, template] = await Promise.all([
    listFields(id),
    listReplies(id),
    listInternalReplies(id),
    listEvents(id),
    listCc(id),
    listFiles(id),
    findSatisfy(id),
    isFollowed(id, actor.user.id),
    requireConfig(actor.organizationId),
    findTemplate(ticket.templateId, actor.organizationId),
  ]);
  return {
    ...listItem(ticket),
    templateId: ticket.templateId,
    templateName: ticket.templateName,
    recipientId: ticket.recipientId,
    mobile: ticket.mobile,
    mail: ticket.mail,
    source: ticket.source,
    recycled: ticket.recycled,
    moduleFields: fields,
    replies,
    internalReplies: canSeeInternal(actor) ? internalReplies : [],
    events: events.filter((event) => canSeeInternal(actor) || event.eventType !== 'internal_reply').map((event) => ({
      ...event,
      userName: String(event.userName ?? '') || (event.userId === PUBLIC_PUBLISHER_ID ? (ticket.guestName || '访客') : ''),
    })),
    ccUsers,
    files,
    satisfy,
    followed,
    template,
    config: {
      handlerCanClose: config.handlerCanClose,
      publisherCanClose: config.publisherCanClose,
      allowStatusBack: config.allowStatusBack,
      replyAfterClose: config.replyAfterClose,
      satisfyEnabled: config.satisfyEnabled,
      canClose: canClose(ticket, actor.user.id, config),
    },
  };
}

export async function ticketOptions(actor: TicketActor): Promise<Record<string, unknown>> {
  await ensureTicketBasics(actor.organizationId, actor.user.id);
  const [templates, statuses, departments, users, customers] = await Promise.all([
    listTemplates(actor.organizationId),
    listStatuses(actor.organizationId),
    listDepartments(actor.organizationId),
    listEnabledUsers(actor.organizationId),
    listCustomerOptions(actor.organizationId),
  ]);
  return {
    templates: templates.filter((item) => item.enable),
    statuses,
    departments,
    users,
    customers,
    priorities: PRIORITIES,
  };
}

export async function ticketForm(organizationId: string) {
  return getFormConfig('ticket', organizationId);
}

export async function createTicket(actor: TicketActor, input: TicketWriteInput & {
  templateId: string;
  handlerId: string;
  ccUserIds: string[];
  contractId: string;
  orderId: string;
}, extra?: { guestName?: string | null; source?: string; keepContact?: boolean }): Promise<{ id: string; number: string }> {
  await ensureTicketBasics(actor.organizationId, actor.user.id);
  const template = await findTemplate(input.templateId, actor.organizationId);
  if (!template || !template.enable) {
    throw validateFailed('模板不存在或已停用');
  }
  const title = cleanTitle(input.title);
  const priority = cleanPriority(input.priority);
  const fields = await normalizeFields(actor.organizationId, input.moduleFields);
  const mobile = extra?.keepContact ? optionalPhone(input.mobile) : cleanMobile(template, input.mobile);
  const mail = extra?.keepContact ? optionalMail(input.mail) : cleanMail(template, input.mail);
  const contractId = await cleanRelation('contract', actor.organizationId, input.contractId);
  const orderId = await cleanRelation('sales_order', actor.organizationId, input.orderId);
  const customerId = await resolveCustomer(actor.organizationId, {
    customerId: input.customerId,
    contractId,
    orderId,
    mobile,
    mail,
    guestName: extra?.guestName ?? null,
  });
  const deadline = template.enableDeadline ? input.deadline : null;
  const statuses = await listStatuses(actor.organizationId);
  const initial = statuses.find((item) => item.isInitial) ?? statuses[0];
  if (!initial) {
    throw validateFailed('请先配置工单状态');
  }
  const files = await namedFiles(input.fileIds);
  const now = Date.now();
  const id = nextId();
  const created = await withTransaction(async (tx) => {
    const number = await nextNumber(tx, actor.organizationId, now);
    await insertTicket(tx, {
      id,
      organizationId: actor.organizationId,
      number,
      title,
      templateId: template.id,
      statusId: initial.id,
      priority,
      publisherId: actor.user.id,
      recipientId: null,
      handlerId: null,
      departmentId: null,
      customerId,
      contractId,
      orderId,
      mobile,
      mail,
      guestName: extra?.guestName ?? null,
      source: extra?.source ?? 'PC',
      deadline,
      endTime: null,
      recycled: false,
      recycleUser: null,
      recycleTime: null,
      createTime: now,
      updateTime: now,
      createUser: actor.user.id,
      updateUser: actor.user.id,
    });
    await replaceFields(tx, id, fields.values, fields.blobIds);
    await replaceTicketFiles(tx, actor.organizationId, id, files, actor.user.id, now);
    const assigned = await assignOnCreate(tx, actor.organizationId, template, input.handlerId, actor.user.id, now);
    await updateTicketAssign(tx, id, assigned.departmentId, assigned.handlerId, assigned.recipientId, actor.user.id, now);
    const ccIds = template.enableCc
      ? unique(input.ccUserIds.filter((userId) => userId && userId !== actor.user.id && userId !== assigned.handlerId))
      : [];
    await replaceCc(tx, actor.organizationId, id, ccIds, actor.user.id, now);
    await addParticipant(tx, actor.organizationId, id, actor.user.id, actor.user.id, now);
    if (assigned.handlerId) {
      await addParticipant(tx, actor.organizationId, id, assigned.handlerId, actor.user.id, now);
    }
    for (const userId of ccIds) {
      await addParticipant(tx, actor.organizationId, id, userId, actor.user.id, now);
    }
    await insertEvent(tx, {
      organizationId: actor.organizationId,
      ticketId: id,
      userId: actor.user.id,
      eventType: 'create',
      content: title,
      now,
    });
    if (assigned.recipientId) {
      await insertEvent(tx, {
        organizationId: actor.organizationId,
        ticketId: id,
        userId: actor.user.id,
        eventType: 'receive',
        targetUserId: assigned.recipientId,
        now,
      });
    }
    return { number, assigned, ccIds };
  });
  const config = await requireConfig(actor.organizationId);
  const notices: TicketNotice[] = [];
  if (config.notifyAssign && created.assigned.handlerId) {
    notices.push({
      operation: 'ASSIGN',
      receivers: [created.assigned.handlerId],
      subject: `工单 ${created.number} 已分配给你`,
      content: title,
    });
  } else if (config.notifyAssign && created.assigned.departmentId && !created.assigned.handlerId) {
    notices.push({
      operation: 'ASSIGN_MANAGER',
      receivers: await departmentCommanders(created.assigned.departmentId),
      subject: `工单 ${created.number} 待分配处理人`,
      content: title,
    });
  }
  if (created.ccIds.length > 0) {
    notices.push({
      operation: 'CC',
      receivers: created.ccIds,
      subject: `工单 ${created.number} 抄送给你`,
      content: title,
    });
  }
  await notifyTicket({
    organizationId: actor.organizationId,
    ticketId: id,
    title,
    operatorId: actor.user.id,
    notices,
  });
  return { id, number: created.number };
}

export async function publishPublicTicket(input: {
  contactName: string;
  mobile: string;
  mail: string;
  title: string;
  priority: number;
  content: string;
}, ip: string): Promise<{ id: string; number: string }> {
  assertPublicRate(ip);
  const organizationId = await firstOrganizationId();
  if (!organizationId) {
    throw validateFailed('暂不能提交工单');
  }
  const contactName = input.contactName.trim();
  if (!contactName || contactName.length > 32) {
    throw validateFailed('请填写联系人');
  }
  const content = input.content.trim();
  if (!content) {
    throw validateFailed('请填写问题描述');
  }
  if (content.length > 4000) {
    throw validateFailed('问题描述不能超过 4000 个字');
  }
  if (!input.mobile.trim() && !input.mail.trim()) {
    throw validateFailed('请填写手机或邮箱');
  }
  await ensureTicketBasics(organizationId, PUBLIC_PUBLISHER_ID);
  const templates = await listTemplates(organizationId);
  const template = templates.find((item) => item.enable);
  if (!template) {
    throw validateFailed('暂不能提交工单');
  }
  const form = await getFormConfig('ticket', organizationId);
  const describe = form.fields.find((field) => field.internalKey === 'ticketDescribe');
  if (!describe) {
    throw validateFailed('暂不能提交工单');
  }
  return createTicket(publicActor(organizationId), {
    templateId: template.id,
    title: input.title,
    priority: input.priority,
    customerId: '',
    contractId: '',
    orderId: '',
    handlerId: '',
    ccUserIds: [],
    mobile: input.mobile,
    mail: input.mail,
    deadline: null,
    moduleFields: [{ fieldId: describe.id, fieldValue: content }],
    fileIds: [],
  }, { guestName: contactName, source: 'PUBLIC', keepContact: true });
}

export async function lookupPublicSatisfy(input: {
  number: string;
  mobile: string;
  mail: string;
}, ip: string): Promise<{
  title: string;
  number: string;
  statusName: string;
  ended: boolean;
  canRate: boolean;
  score: number | null;
  advice: string;
}> {
  assertPublicRate(ip);
  const ticket = await requirePublicTicket(input);
  const config = await requireConfig(ticket.organizationId);
  const satisfy = await findSatisfy(ticket.id);
  const ended = Boolean(ticket.endTime);
  return {
    title: ticket.title,
    number: ticket.number,
    statusName: ticket.statusName ?? '',
    ended,
    canRate: ended && config.satisfyEnabled && !satisfy,
    score: satisfy?.score ?? null,
    advice: satisfy?.advice ?? '',
  };
}

export async function submitPublicSatisfy(input: {
  number: string;
  mobile: string;
  mail: string;
  score: number;
  advice: string;
}, ip: string): Promise<void> {
  assertPublicRate(ip);
  if (input.score < 1 || input.score > 5) {
    throw validateFailed('评分范围为 1 到 5');
  }
  const advice = input.advice.trim();
  if (advice.length > 1000) {
    throw validateFailed('意见不能超过 1000 个字');
  }
  const found = await requirePublicTicket(input);
  const now = Date.now();
  await withTransaction(async (tx) => {
    const ticket = await lockTicket(tx, found.id, found.organizationId);
    if (!ticket || ticket.recycled || !contactMatches(ticket, input.mobile, input.mail)) {
      throw validateFailed('工单不存在或联系方式不正确');
    }
    if (!ticket.endTime) {
      throw validateFailed('工单尚未结束，结束后可以评价');
    }
    const config = await requireConfig(ticket.organizationId);
    if (!config.satisfyEnabled) {
      throw validateFailed('未开启满意度评价');
    }
    if (await findSatisfy(ticket.id)) {
      throw validateFailed('已经评价过');
    }
    await insertSatisfy(tx, {
      organizationId: ticket.organizationId,
      ticketId: ticket.id,
      userId: PUBLIC_PUBLISHER_ID,
      score: input.score,
      advice,
      now,
    });
    await insertEvent(tx, {
      organizationId: ticket.organizationId,
      ticketId: ticket.id,
      userId: PUBLIC_PUBLISHER_ID,
      eventType: 'satisfy',
      content: String(input.score),
      now,
    });
  });
}

async function requirePublicTicket(input: { number: string; mobile: string; mail: string }): Promise<TicketRecord> {
  const organizationId = await firstOrganizationId();
  const number = input.number.trim();
  if (!organizationId || !number) {
    throw validateFailed('工单不存在或联系方式不正确');
  }
  const ticket = await findTicketByNumber(organizationId, number);
  if (!ticket || ticket.recycled || !contactMatches(ticket, input.mobile, input.mail)) {
    throw validateFailed('工单不存在或联系方式不正确');
  }
  return ticket;
}

function contactMatches(ticket: TicketRecord, mobile: string, mail: string): boolean {
  const phone = mobile.trim();
  const email = mail.trim().toLowerCase();
  if (!phone && !email) {
    return false;
  }
  if (phone && ticket.mobile === phone) {
    return true;
  }
  return Boolean(email && (ticket.mail ?? '').toLowerCase() === email);
}

export async function updateTicket(actor: TicketActor, input: TicketWriteInput & { id: string }): Promise<void> {
  const current = await requireVisible(actor, input.id);
  if (current.recycled) {
    throw validateFailed('工单在回收站中');
  }
  if (current.endTime) {
    throw validateFailed('已结束的工单不能编辑');
  }
  const template = await findTemplate(current.templateId, actor.organizationId);
  if (!template) {
    throw validateFailed('模板不存在');
  }
  const title = cleanTitle(input.title);
  const fields = await normalizeFields(actor.organizationId, input.moduleFields);
  const files = await namedFiles(input.fileIds);
  const mobile = template.enableMobile ? cleanMobile(template, input.mobile) : current.mobile;
  const mail = template.enableMail ? cleanMail(template, input.mail) : current.mail;
  const customerId = await resolveCustomer(actor.organizationId, {
    customerId: input.customerId,
    contractId: current.contractId,
    orderId: current.orderId,
    mobile,
    mail,
    guestName: current.guestName,
  });
  const now = Date.now();
  const removed = await withTransaction(async (tx) => {
    const ticket = await lockVisible(tx, actor, input.id);
    await updateTicketBody(tx, {
      id: ticket.id,
      title,
      priority: cleanPriority(input.priority),
      customerId,
      mobile,
      mail,
      deadline: template.enableDeadline ? input.deadline : null,
    }, actor.user.id, now);
    await replaceFields(tx, ticket.id, fields.values, fields.blobIds);
    const dropped = await replaceTicketFiles(tx, actor.organizationId, ticket.id, files, actor.user.id, now);
    await insertEvent(tx, {
      organizationId: actor.organizationId,
      ticketId: ticket.id,
      userId: actor.user.id,
      eventType: 'update',
      content: title,
      now,
    });
    return dropped;
  });
  await dropFiles(removed);
}

export async function replyTicket(actor: TicketActor, input: { id: string; content: string; fileIds: string[] }): Promise<void> {
  const content = plainText(input.content);
  if (!content) {
    throw validateFailed('回复内容不能为空');
  }
  const files = await namedFiles(input.fileIds);
  const now = Date.now();
  const notice = await withTransaction(async (tx) => {
    const ticket = await lockOpen(tx, actor, input.id);
    const config = await requireConfig(actor.organizationId);
    if (ticket.endTime && !config.replyAfterClose) {
      throw validateFailed('请先重启工单后再回复');
    }
    const replyId = nextId();
    await insertReply(tx, {
      id: replyId,
      organizationId: actor.organizationId,
      ticketId: ticket.id,
      userId: actor.user.id,
      content: input.content,
      now,
    });
    await addReplyFiles(tx, actor.organizationId, ticket.id, replyId, null, files, actor.user.id, now);
    await addParticipant(tx, actor.organizationId, ticket.id, actor.user.id, actor.user.id, now);
    const received = await fillHandler(tx, actor, ticket, now);
    await insertEvent(tx, {
      organizationId: actor.organizationId,
      ticketId: ticket.id,
      userId: actor.user.id,
      eventType: 'reply',
      replyId,
      content,
      now,
    });
    if (received.filled) {
      await insertEvent(tx, {
        organizationId: actor.organizationId,
        ticketId: ticket.id,
        userId: actor.user.id,
        eventType: 'receive',
        targetUserId: actor.user.id,
        now,
      });
    }
    const receivers: string[] = [];
    if (config.notifyReplyPublisher) receivers.push(ticket.publisherId);
    if (config.notifyReplyHandler && (ticket.handlerId || received.handlerId)) receivers.push(received.handlerId || ticket.handlerId || '');
    if (config.notifyReplyCc) receivers.push(...(await listCc(ticket.id)).map((item) => item.userId));
    if (config.notifyReplyFollow) receivers.push(...await listFollowers(ticket.id));
    return {
      title: ticket.title,
      number: ticket.number,
      notices: [{ operation: 'REPLY', receivers, subject: `工单 ${ticket.number} 有新回复`, content }],
    };
  });
  await notifyTicket({ organizationId: actor.organizationId, ticketId: input.id, title: notice.title, operatorId: actor.user.id, notices: notice.notices });
}

export async function internalReply(actor: TicketActor, input: { id: string; content: string; mentionUserIds: string[]; fileIds: string[] }): Promise<void> {
  const content = plainText(input.content);
  if (!content) {
    throw validateFailed('回复内容不能为空');
  }
  const files = await namedFiles(input.fileIds);
  const mentions = unique(input.mentionUserIds);
  const now = Date.now();
  const notice = await withTransaction(async (tx) => {
    const ticket = await lockOpen(tx, actor, input.id);
    const config = await requireConfig(actor.organizationId);
    const replyId = nextId();
    await insertInternalReply(tx, {
      id: replyId,
      organizationId: actor.organizationId,
      ticketId: ticket.id,
      userId: actor.user.id,
      content: input.content,
      mentionUserIds: mentions.join(','),
      now,
    });
    await addReplyFiles(tx, actor.organizationId, ticket.id, null, replyId, files, actor.user.id, now);
    await addParticipant(tx, actor.organizationId, ticket.id, actor.user.id, actor.user.id, now);
    await insertEvent(tx, {
      organizationId: actor.organizationId,
      ticketId: ticket.id,
      userId: actor.user.id,
      eventType: 'internal_reply',
      content,
      now,
    });
    const receivers = [...mentions];
    if (config.notifyInternalHandler && ticket.handlerId) {
      receivers.push(ticket.handlerId);
    }
    return {
      title: ticket.title,
      notices: [{ operation: 'INTERNAL', receivers, subject: `工单 ${ticket.number} 有内部协作`, content }],
    };
  });
  await notifyTicket({ organizationId: actor.organizationId, ticketId: input.id, title: notice.title, operatorId: actor.user.id, notices: notice.notices });
}

export async function changeStatus(actor: TicketActor, input: { id: string; statusId: string }): Promise<void> {
  const now = Date.now();
  const notice = await withTransaction(async (tx) => {
    const ticket = await lockOpen(tx, actor, input.id);
    const statuses = await listStatuses(actor.organizationId, tx);
    const current = statuses.find((item) => item.id === ticket.statusId);
    const next = statuses.find((item) => item.id === input.statusId);
    if (!current || !next) {
      throw validateFailed('状态不存在');
    }
    if (current.id === next.id) {
      return null;
    }
    const config = await requireConfig(actor.organizationId);
    if (!config.allowStatusBack && next.pos < current.pos) {
      throw validateFailed('未开启状态回退');
    }
    if (next.isTerminal) {
      assertCanClose(ticket, actor.user.id, config);
    }
    const received = await fillHandler(tx, actor, ticket, now);
    await updateTicketStatus(tx, ticket.id, next.id, next.isTerminal ? now : null, actor.user.id, now);
    await insertEvent(tx, {
      organizationId: actor.organizationId,
      ticketId: ticket.id,
      userId: actor.user.id,
      eventType: 'status',
      statusId: next.id,
      content: next.name,
      now,
    });
    if (received.filled) {
      await insertEvent(tx, {
        organizationId: actor.organizationId,
        ticketId: ticket.id,
        userId: actor.user.id,
        eventType: 'receive',
        targetUserId: actor.user.id,
        now,
      });
    }
    const notices: TicketNotice[] = [];
    if (next.isTerminal && ticket.publisherId !== PUBLIC_PUBLISHER_ID) {
      const satisfy = await findSatisfy(ticket.id);
      const invite = config.satisfyEnabled && !satisfy;
      if (invite || config.notifyClosePublisher) {
        notices.push({
          operation: invite ? 'SATISFY_INVITE' : 'CLOSE',
          receivers: [ticket.publisherId],
          subject: invite ? `工单 ${ticket.number} 已完成，请评价` : `工单 ${ticket.number} 已结束`,
          content: ticket.title,
        });
      }
    } else if (config.notifyStatusPublisher) {
      notices.push({
        operation: 'STATUS',
        receivers: [ticket.publisherId],
        subject: `工单 ${ticket.number} 状态已更新`,
        content: next.name,
      });
    }
    return { title: ticket.title, notices };
  });
  if (notice) {
    await notifyTicket({ organizationId: actor.organizationId, ticketId: input.id, title: notice.title, operatorId: actor.user.id, notices: notice.notices });
  }
}

export async function changePriority(actor: TicketActor, input: { id: string; priority: number }): Promise<void> {
  const priority = cleanPriority(input.priority);
  const now = Date.now();
  await withTransaction(async (tx) => {
    const ticket = await lockOpen(tx, actor, input.id);
    if (ticket.priority === priority) {
      return;
    }
    await updateTicketPriority(tx, ticket.id, priority, actor.user.id, now);
    await insertEvent(tx, {
      organizationId: actor.organizationId,
      ticketId: ticket.id,
      userId: actor.user.id,
      eventType: 'priority',
      priority,
      now,
    });
  });
}

export async function assignTicket(actor: TicketActor, input: { id: string; departmentId: string; handlerId: string }): Promise<void> {
  const member = await findEnabledMember(actor.organizationId, input.handlerId);
  if (!member || member.departmentId !== input.departmentId) {
    throw validateFailed('处理人不属于该部门');
  }
  const now = Date.now();
  const notice = await withTransaction(async (tx) => {
    const ticket = await lockOpen(tx, actor, input.id);
    if (ticket.handlerId === input.handlerId) {
      await updateTicketAssign(tx, ticket.id, input.departmentId, ticket.handlerId, ticket.recipientId, actor.user.id, now);
      return null;
    }
    const recipientId = ticket.recipientId ?? input.handlerId;
    await updateTicketAssign(tx, ticket.id, input.departmentId, input.handlerId, recipientId, actor.user.id, now);
    await addParticipant(tx, actor.organizationId, ticket.id, input.handlerId, actor.user.id, now);
    await insertEvent(tx, {
      organizationId: actor.organizationId,
      ticketId: ticket.id,
      userId: actor.user.id,
      eventType: 'assign',
      targetUserId: input.handlerId,
      now,
    });
    if (!ticket.recipientId) {
      await insertEvent(tx, {
        organizationId: actor.organizationId,
        ticketId: ticket.id,
        userId: actor.user.id,
        eventType: 'receive',
        targetUserId: input.handlerId,
        now,
      });
    }
    const config = await requireConfig(actor.organizationId);
    return {
      title: ticket.title,
      notices: config.notifyAssign ? [{
        operation: 'ASSIGN',
        receivers: [input.handlerId],
        subject: `工单 ${ticket.number} 已改派给你`,
        content: ticket.title,
      }] : [],
    };
  });
  if (notice) {
    await notifyTicket({ organizationId: actor.organizationId, ticketId: input.id, title: notice.title, operatorId: actor.user.id, notices: notice.notices });
  }
}

export async function urgeTicket(actor: TicketActor, input: { id: string; userIds: string[]; content: string }): Promise<void> {
  const userIds = unique(input.userIds);
  if (userIds.length === 0) {
    throw validateFailed('请选择催办人');
  }
  const content = input.content.trim();
  const now = Date.now();
  const notice = await withTransaction(async (tx) => {
    const ticket = await lockOpen(tx, actor, input.id);
    for (const userId of userIds) {
      await insertEvent(tx, {
        organizationId: actor.organizationId,
        ticketId: ticket.id,
        userId: actor.user.id,
        eventType: 'urge',
        targetUserId: userId,
        content,
        now,
      });
    }
    return {
      title: ticket.title,
      notices: [{ operation: 'URGE', receivers: userIds, subject: `工单 ${ticket.number} 催办`, content: content || ticket.title }],
    };
  });
  await notifyTicket({ organizationId: actor.organizationId, ticketId: input.id, title: notice.title, operatorId: actor.user.id, notices: notice.notices });
}

export async function followTicket(actor: TicketActor, input: { id: string; follow: boolean }): Promise<void> {
  const now = Date.now();
  await withTransaction(async (tx) => {
    const ticket = await lockVisible(tx, actor, input.id);
    await setFollow(tx, actor.organizationId, ticket.id, actor.user.id, input.follow, now);
    await insertEvent(tx, {
      organizationId: actor.organizationId,
      ticketId: ticket.id,
      userId: actor.user.id,
      eventType: input.follow ? 'follow' : 'unfollow',
      now,
    });
  });
}

export async function restartTicket(actor: TicketActor, id: string): Promise<void> {
  const now = Date.now();
  const notice = await withTransaction(async (tx) => {
    const ticket = await lockOpen(tx, actor, id);
    const statuses = await listStatuses(actor.organizationId, tx);
    const current = statuses.find((item) => item.id === ticket.statusId);
    if (!current?.isTerminal && !ticket.endTime) {
      throw validateFailed('当前不是结束状态');
    }
    const sorted = [...statuses].sort((left, right) => left.pos - right.pos);
    const next = sorted[1] ?? sorted.find((item) => item.isInitial) ?? sorted[0];
    if (!next) {
      throw validateFailed('请先配置工单状态');
    }
    await updateTicketStatus(tx, ticket.id, next.id, null, actor.user.id, now);
    await insertEvent(tx, {
      organizationId: actor.organizationId,
      ticketId: ticket.id,
      userId: actor.user.id,
      eventType: 'restart',
      statusId: next.id,
      now,
    });
    const config = await requireConfig(actor.organizationId);
    return {
      title: ticket.title,
      notices: config.notifyRestartHandler && ticket.handlerId ? [{
        operation: 'RESTART',
        receivers: [ticket.handlerId],
        subject: `工单 ${ticket.number} 已重启`,
        content: ticket.title,
      }] : [],
    };
  });
  await notifyTicket({ organizationId: actor.organizationId, ticketId: id, title: notice.title, operatorId: actor.user.id, notices: notice.notices });
}

export async function satisfyTicket(actor: TicketActor, input: { id: string; score: number; advice: string }): Promise<void> {
  if (input.score < 1 || input.score > 5) {
    throw validateFailed('评分范围为 1 到 5');
  }
  const now = Date.now();
  await withTransaction(async (tx) => {
    const ticket = await lockVisible(tx, actor, input.id);
    if (ticket.recycled) {
      throw validateFailed('工单在回收站中');
    }
    if (ticket.publisherId !== actor.user.id) {
      throw validateFailed('只有发布人可以评价');
    }
    if (!ticket.endTime) {
      throw validateFailed('工单尚未结束');
    }
    const config = await requireConfig(actor.organizationId);
    if (!config.satisfyEnabled) {
      throw validateFailed('未开启满意度评价');
    }
    if (await findSatisfy(ticket.id)) {
      throw validateFailed('已经评价过');
    }
    await insertSatisfy(tx, {
      organizationId: actor.organizationId,
      ticketId: ticket.id,
      userId: actor.user.id,
      score: input.score,
      advice: input.advice.trim(),
      now,
    });
    await insertEvent(tx, {
      organizationId: actor.organizationId,
      ticketId: ticket.id,
      userId: actor.user.id,
      eventType: 'satisfy',
      content: String(input.score),
      now,
    });
  });
}

export async function recycleTicket(actor: TicketActor, id: string): Promise<void> {
  const now = Date.now();
  await withTransaction(async (tx) => {
    const ticket = await lockVisible(tx, actor, id);
    if (ticket.recycled) {
      return;
    }
    await markRecycled(tx, ticket.id, true, actor.user.id, now);
    await insertEvent(tx, {
      organizationId: actor.organizationId,
      ticketId: ticket.id,
      userId: actor.user.id,
      eventType: 'delete',
      now,
    });
  });
}

export async function recoverTickets(actor: TicketActor, ids: string[]): Promise<void> {
  const now = Date.now();
  await withTransaction(async (tx) => {
    for (const id of unique(ids)) {
      const ticket = await lockVisible(tx, actor, id);
      if (!ticket.recycled) {
        throw validateFailed('工单不在回收站');
      }
      await markRecycled(tx, ticket.id, false, actor.user.id, now);
      await insertEvent(tx, {
        organizationId: actor.organizationId,
        ticketId: ticket.id,
        userId: actor.user.id,
        eventType: 'recover',
        now,
      });
    }
  });
}

export async function purgeTickets(actor: TicketActor, ids: string[]): Promise<void> {
  const removed: string[] = [];
  await withTransaction(async (tx) => {
    for (const id of unique(ids)) {
      const ticket = await lockVisible(tx, actor, id);
      if (!ticket.recycled) {
        throw validateFailed('只能彻底删除回收站中的工单');
      }
      removed.push(...await listFileIds(tx, ticket.id));
      await purgeTicket(tx, ticket.id, actor.organizationId);
    }
  });
  await dropFiles(removed);
}

interface TicketWriteInput {
  title: string;
  priority: number;
  customerId: string;
  mobile: string;
  mail: string;
  deadline: number | null;
  moduleFields: ModuleFieldValue[];
  fileIds: string[];
}

function listItem(ticket: TicketRecord): Record<string, unknown> {
  return {
    id: ticket.id,
    number: ticket.number,
    title: ticket.title,
    statusId: ticket.statusId,
    statusName: ticket.statusName ?? '',
    statusColor: ticket.statusColor ?? '',
    priority: ticket.priority,
    publisherId: ticket.publisherId,
    publisherName: ticket.publisherName ?? '',
    handlerId: ticket.handlerId,
    handlerName: ticket.handlerName ?? '',
    departmentId: ticket.departmentId,
    departmentName: ticket.departmentName ?? '',
    customerId: ticket.customerId,
    customerName: ticket.customerName ?? '',
    satisfyScore: ticket.satisfyScore ?? null,
    templateId: ticket.templateId,
    deadline: ticket.deadline,
    createTime: ticket.createTime,
    endTime: ticket.endTime,
  };
}

function canSeeInternal(actor: TicketActor): boolean {
  if (actor.user.id === ADMIN_USER_ID) {
    return true;
  }
  if (actor.user.roles.some((role) => role.id === 'org_admin' && role.organizationId === actor.organizationId)) {
    return true;
  }
  return actor.user.permissionIds.includes(Permission.TICKET_REPLY)
    || actor.user.permissionIds.includes(Permission.TICKET_UPDATE);
}

async function scopeOf(actor: TicketActor): Promise<Scope> {
  if (actor.user.id === ADMIN_USER_ID) {
    return { scopeAll: true, departmentIds: [] };
  }
  const roles = actor.user.roles.filter((role) => role.organizationId === actor.organizationId);
  if (roles.some((role) => role.dataScope === 'ALL')) {
    return { scopeAll: true, departmentIds: [] };
  }
  const ids = new Set<string>();
  const departments = await listDepartments(actor.organizationId);
  const customRoleIds = roles.filter((role) => role.dataScope === 'DEPT_CUSTOM').map((role) => role.id);
  for (const id of await roleDepartments(customRoleIds)) {
    ids.add(id);
  }
  if (actor.user.departmentId && roles.some((role) => role.dataScope === 'DEPT' || role.dataScope === 'DEPT_AND_CHILD')) {
    if (roles.some((role) => role.dataScope === 'DEPT_AND_CHILD')) {
      for (const id of expandDepartment(departments, actor.user.departmentId)) {
        ids.add(id);
      }
    } else {
      ids.add(actor.user.departmentId);
    }
  }
  return { scopeAll: false, departmentIds: [...ids] };
}

function expandDepartment(departments: Array<{ id: string; parentId: string }>, rootId: string): string[] {
  const children = new Map<string, string[]>();
  for (const department of departments) {
    const list = children.get(department.parentId) ?? [];
    list.push(department.id);
    children.set(department.parentId, list);
  }
  const result: string[] = [];
  const stack = [rootId];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const id = stack.pop();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push(id);
    stack.push(...(children.get(id) ?? []));
  }
  return result;
}

async function canSee(actor: TicketActor, ticket: TicketRecord, scope: Scope): Promise<boolean> {
  if (scope.scopeAll) {
    return true;
  }
  if (ticket.publisherId === actor.user.id || ticket.handlerId === actor.user.id || ticket.recipientId === actor.user.id) {
    return true;
  }
  if (ticket.departmentId && scope.departmentIds.includes(ticket.departmentId)) {
    return true;
  }
  return isRelated(ticket.id, actor.user.id, actor.organizationId);
}

async function requireVisible(actor: TicketActor, id: string): Promise<TicketRecord> {
  const ticket = await findTicket(id, actor.organizationId);
  if (!ticket || !(await canSee(actor, ticket, await scopeOf(actor)))) {
    throw invisible();
  }
  return ticket;
}

async function lockVisible(tx: Tx, actor: TicketActor, id: string): Promise<TicketRecord> {
  const ticket = await lockTicket(tx, id, actor.organizationId);
  if (!ticket || !(await canSee(actor, ticket, await scopeOf(actor)))) {
    throw invisible();
  }
  return ticket;
}

async function lockOpen(tx: Tx, actor: TicketActor, id: string): Promise<TicketRecord> {
  const ticket = await lockVisible(tx, actor, id);
  if (ticket.recycled) {
    throw validateFailed('工单在回收站中');
  }
  return ticket;
}

async function fillHandler(tx: Tx, actor: TicketActor, ticket: TicketRecord, now: number): Promise<{ filled: boolean; handlerId: string | null }> {
  if (ticket.handlerId && ticket.recipientId) {
    return { filled: false, handlerId: ticket.handlerId };
  }
  const handlerId = ticket.handlerId ?? actor.user.id;
  const recipientId = ticket.recipientId ?? actor.user.id;
  await updateTicketAssign(tx, ticket.id, ticket.departmentId, handlerId, recipientId, actor.user.id, now);
  await addParticipant(tx, actor.organizationId, ticket.id, actor.user.id, actor.user.id, now);
  ticket.handlerId = handlerId;
  ticket.recipientId = recipientId;
  return { filled: true, handlerId };
}

function assertCanClose(ticket: TicketRecord, userId: string, config: TicketConfig): void {
  if (ticket.publisherId === ticket.handlerId && userId === ticket.publisherId) {
    return;
  }
  if (userId === ticket.handlerId && !config.handlerCanClose) {
    throw validateFailed('处理人不能结束工单');
  }
  if (userId === ticket.publisherId && userId !== ticket.handlerId && !config.publisherCanClose) {
    throw validateFailed('发布人不能结束工单');
  }
}

async function requireConfig(organizationId: string): Promise<TicketConfig> {
  const config = await findConfig(organizationId);
  if (!config) {
    throw validateFailed('请先配置工单');
  }
  return config;
}

async function nextNumber(tx: Tx, organizationId: string, now: number): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const number = makeNumber(now + attempt);
    if (!(await numberExists(tx, organizationId, number))) {
      return number;
    }
  }
  throw new AppError(500, ResultCode.FAILED, '工单编号生成失败');
}

function makeNumber(now: number): string {
  const date = new Date(now);
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}`;
  let letters = '';
  for (let index = 0; index < 4; index += 1) {
    letters += String.fromCharCode(65 + Math.floor(Math.random() * 26));
  }
  return `T${stamp}${letters}`;
}

async function normalizeFields(organizationId: string, values: ModuleFieldValue[]): Promise<{ values: ModuleFieldValue[]; blobIds: Set<string> }> {
  const form = await getFormConfig('ticket', organizationId);
  const byId = new Map(values.map((item) => [item.fieldId, item.fieldValue ?? '']));
  for (const field of form.fields) {
    if (!fieldRequired(field)) {
      continue;
    }
    if (!String(byId.get(field.id) ?? '').trim()) {
      throw validateFailed(`${field.name}不能为空`);
    }
  }
  const types = new Map(form.fields.map((field) => [field.id, field.type]));
  const blobIds = new Set<string>();
  const stored = values.map((item) => {
    const fieldValue = item.fieldValue ?? '';
    if (BLOB_TYPES.has(types.get(item.fieldId) ?? '') || fieldValue.length > 200) {
      blobIds.add(item.fieldId);
    }
    return { fieldId: item.fieldId, fieldValue };
  });
  return { values: stored, blobIds };
}

function fieldRequired(field: FormField): boolean {
  const rules = field.rules;
  return Array.isArray(rules) && rules.some((rule) => {
    return Boolean(rule) && typeof rule === 'object' && 'key' in rule && (rule as { key?: string }).key === 'required';
  });
}

function cleanTitle(title: string): string {
  const value = title.trim();
  if (!value) {
    throw validateFailed('标题不能为空');
  }
  if (value.length > 255) {
    throw validateFailed('标题不能超过 255 个字');
  }
  return value;
}

function cleanPriority(priority: number): number {
  if (![1, 2, 3, 4].includes(priority)) {
    throw validateFailed('优先级不正确');
  }
  return priority;
}

function publicActor(organizationId: string): TicketActor {
  const user: SessionUser = {
    id: PUBLIC_PUBLISHER_ID,
    name: '访客',
    email: null,
    password: '',
    enable: true,
    createTime: 0,
    updateTime: 0,
    language: 'zh-CN',
    lastOrganizationId: organizationId,
    phone: null,
    source: 'PUBLIC',
    createUser: PUBLIC_PUBLISHER_ID,
    updateUser: PUBLIC_PUBLISHER_ID,
    platformInfo: null,
    avatar: null,
    permissionIds: [],
    organizationIds: [organizationId],
    roles: [],
    departmentId: null,
    departmentName: null,
    defaultPwd: false,
    csrfToken: '',
    sessionId: '',
  };
  return { user, organizationId };
}

function assertPublicRate(ip: string): void {
  const now = Date.now();
  const recent = (publicHits.get(ip) ?? []).filter((time) => now - time < 10 * 60 * 1000);
  if (recent.length >= 20) {
    throw validateFailed('提交过于频繁，请稍后再试');
  }
  recent.push(now);
  publicHits.set(ip, recent);
}

function optionalPhone(mobile: string): string | null {
  const value = mobile.trim();
  if (!value) {
    return null;
  }
  if (!/^1\d{10}$/.test(value)) {
    throw validateFailed('手机格式不正确');
  }
  return value;
}

function optionalMail(mail: string): string | null {
  const value = mail.trim();
  if (!value) {
    return null;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw validateFailed('邮箱格式不正确');
  }
  return value;
}

function cleanMobile(template: TicketTemplate, mobile: string): string | null {
  if (!template.enableMobile) {
    return null;
  }
  const value = mobile.trim();
  if (!value && template.mobileRequired) {
    throw validateFailed('请填写手机');
  }
  if (value && !/^1\d{10}$/.test(value)) {
    throw validateFailed('手机格式不正确');
  }
  return value || null;
}

function cleanMail(template: TicketTemplate, mail: string): string | null {
  if (!template.enableMail) {
    return null;
  }
  const value = mail.trim();
  if (!value && template.mailRequired) {
    throw validateFailed('请填写邮箱');
  }
  if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw validateFailed('邮箱格式不正确');
  }
  return value || null;
}

async function resolveCustomer(organizationId: string, input: {
  customerId: string;
  contractId: string | null;
  orderId: string | null;
  mobile: string | null;
  mail: string | null;
  guestName: string | null;
}): Promise<string | null> {
  if (input.customerId) {
    if (!(await recordExists('customer', input.customerId, organizationId))) {
      throw validateFailed('客户不存在');
    }
    return input.customerId;
  }
  return findCustomerForTicket({
    organizationId,
    contractId: input.contractId,
    orderId: input.orderId,
    mobile: input.mobile,
    mail: input.mail,
    name: input.guestName,
  });
}

async function cleanRelation(table: 'contract' | 'sales_order', organizationId: string, id: string): Promise<string | null> {
  if (!id) {
    return null;
  }
  if (!(await recordExists(table, id, organizationId))) {
    throw validateFailed(table === 'contract' ? '合同不存在' : '订单不存在');
  }
  return id;
}

async function namedFiles(fileIds: string[]): Promise<Array<{ fileId: string; fileName: string }>> {
  const files = [];
  for (const fileId of unique(fileIds)) {
    files.push({ fileId, fileName: await storedFileName(fileId) });
  }
  return files;
}

async function storedFileName(fileId: string): Promise<string> {
  if (!/^[a-z0-9]+$/i.test(fileId)) {
    return 'file';
  }
  try {
    const raw = await readFile(path.join(process.cwd(), 'data', 'files', `${fileId}.json`), 'utf8');
    const meta = JSON.parse(raw) as { filename?: string };
    return meta.filename || 'file';
  } catch {
    return 'file';
  }
}

async function dropFiles(fileIds: string[]): Promise<void> {
  for (const fileId of fileIds) {
    try {
      await deleteTempFile(fileId);
    } catch (error) {
      console.error('工单附件删除失败', fileId, error);
    }
  }
}

function plainText(value: string): string {
  return value.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function invisible(): AppError {
  return new AppError(403, ResultCode.FORBIDDEN, '没有权限');
}

function canClose(ticket: TicketRecord, userId: string, config: TicketConfig): boolean {
  if (ticket.endTime || ticket.recycled) {
    return false;
  }
  if (ticket.publisherId === ticket.handlerId && userId === ticket.publisherId) {
    return true;
  }
  if (userId === ticket.handlerId) {
    return config.handlerCanClose;
  }
  if (userId === ticket.publisherId) {
    return config.publisherCanClose;
  }
  return true;
}
