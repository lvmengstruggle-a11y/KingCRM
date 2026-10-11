import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { approvalService } from '../../services/approval.service.js';
import { requireOrganization, requireUser } from '../../support/context.js';
import { validateFailed } from '../../support/errors.js';
import { Permission } from '../../support/permission.js';
import { success } from '../../support/result.js';
import { requirePermission } from '../middleware/permission.middleware.js';

const pageSchema = z.object({
  current: z.number().optional(),
  pageSize: z.number().optional(),
  keyword: z.string().optional(),
  resourceType: z.string().optional(),
  resourceName: z.string().optional(),
  filters: z.array(z.object({
    name: z.string().optional(),
    value: z.unknown().optional(),
    operator: z.string().optional(),
  })).optional(),
  sort: z.object({
    name: z.string().optional(),
    type: z.string().optional(),
  }).optional(),
});

export async function registerApprovalRoutes(app: FastifyInstance): Promise<void> {
  app.post('/approval-flow/page', { preHandler: requirePermission(Permission.PROCESS_SETTING_READ) }, async (request) => {
    requireUser(request);
    const body = pageSchema.parse(request.body ?? {});
    return success(await approvalService.page(body, requireOrganization(request)));
  });

  app.post('/approval-flow/add', { preHandler: requirePermission(Permission.PROCESS_SETTING_ADD) }, async (request) => {
    const user = requireUser(request);
    return success(await approvalService.add(request.body as never, requireOrganization(request), user.id));
  });

  app.post('/approval-flow/update', { preHandler: requirePermission(Permission.PROCESS_SETTING_UPDATE) }, async (request) => {
    const user = requireUser(request);
    return success(await approvalService.update(request.body as never, requireOrganization(request), user.id));
  });

  app.get('/approval-flow/delete/:id', { preHandler: requirePermission(Permission.PROCESS_SETTING_DELETE) }, async (request) => {
    requireUser(request);
    const { id } = request.params as { id: string };
    await approvalService.remove(id, requireOrganization(request));
    return success(null);
  });

  app.get('/approval-flow/get/:id', { preHandler: requirePermission(Permission.PROCESS_SETTING_READ) }, async (request) => {
    requireUser(request);
    const { id } = request.params as { id: string };
    return success(await approvalService.detail(id, requireOrganization(request)));
  });

  app.get('/approval-flow/enable/:id', { preHandler: requirePermission(Permission.PROCESS_SETTING_UPDATE) }, async (request) => {
    const user = requireUser(request);
    const { id } = request.params as { id: string };
    const enable = String((request.query as { enable?: string }).enable) !== 'false';
    await approvalService.enable(id, enable, requireOrganization(request), user.id);
    return success(null);
  });

  app.get('/approval-flow/status-permission/setting/:formType', { preHandler: requirePermission(Permission.PROCESS_SETTING_READ) }, async (request) => {
    requireUser(request);
    const { formType } = request.params as { formType: string };
    return success(await approvalService.statusPermission(formType, requireOrganization(request)));
  });

  app.get('/approval-flow/get-by-form-type/:formType', async (request) => {
    requireUser(request);
    const { formType } = request.params as { formType: string };
    return success(await approvalService.byFormType(formType, requireOrganization(request)));
  });

  app.get('/approval-flow/form/options', async (request) => {
    requireUser(request);
    return success(await approvalService.formOptions(requireOrganization(request)));
  });

  app.post('/approval-flow/webhook/test', async (request) => {
    requireUser(request);
    requireOrganization(request);
    const body = z.object({ webHookUrl: z.string().optional() }).parse(request.body ?? {});
    if (!body.webHookUrl) {
      throw validateFailed('地址不能为空');
    }
    await approvalService.testWebhook(body.webHookUrl);
    return success(null);
  });

  const todo = async (kind: 'pending' | 'processed' | 'initiated' | 'cc', request: FastifyRequest) => {
    const user = requireUser(request);
    const body = pageSchema.parse(request.body ?? {});
    return success(await approvalService.todoPage(kind, body, user.id, requireOrganization(request)));
  };

  app.post('/approval-todo/pending/page', async (request) => todo('pending', request));
  app.post('/approval-todo/processed/page', async (request) => todo('processed', request));
  app.post('/approval-todo/initiated/page', async (request) => todo('initiated', request));
  app.post('/approval-todo/cc/page', async (request) => todo('cc', request));

  app.get('/approval-todo/pending/count', async (request) => {
    const user = requireUser(request);
    return success(await approvalService.pendingCount(user.id, requireOrganization(request), false));
  });

  app.get('/approval-todo/cc/count', async (request) => {
    const user = requireUser(request);
    return success(await approvalService.pendingCount(user.id, requireOrganization(request), true));
  });

  app.post('/approval-resource/push', async (request) => {
    const user = requireUser(request);
    const body = z.object({ resourceId: z.string(), formKey: z.string() }).parse(request.body);
    await approvalService.push(body.resourceId, body.formKey, requireOrganization(request), user.id);
    return success(null);
  });

  app.post('/approval-resource/revoke', async (request) => {
    const user = requireUser(request);
    const body = z.object({ resourceId: z.string() }).parse(request.body);
    await approvalService.revokeResource(body.resourceId, user.id);
    return success(null);
  });

  app.get('/approval-resource/simple-detail/:resourceId', async (request) => {
    requireUser(request);
    const { resourceId } = request.params as { resourceId: string };
    return success(await approvalService.simpleDetail(resourceId));
  });

  app.get('/approval-resource/detail/:resourceId', async (request) => {
    requireUser(request);
    const { resourceId } = request.params as { resourceId: string };
    return success(await approvalService.instanceDetail(resourceId));
  });

  const actionBody = z.object({
    id: z.string(),
    comment: z.string().optional(),
    returnToNodeId: z.string().optional(),
    signApprover: z.string().optional(),
    type: z.string().optional(),
  });

  app.post('/approval-action/approve', async (request) => {
    const user = requireUser(request);
    const body = actionBody.parse(request.body);
    await approvalService.act('APPROVE', body.id, body.comment ?? '', user.id);
    return success(null);
  });

  app.post('/approval-action/reject', async (request) => {
    const user = requireUser(request);
    const body = actionBody.parse(request.body);
    await approvalService.act('REJECT', body.id, body.comment ?? '', user.id);
    return success(null);
  });

  app.post('/approval-action/batch-approve', async (request) => {
    const user = requireUser(request);
    const body = z.object({ ids: z.array(z.string()), comment: z.string().optional() }).parse(request.body);
    for (const id of body.ids) {
      await approvalService.assertBatch(id);
    }
    for (const id of body.ids) {
      await approvalService.act('APPROVE', id, body.comment ?? '', user.id);
    }
    return success(null);
  });

  app.post('/approval-action/batch-reject', async (request) => {
    const user = requireUser(request);
    const body = z.object({ ids: z.array(z.string()), comment: z.string().optional() }).parse(request.body);
    for (const id of body.ids) {
      await approvalService.assertBatch(id);
    }
    for (const id of body.ids) {
      await approvalService.act('REJECT', id, body.comment ?? '', user.id);
    }
    return success(null);
  });

  app.post('/approval-action/sign', async (request) => {
    const user = requireUser(request);
    const body = actionBody.parse(request.body);
    await approvalService.sign(body.id, body.signApprover ?? '', body.type ?? 'before', body.comment ?? '', user.id);
    return success(null);
  });

  app.post('/approval-action/back', async (request) => {
    const user = requireUser(request);
    const body = actionBody.parse(request.body);
    await approvalService.back(body.id, body.returnToNodeId ?? '', body.comment ?? '', user.id);
    return success(null);
  });

  app.post('/approval-action/revoke', async (request) => {
    const user = requireUser(request);
    const body = z.object({ resourceId: z.string().optional(), id: z.string().optional() }).parse(request.body ?? {});
    if (body.resourceId) {
      await approvalService.revokeResource(body.resourceId, user.id);
    }
    return success(null);
  });
}
