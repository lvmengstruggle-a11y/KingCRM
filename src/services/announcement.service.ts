import {
  deleteAnnouncement,
  findAnnouncement,
  insertAnnouncement,
  listNames,
  listUserIdsByDepartments,
  pageAnnouncements,
  updateAnnouncement,
  type AnnouncementRecord,
} from '../models/announcement.model.js';
import { deleteNotificationsByResource, insertNotifications } from '../models/notification.model.js';
import { listDepartments } from '../models/department.model.js';
import { withTransaction } from '../support/db.js';
import { notFound } from '../support/errors.js';
import { toPager, type Pager } from '../support/pager.js';

export interface AnnouncementView extends AnnouncementRecord {
  contentText: string;
  deptIdName: Array<{ id: string; name: string; scope: string; nodeType: string }>;
  userIdName: Array<{ id: string; name: string; scope: string; nodeType: string }>;
}

export async function pageAnnouncementList(input: {
  organizationId: string;
  keyword?: string;
  current: number;
  pageSize: number;
  sortName?: string;
  sortType?: string;
}): Promise<Pager<AnnouncementView>> {
  const result = await pageAnnouncements(input);
  const list = await Promise.all(result.list.map(attachReceivers));
  return toPager(list, result.total, { current: input.current, pageSize: input.pageSize });
}

export async function announcementDetail(id: string): Promise<AnnouncementView> {
  const row = await findAnnouncement(id);
  if (!row) {
    throw notFound('公告不存在');
  }
  return attachReceivers(row);
}

export async function addAnnouncement(input: AnnouncementWrite, userId: string): Promise<void> {
  const receivers = await resolveReceivers(input);
  const now = Date.now();
  const active = input.startTime <= now && input.endTime >= now;
  await withTransaction(async (tx) => {
    const id = await insertAnnouncement(tx, {
      ...input,
      receiverIds: receivers,
      receiveType: JSON.stringify({ deptIds: input.deptIds, userIds: input.userIds }),
      notice: active,
      userId,
    });
    if (active) {
      await insertNotifications(tx, notificationRows(id, input, receivers, userId));
    }
  });
}

export async function editAnnouncement(input: AnnouncementWrite & { id: string }, userId: string): Promise<void> {
  const current = await findAnnouncement(input.id);
  if (!current) {
    throw notFound('公告不存在');
  }
  const receivers = await resolveReceivers(input);
  const now = Date.now();
  const active = input.startTime <= now && input.endTime >= now;
  await withTransaction(async (tx) => {
    await updateAnnouncement(tx, {
      ...input,
      receiverIds: receivers,
      receiveType: JSON.stringify({ deptIds: input.deptIds, userIds: input.userIds }),
      notice: active,
      userId,
    });
    await deleteNotificationsByResource(tx, input.id);
    if (active) {
      await insertNotifications(tx, notificationRows(input.id, input, receivers, userId));
    }
  });
}

export async function removeAnnouncement(id: string): Promise<void> {
  const current = await findAnnouncement(id);
  if (!current) {
    throw notFound('公告不存在');
  }
  await withTransaction(async (tx) => {
    await deleteNotificationsByResource(tx, id);
    await deleteAnnouncement(tx, id);
  });
}

interface AnnouncementWrite {
  organizationId: string;
  subject: string;
  content: string;
  startTime: number;
  endTime: number;
  url: string;
  renameUrl: string;
  deptIds: string[];
  userIds: string[];
}

async function resolveReceivers(input: AnnouncementWrite): Promise<string[]> {
  const departments = await listDepartments(input.organizationId);
  const departmentIds = expandDepartments(departments, input.deptIds);
  const fromDepartments = await listUserIdsByDepartments(input.organizationId, departmentIds);
  return [...new Set([...fromDepartments, ...input.userIds])];
}

function expandDepartments(departments: Array<{ id: string; parentId: string }>, roots: string[]): string[] {
  const children = new Map<string, string[]>();
  for (const department of departments) {
    const list = children.get(department.parentId) ?? [];
    list.push(department.id);
    children.set(department.parentId, list);
  }
  const result = new Set(roots);
  const queue = [...roots];
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id) {
      break;
    }
    for (const child of children.get(id) ?? []) {
      if (!result.has(child)) {
        result.add(child);
        queue.push(child);
      }
    }
  }
  return [...result];
}

function notificationRows(id: string, input: AnnouncementWrite, receivers: string[], userId: string) {
  const content = JSON.stringify({
    url: input.url,
    renameUrl: input.renameUrl,
    content: input.content,
  });
  return receivers.map((receiver) => ({
    receiver,
    subject: input.subject,
    operator: userId,
    organizationId: input.organizationId,
    resourceId: id,
    resourceName: input.subject,
    content,
    userId,
  }));
}

async function attachReceivers(row: AnnouncementRecord): Promise<AnnouncementView> {
  const receiveType = parseReceiveType(row.receiveType);
  const [departments, users] = await Promise.all([
    listNames('sys_department', receiveType.deptIds),
    listNames('sys_user', receiveType.userIds),
  ]);
  return {
    ...row,
    contentText: row.content,
    deptIdName: departments.map((item) => ({ ...item, scope: 'DEPARTMENT', nodeType: 'ORG' })),
    userIdName: users.map((item) => ({ ...item, scope: 'USER', nodeType: 'USER' })),
  };
}

function parseReceiveType(raw: string): { deptIds: string[]; userIds: string[] } {
  try {
    const parsed = JSON.parse(raw) as { deptIds?: string[]; userIds?: string[] };
    return {
      deptIds: parsed.deptIds ?? [],
      userIds: parsed.userIds ?? [],
    };
  } catch {
    return { deptIds: [], userIds: [] };
  }
}
