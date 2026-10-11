import type { RowDataPacket } from 'mysql2';

import { columnByField, tableColumns } from '../models/record.model.js';
import { execute, query } from '../support/db.js';
import { ident } from '../support/ident.js';
import { nextId } from '../support/id.js';
import { normalizePage, toPager, type Pager } from '../support/pager.js';
import { asObject } from './record.service.js';

export interface ChatTurn {
  conversationId: string;
  runId: string;
  userMessageId: string;
  assistantMessageId: string;
  answer: string;
}

export async function answerChat(organizationId: string, userId: string, body: unknown): Promise<ChatTurn> {
  const request = asObject(body);
  const message = String(request.message ?? '').trim();
  const conversationId = String(request.conversationId || nextId());
  const requestedModelId = String(request.modelId ?? '').trim();
  const existing = await query<RowDataPacket>(
    'SELECT id FROM agent_conversation WHERE id = ? AND organization_id = ? LIMIT 1',
    [conversationId, organizationId],
  );
  const now = Date.now();
  if (!existing[0]) {
    const title = message.slice(0, 40) || '新对话';
    await execute(
      `INSERT INTO agent_conversation
        (id, title, user_id, organization_id, create_time, update_time, create_user, update_user)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [conversationId, title, userId, organizationId, now, now, userId, userId],
    );
  } else {
    await execute(
      'UPDATE agent_conversation SET update_time = ?, update_user = ? WHERE id = ?',
      [now, userId, conversationId],
    );
  }
  const runId = nextId();
  const userMessageId = nextId();
  const assistantMessageId = nextId();
  const history = await recentMessages(conversationId, organizationId);
  const answered = await answerWithModel(organizationId, userId, requestedModelId, message, history);
  await insertMessage(userMessageId, 'USER', runId, conversationId, message, organizationId, userId, now, 0, 0);
  await insertMessage(
    assistantMessageId,
    'ASSISTANT',
    runId,
    conversationId,
    answered.text,
    organizationId,
    userId,
    now + 1,
    answered.inputTokens,
    answered.outputTokens,
  );
  if (answered.attempted) {
    await recordUsage(answered, runId, userId, organizationId, now);
  }
  await execute(
    `INSERT INTO agent_trace (id, name, status, operator, call_time, run_id, organization_id)
     VALUES (?, ?, 'success', ?, ?, ?, ?)`,
    [runId, message.slice(0, 80) || '对话', userId, now, runId, organizationId],
  );
  await execute(
    'INSERT INTO agent_trace_event (id, prompt, trace) VALUES (?, ?, ?)',
    [runId, Buffer.from(message), Buffer.from(answered.text)],
  );
  return { conversationId, runId, userMessageId, assistantMessageId, answer: answered.text };
}

export async function pageConversations(organizationId: string, userId: string, body: unknown): Promise<Pager<Record<string, unknown>>> {
  const request = asObject(body);
  const page = normalizePage(Number(request.current), Number(request.pageSize));
  const keyword = String(request.keyword ?? '');
  const where = ['organization_id = ?', 'user_id = ?'];
  const params: unknown[] = [organizationId, userId];
  if (keyword) {
    where.push('title LIKE ?');
    params.push(`%${keyword}%`);
  }
  const filter = where.join(' AND ');
  const totalRows = await query<RowDataPacket & { total: number }>(
    `SELECT COUNT(*) AS total FROM agent_conversation WHERE ${filter}`,
    params,
  );
  const rows = await query<RowDataPacket>(
    `SELECT * FROM agent_conversation WHERE ${filter} ORDER BY update_time DESC LIMIT ? OFFSET ?`,
    [...params, page.pageSize, (page.current - 1) * page.pageSize],
  );
  return toPager(rows.map(mapConversation), Number(totalRows[0]?.total ?? 0), page);
}

export async function conversationDetail(organizationId: string, conversationId: string): Promise<Record<string, unknown>> {
  const rows = await query<RowDataPacket>(
    'SELECT * FROM agent_conversation WHERE id = ? AND organization_id = ? LIMIT 1',
    [conversationId, organizationId],
  );
  const messages = await query<RowDataPacket>(
    'SELECT * FROM agent_message WHERE conversation_id = ? AND organization_id = ? ORDER BY create_time',
    [conversationId, organizationId],
  );
  return {
    conversation: rows[0] ? mapConversation(rows[0]) : null,
    messages: messages.map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content ?? '',
      conversationId: row.conversation_id,
      runId: row.run_id,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      totalTokens: row.total_tokens,
      helpful: row.helpful == null ? null : Boolean(row.helpful),
      createTime: Number(row.create_time ?? 0),
      organizationId: row.organization_id,
    })),
  };
}

export async function deleteConversation(organizationId: string, conversationId: string): Promise<void> {
  await execute('DELETE FROM agent_message WHERE conversation_id = ? AND organization_id = ?', [conversationId, organizationId]);
  await execute('DELETE FROM agent_conversation WHERE id = ? AND organization_id = ?', [conversationId, organizationId]);
}

export async function renameConversation(organizationId: string, conversationId: string, title: string, userId: string): Promise<void> {
  await execute(
    'UPDATE agent_conversation SET title = ?, update_time = ?, update_user = ? WHERE id = ? AND organization_id = ?',
    [title || '新对话', Date.now(), userId, conversationId, organizationId],
  );
}

export async function setFeedback(runId: string, helpful: boolean | null): Promise<void> {
  await execute('UPDATE agent_message SET helpful = ? WHERE run_id = ? AND role = ?', [helpful, runId, 'ASSISTANT']);
}

export async function listChatModels(organizationId: string, userId: string): Promise<Array<Record<string, unknown>>> {
  const columns = await tableColumns('agent_model');
  if (!columnByField(columns, 'displayName')) {
    return [];
  }
  const rows = await query<RowDataPacket & { id: string; display_name: string; scope?: string }>(
    `SELECT id, display_name, scope FROM agent_model
     WHERE organization_id = ? AND enable = 1
       AND (scope = 'SYSTEM' OR (scope = 'USER' AND user_id = ?))
     ORDER BY scope, create_time`,
    [organizationId, userId],
  );
  const preferred = await preferredModelId(organizationId);
  const defaultId = rows.some((row) => row.id === preferred) ? preferred : rows[0]?.id;
  return rows.map((row) => ({
    id: row.id,
    name: row.display_name,
    scope: row.scope === 'USER' ? 'USER' : 'SYSTEM',
    defaultModel: row.id === defaultId,
  }));
}

export async function listMcp(organizationId: string, userId: string): Promise<Array<Record<string, unknown>>> {
  const rows = await query<RowDataPacket>(
    'SELECT id, name, description FROM agent_mcp_config WHERE organization_id = ? AND user_id = ? ORDER BY update_time DESC',
    [organizationId, userId],
  );
  return rows.map((row) => ({ id: row.id, name: row.name, description: row.description ?? '' }));
}

export async function importMcp(organizationId: string, userId: string, filename: string, raw: string): Promise<void> {
  let name = filename.replace(/\.json$/i, '') || 'MCP';
  try {
    const parsed = JSON.parse(raw) as { name?: string };
    if (parsed.name) {
      name = String(parsed.name);
    }
  } catch {
    raw = JSON.stringify({ name, raw });
  }
  const now = Date.now();
  await execute(
    `INSERT INTO agent_mcp_config
      (id, name, description, config_json, user_id, organization_id, create_time, update_time, create_user, update_user)
     VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?)`,
    [nextId(), name.slice(0, 255), raw, userId, organizationId, now, now, userId, userId],
  );
}

export async function deleteMcp(organizationId: string, id: string): Promise<void> {
  await execute('DELETE FROM agent_mcp_config WHERE id = ? AND organization_id = ?', [id, organizationId]);
}

export async function pageActions(table: 'agent_action_suggestion' | 'agent_action_approve', organizationId: string, body: unknown): Promise<Pager<Record<string, unknown>>> {
  const request = asObject(body);
  const page = normalizePage(Number(request.current), Number(request.pageSize));
  const totalRows = await query<RowDataPacket & { total: number }>(
    `SELECT COUNT(*) AS total FROM ${ident(table)} WHERE organization_id = ? AND status <> 'IGNORED'`,
    [organizationId],
  );
  const rows = await query<RowDataPacket>(
    `SELECT * FROM ${ident(table)} WHERE organization_id = ? AND status <> 'IGNORED' ORDER BY create_time DESC LIMIT ? OFFSET ?`,
    [organizationId, page.pageSize, (page.current - 1) * page.pageSize],
  );
  return toPager(rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    createTime: Number(row.create_time ?? 0),
    summary: row.summary ?? '',
    createUser: row.create_user,
    content: row.content ?? '',
    topic: row.topic ?? '',
    userId: row.user_id,
    actions: row.actions ?? '',
    priority: row.priority ?? 0,
    type: row.type ?? '',
    status: row.status,
  })), Number(totalRows[0]?.total ?? 0), page);
}

export async function setActionStatus(table: 'agent_action_suggestion' | 'agent_action_approve', id: string, status: string): Promise<void> {
  await execute(`UPDATE ${ident(table)} SET status = ? WHERE id = ?`, [status, id]);
}

export async function pageTraces(organizationId: string, body: unknown): Promise<Pager<Record<string, unknown>>> {
  const request = asObject(body);
  const page = normalizePage(Number(request.current), Number(request.pageSize));
  const keyword = String(request.keyword ?? '');
  const where = ['t.organization_id = ?'];
  const params: unknown[] = [organizationId];
  if (keyword) {
    where.push('t.name LIKE ?');
    params.push(`%${keyword}%`);
  }
  if (request.status) {
    where.push('t.status = ?');
    params.push(request.status);
  }
  const filter = where.join(' AND ');
  const totalRows = await query<RowDataPacket & { total: number }>(
    `SELECT COUNT(*) AS total FROM agent_trace t WHERE ${filter}`,
    params,
  );
  const rows = await query<RowDataPacket>(
    `SELECT t.*, u.name AS operator_name FROM agent_trace t
     LEFT JOIN sys_user u ON u.id = t.operator
     WHERE ${filter} ORDER BY t.call_time DESC LIMIT ? OFFSET ?`,
    [...params, page.pageSize, (page.current - 1) * page.pageSize],
  );
  return toPager(rows.map(mapTrace), Number(totalRows[0]?.total ?? 0), page);
}

export async function traceDetail(organizationId: string, id: string): Promise<Record<string, unknown>> {
  const rows = await query<RowDataPacket>(
    `SELECT t.*, u.name AS operator_name, e.prompt, e.trace
     FROM agent_trace t
     LEFT JOIN sys_user u ON u.id = t.operator
     LEFT JOIN agent_trace_event e ON e.id = t.id
     WHERE t.id = ? AND t.organization_id = ? LIMIT 1`,
    [id, organizationId],
  );
  return rows[0] ? mapTrace(rows[0]) : {};
}

export async function smartOverview(organizationId: string): Promise<string> {
  const [customer, clue, opportunity, contract] = await Promise.all([
    countOf('customer', organizationId),
    countOf('clue', organizationId),
    countOf('opportunity', organizationId),
    countOf('contract', organizationId),
  ]);
  return `客户 ${customer}，线索 ${clue}，商机 ${opportunity}，合同 ${contract}。`;
}

export async function summarizeWithModel(organizationId: string, userId: string, focus: string): Promise<string> {
  const overview = await smartOverview(organizationId);
  const question = focus.trim() || '请根据这些数据写一段简短的经营摘要。';
  const answered = await answerWithModel(organizationId, userId, await insightModelId(organizationId), question, []);
  if (!answered.modelId) {
    return overview;
  }
  return answered.text;
}

interface StoredModel {
  id: string;
  displayName: string;
  modelName: string;
  provider: string;
  apiUrl: string;
  apiKey: string;
  userDailyLimit: number;
  globalDailyLimit: number;
}

interface ModelAnswer {
  text: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  success: boolean;
  attempted: boolean;
}

async function answerWithModel(
  organizationId: string,
  userId: string,
  modelId: string,
  message: string,
  history: Array<{ role: string; content: string }>,
): Promise<ModelAnswer> {
  const overview = await smartOverview(organizationId);
  const plan = await resolveModelPlan(organizationId, userId, modelId);
  if (!plan.models.length) {
    return {
      text: modelId
        ? '模型不存在或未启用。'
        : `还没有可用模型。请先在个人中心或企业设置里添加并启用模型。\n${overview}`,
      modelId: '',
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      success: false,
      attempted: false,
    };
  }
  const terms = await termPrompt(organizationId);
  const messages = [
    { role: 'system', content: `你是 KingCRM 的销售助手，用中文回答。可以引用这些组织数据，不要编造名单里没有的客户：${overview}${terms}` },
    ...history,
    { role: 'user', content: message || '请根据当前数据做简要说明。' },
  ];
  let last = failedAnswer(plan.models[0], '模型没有返回内容。');
  for (const model of plan.models) {
    last = await callModel(model, userId, messages);
    if (last.success || !plan.fallback) {
      return last;
    }
  }
  return last;
}

function failedAnswer(model: StoredModel, text: string): ModelAnswer {
  return { text, modelId: model.id, inputTokens: 0, outputTokens: 0, latencyMs: 0, success: false, attempted: false };
}

async function callModel(
  model: StoredModel,
  userId: string,
  messages: Array<{ role: string; content: string }>,
): Promise<ModelAnswer> {
  if (!model.apiKey) {
    return failedAnswer(model, `模型「${model.displayName}」还没有填写 API Key。`);
  }
  const limited = await overDailyLimit(model, userId);
  if (limited) {
    return failedAnswer(model, limited);
  }
  const started = Date.now();
  try {
    const result = await completeChat(model, messages);
    return {
      text: result.text || '模型没有返回内容。',
      modelId: model.id,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      latencyMs: Date.now() - started,
      success: true,
      attempted: true,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : '模型调用失败';
    return {
      ...failedAnswer(model, `模型「${model.displayName}」调用失败：${reason}`),
      latencyMs: Date.now() - started,
      attempted: true,
    };
  }
}

async function resolveModelPlan(organizationId: string, userId: string, modelId: string): Promise<{ models: StoredModel[]; fallback: boolean }> {
  const strategy = await loadStrategy(organizationId);
  if (!strategy.fallback) {
    const primaryId = modelId || strategy.chatModels[0] || '';
    const primary = primaryId
      ? await loadModel(organizationId, userId, primaryId)
      : await firstVisibleModel(organizationId, userId);
    return { models: primary ? [primary] : [], fallback: false };
  }
  const orderedIds = modelId
    ? [modelId, ...strategy.chatModels, ...strategy.taskModels]
    : [...strategy.chatModels, ...strategy.taskModels];
  const models: StoredModel[] = [];
  const seen = new Set<string>();
  for (const id of orderedIds) {
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const model = await loadModel(organizationId, userId, id);
    if (model) {
      models.push(model);
    }
  }
  if (!models.length && !modelId) {
    const first = await firstVisibleModel(organizationId, userId);
    if (first) {
      models.push(first);
      seen.add(first.id);
    }
  }
  for (const model of await visibleModels(organizationId, userId)) {
    if (!seen.has(model.id)) {
      seen.add(model.id);
      models.push(model);
    }
  }
  return { models, fallback: models.length > 1 };
}

async function loadModel(organizationId: string, userId: string, modelId: string): Promise<StoredModel | null> {
  const rows = await query<RowDataPacket>(
    `SELECT id, display_name, model_name, provider, api_url, api_key, user_daily_limit, global_daily_limit
     FROM agent_model
     WHERE id = ? AND organization_id = ? AND enable = 1
       AND (scope = 'SYSTEM' OR (scope = 'USER' AND user_id = ?))
     LIMIT 1`,
    [modelId, organizationId, userId],
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    id: String(row.id),
    displayName: String(row.display_name ?? ''),
    modelName: String(row.model_name || row.display_name || ''),
    provider: String(row.provider ?? 'OpenAI'),
    apiUrl: String(row.api_url ?? ''),
    apiKey: String(row.api_key ?? ''),
    userDailyLimit: Number(row.user_daily_limit ?? -1),
    globalDailyLimit: Number(row.global_daily_limit ?? -1),
  };
}

async function loadStrategy(organizationId: string): Promise<{ chatModels: string[]; taskModels: string[]; fallback: boolean }> {
  const rows = await query<RowDataPacket & { chat_models: string | null; task_models: string | null; fallback: number }>(
    'SELECT chat_models, task_models, fallback FROM agent_model_strategy WHERE id = ? LIMIT 1',
    [organizationId],
  );
  return {
    chatModels: parseIdList(rows[0]?.chat_models),
    taskModels: parseIdList(rows[0]?.task_models),
    fallback: Number(rows[0]?.fallback ?? 0) === 1,
  };
}

function parseIdList(raw: string | null | undefined): string[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

async function insightModelId(organizationId: string): Promise<string> {
  const strategy = await loadStrategy(organizationId);
  return strategy.taskModels[0] ?? '';
}

async function preferredModelId(organizationId: string): Promise<string> {
  const strategy = await loadStrategy(organizationId);
  return strategy.chatModels[0] || '';
}

async function firstVisibleModel(organizationId: string, userId: string): Promise<StoredModel | null> {
  const models = await visibleModels(organizationId, userId);
  return models[0] ?? null;
}

async function visibleModels(organizationId: string, userId: string): Promise<StoredModel[]> {
  const rows = await query<RowDataPacket & { id: string }>(
    `SELECT id FROM agent_model
     WHERE organization_id = ? AND enable = 1
       AND (scope = 'SYSTEM' OR (scope = 'USER' AND user_id = ?))
     ORDER BY CASE WHEN scope = 'SYSTEM' THEN 0 ELSE 1 END, create_time`,
    [organizationId, userId],
  );
  const models: StoredModel[] = [];
  for (const row of rows) {
    const model = await loadModel(organizationId, userId, row.id);
    if (model) {
      models.push(model);
    }
  }
  return models;
}

async function recentMessages(conversationId: string, organizationId: string): Promise<Array<{ role: string; content: string }>> {
  const rows = await query<RowDataPacket>(
    `SELECT role, content FROM agent_message
     WHERE conversation_id = ? AND organization_id = ? AND content IS NOT NULL AND content <> ''
     ORDER BY create_time DESC LIMIT 10`,
    [conversationId, organizationId],
  );
  return rows.reverse().map((row) => ({
    role: String(row.role).toUpperCase() === 'ASSISTANT' ? 'assistant' : 'user',
    content: String(row.content),
  }));
}

async function overDailyLimit(model: StoredModel, userId: string): Promise<string> {
  const start = startOfShanghaiDay();
  if (model.userDailyLimit > 0) {
    const used = await usageCount(model.id, start, userId);
    if (used >= model.userDailyLimit) {
      return `模型「${model.displayName}」今日个人 token 已用完。`;
    }
  }
  if (model.globalDailyLimit > 0) {
    const used = await usageCount(model.id, start);
    if (used >= model.globalDailyLimit) {
      return `模型「${model.displayName}」今日 token 已用完。`;
    }
  }
  return '';
}

async function usageCount(modelId: string, since: number, userId = ''): Promise<number> {
  const rows = await query<RowDataPacket & { total: number }>(
    `SELECT COALESCE(SUM(total_tokens), 0) AS total FROM agent_model_usage
     WHERE model_id = ? AND create_time >= ? ${userId ? 'AND user_id = ?' : ''}`,
    userId ? [modelId, since, userId] : [modelId, since],
  );
  return Number(rows[0]?.total ?? 0);
}

function startOfShanghaiDay(now = Date.now()): number {
  const shifted = new Date(now + 8 * 60 * 60 * 1000);
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - 8 * 60 * 60 * 1000;
}

async function completeChat(
  model: StoredModel,
  messages: Array<{ role: string; content: string }>,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const endpoint = chatEndpoint(model);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = model.provider === 'Anthropic'
      ? await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': model.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: model.modelName,
          max_tokens: 1024,
          system: messages.find((item) => item.role === 'system')?.content ?? '',
          messages: messages.filter((item) => item.role !== 'system'),
        }),
        signal: controller.signal,
      })
      : await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${model.apiKey}`,
        },
        body: JSON.stringify({ model: model.modelName, messages }),
        signal: controller.signal,
      });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(errorText(raw, response.status));
    }
    const payload = JSON.parse(raw) as {
      choices?: Array<{ message?: { content?: string } }>;
      content?: Array<{ text?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number };
    };
    const text = payload.choices?.[0]?.message?.content
      ?? payload.content?.map((item) => item.text ?? '').join('')
      ?? '';
    return {
      text,
      inputTokens: Number(payload.usage?.prompt_tokens ?? payload.usage?.input_tokens ?? 0),
      outputTokens: Number(payload.usage?.completion_tokens ?? payload.usage?.output_tokens ?? 0),
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('请求超时');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function chatEndpoint(model: StoredModel): string {
  const configured = model.apiUrl.trim();
  if (!configured && model.provider === '自定义') {
    throw new Error('请填写 API Base URL');
  }
  const base = (configured || defaultApiUrl(model.provider)).replace(/\/+$/, '');
  if (model.provider === 'Anthropic') {
    return base.endsWith('/messages') ? base : `${base}/messages`;
  }
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
}

function defaultApiUrl(provider: string): string {
  if (provider === 'DeepSeek') {
    return 'https://api.deepseek.com';
  }
  if (provider === '阿里云') {
    return 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  }
  if (provider === '腾讯云') {
    return 'https://api.hunyuan.cloud.tencent.com/v1';
  }
  if (provider === 'Anthropic') {
    return 'https://api.anthropic.com/v1';
  }
  return 'https://api.openai.com/v1';
}

function errorText(raw: string, status: number): string {
  try {
    const payload = JSON.parse(raw) as { error?: { message?: string } | string; message?: string };
    if (typeof payload.error === 'string' && payload.error) {
      return payload.error;
    }
    if (payload.error && typeof payload.error === 'object' && payload.error.message) {
      return payload.error.message;
    }
    if (payload.message) {
      return payload.message;
    }
  } catch {
    if (raw.trim()) {
      return raw.trim().slice(0, 180);
    }
  }
  return `接口返回 ${status}`;
}

async function recordUsage(answered: ModelAnswer, runId: string, userId: string, organizationId: string, now: number): Promise<void> {
  await execute(
    `INSERT INTO agent_model_usage
      (id, model_id, run_id, user_id, input_tokens, output_tokens, total_tokens, call_count,
       fallback_count, success_count, failure_count, total_latency_ms, organization_id, create_time)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?)`,
    [
      nextId(),
      answered.modelId,
      runId,
      userId,
      answered.inputTokens,
      answered.outputTokens,
      answered.inputTokens + answered.outputTokens,
      answered.success ? 1 : 0,
      answered.success ? 0 : 1,
      answered.latencyMs,
      organizationId,
      now,
    ],
  );
}

async function countOf(table: 'customer' | 'clue' | 'opportunity' | 'contract', organizationId: string): Promise<number> {
  const rows = await query<RowDataPacket & { total: number }>(
    `SELECT COUNT(*) AS total FROM ${ident(table)} WHERE organization_id = ?`,
    [organizationId],
  );
  return Number(rows[0]?.total ?? 0);
}

async function insertMessage(
  id: string,
  role: string,
  runId: string,
  conversationId: string,
  content: string,
  organizationId: string,
  userId: string,
  now: number,
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  await execute(
    `INSERT INTO agent_message
      (id, role, run_id, conversation_id, content, input_tokens, output_tokens, total_tokens,
       organization_id, create_time, update_time, create_user, update_user)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, role, runId, conversationId, content, inputTokens, outputTokens, inputTokens + outputTokens,
      organizationId, now, now, userId, userId,
    ],
  );
}

export async function suggestTerms(organizationId: string, userId: string, samples: string[]): Promise<string[]> {
  if (!samples.length) {
    return [];
  }
  const strategy = await loadStrategy(organizationId);
  const classifyModelId = strategy.chatModels[1] || '';
  if (!classifyModelId) {
    return [];
  }
  const plan = await resolveModelPlan(organizationId, userId, classifyModelId);
  const model = plan.models[0];
  if (!model) {
    return [];
  }
  const answered = await callModel(model, userId, [
    { role: 'system', content: '从对话里找出可能的业务术语。每行只写一个术语，2到12个字。不要编号，不要解释。没有就只回复无。' },
    { role: 'user', content: samples.join('\n').slice(0, 4000) },
  ]);
  if (!answered.success || answered.text.trim() === '无') {
    return [];
  }
  return answered.text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\d.、\-\s]+/, '').trim())
    .filter((word) => /^[\u4e00-\u9fffA-Za-z0-9]{2,12}$/.test(word))
    .slice(0, 10);
}

async function termPrompt(organizationId: string): Promise<string> {
  const rows = await query<RowDataPacket>(
    `SELECT standard_term, also_called, avoid_these
     FROM agent_term
     WHERE organization_id = ? AND enable = 1
     ORDER BY update_time DESC
     LIMIT 30`,
    [organizationId],
  );
  if (!rows.length) {
    return '';
  }
  const lines = rows.map((row) => {
    const also = String(row.also_called ?? '').trim();
    const avoid = String(row.avoid_these ?? '').trim();
    const extra = [
      also ? `也叫：${also}` : '',
      avoid ? `避免：${avoid}` : '',
    ].filter(Boolean).join('；');
    return extra ? `- ${row.standard_term}（${extra}）` : `- ${row.standard_term}`;
  });
  return `\n回答时使用这些标准术语，同义说法换成标准词，不要使用需要避免的词：\n${lines.join('\n')}`;
}

function mapConversation(row: RowDataPacket): Record<string, unknown> {
  return {
    id: row.id,
    title: row.title,
    userId: row.user_id,
    organizationId: row.organization_id,
    createTime: Number(row.create_time ?? 0),
    updateTime: Number(row.update_time ?? 0),
    createUser: row.create_user,
    updateUser: row.update_user,
  };
}

function mapTrace(row: RowDataPacket): Record<string, unknown> {
  return {
    id: row.id,
    operator: row.operator,
    operatorName: row.operator_name ?? '',
    name: row.name,
    runId: row.run_id,
    callTime: Number(row.call_time ?? 0),
    callIp: row.call_ip ?? '',
    status: row.status === 'failed' ? 'failed' : 'success',
    prompt: blobText(row.prompt),
    trace: blobText(row.trace),
  };
}

function blobText(value: unknown): string {
  if (Buffer.isBuffer(value)) {
    return value.toString('utf8');
  }
  return typeof value === 'string' ? value : '';
}
