import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  answerChat,
  conversationDetail,
  deleteConversation,
  deleteMcp,
  importMcp,
  listChatModels,
  listMcp,
  pageActions,
  pageConversations,
  pageTraces,
  renameConversation,
  setActionStatus,
  setFeedback,
  smartOverview,
  summarizeWithModel,
  traceDetail,
} from '../../services/ai-chat.service.js';
import { listThirdPartyConfigs, sendMailCode } from '../../services/organization-config.service.js';
import {
  approveBusiness,
  deleteAuthSource,
  getAuthSource,
  listAuthSources,
  listTitleConfig,
  patchAuthSource,
  queryLocalTitle,
  saveAuthSource,
  saveSchedule,
  scheduleConfig,
  sortBoard,
  switchTitleConfig,
  titleHasInvoice,
  titleOptions,
  updateLeadStage,
} from '../../services/page-rest.service.js';
import { saveTempFiles } from '../../services/file.service.js';
import { asIds, asObject } from '../../services/record.service.js';
import { requireOrganization, requireUser } from '../../support/context.js';
import { validateFailed } from '../../support/errors.js';
import { nextId } from '../../support/id.js';
import { parseMultipart } from '../../support/multipart.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { Permission } from '../../support/permission.js';
import { success } from '../../support/result.js';

const settingRead = { preHandler: requirePermission(Permission.SYSTEM_SETTING_READ) };
const settingWrite = { preHandler: requirePermission(Permission.SYSTEM_SETTING_UPDATE) };
const contractRead = { preHandler: requirePermission(Permission.CONTRACT_READ) };
const contractWrite = { preHandler: requirePermission(Permission.CONTRACT_UPDATE) };
const agentRead = { preHandler: requirePermission(Permission.AGENT_READ) };
const orgRead = { preHandler: requirePermission(Permission.SYS_ORGANIZATION_READ) };
const orgWrite = { preHandler: requirePermission(Permission.SYS_ORGANIZATION_UPDATE) };

export async function registerPageRestRoutes(app: FastifyInstance): Promise<void> {
  app.get('/business-title/config/get', contractRead, async (request) => success(await listTitleConfig(requireOrganization(request))));
  app.get('/business-title/config/switch/:id', contractWrite, async (request) => {
    await switchTitleConfig(requireOrganization(request), (request.params as { id: string }).id);
    return success(null);
  });
  app.get('/contract/business-title/third-query', contractRead, async (request) => {
    const keyword = String((request.query as { keyword?: string }).keyword ?? '');
    return success(await queryLocalTitle(requireOrganization(request), keyword));
  });
  app.post('/contract/business-title/third-query/option', contractRead, async (request) => {
    return success(await titleOptions(requireOrganization(request), request.body));
  });
  app.get('/contract/business-title/invoice/check/:id', contractRead, async (request) => {
    return success(await titleHasInvoice(requireOrganization(request), (request.params as { id: string }).id));
  });

  app.post('/contract/approval', contractWrite, async (request) => {
    await approveBusiness('contract', 'contract', requireOrganization(request), requireUser(request).id, request.body);
    return success(null);
  });
  app.post('/contract/batch/approval', contractWrite, async (request) => {
    return success(await approveMany('contract', 'contract', request));
  });
  app.post('/invoice/approval', contractWrite, async (request) => {
    await approveBusiness('contract_invoice', 'invoice', requireOrganization(request), requireUser(request).id, request.body);
    return success(null);
  });
  app.post('/opportunity/sort', { preHandler: requirePermission(Permission.OPPORTUNITY_MANAGEMENT_UPDATE) }, async (request) => {
    await sortBoard('opportunity', requireOrganization(request), request.body);
    return success(null);
  });
  app.post('/contract/sort', contractWrite, async (request) => {
    await sortBoard('contract', requireOrganization(request), request.body);
    return success(null);
  });
  app.post('/order/sort', { preHandler: requirePermission(Permission.ORDER_UPDATE) }, async (request) => {
    await sortBoard('sales_order', requireOrganization(request), request.body);
    return success(null);
  });
  app.get('/order/download/:id', { preHandler: requirePermission(Permission.ORDER_READ) }, async () => success(null));
  app.post('/lead/status/update', { preHandler: requirePermission(Permission.CLUE_MANAGEMENT_UPDATE) }, async (request) => {
    await updateLeadStage(requireOrganization(request), requireUser(request).id, request.body);
    return success(null);
  });

  app.post('/system/auth-sources/list', settingRead, async (request) => {
    return success(await listAuthSources(requireOrganization(request), requireUser(request).id, request.body));
  });
  app.get('/system/auth-sources/get/:id', settingRead, async (request) => success(await getAuthSource((request.params as { id: string }).id)));
  app.post('/system/auth-sources/add', settingWrite, async (request) => {
    await saveAuthSource(requireOrganization(request), requireUser(request).id, request.body);
    return success(null);
  });
  app.post('/system/auth-sources/update', settingWrite, async (request) => {
    await saveAuthSource(requireOrganization(request), requireUser(request).id, request.body);
    return success(null);
  });
  app.get('/system/auth-sources/update/status/:id', settingWrite, async (request) => {
    const enable = (request.query as { enable?: string }).enable;
    await patchAuthSource((request.params as { id: string }).id, { enable: enable === 'true' || enable === '1' }, requireUser(request).id);
    return success(null);
  });
  app.get('/system/auth-sources/update/name/:id', settingWrite, async (request) => {
    await patchAuthSource((request.params as { id: string }).id, { name: String((request.query as { name?: string }).name ?? '') }, requireUser(request).id);
    return success(null);
  });
  app.get('/system/auth-sources/delete/:id', settingWrite, async (request) => {
    await deleteAuthSource((request.params as { id: string }).id);
    return success(null);
  });

  app.get('/organization/settings/de-token', settingRead, async () => success({ url: '', token: '' }));
  app.post('/organization/settings/de/org/list', settingRead, async () => success([]));
  app.get('/organization/settings/de/sync', settingWrite, async () => {
    throw validateFailed('未配置 DataEase');
  });
  app.get('/organization/settings/third-party/types', settingRead, async () => success([
    { id: 'WECOM', name: '企业微信' },
    { id: 'DINGTALK', name: '钉钉' },
    { id: 'LARK', name: '飞书' },
  ]));
  app.get('/organization/settings/third-party/get/:type', settingRead, async (request) => {
    const type = (request.params as { type: string }).type;
    const configs = await listThirdPartyConfigs(requireOrganization(request));
    const matched = configs.find((item) => item.type === type);
    return success(matched ?? { type, verify: false, config: {} });
  });
  app.get('/tender/application/config', settingRead, async () => success({ type: '', verify: false, config: {} }));
  app.post('/personal/center/mail/code/send', async (request) => {
    const user = requireUser(request);
    const email = String((request.query as { email?: string }).email ?? '').trim();
    await sendMailCode(requireOrganization(request), user.id, email);
    return success(null);
  });

  app.post('/user/sync/operation', orgWrite, async () => success(null));
  app.get('/user/sync/check', orgRead, async () => success(false));
  app.get('/user/sync/third-org/:type', orgRead, async () => success([]));
  app.get('/user/sync/schedule-config/:type', orgRead, async (request) => {
    return success(await scheduleConfig(requireOrganization(request), (request.params as { type: string }).type));
  });
  app.post('/user/sync/schedule-config', orgWrite, async (request) => {
    await saveSchedule(requireOrganization(request), requireUser(request).id, request.body);
    return success(null);
  });

  app.get('/sso/callback/oauth/state/:flow', async () => success(nextId()));
  app.get('/sso/callback/oauth', async () => {
    throw validateFailed('未启用单点登录');
  });
  app.get('/sso/callback/:type', async () => {
    throw validateFailed('未启用单点登录');
  });

  app.post('/agent/chat/stream', agentRead, async (request, reply) => writeChat(request, reply));
  app.post('/agent/chat/reconnect', agentRead, async (_request, reply) => {
    writeSse(reply, [
      block(1, 'reconnect', JSON.stringify({ finished: true })),
      block(2, 'done', JSON.stringify({})),
    ]);
  });
  app.post('/agent/chat/status', agentRead, async (request) => {
    const ids = asObject(request.body).requestIds;
    const result: Record<string, boolean> = {};
    if (Array.isArray(ids)) {
      ids.forEach((id) => {
        result[String(id)] = false;
      });
    }
    return success(result);
  });
  app.post('/agent/chat/cancel', agentRead, async () => success(null));
  app.post('/agent/confirm/:dialogId', agentRead, async () => success(null));
  app.post('/agent/chat/:runId/like', agentRead, async (request) => {
    await setFeedback((request.params as { runId: string }).runId, true);
    return success(null);
  });
  app.post('/agent/chat/:runId/dislike', agentRead, async (request) => {
    await setFeedback((request.params as { runId: string }).runId, false);
    return success(null);
  });
  app.post('/agent/chat/:runId/feedback/cancel', agentRead, async (request) => {
    await setFeedback((request.params as { runId: string }).runId, null);
    return success(null);
  });
  app.get('/agent/chat/models', agentRead, async (request) => {
    return success(await listChatModels(requireOrganization(request), requireUser(request).id));
  });
  app.post('/agent/chat/file/upload', agentRead, async (request) => success(await saveTempFiles(filesOf(request))));
  app.post('/agent-conversation/page', agentRead, async (request) => {
    return success(await pageConversations(requireOrganization(request), requireUser(request).id, request.body));
  });
  app.get('/agent-conversation/get/:id', agentRead, async (request) => {
    return success(await conversationDetail(requireOrganization(request), (request.params as { id: string }).id));
  });
  app.get('/agent-conversation/delete/:id', agentRead, async (request) => {
    await deleteConversation(requireOrganization(request), (request.params as { id: string }).id);
    return success(null);
  });
  app.put('/agent-conversation/rename/:id', agentRead, async (request) => {
    await renameConversation(
      requireOrganization(request),
      (request.params as { id: string }).id,
      String(asObject(request.body).title ?? ''),
      requireUser(request).id,
    );
    return success(null);
  });
  app.get('/agent-mcp-config/list', agentRead, async (request) => success(await listMcp(requireOrganization(request), requireUser(request).id)));
  app.post('/agent-mcp-config/import', agentRead, async (request) => {
    const file = filesOf(request)[0];
    if (!file) {
      throw validateFailed('请上传 MCP 配置文件');
    }
    await importMcp(requireOrganization(request), requireUser(request).id, file.filename, file.data.toString('utf8'));
    return success(null);
  });
  app.get('/agent-mcp-config/delete/:id', agentRead, async (request) => {
    await deleteMcp(requireOrganization(request), (request.params as { id: string }).id);
    return success(null);
  });
  app.post('/smart/data-overview', agentRead, async (request) => success(await smartOverview(requireOrganization(request))));
  app.post('/smart/data-overview/regenerate', agentRead, async (request) => success(await smartOverview(requireOrganization(request))));
  app.post('/smart/ai-summary', agentRead, async (request) => {
    const focus = String(asObject(request.body).focus ?? '');
    return success(await summarizeWithModel(requireOrganization(request), requireUser(request).id, focus));
  });
  app.post('/smart/ai-summary/regenerate', agentRead, async (request) => {
    const focus = String(asObject(request.body).focus ?? '');
    return success(await summarizeWithModel(requireOrganization(request), requireUser(request).id, focus));
  });
  app.post('/agent-action-suggestion/page', agentRead, async (request) => success(await pageActions('agent_action_suggestion', requireOrganization(request), request.body)));
  app.post('/agent-action-suggestion/ignore/:id', agentRead, async (request) => {
    await setActionStatus('agent_action_suggestion', (request.params as { id: string }).id, 'IGNORED');
    return success(null);
  });
  app.post('/agent-action-suggestion/submit/:id', agentRead, async (request) => {
    await setActionStatus('agent_action_suggestion', (request.params as { id: string }).id, 'SUBMITTED');
    return success(null);
  });
  app.post('/agent-action-approve/page', agentRead, async (request) => success(await pageActions('agent_action_approve', requireOrganization(request), request.body)));
  app.post('/agent-action-approve/ignore/:id', agentRead, async (request) => {
    await setActionStatus('agent_action_approve', (request.params as { id: string }).id, 'IGNORED');
    return success(null);
  });
  app.post('/agent-action-approve/confirm/:id', agentRead, async (request) => {
    await setActionStatus('agent_action_approve', (request.params as { id: string }).id, 'CONFIRMED');
    return success(null);
  });
  app.post('/agent-trace/page', { preHandler: requirePermission(Permission.OPERATION_LOG_READ) }, async (request) => {
    return success(await pageTraces(requireOrganization(request), request.body));
  });
  app.get('/agent-trace/detail/:id', { preHandler: requirePermission(Permission.OPERATION_LOG_READ) }, async (request) => {
    return success(await traceDetail(requireOrganization(request), (request.params as { id: string }).id));
  });
}

async function approveMany(table: string, formKey: string, request: FastifyRequest): Promise<{ success: number; fail: number }> {
  const body = asObject(request.body);
  const ids = asIds(request.body);
  let ok = 0;
  let fail = 0;
  for (const id of ids) {
    try {
      await approveBusiness(table, formKey, requireOrganization(request), requireUser(request).id, { ...body, id });
      ok += 1;
    } catch {
      fail += 1;
    }
  }
  return { success: ok, fail };
}

async function writeChat(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const turn = await answerChat(requireOrganization(request), requireUser(request).id, request.body);
  writeSse(reply, [
    block(1, 'run', JSON.stringify({
      conversationId: turn.conversationId,
      runId: turn.runId,
      userMessageId: turn.userMessageId,
      assistantMessageId: turn.assistantMessageId,
    })),
    block(2, 'chunk', turn.answer),
    block(3, 'done', JSON.stringify({
      runId: turn.runId,
      conversationId: turn.conversationId,
      assistantMessageId: turn.assistantMessageId,
    })),
  ]);
}

function writeSse(reply: FastifyReply, events: string[]): void {
  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  reply.raw.end(events.join(''));
}

function block(id: number, event: string, data: string): string {
  const lines = data.split('\n').map((line) => `data: ${line}`).join('\n');
  return `id: ${id}\nevent: ${event}\n${lines}\n\n`;
}

function filesOf(request: FastifyRequest): Array<{ filename: string; data: Buffer }> {
  const header = request.headers['content-type'];
  const contentType = Array.isArray(header) ? header[0] ?? '' : header ?? '';
  const body = Buffer.isBuffer(request.body) ? request.body : Buffer.from('');
  return parseMultipart(body, contentType).files;
}
