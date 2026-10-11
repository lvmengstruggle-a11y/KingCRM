import { suggestTerms } from './ai-chat.service.js';
import { execute, query, type SqlRow } from '../support/db.js';
import { notFound, validateFailed } from '../support/errors.js';
import { nextId } from '../support/id.js';
import { normalizePage, toPager, type Pager } from '../support/pager.js';

type ModelScope = 'SYSTEM' | 'USER';

interface ModelInput {
  id?: string;
  displayName?: string;
  modelName?: string;
  provider?: string;
  apiUrl?: string;
  apiKey?: string;
  enable?: boolean;
  globalDailyLimit?: number;
  userDailyLimit?: number;
  modelParams?: string;
}

interface TaskInput {
  id?: string;
  name?: string;
  triggerType?: string;
  executionCondition?: string;
  executionAction?: string;
  confirmationLevel?: string;
  applicableModel?: string;
  enable?: boolean;
}

interface TermInput {
  id?: string;
  catalogId?: string;
  standardTerm?: string;
  alsoCalled?: string;
  avoidThese?: string;
  useCase?: string;
  systemReference?: string;
  enable?: boolean;
}

interface ModelRow extends SqlRow {
  id: string;
  display_name: string;
  model_name: string;
  provider: string;
  api_url: string | null;
  api_key: string;
  enable: number;
  user_daily_limit: number | string | null;
  global_daily_limit: number | string | null;
  model_params: string | null;
  create_time: number | string;
  update_time: number | string;
  create_user: string;
  update_user: string;
}

function flag(value: unknown, fallback = true): number {
  if (value === undefined || value === null) {
    return fallback ? 1 : 0;
  }
  return value === false || value === 0 ? 0 : 1;
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function limit(value: unknown): number {
  if (value === undefined || value === null || value === '') {
    return -1;
  }
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : -1;
}

async function userNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) {
    return new Map();
  }
  const rows = await query<SqlRow & { id: string; name: string }>(
    `SELECT id, name FROM sys_user WHERE id IN (${unique.map(() => '?').join(', ')})`,
    unique,
  );
  return new Map(rows.map((row) => [row.id, row.name]));
}

function modelItem(row: ModelRow, names: Map<string, string>, dailyTotal = 0): Record<string, unknown> {
  return {
    id: row.id,
    displayName: row.display_name,
    modelName: row.model_name,
    provider: row.provider,
    apiUrl: row.api_url ?? '',
    apiKey: row.api_key,
    enable: Number(row.enable) === 1,
    globalDailyLimit: Number(row.global_daily_limit ?? -1),
    userDailyLimit: Number(row.user_daily_limit ?? -1),
    modelParams: row.model_params ?? '',
    dailyTotal,
    createUserName: names.get(row.create_user) ?? row.create_user,
    updateUserName: names.get(row.update_user) ?? row.update_user,
    createTime: Number(row.create_time),
    updateTime: Number(row.update_time),
  };
}

async function requireModel(id: string, organizationId: string, scope: ModelScope, userId: string): Promise<ModelRow> {
  const rows = await query<ModelRow>(
    `SELECT * FROM agent_model WHERE id = ? AND organization_id = ? AND scope = ? ${scope === 'USER' ? 'AND user_id = ?' : ''}`,
    scope === 'USER' ? [id, organizationId, scope, userId] : [id, organizationId, scope],
  );
  const row = rows[0];
  if (!row) {
    throw notFound('模型不存在');
  }
  return row;
}

function defaultModelApiUrl(provider: string): string {
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
  if (provider === '自定义') {
    return '';
  }
  return 'https://api.openai.com/v1';
}

async function assertUniqueModelName(
  displayName: string,
  organizationId: string,
  scope: ModelScope,
  userId: string,
  excludeId = '',
): Promise<void> {
  const rows = await query<SqlRow & { id: string }>(
    `SELECT id FROM agent_model
     WHERE organization_id = ? AND scope = ? AND display_name = ?
       AND ${scope === 'USER' ? 'user_id = ?' : '1 = 1'}
       ${excludeId ? 'AND id <> ?' : ''}
     LIMIT 1`,
    scope === 'USER'
      ? [organizationId, scope, displayName, userId, ...(excludeId ? [excludeId] : [])]
      : [organizationId, scope, displayName, ...(excludeId ? [excludeId] : [])],
  );
  if (rows[0]) {
    throw validateFailed('模型名称不能重复');
  }
}

export class AiSettingService {
  async pageModels(
    body: {
      current?: number;
      pageSize?: number;
      keyword?: string;
      sort?: { name?: string; type?: string };
      filters?: Array<{ name?: string; value?: unknown }>;
    },
    organizationId: string,
    scope: ModelScope,
    userId: string,
  ): Promise<Pager<Record<string, unknown>>> {
    const page = normalizePage(body.current, body.pageSize);
    const filters = ['organization_id = ?', 'scope = ?'];
    const params: unknown[] = [organizationId, scope];
    if (scope === 'USER') {
      filters.push('user_id = ?');
      params.push(userId);
    }
    if (body.keyword) {
      filters.push('(display_name LIKE ? OR model_name LIKE ?)');
      params.push(`%${body.keyword}%`, `%${body.keyword}%`);
    }
    const enabled = enableFilter(body.filters);
    if (enabled !== undefined) {
      filters.push('enable = ?');
      params.push(enabled ? 1 : 0);
    }
    const where = filters.join(' AND ');
    const total = await query<SqlRow & { total: number }>(`SELECT COUNT(*) AS total FROM agent_model WHERE ${where}`, params);
    const rows = await query<ModelRow>(
      `SELECT * FROM agent_model WHERE ${where} ORDER BY ${modelSort(body.sort)} LIMIT ? OFFSET ?`,
      [...params, page.pageSize, (page.current - 1) * page.pageSize],
    );
    const usage = await query<SqlRow & { model_id: string; total: number }>(
      `SELECT model_id, COALESCE(SUM(total_tokens), 0) AS total FROM agent_model_usage
       WHERE organization_id = ? AND create_time >= ? GROUP BY model_id`,
      [organizationId, startOfShanghaiDay()],
    );
    const totals = new Map(usage.map((row) => [row.model_id, Number(row.total)]));
    const names = await userNames(rows.flatMap((row) => [row.create_user, row.update_user]));
    return toPager(rows.map((row) => modelItem(row, names, totals.get(row.id) ?? 0)), Number(total[0]?.total ?? 0), page);
  }

  async modelDetail(id: string, organizationId: string, scope: ModelScope, userId: string): Promise<Record<string, unknown>> {
    const row = await requireModel(id, organizationId, scope, userId);
    const names = await userNames([row.create_user, row.update_user]);
    return modelItem(row, names);
  }

  async addModel(input: ModelInput, organizationId: string, scope: ModelScope, userId: string): Promise<{ id: string }> {
    const displayName = text(input.displayName);
    if (!displayName) {
      throw validateFailed('模型名称不能为空');
    }
    const apiKey = text(input.apiKey);
    if (!apiKey) {
      throw validateFailed('请填写 API Key');
    }
    const provider = text(input.provider, 'OpenAI') || 'OpenAI';
    await assertUniqueModelName(displayName, organizationId, scope, userId);
    const id = nextId();
    const now = Date.now();
    await execute(
      `INSERT INTO agent_model
        (id, display_name, model_name, provider, api_url, api_key, enable, user_daily_limit, global_daily_limit,
         model_params, organization_id, scope, user_id, create_time, update_time, create_user, update_user)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, displayName, text(input.modelName, displayName) || displayName, provider,
        text(input.apiUrl) || defaultModelApiUrl(provider), apiKey, flag(input.enable), limit(input.userDailyLimit), limit(input.globalDailyLimit),
        text(input.modelParams) || null, organizationId, scope, scope === 'USER' ? userId : null, now, now, userId, userId,
      ],
    );
    return { id };
  }

  async updateModel(input: ModelInput, organizationId: string, scope: ModelScope, userId: string): Promise<void> {
    const current = await requireModel(text(input.id), organizationId, scope, userId);
    const displayName = text(input.displayName) || current.display_name;
    const provider = text(input.provider, current.provider) || current.provider;
    await assertUniqueModelName(displayName, organizationId, scope, userId, current.id);
    const apiUrl = input.apiUrl === undefined
      ? (current.api_url || defaultModelApiUrl(provider))
      : (text(input.apiUrl) || defaultModelApiUrl(provider));
    await execute(
      `UPDATE agent_model
       SET display_name = ?, model_name = ?, provider = ?, api_url = ?, api_key = ?, enable = ?,
           user_daily_limit = ?, global_daily_limit = ?, model_params = ?, update_time = ?, update_user = ?
       WHERE id = ?`,
      [
        displayName,
        text(input.modelName, current.model_name) || current.model_name,
        provider,
        apiUrl,
        input.apiKey === undefined || input.apiKey === '' ? current.api_key : text(input.apiKey),
        flag(input.enable, Number(current.enable) === 1),
        input.userDailyLimit === undefined ? limit(current.user_daily_limit) : limit(input.userDailyLimit),
        input.globalDailyLimit === undefined ? limit(current.global_daily_limit) : limit(input.globalDailyLimit),
        input.modelParams === undefined ? current.model_params : (text(input.modelParams) || null),
        Date.now(), userId, current.id,
      ],
    );
  }

  async switchModel(id: string, organizationId: string, scope: ModelScope, userId: string): Promise<void> {
    const current = await requireModel(id, organizationId, scope, userId);
    await execute('UPDATE agent_model SET enable = ?, update_time = ?, update_user = ? WHERE id = ?', [
      Number(current.enable) === 1 ? 0 : 1, Date.now(), userId, id,
    ]);
  }

  async deleteModel(id: string, organizationId: string, scope: ModelScope, userId: string): Promise<void> {
    await requireModel(id, organizationId, scope, userId);
    await execute('DELETE FROM agent_model WHERE id = ?', [id]);
    await removeModelFromStrategy(id, organizationId);
  }

  async modelOptions(organizationId: string): Promise<{ id: string; name: string; idAsString: string }[]> {
    const rows = await query<SqlRow & { id: string; display_name: string }>(
      `SELECT id, display_name FROM agent_model
       WHERE organization_id = ? AND scope = 'SYSTEM' AND enable = 1
       ORDER BY update_time DESC`,
      [organizationId],
    );
    return rows.map((row) => ({ id: row.id, name: row.display_name, idAsString: row.id }));
  }

  async strategy(organizationId: string): Promise<Record<string, unknown>> {
    const rows = await query<SqlRow & { chat_models: string | null; task_models: string | null; fallback: number }>(
      'SELECT chat_models, task_models, fallback FROM agent_model_strategy WHERE id = ?',
      [organizationId],
    );
    const row = rows[0];
    return {
      id: organizationId,
      chatModels: parseIds(row?.chat_models),
      taskModels: parseIds(row?.task_models),
      fallback: Number(row?.fallback ?? 0) === 1,
    };
  }

  async saveStrategy(chatModels: string[], taskModels: string[], fallback: boolean, organizationId: string): Promise<void> {
    await execute(
      `INSERT INTO agent_model_strategy (id, chat_models, task_models, fallback)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE chat_models = VALUES(chat_models), task_models = VALUES(task_models), fallback = VALUES(fallback)`,
      [organizationId, JSON.stringify(chatModels), JSON.stringify(taskModels), fallback ? 1 : 0],
    );
  }

  async pageTasks(body: { current?: number; pageSize?: number; keyword?: string }, organizationId: string): Promise<Pager<Record<string, unknown>>> {
    const page = normalizePage(body.current, body.pageSize);
    const filters = ['organization_id = ?'];
    const params: unknown[] = [organizationId];
    if (body.keyword) {
      filters.push('name LIKE ?');
      params.push(`%${body.keyword}%`);
    }
    const where = filters.join(' AND ');
    const total = await query<SqlRow & { total: number }>(`SELECT COUNT(*) AS total FROM agent_task WHERE ${where}`, params);
    const rows = await query<SqlRow>(
      `SELECT * FROM agent_task WHERE ${where} ORDER BY update_time DESC LIMIT ? OFFSET ?`,
      [...params, page.pageSize, (page.current - 1) * page.pageSize],
    );
    const names = await userNames(rows.flatMap((row) => [String(row.create_user), String(row.update_user)]));
    return toPager(rows.map((row) => taskItem(row, names)), Number(total[0]?.total ?? 0), page);
  }

  async addTask(input: TaskInput, organizationId: string, userId: string): Promise<{ id: string }> {
    const name = text(input.name);
    if (!name) {
      throw validateFailed('任务名称不能为空');
    }
    const id = nextId();
    const now = Date.now();
    await execute(
      `INSERT INTO agent_task
        (id, name, trigger_type, execution_condition, execution_action, confirmation_level, applicable_model,
         enable, organization_id, create_time, update_time, create_user, update_user)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, name, text(input.triggerType, 'manual') || 'manual', text(input.executionCondition) || null,
        text(input.executionAction) || null, text(input.confirmationLevel, 'ask') || 'ask', text(input.applicableModel) || null,
        flag(input.enable), organizationId, now, now, userId, userId,
      ],
    );
    return { id };
  }

  async updateTask(input: TaskInput, organizationId: string, userId: string): Promise<void> {
    const current = await requireTask(text(input.id), organizationId);
    await execute(
      `UPDATE agent_task
       SET name = ?, trigger_type = ?, execution_condition = ?, execution_action = ?, confirmation_level = ?,
           applicable_model = ?, enable = ?, update_time = ?, update_user = ?
       WHERE id = ? AND organization_id = ?`,
      [
        text(input.name) || String(current.name),
        text(input.triggerType, String(current.trigger_type)) || String(current.trigger_type),
        text(input.executionCondition) || null,
        text(input.executionAction) || null,
        text(input.confirmationLevel, String(current.confirmation_level)) || String(current.confirmation_level),
        text(input.applicableModel) || null,
        flag(input.enable, Number(current.enable) === 1),
        Date.now(), userId, current.id, organizationId,
      ],
    );
  }

  async taskDetail(id: string, organizationId: string): Promise<Record<string, unknown>> {
    const row = await requireTask(id, organizationId);
    const names = await userNames([String(row.create_user), String(row.update_user)]);
    return taskItem(row, names);
  }

  async switchTask(id: string, organizationId: string, userId: string): Promise<void> {
    const row = await requireTask(id, organizationId);
    await execute('UPDATE agent_task SET enable = ?, update_time = ?, update_user = ? WHERE id = ?', [
      Number(row.enable) === 1 ? 0 : 1, Date.now(), userId, id,
    ]);
  }

  async deleteTask(id: string, organizationId: string): Promise<void> {
    await requireTask(id, organizationId);
    await execute('DELETE FROM agent_task_execute_log WHERE task_id = ?', [id]);
    await execute('DELETE FROM agent_task WHERE id = ? AND organization_id = ?', [id, organizationId]);
  }

  async pageExecutions(body: { current?: number; pageSize?: number; taskId?: string }, organizationId: string): Promise<Pager<Record<string, unknown>>> {
    const page = normalizePage(body.current, body.pageSize);
    const filters = ['organization_id = ?'];
    const params: unknown[] = [organizationId];
    if (body.taskId) {
      filters.push('task_id = ?');
      params.push(body.taskId);
    }
    const where = filters.join(' AND ');
    const total = await query<SqlRow & { total: number }>(`SELECT COUNT(*) AS total FROM agent_task_execute_log WHERE ${where}`, params);
    const rows = await query<SqlRow>(
      `SELECT * FROM agent_task_execute_log WHERE ${where} ORDER BY execute_time DESC LIMIT ? OFFSET ?`,
      [...params, page.pageSize, (page.current - 1) * page.pageSize],
    );
    return toPager(rows.map((row) => ({
      id: row.id,
      executeTime: Number(row.execute_time),
      taskId: row.task_id,
      taskName: row.task_name,
      executeReason: row.execute_reason,
      status: row.status,
      result: row.result ?? '',
    })), Number(total[0]?.total ?? 0), page);
  }

  async stopExecution(id: string, organizationId: string): Promise<void> {
    const rows = await query<SqlRow>('SELECT id FROM agent_task_execute_log WHERE id = ? AND organization_id = ?', [id, organizationId]);
    if (!rows[0]) {
      throw notFound('执行记录不存在');
    }
    await execute(`UPDATE agent_task_execute_log SET status = 'STOPPED' WHERE id = ?`, [id]);
  }

  async deleteExecution(id: string, organizationId: string): Promise<void> {
    await execute('DELETE FROM agent_task_execute_log WHERE id = ? AND organization_id = ?', [id, organizationId]);
  }

  async termCatalogs(organizationId: string): Promise<Record<string, unknown>[]> {
    const rows = await query<SqlRow & { id: string; name: string; total: number }>(
      `SELECT c.id, c.name, COUNT(t.id) AS total
       FROM agent_term_catalog c
       LEFT JOIN agent_term t ON t.catalog_id = c.id
       WHERE c.organization_id = ?
       GROUP BY c.id, c.name
       ORDER BY c.create_time`,
      [organizationId],
    );
    return rows.map((row) => ({ id: row.id, name: row.name, termCount: Number(row.total) }));
  }

  async addCatalog(name: string, organizationId: string, userId: string): Promise<Record<string, unknown>> {
    const catalogName = text(name);
    if (!catalogName) {
      throw validateFailed('分类名称不能为空');
    }
    const id = nextId();
    const now = Date.now();
    await execute(
      `INSERT INTO agent_term_catalog (id, name, organization_id, create_time, update_time, create_user, update_user)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, catalogName, organizationId, now, now, userId, userId],
    );
    return { id, name: catalogName, termCount: 0 };
  }

  async updateCatalog(id: string, name: string, organizationId: string, userId: string): Promise<void> {
    await requireCatalog(id, organizationId);
    if (!text(name)) {
      throw validateFailed('分类名称不能为空');
    }
    await execute(
      'UPDATE agent_term_catalog SET name = ?, update_time = ?, update_user = ? WHERE id = ? AND organization_id = ?',
      [text(name), Date.now(), userId, id, organizationId],
    );
  }

  async deleteCatalog(id: string, organizationId: string): Promise<void> {
    await requireCatalog(id, organizationId);
    const terms = await query<SqlRow>('SELECT id FROM agent_term WHERE catalog_id = ? LIMIT 1', [id]);
    if (terms.length) {
      throw validateFailed('请先删除分类下的术语');
    }
    await execute('DELETE FROM agent_term_catalog WHERE id = ? AND organization_id = ?', [id, organizationId]);
  }

  async pageTerms(body: { current?: number; pageSize?: number; keyword?: string; catalogId?: string }, organizationId: string): Promise<Pager<Record<string, unknown>>> {
    const page = normalizePage(body.current, body.pageSize);
    const filters = ['t.organization_id = ?'];
    const params: unknown[] = [organizationId];
    if (body.catalogId) {
      filters.push('t.catalog_id = ?');
      params.push(body.catalogId);
    }
    if (body.keyword) {
      filters.push('t.standard_term LIKE ?');
      params.push(`%${body.keyword}%`);
    }
    const where = filters.join(' AND ');
    const total = await query<SqlRow & { total: number }>(`SELECT COUNT(*) AS total FROM agent_term t WHERE ${where}`, params);
    const rows = await query<SqlRow>(
      `SELECT t.*, c.name AS catalog_name
       FROM agent_term t
       LEFT JOIN agent_term_catalog c ON c.id = t.catalog_id
       WHERE ${where}
       ORDER BY t.update_time DESC
       LIMIT ? OFFSET ?`,
      [...params, page.pageSize, (page.current - 1) * page.pageSize],
    );
    const names = await userNames(rows.flatMap((row) => [String(row.create_user), String(row.update_user)]));
    return toPager(rows.map((row) => termItem(row, names)), Number(total[0]?.total ?? 0), page);
  }

  async addTerm(input: TermInput, organizationId: string, userId: string): Promise<Record<string, unknown>> {
    const catalogId = text(input.catalogId);
    const standardTerm = text(input.standardTerm);
    if (!catalogId || !standardTerm) {
      throw validateFailed('分类和标准术语不能为空');
    }
    await requireCatalog(catalogId, organizationId);
    const id = nextId();
    const now = Date.now();
    await execute(
      `INSERT INTO agent_term
        (id, catalog_id, standard_term, also_called, avoid_these, use_case, system_reference, enable,
         organization_id, create_time, update_time, create_user, update_user)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, catalogId, standardTerm, text(input.alsoCalled) || null, text(input.avoidThese) || null,
        text(input.useCase) || null, text(input.systemReference) || null, flag(input.enable),
        organizationId, now, now, userId, userId,
      ],
    );
    return this.termDetail(id, organizationId);
  }

  async updateTerm(input: TermInput, organizationId: string, userId: string): Promise<void> {
    const current = await requireTerm(text(input.id), organizationId);
    const catalogId = text(input.catalogId) || String(current.catalog_id);
    await requireCatalog(catalogId, organizationId);
    await execute(
      `UPDATE agent_term
       SET catalog_id = ?, standard_term = ?, also_called = ?, avoid_these = ?, use_case = ?, system_reference = ?,
           enable = ?, update_time = ?, update_user = ?
       WHERE id = ? AND organization_id = ?`,
      [
        catalogId, text(input.standardTerm) || String(current.standard_term), text(input.alsoCalled) || null,
        text(input.avoidThese) || null, text(input.useCase) || null, text(input.systemReference) || null,
        flag(input.enable, Number(current.enable) === 1), Date.now(), userId, current.id, organizationId,
      ],
    );
  }

  async termDetail(id: string, organizationId: string): Promise<Record<string, unknown>> {
    const rows = await query<SqlRow>(
      `SELECT t.*, c.name AS catalog_name FROM agent_term t
       LEFT JOIN agent_term_catalog c ON c.id = t.catalog_id
       WHERE t.id = ? AND t.organization_id = ?`,
      [id, organizationId],
    );
    const row = rows[0];
    if (!row) {
      throw notFound('术语不存在');
    }
    const names = await userNames([String(row.create_user), String(row.update_user)]);
    return termItem(row, names);
  }

  async switchTerm(id: string, organizationId: string, userId: string): Promise<void> {
    const row = await requireTerm(id, organizationId);
    await execute('UPDATE agent_term SET enable = ?, update_time = ?, update_user = ? WHERE id = ?', [
      Number(row.enable) === 1 ? 0 : 1, Date.now(), userId, id,
    ]);
  }

  async deleteTerm(id: string, organizationId: string): Promise<void> {
    await requireTerm(id, organizationId);
    await execute('DELETE FROM agent_term WHERE id = ? AND organization_id = ?', [id, organizationId]);
  }

  async importTerms(csv: string, catalogId: string, organizationId: string, userId: string): Promise<{ failCount: number; successCount: number; errorMessages: { rowNum: number; errMsg: string }[] }> {
    await requireCatalog(catalogId, organizationId);
    const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const rows = lines[0]?.includes('标准术语') ? lines.slice(1) : lines;
    const errors: { rowNum: number; errMsg: string }[] = [];
    let successCount = 0;
    for (let index = 0; index < rows.length; index += 1) {
      const cells = rows[index].split(',');
      const standardTerm = cells[0]?.trim();
      if (!standardTerm) {
        errors.push({ rowNum: index + 2, errMsg: '标准术语不能为空' });
        continue;
      }
      await this.addTerm({
        catalogId,
        standardTerm,
        alsoCalled: cells[1]?.trim() ?? '',
        avoidThese: cells[2]?.trim() ?? '',
        useCase: cells[3]?.trim() ?? '',
        systemReference: cells[4]?.trim() ?? '',
        enable: true,
      }, organizationId, userId);
      successCount += 1;
    }
    return { failCount: errors.length, successCount, errorMessages: errors };
  }

  async pageDiscoveries(body: { current?: number; pageSize?: number }, organizationId: string, userId: string): Promise<Pager<Record<string, unknown>>> {
    if ((body.current ?? 1) <= 1) {
      await scanConversationTerms(organizationId, userId);
    }
    const page = normalizePage(body.current, body.pageSize);
    const total = await query<SqlRow & { total: number }>('SELECT COUNT(*) AS total FROM agent_term_discovery');
    const rows = await query<SqlRow>(
      'SELECT * FROM agent_term_discovery ORDER BY create_time DESC LIMIT ? OFFSET ?',
      [page.pageSize, (page.current - 1) * page.pageSize],
    );
    return toPager(rows.map((row) => ({
      id: row.id,
      freeTerm: row.free_term,
      source: row.source ?? '',
      reference: row.reference ?? '',
      createTime: Number(row.create_time),
    })), Number(total[0]?.total ?? 0), page);
  }

  async ignoreDiscovery(id: string): Promise<void> {
    await execute('DELETE FROM agent_term_discovery WHERE id = ?', [id]);
  }

  async adoptDiscovery(input: TermInput, organizationId: string, userId: string): Promise<Record<string, unknown>> {
    const rows = await query<SqlRow & { free_term: string }>('SELECT free_term FROM agent_term_discovery WHERE id = ?', [text(input.id)]);
    const found = rows[0];
    if (!found) {
      throw notFound('术语发现不存在');
    }
    const created = await this.addTerm({ ...input, standardTerm: text(input.standardTerm) || found.free_term }, organizationId, userId);
    await execute('DELETE FROM agent_term_discovery WHERE id = ?', [text(input.id)]);
    return created;
  }
}

function parseIds(raw: string | null | undefined): string[] {
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

function enableFilter(filters: Array<{ name?: string; value?: unknown }> | undefined): boolean | undefined {
  const item = filters?.find((filter) => filter.name === 'enable');
  if (!item) {
    return undefined;
  }
  const values = Array.isArray(item.value) ? item.value : [item.value];
  const flags = values.flatMap((value) => {
    if (value === true || value === 1 || value === 'true' || value === '1') {
      return [true];
    }
    if (value === false || value === 0 || value === 'false' || value === '0') {
      return [false];
    }
    return [];
  });
  if (flags.includes(true) && flags.includes(false)) {
    return undefined;
  }
  if (flags.includes(true)) {
    return true;
  }
  if (flags.includes(false)) {
    return false;
  }
  return undefined;
}

function modelSort(sort: { name?: string; type?: string } | undefined): string {
  const columns: Record<string, string> = {
    createTime: 'create_time',
    updateTime: 'update_time',
    createUser: 'create_user',
    updateUser: 'update_user',
  };
  const column = columns[sort?.name ?? ''] ?? 'update_time';
  return `${column} ${sort?.type === 'asc' ? 'ASC' : 'DESC'}`;
}

function startOfShanghaiDay(now = Date.now()): number {
  const shifted = new Date(now + 8 * 60 * 60 * 1000);
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - 8 * 60 * 60 * 1000;
}

async function removeModelFromStrategy(modelId: string, organizationId: string): Promise<void> {
  const rows = await query<SqlRow & { chat_models: string | null; task_models: string | null; fallback: number }>(
    'SELECT chat_models, task_models, fallback FROM agent_model_strategy WHERE id = ?',
    [organizationId],
  );
  const row = rows[0];
  if (!row) {
    return;
  }
  const chatModels = parseIds(row.chat_models).filter((id) => id !== modelId);
  const taskModels = parseIds(row.task_models).filter((id) => id !== modelId);
  await execute(
    `UPDATE agent_model_strategy SET chat_models = ?, task_models = ? WHERE id = ?`,
    [JSON.stringify(chatModels), JSON.stringify(taskModels), organizationId],
  );
}

function taskItem(row: SqlRow, names: Map<string, string>): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    triggerType: row.trigger_type,
    executionCondition: row.execution_condition ?? '',
    executionAction: row.execution_action ?? '',
    confirmationLevel: row.confirmation_level,
    applicableModel: row.applicable_model ?? '',
    enable: Number(row.enable) === 1,
    createUser: row.create_user,
    updateUser: row.update_user,
    createUserName: names.get(String(row.create_user)) ?? row.create_user,
    updateUserName: names.get(String(row.update_user)) ?? row.update_user,
    createTime: Number(row.create_time),
    updateTime: Number(row.update_time),
  };
}

function termItem(row: SqlRow, names: Map<string, string>): Record<string, unknown> {
  return {
    id: row.id,
    catalogId: row.catalog_id,
    catalogName: row.catalog_name ?? '',
    standardTerm: row.standard_term,
    alsoCalled: row.also_called ?? '',
    avoidThese: row.avoid_these ?? '',
    useCase: row.use_case ?? '',
    systemReference: row.system_reference ?? '',
    enable: Number(row.enable) === 1,
    createUserName: names.get(String(row.create_user)) ?? row.create_user,
    updateUserName: names.get(String(row.update_user)) ?? row.update_user,
    createTime: Number(row.create_time),
    updateTime: Number(row.update_time),
  };
}

async function requireTask(id: string, organizationId: string): Promise<SqlRow> {
  const rows = await query<SqlRow>('SELECT * FROM agent_task WHERE id = ? AND organization_id = ?', [id, organizationId]);
  if (!rows[0]) {
    throw notFound('任务不存在');
  }
  return rows[0];
}

async function requireCatalog(id: string, organizationId: string): Promise<void> {
  const rows = await query<SqlRow>('SELECT id FROM agent_term_catalog WHERE id = ? AND organization_id = ?', [id, organizationId]);
  if (!rows[0]) {
    throw notFound('术语分类不存在');
  }
}

async function requireTerm(id: string, organizationId: string): Promise<SqlRow> {
  const rows = await query<SqlRow>('SELECT * FROM agent_term WHERE id = ? AND organization_id = ?', [id, organizationId]);
  if (!rows[0]) {
    throw notFound('术语不存在');
  }
  return rows[0];
}

const TERM_STOP = new Set(['客户', '商机', '合同', '线索', '产品', '订单', '公司', '我们', '你们', '这个', '那个', '什么', '怎么', '可以', '没有', '不是', '一个', '进行', '需要', '问题', '谢谢', '你好', '请问', '一下', '目前', '已经']);

function collectTermCandidates(content: string): string[] {
  const quoted = [...content.matchAll(/[「『“"]([\u4e00-\u9fffA-Za-z0-9]{2,12})[」』”"]/g)].map((item) => item[1]);
  const segments = content.split(/[^\u4e00-\u9fff]+/).filter((part) => part.length >= 4 && part.length <= 8);
  return [...quoted, ...segments];
}

async function scanConversationTerms(organizationId: string, userId: string): Promise<void> {
  const messages = await query<SqlRow>(
    `SELECT m.content
     FROM agent_message m
     JOIN agent_conversation c ON c.id = m.conversation_id
     WHERE c.organization_id = ? AND m.role = 'USER'
     ORDER BY m.create_time DESC
     LIMIT 200`,
    [organizationId],
  );
  const samples = messages.map((row) => String(row.content ?? '')).filter(Boolean);
  const counts = new Map<string, number>();
  for (const sample of samples) {
    for (const phrase of collectTermCandidates(sample)) {
      if (!TERM_STOP.has(phrase)) {
        counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
      }
    }
  }
  const suggested = await suggestTerms(organizationId, userId, samples.slice(0, 40));
  for (const phrase of suggested) {
    if (!TERM_STOP.has(phrase)) {
      counts.set(phrase, Math.max(counts.get(phrase) ?? 0, 2));
    }
  }
  const known = await query<SqlRow>(
    'SELECT standard_term, also_called, avoid_these FROM agent_term WHERE organization_id = ?',
    [organizationId],
  );
  const found = await query<SqlRow>('SELECT free_term FROM agent_term_discovery');
  const defined = new Set<string>();
  for (const row of known) {
    for (const value of [row.standard_term, row.also_called, row.avoid_these]) {
      for (const part of String(value ?? '').split(/[,，、;；]/)) {
        const word = part.trim();
        if (word) {
          defined.add(word);
        }
      }
    }
  }
  for (const row of found) {
    defined.add(String(row.free_term ?? ''));
  }
  const candidates = [...counts.entries()]
    .filter(([word, count]) => count >= 2 && !defined.has(word))
    .sort((left, right) => right[1] - left[1])
    .slice(0, 10);
  const now = Date.now();
  for (const [word, count] of candidates) {
    await execute(
      'INSERT INTO agent_term_discovery (id, free_term, source, reference, create_time) VALUES (?, ?, ?, ?, ?)',
      [nextId(), word, '对话记录', `出现 ${count} 次`, now],
    );
  }
}

export const aiSettingService = new AiSettingService();
