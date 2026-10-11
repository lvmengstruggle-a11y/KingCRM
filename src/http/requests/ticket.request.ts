import { z } from 'zod';

const id = z.string().trim().min(1);
const optionalText = z.string().trim().optional().default('');
const idList = z.array(z.string().trim().min(1)).optional().default([]);
const moduleFields = z.array(z.object({
  fieldId: z.string().trim().min(1),
  fieldValue: z.string().optional().default(''),
})).optional().default([]);

export const ticketPageSchema = z.object({
  current: z.number().int().min(1).optional().default(1),
  pageSize: z.number().int().min(1).max(100).optional().default(20),
  view: z.enum(['all', 'mine', 'handling', 'department', 'cc', 'recycle']).optional().default('all'),
  keyword: optionalText,
  statusId: optionalText,
  priority: z.number().int().min(0).max(4).optional().default(0),
  templateId: optionalText,
  handlerId: optionalText,
});

export const accountTicketPageSchema = ticketPageSchema.extend({
  customerId: id,
});

export const ticketIdSchema = z.object({ id });

export const ticketIdsSchema = z.object({
  ids: z.array(id).min(1, '请选择工单'),
});

export const ticketPublicAddSchema = z.object({
  contactName: z.string().trim().min(1, '请填写联系人').max(32),
  mobile: optionalText,
  mail: optionalText,
  title: z.string().trim().min(1, '标题不能为空').max(255),
  priority: z.number().int().min(1).max(4).optional().default(1),
  content: z.string().trim().min(1, '请填写问题描述').max(4000),
});

export const ticketPublicSatisfySchema = z.object({
  number: z.string().trim().min(1, '请填写工单编号').max(32),
  mobile: optionalText,
  mail: optionalText,
  score: z.number().int().min(1).max(5),
  advice: z.string().trim().max(1000).optional().default(''),
});

export const ticketPublicLookupSchema = z.object({
  number: z.string().trim().min(1, '请填写工单编号').max(32),
  mobile: optionalText,
  mail: optionalText,
});

export const ticketAddSchema = z.object({
  templateId: id,
  title: z.string().trim().min(1, '标题不能为空').max(255),
  priority: z.number().int().min(1).max(4).optional().default(1),
  customerId: optionalText,
  contractId: optionalText,
  orderId: optionalText,
  handlerId: optionalText,
  ccUserIds: idList,
  mobile: optionalText,
  mail: optionalText,
  deadline: z.number().int().nullable().optional().default(null),
  moduleFields,
  fileIds: idList,
});

export const ticketUpdateSchema = z.object({
  id,
  title: z.string().trim().min(1, '标题不能为空').max(255),
  priority: z.number().int().min(1).max(4),
  customerId: optionalText,
  mobile: optionalText,
  mail: optionalText,
  deadline: z.number().int().nullable().optional().default(null),
  moduleFields,
  fileIds: idList,
});

export const ticketReplySchema = z.object({
  id,
  content: z.string().min(1, '回复内容不能为空'),
  fileIds: idList,
});

export const ticketInternalReplySchema = z.object({
  id,
  content: z.string().min(1, '回复内容不能为空'),
  mentionUserIds: idList,
  fileIds: idList,
});

export const ticketStatusSchema = z.object({
  id,
  statusId: id,
});

export const ticketPrioritySchema = z.object({
  id,
  priority: z.number().int().min(1).max(4),
});

export const ticketAssignSchema = z.object({
  id,
  departmentId: id,
  handlerId: id,
});

export const ticketUrgeSchema = z.object({
  id,
  userIds: z.array(id).min(1, '请选择催办人'),
  content: optionalText,
});

export const ticketFollowSchema = z.object({
  id,
  follow: z.boolean(),
});

export const ticketSatisfySchema = z.object({
  id,
  score: z.number().int().min(1).max(5),
  advice: optionalText,
});

const flag = z.boolean().optional().default(false);

export const ticketTemplateSaveSchema = z.object({
  id: z.string().trim().optional().default(''),
  name: z.string().trim().min(1, '模板名称不能为空').max(255),
  enable: z.boolean().optional().default(true),
  pos: z.number().int().optional(),
  enableCustomer: flag,
  enableCc: flag,
  enableHandler: flag,
  enableDeadline: flag,
  enableMobile: flag,
  mobileRequired: flag,
  enableMail: flag,
  mailRequired: flag,
});

export const ticketStatusSaveSchema = z.object({
  id: z.string().trim().optional().default(''),
  name: z.string().trim().min(1, '状态名称不能为空').max(255),
  color: z.string().trim().optional().default('#3290f9'),
  isInitial: flag,
  isTerminal: flag,
  stopTiming: flag,
});

export const ticketStatusSortSchema = z.object({
  ids: z.array(id).min(1, '状态不能为空'),
});

export const ticketRouteSaveSchema = z.object({
  templateId: id,
  departmentId: id,
});

export const ticketConfigSaveSchema = z.object({
  defaultDepartmentId: z.string().trim().nullable().optional().default(null),
  handlerCanClose: z.boolean().optional().default(true),
  publisherCanClose: z.boolean().optional().default(true),
  replyAfterClose: flag,
  allowStatusBack: flag,
  notifyAssign: z.boolean().optional().default(true),
  notifyReplyPublisher: z.boolean().optional().default(true),
  notifyReplyHandler: z.boolean().optional().default(true),
  notifyReplyCc: z.boolean().optional().default(true),
  notifyReplyFollow: z.boolean().optional().default(true),
  notifyInternalHandler: z.boolean().optional().default(true),
  notifyStatusPublisher: flag,
  notifyClosePublisher: flag,
  notifyRestartHandler: z.boolean().optional().default(true),
  satisfyEnabled: z.boolean().optional().default(true),
});
