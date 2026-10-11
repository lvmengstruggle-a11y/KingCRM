import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { aiSettingService } from '../../services/ai-setting.service.js';
import { uiDisplayService, type UiSettingInput } from '../../services/ui-display.service.js';
import { requireOrganization, requireUser } from '../../support/context.js';
import { validateFailed } from '../../support/errors.js';
import { parseMultipart } from '../../support/multipart.js';
import { Permission } from '../../support/permission.js';
import { success } from '../../support/result.js';
import { requirePermission } from '../middleware/permission.middleware.js';

const pageSchema = z.object({
  current: z.number().optional(),
  pageSize: z.number().optional(),
  keyword: z.string().optional(),
  catalogId: z.string().optional(),
  taskId: z.string().optional(),
  sort: z.object({
    name: z.string().optional(),
    type: z.string().optional(),
  }).optional(),
  filters: z.array(z.object({
    name: z.string().optional(),
    value: z.unknown().optional(),
  }).passthrough()).optional(),
});

const modelSchema = z.object({
  id: z.string().optional(),
  displayName: z.string().optional(),
  modelName: z.string().optional(),
  provider: z.string().optional(),
  apiUrl: z.string().optional(),
  apiKey: z.string().optional(),
  enable: z.boolean().optional(),
  globalDailyLimit: z.number().optional(),
  userDailyLimit: z.number().optional(),
  modelParams: z.string().optional(),
}).passthrough();

function registerModels(app: FastifyInstance, prefix: '/agent-model' | '/user-model', scope: 'SYSTEM' | 'USER'): void {
  const guard = scope === 'SYSTEM'
    ? { preHandler: requirePermission(Permission.SYSTEM_SETTING_READ) }
    : {};
  const write = scope === 'SYSTEM'
    ? { preHandler: requirePermission(Permission.SYSTEM_SETTING_UPDATE) }
    : {};

  app.post(`${prefix}/page`, guard, async (request) => {
    const user = requireUser(request);
    const body = pageSchema.parse(request.body ?? {});
    return success(await aiSettingService.pageModels(body, requireOrganization(request), scope, user.id));
  });

  app.get(`${prefix}/get/:id`, guard, async (request) => {
    const user = requireUser(request);
    const { id } = request.params as { id: string };
    return success(await aiSettingService.modelDetail(id, requireOrganization(request), scope, user.id));
  });

  app.post(`${prefix}/add`, write, async (request) => {
    const user = requireUser(request);
    return success(await aiSettingService.addModel(modelSchema.parse(request.body ?? {}), requireOrganization(request), scope, user.id));
  });

  app.post(`${prefix}/update`, write, async (request) => {
    const user = requireUser(request);
    await aiSettingService.updateModel(modelSchema.parse(request.body ?? {}), requireOrganization(request), scope, user.id);
    return success(null);
  });

  app.get(`${prefix}/switch/:id`, write, async (request) => {
    const user = requireUser(request);
    const { id } = request.params as { id: string };
    await aiSettingService.switchModel(id, requireOrganization(request), scope, user.id);
    return success(null);
  });

  app.get(`${prefix}/delete/:id`, write, async (request) => {
    const user = requireUser(request);
    const { id } = request.params as { id: string };
    await aiSettingService.deleteModel(id, requireOrganization(request), scope, user.id);
    return success(null);
  });
}

export async function registerAiSettingRoutes(app: FastifyInstance): Promise<void> {
  registerModels(app, '/agent-model', 'SYSTEM');
  registerModels(app, '/user-model', 'USER');

  app.get('/agent-model/options', { preHandler: requirePermission(Permission.SYSTEM_SETTING_READ) }, async (request) => {
    requireUser(request);
    return success(await aiSettingService.modelOptions(requireOrganization(request)));
  });

  app.get('/agent-model-strategy/get', { preHandler: requirePermission(Permission.SYSTEM_SETTING_READ) }, async (request) => {
    requireUser(request);
    return success(await aiSettingService.strategy(requireOrganization(request)));
  });

  app.post('/agent-model-strategy/config', { preHandler: requirePermission(Permission.SYSTEM_SETTING_UPDATE) }, async (request) => {
    requireUser(request);
    const body = z.object({
      chatModels: z.array(z.string()).optional(),
      taskModels: z.array(z.string()).optional(),
      fallback: z.boolean().optional(),
    }).parse(request.body ?? {});
    await aiSettingService.saveStrategy(body.chatModels ?? [], body.taskModels ?? [], Boolean(body.fallback), requireOrganization(request));
    return success(null);
  });

  const read = { preHandler: requirePermission(Permission.SYSTEM_SETTING_READ) };
  const write = { preHandler: requirePermission(Permission.SYSTEM_SETTING_UPDATE) };

  app.post('/agent-task/page', read, async (request) => {
    requireUser(request);
    return success(await aiSettingService.pageTasks(pageSchema.parse(request.body ?? {}), requireOrganization(request)));
  });
  app.post('/agent-task/add', write, async (request) => {
    const user = requireUser(request);
    return success(await aiSettingService.addTask(request.body as never, requireOrganization(request), user.id));
  });
  app.post('/agent-task/update', write, async (request) => {
    const user = requireUser(request);
    await aiSettingService.updateTask(request.body as never, requireOrganization(request), user.id);
    return success(null);
  });
  app.get('/agent-task/get/:id', read, async (request) => {
    requireUser(request);
    const { id } = request.params as { id: string };
    return success(await aiSettingService.taskDetail(id, requireOrganization(request)));
  });
  app.get('/agent-task/switch/:id', write, async (request) => {
    const user = requireUser(request);
    const { id } = request.params as { id: string };
    await aiSettingService.switchTask(id, requireOrganization(request), user.id);
    return success(null);
  });
  app.get('/agent-task/delete/:id', write, async (request) => {
    requireUser(request);
    const { id } = request.params as { id: string };
    await aiSettingService.deleteTask(id, requireOrganization(request));
    return success(null);
  });
  app.post('/agent-task/execution-record/page', read, async (request) => {
    requireUser(request);
    return success(await aiSettingService.pageExecutions(pageSchema.parse(request.body ?? {}), requireOrganization(request)));
  });
  app.get('/agent-task/execution-record/stop/:id', write, async (request) => {
    requireUser(request);
    const { id } = request.params as { id: string };
    await aiSettingService.stopExecution(id, requireOrganization(request));
    return success(null);
  });
  app.get('/agent-task/execution-record/delete/:id', write, async (request) => {
    requireUser(request);
    const { id } = request.params as { id: string };
    await aiSettingService.deleteExecution(id, requireOrganization(request));
    return success(null);
  });

  app.get('/agent-term-catalog/list', read, async (request) => {
    requireUser(request);
    return success(await aiSettingService.termCatalogs(requireOrganization(request)));
  });
  app.post('/agent-term-catalog/add', write, async (request) => {
    const user = requireUser(request);
    const body = z.object({ name: z.string() }).parse(request.body);
    return success(await aiSettingService.addCatalog(body.name, requireOrganization(request), user.id));
  });
  app.post('/agent-term-catalog/update', write, async (request) => {
    const user = requireUser(request);
    const body = z.object({ id: z.string(), name: z.string() }).parse(request.body);
    await aiSettingService.updateCatalog(body.id, body.name, requireOrganization(request), user.id);
    return success(null);
  });
  app.get('/agent-term-catalog/delete/:id', write, async (request) => {
    requireUser(request);
    const { id } = request.params as { id: string };
    await aiSettingService.deleteCatalog(id, requireOrganization(request));
    return success(null);
  });

  app.post('/agent-term/page', read, async (request) => {
    requireUser(request);
    return success(await aiSettingService.pageTerms(pageSchema.parse(request.body ?? {}), requireOrganization(request)));
  });
  app.post('/agent-term/add', write, async (request) => {
    const user = requireUser(request);
    return success(await aiSettingService.addTerm(request.body as never, requireOrganization(request), user.id));
  });
  app.post('/agent-term/update', write, async (request) => {
    const user = requireUser(request);
    await aiSettingService.updateTerm(request.body as never, requireOrganization(request), user.id);
    return success(null);
  });
  app.get('/agent-term/get/:id', read, async (request) => {
    requireUser(request);
    const { id } = request.params as { id: string };
    return success(await aiSettingService.termDetail(id, requireOrganization(request)));
  });
  app.get('/agent-term/switch/:id', write, async (request) => {
    const user = requireUser(request);
    const { id } = request.params as { id: string };
    await aiSettingService.switchTerm(id, requireOrganization(request), user.id);
    return success(null);
  });
  app.get('/agent-term/delete/:id', write, async (request) => {
    requireUser(request);
    const { id } = request.params as { id: string };
    await aiSettingService.deleteTerm(id, requireOrganization(request));
    return success(null);
  });

  app.get('/agent-term/template/download', read, async (request, reply) => {
    requireUser(request);
    requireOrganization(request);
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="term-template.csv"');
    return reply.send('\uFEFF标准术语,同义词,禁用词,使用场景,系统映射\n');
  });

  app.post('/agent-term/import/pre-check', write, async (request) => {
    requireUser(request);
    const csv = csvOf(request);
    const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
    const count = Math.max(lines.length - 1, 0);
    return success({ failCount: 0, successCount: count, errorMessages: [] });
  });

  app.post('/agent-term/import', write, async (request) => {
    const user = requireUser(request);
    const csv = csvOf(request);
    const catalogId = catalogOf(request);
    if (!catalogId) {
      throw validateFailed('请选择术语分类');
    }
    return success(await aiSettingService.importTerms(csv, catalogId, requireOrganization(request), user.id));
  });

  app.post('/agent-term-discovery/page', read, async (request) => {
    const user = requireUser(request);
    return success(await aiSettingService.pageDiscoveries(pageSchema.parse(request.body ?? {}), requireOrganization(request), user.id));
  });
  app.get('/agent-term-discovery/ignore/:id', write, async (request) => {
    requireUser(request);
    const { id } = request.params as { id: string };
    await aiSettingService.ignoreDiscovery(id);
    return success(null);
  });
  app.post('/agent-term-discovery/adopt', write, async (request) => {
    const user = requireUser(request);
    return success(await aiSettingService.adoptDiscovery(request.body as never, requireOrganization(request), user.id));
  });
}

function csvOf(request: FastifyRequest): string {
  if (!Buffer.isBuffer(request.body)) {
    return '';
  }
  const parsed = parseMultipart(request.body, String(request.headers['content-type'] ?? ''));
  return parsed.files[0]?.data.toString('utf8') ?? '';
}

function catalogOf(request: FastifyRequest): string {
  if (!Buffer.isBuffer(request.body)) {
    return '';
  }
  const parsed = parseMultipart(request.body, String(request.headers['content-type'] ?? ''));
  const raw = parsed.fields.get('request');
  if (!raw) {
    return '';
  }
  try {
    const body = JSON.parse(raw) as { catalogId?: string };
    return body.catalogId ?? '';
  } catch {
    return '';
  }
}

export async function registerUiDisplayRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ui/display/info', async (request) => {
    const organizationId = request.organizationId || '100001';
    return success(await uiDisplayService.info(organizationId));
  });

  app.get('/ui/display/preview', async (request, reply: FastifyReply) => {
    const paramKey = String((request.query as { paramKey?: string }).paramKey ?? '');
    const file = await uiDisplayService.preview(paramKey, request.organizationId || '100001');
    reply.header('Content-Type', file.type);
    return reply.send(file.body);
  });

  app.post('/ui/display/save', { preHandler: requirePermission(Permission.SYSTEM_SETTING_UPDATE) }, async (request) => {
    requireUser(request);
    const { items, files } = readUiBody(request);
    await uiDisplayService.save(items, files, requireOrganization(request));
    return success(null);
  });
}

function readUiBody(request: FastifyRequest): { items: UiSettingInput[]; files: { filename: string; data: Buffer }[] } {
  if (Array.isArray(request.body)) {
    return { items: request.body as UiSettingInput[], files: [] };
  }
  if (Buffer.isBuffer(request.body)) {
    const parsed = parseMultipart(request.body, String(request.headers['content-type'] ?? ''));
    const requestFile = parsed.files.find((file) => file.field === 'request');
    const raw = parsed.fields.get('request') ?? requestFile?.data.toString('utf8') ?? '[]';
    const items = JSON.parse(raw) as UiSettingInput[];
    return {
      items: Array.isArray(items) ? items : [],
      files: parsed.files
        .filter((file) => file.field !== 'request')
        .map((file) => ({ filename: file.filename, data: file.data })),
    };
  }
  throw validateFailed('界面配置格式不正确');
}
