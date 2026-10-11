import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { agentFolder, dashboardFolder, type FolderItemInput, type FolderService } from '../../services/folder.service.js';
import { requireOrganization, requireUser } from '../../support/context.js';
import { Permission } from '../../support/permission.js';
import { success } from '../../support/result.js';
import { requirePermission } from '../middleware/permission.middleware.js';

const pageSchema = z.object({
  current: z.number().optional(),
  pageSize: z.number().optional(),
  keyword: z.string().optional(),
  dashboardModuleIds: z.array(z.string()).optional(),
  agentModuleIds: z.array(z.string()).optional(),
});

function itemInput(body: Record<string, unknown>, kind: 'dashboard' | 'agent'): FolderItemInput {
  return {
    id: typeof body.id === 'string' ? body.id : undefined,
    name: typeof body.name === 'string' ? body.name : undefined,
    moduleId: kind === 'dashboard'
      ? (typeof body.dashboardModuleId === 'string' ? body.dashboardModuleId : undefined)
      : (typeof body.agentModuleId === 'string' ? body.agentModuleId : undefined),
    resourceUrl: typeof body.resourceUrl === 'string' ? body.resourceUrl : undefined,
    scopeIds: Array.isArray(body.scopeIds) ? body.scopeIds.map((item) => String(item)) : [],
    description: typeof body.description === 'string' ? body.description : '',
    script: typeof body.script === 'string' ? body.script : '',
    type: typeof body.type === 'string' ? body.type : 'SCRIPT',
    workspaceId: typeof body.workspaceId === 'string' ? body.workspaceId : '',
    applicationId: typeof body.applicationId === 'string' ? body.applicationId : '',
  };
}

function registerFolder(app: FastifyInstance, prefix: 'dashboard' | 'agent', folder: FolderService): void {
  const read = prefix === 'dashboard' ? Permission.DASHBOARD_READ : Permission.AGENT_READ;
  const add = prefix === 'dashboard' ? Permission.DASHBOARD_ADD : Permission.AGENT_ADD;
  const update = prefix === 'dashboard' ? Permission.DASHBOARD_UPDATE : Permission.AGENT_UPDATE;
  const remove = prefix === 'dashboard' ? Permission.DASHBOARD_DELETE : Permission.AGENT_DELETE;
  const moduleKey = prefix === 'dashboard' ? 'dashboardModuleId' : 'agentModuleId';

  app.post(`/${prefix}/module/add`, { preHandler: requirePermission(add) }, async (request) => {
    const body = z.object({ parentId: z.string().optional(), name: z.string() }).parse(request.body);
    const user = requireUser(request);
    return success(await folder.addModule(body.parentId ?? 'NONE', body.name, requireOrganization(request), user.id));
  });

  app.post(`/${prefix}/module/rename`, { preHandler: requirePermission(update) }, async (request) => {
    const body = z.object({ id: z.string(), name: z.string() }).parse(request.body);
    await folder.renameModule(body.id, body.name, requireOrganization(request), requireUser(request).id);
    return success(null);
  });

  app.post(`/${prefix}/module/delete`, { preHandler: requirePermission(remove) }, async (request) => {
    const ids = z.array(z.string()).parse(request.body);
    await folder.deleteModules(ids, requireOrganization(request));
    return success(null);
  });

  app.get(`/${prefix}/module/tree`, { preHandler: requirePermission(read) }, async (request) => {
    const user = requireUser(request);
    return success(await folder.tree(requireOrganization(request), user.id));
  });

  app.get(`/${prefix}/module/count`, { preHandler: requirePermission(read) }, async (request) => {
    const user = requireUser(request);
    return success(await folder.count(requireOrganization(request), user.id));
  });

  app.post(`/${prefix}/module/move`, { preHandler: requirePermission(update) }, async (request) => {
    const body = z.object({
      dragNodeId: z.string(),
      dropNodeId: z.string(),
      dropPosition: z.number(),
    }).parse(request.body);
    await folder.moveModule(body.dragNodeId, body.dropNodeId, body.dropPosition, requireOrganization(request), requireUser(request).id);
    return success(null);
  });

  app.post(`/${prefix}/add`, { preHandler: requirePermission(add) }, async (request) => {
    const user = requireUser(request);
    return success(await folder.addItem(itemInput(request.body as Record<string, unknown>, prefix), requireOrganization(request), user.id));
  });

  app.post(`/${prefix}/update`, { preHandler: requirePermission(update) }, async (request) => {
    const user = requireUser(request);
    await folder.updateItem(itemInput(request.body as Record<string, unknown>, prefix), requireOrganization(request), user.id);
    return success(null);
  });

  app.post(`/${prefix}/rename`, { preHandler: requirePermission(update) }, async (request) => {
    const body = z.object({ id: z.string(), name: z.string() }).passthrough().parse(request.body);
    const moduleId = typeof body[moduleKey] === 'string' ? body[moduleKey] : '';
    await folder.renameItem(body.id, body.name, moduleId, requireOrganization(request), requireUser(request).id);
    return success(null);
  });

  app.get(`/${prefix}/detail/:id`, { preHandler: requirePermission(read) }, async (request) => {
    const { id } = request.params as { id: string };
    return success(await folder.detail(id, requireOrganization(request)));
  });

  app.get(`/${prefix}/delete/:id`, { preHandler: requirePermission(remove) }, async (request) => {
    const { id } = request.params as { id: string };
    await folder.deleteItem(id, requireOrganization(request));
    return success(null);
  });

  app.post(`/${prefix}/page`, { preHandler: requirePermission(read) }, async (request) => {
    const body = pageSchema.parse(request.body ?? {});
    const user = requireUser(request);
    return success(await folder.page({
      current: body.current,
      pageSize: body.pageSize,
      keyword: body.keyword,
      moduleIds: body.dashboardModuleIds ?? body.agentModuleIds,
    }, requireOrganization(request), user.id));
  });

  app.post(`/${prefix}/collect/page`, { preHandler: requirePermission(read) }, async (request) => {
    const body = pageSchema.parse(request.body ?? {});
    const user = requireUser(request);
    return success(await folder.page({
      current: body.current,
      pageSize: body.pageSize,
      keyword: body.keyword,
      collected: true,
    }, requireOrganization(request), user.id));
  });

  app.get(`/${prefix}/collect/:id`, { preHandler: requirePermission(read) }, async (request) => {
    const { id } = request.params as { id: string };
    const user = requireUser(request);
    await folder.collect(id, requireOrganization(request), user.id, true);
    return success(null);
  });

  app.get(`/${prefix}/un-collect/:id`, { preHandler: requirePermission(read) }, async (request) => {
    const { id } = request.params as { id: string };
    const user = requireUser(request);
    await folder.collect(id, requireOrganization(request), user.id, false);
    return success(null);
  });

  app.post(`/${prefix}/edit/pos`, { preHandler: requirePermission(update) }, async (request) => {
    const body = z.object({
      moveId: z.string(),
      targetId: z.string(),
      moveMode: z.string(),
    }).passthrough().parse(request.body);
    const moduleId = typeof body[moduleKey] === 'string' ? body[moduleKey] : '';
    await folder.moveItem(body.moveId, body.targetId, moduleId, body.moveMode, requireOrganization(request), requireUser(request).id);
    return success(null);
  });

  app.get(`/${prefix}/option`, { preHandler: requirePermission(read) }, async (request) => {
    requireUser(request);
    return success(await folder.options(requireOrganization(request)));
  });
}

export async function registerFolderRoutes(app: FastifyInstance): Promise<void> {
  registerFolder(app, 'dashboard', dashboardFolder);
  registerFolder(app, 'agent', agentFolder);

  app.get('/agent/workspace', { preHandler: requirePermission(Permission.AGENT_READ) }, async (request) => {
    requireUser(request);
    requireOrganization(request);
    return success([]);
  });

  app.get('/agent/application/config', { preHandler: requirePermission(Permission.AGENT_READ) }, async (request) => {
    requireUser(request);
    requireOrganization(request);
    return success(null);
  });

  app.get('/agent/application/:workspaceId', { preHandler: requirePermission(Permission.AGENT_READ) }, async (request) => {
    requireUser(request);
    requireOrganization(request);
    return success([]);
  });

  app.post('/agent/script', { preHandler: requirePermission(Permission.AGENT_READ) }, async (request) => {
    requireUser(request);
    requireOrganization(request);
    return success({ parameters: [], src: '' });
  });

  app.get('/agent/edition', { preHandler: requirePermission(Permission.AGENT_READ) }, async (request) => {
    requireUser(request);
    requireOrganization(request);
    return success('PE');
  });

  app.get('/agent/check', async (request) => {
    requireUser(request);
    requireOrganization(request);
    return success(false);
  });
}
