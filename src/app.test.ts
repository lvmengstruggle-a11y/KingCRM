import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { buildApp } from './app.js';
import { pool } from './support/db.js';
import { sessionStore } from './support/session-store.js';
import type { SessionUser } from './support/session-user.js';

describe('http', () => {
  const appPromise = buildApp();

  after(async () => {
    const app = await appPromise;
    await app.close();
    await pool.end();
  });

  it('GET /health stays outside the result envelope', async () => {
    const app = await appPromise;
    const response = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: 'ok' });
  });

  it('GET /get-key returns the result envelope', async () => {
    const app = await appPromise;
    const response = await app.inject({ method: 'GET', url: '/get-key' });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.code, 100200);
    assert.equal(typeof body.data, 'string');
    assert.ok(body.data.length > 100);
  });

  it('GET /is-login without a session is 401', async () => {
    const app = await appPromise;
    const response = await app.inject({ method: 'GET', url: '/is-login' });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().code, 401);
    assert.equal(response.headers['authentication-status'], 'invalid');
  });

  it('POST /login rejects an empty body with 100400', async () => {
    const app = await appPromise;
    const response = await app.inject({
      method: 'POST',
      url: '/login',
      payload: {},
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().code, 100400);
  });

  it('an authenticated call to an unmigrated route answers 100404', async () => {
    const app = await appPromise;
    const user = sessionStore.create(fakeUser());
    const response = await app.inject({
      method: 'GET',
      url: '/customer/page',
      headers: { 'x-auth-token': user.sessionId },
    });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().code, 100404);
  });

  it('GET /department/tree without the organization permission is 403', async () => {
    const app = await appPromise;
    const user = sessionStore.create(fakeUser('staff'));
    const response = await app.inject({
      method: 'GET',
      url: '/department/tree',
      headers: {
        'x-auth-token': user.sessionId,
        'organization-id': 'org',
      },
    });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().code, 403);
  });

  it('POST /department/add rejects an empty body with 100400', async () => {
    const app = await appPromise;
    const user = sessionStore.create(fakeUser('admin'));
    const response = await app.inject({
      method: 'POST',
      url: '/department/add',
      headers: {
        'x-auth-token': user.sessionId,
        'csrf-token': user.csrfToken,
        'organization-id': 'org',
      },
      payload: {},
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().code, 100400);
  });

  it('GET /organization/settings/third-party returns an empty list for admin', async () => {
    const app = await appPromise;
    const user = sessionStore.create(fakeUser('admin'));
    const response = await app.inject({
      method: 'GET',
      url: '/organization/settings/third-party',
      headers: {
        'x-auth-token': user.sessionId,
        'organization-id': 'org',
      },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().data, []);
  });

  it('GET /organization/settings/email returns an empty mail config for an admin', async () => {
    const app = await appPromise;
    const user = sessionStore.create(fakeUser('admin'));
    const response = await app.inject({
      method: 'GET',
      url: '/organization/settings/email',
      headers: {
        'x-auth-token': user.sessionId,
        'organization-id': '100001',
      },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().data.host, '');
  });

  it('GET /message/task/get returns the message setting catalog for an admin', async () => {
    const app = await appPromise;
    const user = sessionStore.create(fakeUser('admin'));
    const response = await app.inject({
      method: 'GET',
      url: '/message/task/get',
      headers: {
        'x-auth-token': user.sessionId,
        'organization-id': '100001',
      },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.code, 100200);
    assert.ok(Array.isArray(body.data));
    assert.ok(body.data.length > 0);
    assert.equal(typeof body.data[0].moduleName, 'string');
    assert.ok(body.data[0].moduleName.length > 0);
  });

  it('GET /role/permission/setting returns the permission catalog for an admin', async () => {
    const app = await appPromise;
    const user = sessionStore.create(fakeUser('admin'));
    const response = await app.inject({
      method: 'GET',
      url: '/role/permission/setting',
      headers: {
        'x-auth-token': user.sessionId,
        'organization-id': 'org',
      },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.code, 100200);
    assert.ok(Array.isArray(body.data));
    assert.ok(body.data.length > 0);
    assert.equal(typeof body.data[0].name, 'string');
  });

  it('GET /account/module/form and POST /account/page are migrated', async () => {
    const app = await appPromise;
    const user = sessionStore.create(fakeUser('admin'));
    const headers = {
      'x-auth-token': user.sessionId,
      'csrf-token': user.csrfToken,
      'organization-id': 'org',
    };
    const form = await app.inject({ method: 'GET', url: '/account/module/form', headers });
    assert.equal(form.statusCode, 200);
    assert.equal(form.json().code, 100200);
    assert.ok(Array.isArray(form.json().data.fields));

    const page = await app.inject({
      method: 'POST',
      url: '/account/page',
      headers,
      payload: { current: 1, pageSize: 10 },
    });
    assert.equal(page.statusCode, 200);
    assert.equal(page.json().code, 100200);
    assert.ok(Array.isArray(page.json().data.list));

    const created = await app.inject({
      method: 'POST',
      url: '/account/add',
      headers,
      payload: { name: 'node-migration-customer' },
    });
    assert.equal(created.statusCode, 200, created.body);
    assert.equal(created.json().code, 100200);
    const id = created.json().data.id as string;
    assert.equal(typeof id, 'string');

    const removed = await app.inject({ method: 'GET', url: `/account/delete/${id}`, headers });
    assert.equal(removed.statusCode, 200);
    assert.equal(removed.json().code, 100200);
  });

  it('home statistic, dashboard and agent folders are migrated', async () => {
    const app = await appPromise;
    const user = sessionStore.create(fakeUser('admin'));
    const headers = {
      'x-auth-token': user.sessionId,
      'csrf-token': user.csrfToken,
      'organization-id': 'org',
    };
    const lead = await app.inject({
      method: 'POST',
      url: '/home/statistic/lead',
      headers,
      payload: { searchType: 'ALL', deptIds: [], userField: 'OWNER' },
    });
    assert.equal(lead.statusCode, 200, lead.body);
    assert.equal(lead.json().code, 100200);
    assert.equal(typeof lead.json().data.todayClue.value, 'number');
    assert.equal(typeof lead.json().data.thisYearClue.value, 'number');

    const folder = await app.inject({
      method: 'POST',
      url: '/dashboard/module/add',
      headers,
      payload: { parentId: 'NONE', name: 'node-dashboard-folder' },
    });
    assert.equal(folder.statusCode, 200, folder.body);
    const moduleId = folder.json().data.id as string;

    const board = await app.inject({
      method: 'POST',
      url: '/dashboard/add',
      headers,
      payload: {
        dashboardModuleId: moduleId,
        name: 'node-dashboard',
        resourceUrl: 'https://example.com/board',
        scopeIds: [],
        description: '',
      },
    });
    assert.equal(board.statusCode, 200, board.body);
    const boardId = board.json().data.id as string;
    const tree = await app.inject({ method: 'GET', url: '/dashboard/module/tree', headers });
    assert.equal(tree.json().code, 100200);
    assert.ok(Array.isArray(tree.json().data));
    await app.inject({ method: 'GET', url: `/dashboard/delete/${boardId}`, headers });
    await app.inject({ method: 'POST', url: '/dashboard/module/delete', headers, payload: [moduleId] });

    const agentModule = await app.inject({
      method: 'POST',
      url: '/agent/module/add',
      headers,
      payload: { parentId: 'NONE', name: 'node-agent-folder' },
    });
    assert.equal(agentModule.statusCode, 200, agentModule.body);
    const agentModuleId = agentModule.json().data.id as string;
    const agent = await app.inject({
      method: 'POST',
      url: '/agent/add',
      headers,
      payload: {
        agentModuleId,
        name: 'node-agent',
        scopeIds: [],
        script: '<div></div>',
        type: 'SCRIPT',
        description: '',
      },
    });
    assert.equal(agent.statusCode, 200, agent.body);
    const workspace = await app.inject({ method: 'GET', url: '/agent/workspace', headers });
    assert.equal(workspace.json().code, 100200);
    assert.ok(Array.isArray(workspace.json().data));
    await app.inject({ method: 'GET', url: `/agent/delete/${agent.json().data.id}`, headers });
    await app.inject({ method: 'POST', url: '/agent/module/delete', headers, payload: [agentModuleId] });
  });

  it('approval flow can be created, listed and deleted', async () => {
    const app = await appPromise;
    const user = sessionStore.create(fakeUser('admin'));
    const headers = {
      'x-auth-token': user.sessionId,
      'csrf-token': user.csrfToken,
      'organization-id': 'org',
    };
    const created = await app.inject({
      method: 'POST',
      url: '/approval-flow/add',
      headers,
      payload: {
        name: 'node-approval-flow',
        formType: 'quotation',
        createExecute: true,
        updateExecute: false,
        deleteExecute: false,
        enable: true,
        statusPermissions: [],
        createNodeConfig: {
          nodes: [
            { id: 'start', name: '开始', nodeType: 'START' },
            {
              id: 'approve',
              name: '审批',
              nodeType: 'APPROVER',
              approvalType: 'MANUAL',
              multiApproverMode: 'ALL',
              emptyApproverAction: 'AUTO_PASS',
              sameSubmitterAction: 'SKIP',
              approverType: 'MEMBER',
              approverList: ['admin'],
            },
            { id: 'end', name: '结束', nodeType: 'END' },
          ],
          links: [
            { fromNodeId: 'start', toNodeId: 'approve' },
            { fromNodeId: 'approve', toNodeId: 'end' },
          ],
        },
      },
    });
    assert.equal(created.statusCode, 200, created.body);
    assert.equal(created.json().code, 100200);
    const id = created.json().data.id as string;
    assert.equal(created.json().data.createNodeConfig.nodes.length, 3);

    const page = await app.inject({
      method: 'POST',
      url: '/approval-flow/page',
      headers,
      payload: { current: 1, pageSize: 10, keyword: 'node-approval-flow' },
    });
    assert.equal(page.json().code, 100200);
    assert.ok(page.json().data.list.some((item: { id: string }) => item.id === id));

    const pending = await app.inject({
      method: 'POST',
      url: '/approval-todo/pending/page',
      headers,
      payload: { current: 1, pageSize: 10, resourceType: 'ALL' },
    });
    assert.equal(pending.json().code, 100200);
    assert.ok(Array.isArray(pending.json().data.list));

    const removedFlow = await app.inject({ method: 'GET', url: `/approval-flow/delete/${id}`, headers });
    assert.equal(removedFlow.json().code, 100200);
  });

  it('model, term and page settings can be saved', async () => {
    const app = await appPromise;
    const user = sessionStore.create(fakeUser('admin'));
    const headers = {
      'x-auth-token': user.sessionId,
      'csrf-token': user.csrfToken,
      'organization-id': 'org',
    };
    const model = await app.inject({
      method: 'POST',
      url: '/agent-model/add',
      headers,
      payload: { displayName: 'node-model', modelName: 'gpt-test', provider: 'OpenAI', apiKey: 'sk-test', enable: true },
    });
    assert.equal(model.statusCode, 200, model.body);
    const modelId = model.json().data.id as string;
    const models = await app.inject({
      method: 'POST',
      url: '/agent-model/page',
      headers,
      payload: { current: 1, pageSize: 10, keyword: 'node-model' },
    });
    assert.equal(models.json().code, 100200);
    assert.ok(models.json().data.list.some((item: { id: string }) => item.id === modelId));
    await app.inject({ method: 'GET', url: `/agent-model/delete/${modelId}`, headers });

    const catalog = await app.inject({
      method: 'POST',
      url: '/agent-term-catalog/add',
      headers,
      payload: { name: 'node-term-catalog' },
    });
    assert.equal(catalog.statusCode, 200, catalog.body);
    const catalogId = catalog.json().data.id as string;
    const term = await app.inject({
      method: 'POST',
      url: '/agent-term/add',
      headers,
      payload: { catalogId, standardTerm: '客户', alsoCalled: '账号', avoidThese: '', useCase: '', systemReference: '', enable: true },
    });
    assert.equal(term.statusCode, 200, term.body);
    await app.inject({ method: 'GET', url: `/agent-term/delete/${term.json().data.id}`, headers });
    await app.inject({ method: 'GET', url: `/agent-term-catalog/delete/${catalogId}`, headers });

    const saved = await app.inject({
      method: 'POST',
      url: '/ui/display/save',
      headers,
      payload: [{ paramKey: 'ui.title', paramValue: 'Node CRM', type: 'text' }],
    });
    assert.equal(saved.statusCode, 200, saved.body);
    const info = await app.inject({ method: 'GET', url: '/ui/display/info', headers });
    assert.equal(info.json().code, 100200);
    assert.ok(info.json().data.some((item: { paramKey: string; paramValue: string }) => item.paramKey === 'ui.title' && item.paramValue === 'Node CRM'));
  });

  it('search config, field source and customer child pages are registered', async () => {
    const app = await appPromise;
    const user = sessionStore.create(fakeUser('admin'));
    const headers = {
      'x-auth-token': user.sessionId,
      'csrf-token': user.csrfToken,
      'organization-id': 'org',
    };
    const saved = await app.inject({
      method: 'POST',
      url: '/search/config/save',
      headers,
      payload: { searchFields: { searchAdvancedCustomer: ['name'] }, resultDisplay: true, sortSetting: ['searchAdvancedCustomer'] },
    });
    assert.equal(saved.statusCode, 200, saved.body);
    const config = await app.inject({ method: 'GET', url: '/search/config/get', headers });
    assert.equal(config.json().code, 100200);
    assert.deepEqual(config.json().data.searchFields.searchAdvancedCustomer, ['name']);
    assert.equal(config.json().data.resultDisplay, true);
    await app.inject({ method: 'GET', url: '/search/config/reset', headers });

    const source = await app.inject({
      method: 'POST',
      url: '/field/source/account',
      headers,
      payload: { current: 1, pageSize: 10 },
    });
    assert.equal(source.statusCode, 200, source.body);
    assert.equal(source.json().code, 100200);
    assert.ok(Array.isArray(source.json().data.list));

    const counts = await app.inject({
      method: 'POST',
      url: '/global/search/module/count?keyword=node',
      headers,
    });
    assert.equal(counts.json().code, 100200);
    assert.equal(counts.json().data.length, 6);

    const child = await app.inject({
      method: 'POST',
      url: '/account/contract/page',
      headers,
      payload: { customerId: 'missing', current: 1, pageSize: 10 },
    });
    assert.equal(child.statusCode, 200, child.body);
    assert.equal(child.json().data.total, 0);
  });

  it('custom form, merge guard and export center are available', async () => {
    const app = await appPromise;
    const user = sessionStore.create(fakeUser('admin'));
    const headers = {
      'x-auth-token': user.sessionId,
      'csrf-token': user.csrfToken,
      'organization-id': 'org',
    };
    const created = await app.inject({
      method: 'POST',
      url: '/custom-form/add',
      headers,
      payload: { name: 'node-custom-form', enable: true, fields: [], formProp: {} },
    });
    assert.equal(created.statusCode, 200, created.body);
    const formId = created.json().data.id as string;
    const list = await app.inject({ method: 'GET', url: '/custom-form/list', headers });
    assert.equal(list.json().code, 100200);
    assert.ok(list.json().data.some((item: { id: string }) => item.id === formId));
    const added = await app.inject({
      method: 'POST',
      url: '/custom-form/data/add',
      headers,
      payload: { customFormId: formId, name: 'node-row', owner: 'admin', moduleFields: [] },
    });
    assert.equal(added.statusCode, 200, added.body);
    await app.inject({ method: 'GET', url: `/custom-form/delete/${formId}`, headers });

    const merge = await app.inject({
      method: 'POST',
      url: '/account/merge',
      headers,
      payload: { mergeIds: [], toMergeId: 'missing', ownerId: 'admin' },
    });
    assert.equal(merge.statusCode, 400);

    const tasks = await app.inject({ method: 'POST', url: '/export/center/list', headers, payload: {} });
    assert.equal(tasks.json().code, 100200);
    assert.ok(Array.isArray(tasks.json().data));
  });

  it('charts, business title config, chat and remaining pages answer', async () => {
    const app = await appPromise;
    const user = sessionStore.create(fakeUser('admin'));
    const headers = {
      'x-auth-token': user.sessionId,
      'csrf-token': user.csrfToken,
      'organization-id': 'org',
    };
    const chart = await app.inject({
      method: 'POST',
      url: '/account/chart',
      headers,
      payload: { chartConfig: { categoryAxis: { fieldId: 'owner' }, valueAxis: { aggregateMethod: 'COUNT' } } },
    });
    assert.equal(chart.statusCode, 200, chart.body);
    assert.ok(Array.isArray(chart.json().data));

    const titles = await app.inject({ method: 'GET', url: '/business-title/config/get', headers });
    assert.equal(titles.statusCode, 200, titles.body);
    assert.ok(titles.json().data.length > 0);

    const chat = await app.inject({
      method: 'POST',
      url: '/agent/chat/stream',
      headers,
      payload: { message: '今天有哪些客户', requestId: 'req-1' },
    });
    assert.equal(chat.statusCode, 200, chat.body);
    assert.match(chat.body, /event: run/);
    assert.match(chat.body, /event: chunk/);

    const conversations = await app.inject({
      method: 'POST',
      url: '/agent-conversation/page',
      headers,
      payload: { current: 1, pageSize: 10 },
    });
    assert.equal(conversations.statusCode, 200, conversations.body);
    const conversationId = conversations.json().data.list[0]?.id as string;
    assert.ok(conversationId);
    const removed = await app.inject({ method: 'GET', url: `/agent-conversation/delete/${conversationId}`, headers });
    assert.equal(removed.statusCode, 200, removed.body);

    const overview = await app.inject({ method: 'POST', url: '/smart/data-overview', headers, payload: {} });
    assert.equal(overview.statusCode, 200, overview.body);
    assert.match(overview.json().data, /客户/);

    const mail = await app.inject({
      method: 'POST',
      url: '/personal/center/mail/code/send?email=a@example.com',
      headers,
    });
    assert.equal(mail.statusCode, 400, mail.body);

    const sso = await app.inject({ method: 'GET', url: '/sso/callback/oauth/state/login' });
    assert.equal(sso.statusCode, 200, sso.body);
    assert.equal(typeof sso.json().data, 'string');
  });

  it('demo data can be created and cleared in one step', async () => {
    const app = await appPromise;
    const user = sessionStore.create(fakeUser('admin'));
    const headers = {
      'x-auth-token': user.sessionId,
      'csrf-token': user.csrfToken,
      'organization-id': '100001',
    };
    const created = await app.inject({ method: 'POST', url: '/system/demo-data', headers });
    assert.equal(created.statusCode, 200, created.body);
    const counts = created.json().data;
    assert.ok(counts.products >= 8);
    assert.ok(counts.customers >= 12);
    assert.ok(counts.clues >= 18);
    assert.ok(counts.opportunities >= 12);
    assert.ok(counts.contracts >= 8);
    assert.ok(counts.orders >= 8);
    const cleared = await app.inject({ method: 'POST', url: '/system/demo-data/clear', headers });
    assert.equal(cleared.statusCode, 200, cleared.body);
    assert.deepEqual(cleared.json().data, {
      products: 0,
      customers: 0,
      clues: 0,
      opportunities: 0,
      contracts: 0,
      orders: 0,
    });
  });
});

function fakeUser(id = 'admin'): Omit<SessionUser, 'sessionId' | 'csrfToken'> {
  return {
    id,
    name: 'admin',
    email: null,
    password: '',
    enable: true,
    createTime: 0,
    updateTime: 0,
    language: 'zh-CN',
    lastOrganizationId: 'org',
    phone: null,
    source: 'LOCAL',
    createUser: 'admin',
    updateUser: 'admin',
    platformInfo: null,
    avatar: null,
    permissionIds: [],
    organizationIds: ['org'],
    roles: [],
    departmentId: null,
    departmentName: null,
    defaultPwd: false,
  };
}
