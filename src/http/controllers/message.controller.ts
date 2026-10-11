import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  addAnnouncement,
  announcementDetail,
  editAnnouncement,
  pageAnnouncementList,
  removeAnnouncement,
} from '../../services/announcement.service.js';
import {
  batchSaveMessageTaskSettings,
  getMessageTaskConfig,
  listMessageTaskSettings,
  saveMessageTaskSetting,
} from '../../services/message-task.service.js';
import {
  lastAnnouncements,
  lastNotices,
  pageNotificationList,
  readAllNotifications,
  readNotification,
  unreadNotificationCounts,
} from '../../services/notification.service.js';
import { requireOrganization, requireUser } from '../../support/context.js';
import { normalizePage } from '../../support/pager.js';
import { Permission } from '../../support/permission.js';
import { success } from '../../support/result.js';
import { requirePermission } from '../middleware/permission.middleware.js';

const flagsSchema = z.object({
  emailEnable: z.boolean().optional(),
  sysEnable: z.boolean().optional(),
  weComEnable: z.boolean().optional(),
  dingTalkEnable: z.boolean().optional(),
  larkEnable: z.boolean().optional(),
});

const announcementSchema = z.object({
  id: z.string().optional(),
  subject: z.string().trim().min(1),
  content: z.string().min(1),
  startTime: z.number(),
  endTime: z.number(),
  url: z.string().optional().nullable(),
  renameUrl: z.string().optional().nullable(),
  organizationId: z.string().optional(),
  deptIds: z.array(z.string()).optional(),
  userIds: z.array(z.string()).optional(),
});

export async function registerMessageRoutes(app: FastifyInstance): Promise<void> {
  app.get('/message/task/get', { preHandler: requirePermission(Permission.SYSTEM_NOTICE_READ) }, async (request) => {
    return success(await listMessageTaskSettings(requireOrganization(request)));
  });

  app.post('/message/task/save', { preHandler: requirePermission(Permission.SYSTEM_NOTICE_UPDATE) }, async (request) => {
    const body = flagsSchema.extend({
      module: z.string().min(1),
      event: z.string().min(1),
      config: z.record(z.string(), z.unknown()).nullable().optional(),
    }).parse(request.body);
    await saveMessageTaskSetting({
      organizationId: requireOrganization(request),
      userId: requireUser(request).id,
      module: body.module,
      event: body.event,
      flags: {
        emailEnable: body.emailEnable ?? false,
        sysEnable: body.sysEnable ?? false,
        weComEnable: body.weComEnable ?? false,
        dingTalkEnable: body.dingTalkEnable ?? false,
        larkEnable: body.larkEnable ?? false,
      },
      config: body.config,
    });
    return success(null);
  });

  app.post('/message/task/batch/save', { preHandler: requirePermission(Permission.SYSTEM_NOTICE_UPDATE) }, async (request) => {
    const body = flagsSchema.parse(request.body ?? {});
    await batchSaveMessageTaskSettings(requireOrganization(request), requireUser(request).id, body);
    return success(null);
  });

  app.post('/message/task/config/query', { preHandler: requirePermission(Permission.SYSTEM_NOTICE_READ) }, async (request) => {
    const body = z.object({ module: z.string().min(1), event: z.string().min(1) }).parse(request.body);
    return success(await getMessageTaskConfig(requireOrganization(request), body.module, body.event));
  });

  app.post('/announcement/page', { preHandler: requirePermission(Permission.SYSTEM_NOTICE_READ) }, async (request) => {
    const body = z.object({
      current: z.number().int().optional(),
      pageSize: z.number().int().optional(),
      keyword: z.string().optional(),
      sort: z.object({ name: z.string().optional(), type: z.string().optional() }).optional(),
    }).parse(request.body ?? {});
    const page = normalizePage(body.current, body.pageSize);
    return success(await pageAnnouncementList({
      organizationId: requireOrganization(request),
      keyword: body.keyword,
      current: page.current,
      pageSize: page.pageSize,
      sortName: body.sort?.name,
      sortType: body.sort?.type,
    }));
  });

  app.get('/announcement/get/:id', { preHandler: requirePermission(Permission.SYSTEM_NOTICE_READ) }, async (request) => {
    return success(await announcementDetail((request.params as { id: string }).id));
  });

  app.post('/announcement/add', { preHandler: requirePermission(Permission.SYSTEM_NOTICE_ADD) }, async (request) => {
    const body = announcementSchema.parse(request.body);
    await addAnnouncement(announcementInput(body, requireOrganization(request)), requireUser(request).id);
    return success(null);
  });

  app.post('/announcement/edit', { preHandler: requirePermission(Permission.SYSTEM_NOTICE_UPDATE) }, async (request) => {
    const body = announcementSchema.extend({ id: z.string().min(1) }).parse(request.body);
    await editAnnouncement({
      id: body.id,
      ...announcementInput(body, requireOrganization(request)),
    }, requireUser(request).id);
    return success(null);
  });

  app.get('/announcement/delete/:id', { preHandler: requirePermission(Permission.SYSTEM_NOTICE_DELETE) }, async (request) => {
    await removeAnnouncement((request.params as { id: string }).id);
    return success(null);
  });

  app.get('/notification/last/list', async (request) => {
    const user = requireUser(request);
    return success(await lastNotices(user.id, requireOrganization(request)));
  });

  app.get('/notification/last/announcement/list', async (request) => {
    const user = requireUser(request);
    return success(await lastAnnouncements(user.id, requireOrganization(request)));
  });

  app.post('/notification/list/all/page', async (request) => {
    const user = requireUser(request);
    const body = z.object({
      current: z.number().int().optional(),
      pageSize: z.number().int().optional(),
      type: z.string().optional(),
      status: z.string().optional(),
      resourceType: z.string().optional(),
      createTime: z.number().nullable().optional(),
      endTime: z.number().nullable().optional(),
    }).parse(request.body ?? {});
    const page = normalizePage(body.current, body.pageSize);
    return success(await pageNotificationList({
      userId: user.id,
      organizationId: requireOrganization(request),
      type: body.type,
      status: body.status,
      resourceType: body.resourceType,
      createTime: body.createTime,
      endTime: body.endTime,
      current: page.current,
      pageSize: page.pageSize,
    }));
  });

  app.post('/notification/count', async (request) => {
    const user = requireUser(request);
    return success(await unreadNotificationCounts(user.id, requireOrganization(request)));
  });

  app.get('/notification/read/:id', async (request) => {
    const user = requireUser(request);
    return success(await readNotification((request.params as { id: string }).id, user.id, requireOrganization(request)));
  });

  app.get('/notification/read/all', async (request) => {
    const user = requireUser(request);
    return success(await readAllNotifications(user.id, requireOrganization(request)));
  });

  app.get('/sse/close', async (request) => {
    requireUser(request);
    return success(null);
  });

  app.get('/sse/subscribe', async (request, reply) => {
    requireUser(request);
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    reply.raw.write('data: HEARTBEAT\n\n');
    const timer = setInterval(() => {
      if (!reply.raw.writableEnded) {
        reply.raw.write('data: HEARTBEAT\n\n');
      }
    }, 15000);
    request.raw.on('close', () => {
      clearInterval(timer);
      if (!reply.raw.writableEnded) {
        reply.raw.end();
      }
    });
  });
}

function announcementInput(body: z.infer<typeof announcementSchema>, organizationId: string) {
  return {
    organizationId: body.organizationId || organizationId,
    subject: body.subject,
    content: body.content,
    startTime: body.startTime,
    endTime: body.endTime,
    url: body.url ?? '',
    renameUrl: body.renameUrl ?? '',
    deptIds: body.deptIds ?? [],
    userIds: body.userIds ?? [],
  };
}
