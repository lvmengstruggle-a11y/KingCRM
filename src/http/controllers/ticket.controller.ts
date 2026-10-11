import type { FastifyInstance, FastifyRequest } from 'fastify';

import { ADMIN_USER_ID } from '../../config/index.js';
import { listPermissionIds, listRoles } from '../../models/role.model.js';
import {
  assignTicket,
  changePriority,
  changeStatus,
  createTicket,
  followTicket,
  getTicket,
  internalReply,
  lookupPublicSatisfy,
  pageTickets,
  publishPublicTicket,
  purgeTickets,
  recoverTickets,
  recycleTicket,
  replyTicket,
  restartTicket,
  satisfyTicket,
  submitPublicSatisfy,
  ticketForm,
  ticketOptions,
  updateTicket,
  urgeTicket,
  type TicketActor,
} from '../../services/ticket.service.js';
import {
  getTicketConfig,
  listTicketRoutes,
  listTicketStatuses,
  listTicketTemplates,
  removeTicketRoute,
  removeTicketStatus,
  removeTicketTemplate,
  saveTicketConfig,
  saveTicketRoute,
  saveTicketStatus,
  saveTicketTemplate,
  sortTicketStatuses,
} from '../../services/ticket-setting.service.js';
import { requireOrganization, requireUser } from '../../support/context.js';
import { Permission } from '../../support/permission.js';
import { success } from '../../support/result.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import {
  accountTicketPageSchema,
  ticketAddSchema,
  ticketAssignSchema,
  ticketConfigSaveSchema,
  ticketFollowSchema,
  ticketIdSchema,
  ticketIdsSchema,
  ticketInternalReplySchema,
  ticketPageSchema,
  ticketPrioritySchema,
  ticketPublicAddSchema,
  ticketPublicLookupSchema,
  ticketPublicSatisfySchema,
  ticketReplySchema,
  ticketRouteSaveSchema,
  ticketSatisfySchema,
  ticketStatusSaveSchema,
  ticketStatusSchema,
  ticketStatusSortSchema,
  ticketTemplateSaveSchema,
  ticketUpdateSchema,
  ticketUrgeSchema,
} from '../requests/ticket.request.js';

const read = { preHandler: requirePermission(Permission.TICKET_READ) };
const add = { preHandler: requirePermission(Permission.TICKET_ADD) };
const update = { preHandler: requirePermission(Permission.TICKET_UPDATE) };
const reply = { preHandler: requirePermission(Permission.TICKET_REPLY) };
const remove = { preHandler: requirePermission(Permission.TICKET_DELETE) };
const settingRead = { preHandler: requirePermission(Permission.TICKET_SETTING_READ, Permission.TICKET_SETTING_UPDATE) };
const settingUpdate = { preHandler: requirePermission(Permission.TICKET_SETTING_UPDATE) };

export async function registerTicketRoutes(app: FastifyInstance): Promise<void> {
  app.post('/ticket/public/add', async (request) => {
    const body = ticketPublicAddSchema.parse(request.body);
    return success(await publishPublicTicket(body, request.ip));
  });

  app.post('/ticket/public/satisfy/lookup', async (request) => {
    const body = ticketPublicLookupSchema.parse(request.body);
    return success(await lookupPublicSatisfy(body, request.ip));
  });

  app.post('/ticket/public/satisfy', async (request) => {
    const body = ticketPublicSatisfySchema.parse(request.body);
    await submitPublicSatisfy(body, request.ip);
    return success(null);
  });

  app.post('/ticket/page', read, async (request) => {
    const body = ticketPageSchema.parse(request.body);
    const actor = actorOf(request);
    return success(await pageTickets(actor, {
      ...body,
      customerId: '',
      canRecycle: await owns(request, Permission.TICKET_DELETE),
    }));
  });

  app.get('/ticket/get/:id', read, async (request) => {
    const params = ticketIdSchema.parse(request.params);
    return success(await getTicket(actorOf(request), params.id));
  });

  app.post('/ticket/add', add, async (request) => {
    const body = ticketAddSchema.parse(request.body);
    return success(await createTicket(actorOf(request), body));
  });

  app.post('/ticket/update', update, async (request) => {
    const body = ticketUpdateSchema.parse(request.body);
    await updateTicket(actorOf(request), body);
    return success(null);
  });

  app.post('/ticket/reply', reply, async (request) => {
    const body = ticketReplySchema.parse(request.body);
    await replyTicket(actorOf(request), body);
    return success(null);
  });

  app.post('/ticket/internal-reply', reply, async (request) => {
    const body = ticketInternalReplySchema.parse(request.body);
    await internalReply(actorOf(request), body);
    return success(null);
  });

  app.post('/ticket/status', update, async (request) => {
    const body = ticketStatusSchema.parse(request.body);
    await changeStatus(actorOf(request), body);
    return success(null);
  });

  app.post('/ticket/priority', update, async (request) => {
    const body = ticketPrioritySchema.parse(request.body);
    await changePriority(actorOf(request), body);
    return success(null);
  });

  app.post('/ticket/assign', update, async (request) => {
    const body = ticketAssignSchema.parse(request.body);
    await assignTicket(actorOf(request), body);
    return success(null);
  });

  app.post('/ticket/urge', update, async (request) => {
    const body = ticketUrgeSchema.parse(request.body);
    await urgeTicket(actorOf(request), body);
    return success(null);
  });

  app.post('/ticket/follow', update, async (request) => {
    const body = ticketFollowSchema.parse(request.body);
    await followTicket(actorOf(request), body);
    return success(null);
  });

  app.post('/ticket/restart', reply, async (request) => {
    const body = ticketIdSchema.parse(request.body);
    await restartTicket(actorOf(request), body.id);
    return success(null);
  });

  app.post('/ticket/satisfy', read, async (request) => {
    const body = ticketSatisfySchema.parse(request.body);
    await satisfyTicket(actorOf(request), body);
    return success(null);
  });

  app.get('/ticket/delete/:id', remove, async (request) => {
    const params = ticketIdSchema.parse(request.params);
    await recycleTicket(actorOf(request), params.id);
    return success(null);
  });

  app.post('/ticket/recover', remove, async (request) => {
    const body = ticketIdsSchema.parse(request.body);
    await recoverTickets(actorOf(request), body.ids);
    return success(null);
  });

  app.post('/ticket/purge', remove, async (request) => {
    const body = ticketIdsSchema.parse(request.body);
    await purgeTickets(actorOf(request), body.ids);
    return success(null);
  });

  app.get('/ticket/module/form', read, async (request) => {
    return success(await ticketForm(requireOrganization(request)));
  });

  app.get('/ticket/options', read, async (request) => {
    return success(await ticketOptions(actorOf(request)));
  });

  app.get('/ticket/template/list', settingRead, async (request) => {
    return success(await listTicketTemplates(requireOrganization(request)));
  });

  app.post('/ticket/template/save', settingUpdate, async (request) => {
    const body = ticketTemplateSaveSchema.parse(request.body);
    const user = requireUser(request);
    return success(await saveTicketTemplate({
      ...body,
      id: body.id || undefined,
      organizationId: requireOrganization(request),
      userId: user.id,
    }));
  });

  app.get('/ticket/template/delete/:id', settingUpdate, async (request) => {
    const params = ticketIdSchema.parse(request.params);
    await removeTicketTemplate(params.id, requireOrganization(request));
    return success(null);
  });

  app.get('/ticket/status-config/list', settingRead, async (request) => {
    return success(await listTicketStatuses(requireOrganization(request)));
  });

  app.post('/ticket/status-config/save', settingUpdate, async (request) => {
    const body = ticketStatusSaveSchema.parse(request.body);
    await saveTicketStatus({
      ...body,
      id: body.id || undefined,
      organizationId: requireOrganization(request),
      userId: requireUser(request).id,
    });
    return success(null);
  });

  app.post('/ticket/status-config/sort', settingUpdate, async (request) => {
    const body = ticketStatusSortSchema.parse(request.body);
    await sortTicketStatuses(requireOrganization(request), requireUser(request).id, body.ids);
    return success(null);
  });

  app.get('/ticket/status-config/delete/:id', settingUpdate, async (request) => {
    const params = ticketIdSchema.parse(request.params);
    await removeTicketStatus(params.id, requireOrganization(request));
    return success(null);
  });

  app.get('/ticket/route/list', settingRead, async (request) => {
    return success(await listTicketRoutes(requireOrganization(request)));
  });

  app.post('/ticket/route/save', settingUpdate, async (request) => {
    const body = ticketRouteSaveSchema.parse(request.body);
    await saveTicketRoute({
      ...body,
      organizationId: requireOrganization(request),
      userId: requireUser(request).id,
    });
    return success(null);
  });

  app.get('/ticket/route/delete/:id', settingUpdate, async (request) => {
    const params = ticketIdSchema.parse(request.params);
    await removeTicketRoute(params.id, requireOrganization(request));
    return success(null);
  });

  app.get('/ticket/config', settingRead, async (request) => {
    return success(await getTicketConfig(requireOrganization(request), requireUser(request).id));
  });

  app.post('/ticket/config/save', settingUpdate, async (request) => {
    const body = ticketConfigSaveSchema.parse(request.body);
    await saveTicketConfig({
      ...body,
      defaultDepartmentId: body.defaultDepartmentId || null,
      organizationId: requireOrganization(request),
      userId: requireUser(request).id,
    });
    return success(null);
  });

  app.post('/account/ticket/page', { preHandler: requirePermission(Permission.TICKET_READ) }, async (request, reply) => {
    await requirePermission(Permission.CUSTOMER_MANAGEMENT_READ)(request, reply);
    const body = accountTicketPageSchema.parse(request.body);
    return success(await pageTickets(actorOf(request), {
      ...body,
      view: 'all',
      canRecycle: false,
    }));
  });
}

function actorOf(request: FastifyRequest): TicketActor {
  return {
    user: requireUser(request),
    organizationId: requireOrganization(request),
  };
}

async function owns(request: FastifyRequest, permission: string): Promise<boolean> {
  const user = requireUser(request);
  if (user.id === ADMIN_USER_ID) {
    return true;
  }
  const organizationId = requireOrganization(request);
  const roles = organizationId === user.lastOrganizationId
    ? user.roles
    : await listRoles(user.id, organizationId);
  if (roles.some((role) => role.id === 'org_admin')) {
    return true;
  }
  const owned = organizationId === user.lastOrganizationId
    ? user.permissionIds
    : await listPermissionIds(user.id, organizationId);
  return owned.includes(permission);
}
