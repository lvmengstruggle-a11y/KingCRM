import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  findMessageTask,
  findMessageTaskConfig,
  insertMessageTask,
  listMessageTasks,
  saveMessageTaskConfig,
  updateMessageTaskFlags,
  updateMessageTasksByOrganization,
  type MessageTaskFlags,
} from '../models/message-task.model.js';
import { query, type SqlRow } from '../support/db.js';
import { translate } from '../support/i18n.js';

interface TaskDetail extends MessageTaskFlags {
  event: string;
  eventName: string;
}

interface TaskModule {
  module: string;
  moduleName: string;
  messageTaskDetailDTOList: TaskDetail[];
}

const templates = loadTemplates();

function loadTemplates(): TaskModule[] {
  const path = join(dirname(fileURLToPath(import.meta.url)), '../../resources/task/message_task.json');
  const raw = JSON.parse(readFileSync(path, 'utf8')) as TaskModule[];
  return raw;
}

function namedCopy(): TaskModule[] {
  return templates.map((module) => ({
    module: module.module,
    moduleName: translate(`message.${module.module.toLowerCase()}`, module.module),
    messageTaskDetailDTOList: module.messageTaskDetailDTOList.map((detail) => ({
      event: detail.event,
      eventName: translate(`message.${detail.event.toLowerCase()}`, detail.event),
      emailEnable: false,
      sysEnable: false,
      weComEnable: false,
      dingTalkEnable: false,
      larkEnable: false,
    })),
  }));
}

function templateText(event: string): string {
  return translate(`message.${event.toLowerCase()}_text`, '');
}

export async function listMessageTaskSettings(organizationId: string): Promise<TaskModule[]> {
  const result = namedCopy();
  const stored = await listMessageTasks(organizationId);
  const byEvent = new Map(stored.map((task) => [task.event, task]));
  for (const module of result) {
    for (const detail of module.messageTaskDetailDTOList) {
      const task = byEvent.get(detail.event);
      if (!task) {
        continue;
      }
      detail.emailEnable = task.emailEnable;
      detail.sysEnable = task.sysEnable;
      detail.weComEnable = task.weComEnable;
      detail.dingTalkEnable = task.dingTalkEnable;
      detail.larkEnable = task.larkEnable;
    }
  }
  return result;
}

export async function saveMessageTaskSetting(input: {
  organizationId: string;
  userId: string;
  module: string;
  event: string;
  flags: MessageTaskFlags;
  config?: Record<string, unknown> | null;
}): Promise<void> {
  const current = await findMessageTask(input.organizationId, input.module, input.event);
  if (current) {
    await updateMessageTaskFlags(current.id, input.flags, input.userId);
  } else {
    await insertMessageTask({
      organizationId: input.organizationId,
      module: input.module,
      event: input.event,
      flags: input.flags,
      template: templateText(input.event),
      userId: input.userId,
    });
  }
  if (input.config) {
    const config = { ...input.config };
    if (Array.isArray(config.timeList)) {
      config.timeList = config.timeList.filter((item) => item && typeof item === 'object' && 'timeValue' in item);
    }
    await saveMessageTaskConfig(input.organizationId, input.module, input.event, JSON.stringify(config));
  }
}

export async function batchSaveMessageTaskSettings(
  organizationId: string,
  userId: string,
  patch: Partial<MessageTaskFlags>,
): Promise<void> {
  if (Object.values(patch).every((value) => value === undefined)) {
    return;
  }
  const stored = await listMessageTasks(organizationId);
  const existing = new Set(stored.map((task) => task.event));
  await updateMessageTasksByOrganization(organizationId, patch);
  for (const module of templates) {
    for (const detail of module.messageTaskDetailDTOList) {
      if (existing.has(detail.event)) {
        continue;
      }
      await insertMessageTask({
        organizationId,
        module: module.module,
        event: detail.event,
        flags: {
          emailEnable: patch.emailEnable ?? false,
          sysEnable: patch.sysEnable ?? false,
          weComEnable: patch.weComEnable ?? false,
          dingTalkEnable: patch.dingTalkEnable ?? false,
          larkEnable: patch.larkEnable ?? false,
        },
        template: templateText(detail.event),
        userId,
      });
    }
  }
}

export async function getMessageTaskConfig(organizationId: string, module: string, event: string) {
  const raw = await findMessageTaskConfig(organizationId, module, event);
  if (!raw) {
    return null;
  }
  const config = JSON.parse(raw) as {
    userIds?: string[];
    roleIds?: string[];
    timeList?: unknown[];
    [key: string]: unknown;
  };
  const userIds = config.userIds ?? [];
  const roleIds = config.roleIds ?? [];
  return {
    ...config,
    userIdNames: await nameOptions(userIds, 'sys_user'),
    roleIdNames: await nameOptions(roleIds, 'sys_role'),
  };
}

async function nameOptions(ids: string[], table: 'sys_user' | 'sys_role'): Promise<Array<{ id: string; name: string }>> {
  if (ids.length === 0) {
    return [];
  }
  const marks = ids.map(() => '?').join(',');
  const rows = await query<SqlRow & { id: string; name: string }>(
    `SELECT id, name FROM ${table} WHERE id IN (${marks})`,
    ids,
  );
  const found = new Map(rows.map((row) => [row.id, row.name]));
  return ids.map((id) => ({
    id,
    name: found.get(id) ?? translate(`message.${id.toLowerCase()}`, id),
  }));
}
