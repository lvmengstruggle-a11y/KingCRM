import {
  countUnreadByResource,
  listLastAnnouncements,
  listLastNotices,
  markAllNotificationsRead,
  markNotificationRead,
  pageNotifications,
} from '../models/notification.model.js';
import { toPager, type Pager } from '../support/pager.js';
import type { NotificationRecord } from '../models/notification.model.js';

export async function lastAnnouncements(userId: string, organizationId: string): Promise<NotificationRecord[]> {
  return listLastAnnouncements(userId, organizationId);
}

export async function lastNotices(userId: string, organizationId: string): Promise<NotificationRecord[]> {
  return listLastNotices(userId, organizationId);
}

export async function pageNotificationList(input: {
  userId: string;
  organizationId: string;
  type?: string;
  status?: string;
  resourceType?: string;
  createTime?: number | null;
  endTime?: number | null;
  current: number;
  pageSize: number;
}): Promise<Pager<NotificationRecord>> {
  const result = await pageNotifications(input);
  return toPager(result.list, result.total, { current: input.current, pageSize: input.pageSize });
}

export async function unreadNotificationCounts(userId: string, organizationId: string) {
  return countUnreadByResource(userId, organizationId);
}

export async function readNotification(id: string, userId: string, organizationId: string): Promise<number> {
  return markNotificationRead(id, userId, organizationId);
}

export async function readAllNotifications(userId: string, organizationId: string): Promise<number> {
  return markAllNotificationsRead(userId, organizationId);
}
