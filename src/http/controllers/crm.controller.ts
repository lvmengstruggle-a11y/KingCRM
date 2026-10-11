import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { RowDataPacket } from 'mysql2';

import { getFormConfig, getFormSnapshot, saveFormConfig, type FormField } from '../../models/form.model.js';
import { addStage, deleteStage, listStages, renameStage, saveAdvanced, setCirculation, sortStages, updateStageRollback } from '../../models/stage.model.js';
import { deleteView, getView, listViews, moveView, saveView, toggleView } from '../../models/view.model.js';
import { entities, entityByPrefix, type EntitySpec } from '../../services/crm-catalog.js';
import { buildChart } from '../../services/chart.service.js';
import {
  cluePool,
  customerPool,
  deleteCapacity,
  deletePool,
  deleteRule,
  listCapacity,
  pagePools,
  pageRules,
  poolHasRecords,
  saveCapacity,
  savePool,
  saveRule,
  switchPool,
  switchRule,
} from '../../services/pool.service.js';
import {
  addEntity,
  asIds,
  asObject,
  assignRecords,
  batchEdit,
  entityOptions,
  entityStatistic,
  freezeRecord,
  getEntity,
  moveToPool,
  opportunityContacts,
  pageEntity,
  pickRecords,
  removeEntities,
  setFlag,
  transferOwners,
  updateEntity,
  updateStage,
} from '../../services/record.service.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { execute, query } from '../../support/db.js';
import { requireOrganization, requireUser } from '../../support/context.js';
import { nextId } from '../../support/id.js';
import { normalizePage, toPager } from '../../support/pager.js';
import { Permission } from '../../support/permission.js';
import { success } from '../../support/result.js';

const tab = { all: true, dept: true };

function formPermissions(entity: EntitySpec): string[] {
  if (entity.prefix === '/account') {
    return [Permission.CUSTOMER_MANAGEMENT_READ, Permission.CUSTOMER_MANAGEMENT_POOL_READ];
  }
  if (entity.prefix === '/lead') {
    return [Permission.CLUE_MANAGEMENT_READ, Permission.CLUE_MANAGEMENT_POOL_READ];
  }
  return entity.read;
}

function registerEntity(app: FastifyInstance, entity: EntitySpec): void {
  const read = { preHandler: requirePermission(...entity.read) };
  const add = { preHandler: requirePermission(...entity.add) };
  const update = { preHandler: requirePermission(...entity.update) };
  const remove = { preHandler: requirePermission(...entity.remove) };
  const base = entity.prefix;

  app.get(`${base}/module/form`, { preHandler: requirePermission(...formPermissions(entity)) }, async (request) => {
    return success(await getFormConfig(entity.formKey, requireOrganization(request)));
  });
  app.get(`${base}/module/form/snapshot`, { preHandler: requirePermission(...formPermissions(entity)) }, async (request) => {
    return success(await getFormConfig(entity.formKey, requireOrganization(request)));
  });
  if (entity.formSnapshot) {
    app.get(`${base}/module/form/snapshot/:id`, { preHandler: requirePermission(...formPermissions(entity)) }, async (request) => {
      const { id } = request.params as { id: string };
      return success(await getFormSnapshot(entity.formSnapshot!, entity.table, id, entity.formKey, requireOrganization(request)));
    });
  }
  app.get(`${base}/tab`, read, async () => success(tab));
  app.post(`${base}/page`, read, async (request) => {
    return success(await pageEntity(entity, requireOrganization(request), requireUser(request).id, request.body));
  });
  app.get(`${base}/get/:id`, read, async (request) => {
    const { id } = request.params as { id: string };
    return success(await getEntity(entity, id, requireOrganization(request), requireUser(request).id));
  });
  app.get(`${base}/get/snapshot/:id`, read, async (request) => {
    const { id } = request.params as { id: string };
    return success(await getEntity(entity, id, requireOrganization(request), requireUser(request).id));
  });
  app.post(`${base}/add`, add, async (request) => {
    return success(await addEntity(entity, requireOrganization(request), requireUser(request).id, request.body));
  });
  app.post(`${base}/update`, update, async (request) => {
    return success(await updateEntity(entity, requireOrganization(request), requireUser(request).id, request.body));
  });
  app.get(`${base}/delete/:id`, remove, async (request) => {
    const { id } = request.params as { id: string };
    await removeEntities(entity, requireOrganization(request), requireUser(request).id, [id]);
    return success(null);
  });
  app.post(`${base}/batch/delete`, remove, async (request) => {
    await removeEntities(entity, requireOrganization(request), requireUser(request).id, asIds(request.body));
    return success(null);
  });
  app.post(`${base}/batch/update`, update, async (request) => {
    await batchEdit(entity, requireOrganization(request), requireUser(request).id, request.body);
    return success(null);
  });
  app.post(`${base}/batch/transfer`, update, async (request) => {
    await transferOwners(entity, requireOrganization(request), requireUser(request).id, request.body);
    return success(null);
  });
  app.post(`${base}/statistic`, read, async (request) => {
    return success(await entityStatistic(entity, requireOrganization(request)));
  });
  app.post(`${base}/chart`, read, async (request) => {
    return success(await buildChart(entity, requireOrganization(request), request.body));
  });
  registerViews(app, base, entity.viewType, entity.read);

  if (entity.stageTable) {
    app.get(`${base}/stage/get`, read, async (request) => {
      return success(await listStages(entity.stageTable!, entity.table, requireOrganization(request)));
    });
    app.post(`${base}/stage/add`, { preHandler: requirePermission(Permission.MODULE_SETTING_UPDATE) }, async (request) => {
      const id = await addStage(entity.stageTable!, requireOrganization(request), requireUser(request).id, asObject(request.body));
      return success(id);
    });
    app.get(`${base}/stage/delete/:id`, { preHandler: requirePermission(Permission.MODULE_SETTING_UPDATE) }, async (request) => {
      const { id } = request.params as { id: string };
      await deleteStage(entity.stageTable!, entity.table, id, requireOrganization(request));
      return success(null);
    });
    app.post(`${base}/stage/update`, async (request, reply) => {
      const body = asObject(request.body);
      if (typeof body.stage === 'string' && body.stage !== '' && body.name == null) {
        await requirePermission(...entity.update)(request, reply);
        await updateStage(entity, requireOrganization(request), requireUser(request).id, body);
        return success(null);
      }
      await requirePermission(Permission.MODULE_SETTING_UPDATE)(request, reply);
      await renameStage(entity.stageTable!, requireOrganization(request), body);
      return success(null);
    });
    app.post(`${base}/stage/update-rollback`, { preHandler: requirePermission(Permission.MODULE_SETTING_UPDATE) }, async (request) => {
      await updateStageRollback(entity.stageTable!, requireOrganization(request), asObject(request.body));
      return success(null);
    });
    app.post(`${base}/update/stage`, update, async (request) => {
      await updateStage(entity, requireOrganization(request), requireUser(request).id, request.body);
      return success(null);
    });
    app.post(`${base}/stage/sort`, { preHandler: requirePermission(Permission.MODULE_SETTING_UPDATE) }, async (request) => {
      const ids = Array.isArray(request.body) ? request.body.map((item) => String(item)) : [];
      await sortStages(entity.stageTable!, requireOrganization(request), ids);
      return success(null);
    });
    app.get(`${base}/stage/circulation-type/:type`, { preHandler: requirePermission(Permission.MODULE_SETTING_UPDATE) }, async (request) => {
      const { type } = request.params as { type: string };
      await setCirculation(entity.stageTable!, requireOrganization(request), type);
      return success(null);
    });
    app.post(`${base}/stage/advanced/config`, { preHandler: requirePermission(Permission.MODULE_SETTING_UPDATE) }, async (request) => {
      await saveAdvanced(entity.stageTable!, requireOrganization(request), requireUser(request).id, asObject(request.body));
      return success(null);
    });
  }
}

function registerViews(app: FastifyInstance, base: string, resourceType: string, permissions: string[]): void {
  const guard = { preHandler: requirePermission(...permissions) };
  app.get(`${base}/view/list`, guard, async (request) => {
    const views = await listViews(resourceType, requireUser(request).id, requireOrganization(request));
    return success(views.map((view) => ({ id: view.id, name: view.name, fixed: view.fixed, enable: view.enable })));
  });
  app.get(`${base}/view/detail/:id`, guard, async (request) => {
    const { id } = request.params as { id: string };
    return success(await getView(id, requireOrganization(request)));
  });
  app.post(`${base}/view/add`, guard, async (request) => {
    const body = asObject(request.body);
    return success(await saveView({
      name: String(body.name ?? ''),
      resourceType,
      organizationId: requireOrganization(request),
      userId: requireUser(request).id,
      searchMode: typeof body.searchMode === 'string' ? body.searchMode : 'AND',
      conditions: Array.isArray(body.conditions) ? body.conditions as Array<Record<string, unknown>> : [],
    }));
  });
  app.post(`${base}/view/update`, guard, async (request) => {
    const body = asObject(request.body);
    return success(await saveView({
      id: String(body.id ?? ''),
      name: String(body.name ?? ''),
      resourceType,
      organizationId: requireOrganization(request),
      userId: requireUser(request).id,
      searchMode: typeof body.searchMode === 'string' ? body.searchMode : 'AND',
      conditions: Array.isArray(body.conditions) ? body.conditions as Array<Record<string, unknown>> : undefined,
    }));
  });
  app.get(`${base}/view/delete/:id`, guard, async (request) => {
    const { id } = request.params as { id: string };
    await deleteView(id, requireOrganization(request));
    return success(null);
  });
  app.get(`${base}/view/fixed/:id`, guard, async (request) => {
    const { id } = request.params as { id: string };
    await toggleView(id, requireOrganization(request), 'fixed');
    return success(null);
  });
  app.get(`${base}/view/enable/:id`, guard, async (request) => {
    const { id } = request.params as { id: string };
    await toggleView(id, requireOrganization(request), 'enable');
    return success(null);
  });
  app.post(`${base}/view/edit/pos`, guard, async (request) => {
    const body = asObject(request.body);
    await moveView({
      organizationId: requireOrganization(request),
      moveId: String(body.moveId ?? ''),
      targetId: String(body.targetId ?? ''),
      moveMode: String(body.moveMode ?? 'AFTER'),
    });
    return success(null);
  });
}

function registerFollowAlias(app: FastifyInstance, path: string, sourcePrefix: string): void {
  const entity = entityByPrefix(sourcePrefix);
  const guard = { preHandler: requirePermission(...entity.read) };
  app.post(`${path}/page`, guard, async (request) => {
    return success(await pageEntity(entity, requireOrganization(request), requireUser(request).id, request.body));
  });
  app.post(`${path}/add`, guard, async (request) => {
    return success(await addEntity(entity, requireOrganization(request), requireUser(request).id, request.body));
  });
  app.post(`${path}/update`, guard, async (request) => {
    return success(await updateEntity(entity, requireOrganization(request), requireUser(request).id, request.body));
  });
  app.get(`${path}/get/:id`, guard, async (request) => {
    const { id } = request.params as { id: string };
    return success(await getEntity(entity, id, requireOrganization(request), requireUser(request).id));
  });
  app.get(`${path}/delete/:id`, guard, async (request) => {
    const { id } = request.params as { id: string };
    await removeEntities(entity, requireOrganization(request), requireUser(request).id, [id]);
    return success(null);
  });
}

function registerComments(app: FastifyInstance, table: 'follow_up_record_comment' | 'follow_up_plan_comment', path: string): void {
  const guard = { preHandler: requirePermission(Permission.CUSTOMER_MANAGEMENT_READ, Permission.CLUE_MANAGEMENT_READ, Permission.OPPORTUNITY_MANAGEMENT_READ) };
  app.post(`${path}/page`, guard, async (request) => {
    const body = asObject(request.body);
    const page = normalizePage(Number(body.current), Number(body.pageSize));
    const resourceId = String(body.resourceId ?? body.followId ?? '');
    const organizationId = requireOrganization(request);
    const params: unknown[] = [organizationId];
    let where = 'organization_id = ?';
    if (resourceId) {
      where += ' AND resource_id = ?';
      params.push(resourceId);
    }
    const totals = await query<RowDataPacket & { total: number }>(`SELECT COUNT(*) AS total FROM ${table} WHERE ${where}`, params);
    const rows = await query<RowDataPacket>(
      `SELECT * FROM ${table} WHERE ${where} ORDER BY create_time DESC LIMIT ? OFFSET ?`,
      [...params, page.pageSize, (page.current - 1) * page.pageSize],
    );
    return success(toPager(rows.map((row) => ({
      id: row.id,
      resourceId: row.resource_id,
      parentId: row.parent_id,
      replyToUserId: row.reply_to_user_id,
      content: row.content,
      createUser: row.create_user,
      createTime: row.create_time,
      updateTime: row.update_time,
    })), Number(totals[0]?.total ?? 0), page));
  });
  app.post(`${path}/add`, guard, async (request) => {
    const body = asObject(request.body);
    const id = nextId();
    const now = Date.now();
    const userId = requireUser(request).id;
    await execute(
      `INSERT INTO ${table}
       (id, resource_id, parent_id, reply_to_user_id, content, organization_id, create_time, update_time, create_user, update_user)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, body.resourceId ?? body.followId ?? '', body.parentId ?? null, body.replyToUserId ?? null, String(body.content ?? ''), requireOrganization(request), now, now, userId, userId],
    );
    return success({ id });
  });
  app.post(`${path}/update`, guard, async (request) => {
    const body = asObject(request.body);
    await execute(`UPDATE ${table} SET content = ?, update_time = ?, update_user = ? WHERE id = ? AND organization_id = ?`, [
      String(body.content ?? ''),
      Date.now(),
      requireUser(request).id,
      String(body.id ?? ''),
      requireOrganization(request),
    ]);
    return success(null);
  });
  app.get(`${path}/delete/:id`, guard, async (request) => {
    const { id } = request.params as { id: string };
    await execute(`DELETE FROM ${table} WHERE id = ? AND organization_id = ?`, [id, requireOrganization(request)]);
    return success(null);
  });
}

async function ownerHistory(request: FastifyRequest): Promise<unknown[]> {
  const { id } = request.params as { id: string };
  const rows = await query<RowDataPacket>(
    `SELECT h.id, h.customer_id, h.owner, h.collection_time, h.end_time, h.operator, u.name AS owner_name
     FROM customer_owner h
     LEFT JOIN sys_user u ON u.id = h.owner
     WHERE h.customer_id = ?
     ORDER BY h.collection_time DESC`,
    [id],
  );
  return rows.map((row) => ({
    id: row.id,
    customerId: row.customer_id,
    owner: row.owner,
    ownerName: row.owner_name,
    collectionTime: row.collection_time,
    endTime: row.end_time,
    operator: row.operator,
  }));
}

export async function registerCrmRoutes(app: FastifyInstance): Promise<void> {
  for (const entity of entities) {
    registerEntity(app, entity);
  }

  const customer = entityByPrefix('/account');
  const clue = entityByPrefix('/lead');
  const opportunity = entityByPrefix('/opportunity');
  const contact = entityByPrefix('/account/contact');
  const plan = entityByPrefix('/follow/plan');
  const customerGuard = { preHandler: requirePermission(...customer.read) };
  const poolGuard = { preHandler: requirePermission(Permission.CUSTOMER_MANAGEMENT_POOL_READ, Permission.CUSTOMER_MANAGEMENT_READ) };
  const cluePoolGuard = { preHandler: requirePermission(Permission.CLUE_MANAGEMENT_POOL_READ, Permission.CLUE_MANAGEMENT_READ) };
  const moduleGuard = { preHandler: requirePermission(Permission.MODULE_SETTING_READ, Permission.MODULE_SETTING_UPDATE) };

  app.post('/account/option', customerGuard, async (request) => {
    return success(await entityOptions(customer, requireOrganization(request), requireUser(request).id, request.body));
  });
  app.get('/product/list/option', { preHandler: requirePermission(Permission.PRODUCT_MANAGEMENT_READ) }, async (request) => {
    const page = await entityOptions(entityByPrefix('/product'), requireOrganization(request), requireUser(request).id, { current: 1, pageSize: 500 });
    return success(page.list);
  });
  app.post('/account/to-pool', { preHandler: requirePermission(...customer.update) }, async (request) => {
    await moveToPool(customer, requireOrganization(request), requireUser(request).id, request.body);
    return success(null);
  });
  app.post('/account/batch/to-pool', { preHandler: requirePermission(...customer.update) }, async (request) => {
    await moveToPool(customer, requireOrganization(request), requireUser(request).id, request.body);
    return success(null);
  });
  app.post('/lead/to-pool', { preHandler: requirePermission(...clue.update) }, async (request) => {
    await moveToPool(clue, requireOrganization(request), requireUser(request).id, request.body);
    return success(null);
  });
  app.post('/lead/batch/to-pool', { preHandler: requirePermission(...clue.update) }, async (request) => {
    await moveToPool(clue, requireOrganization(request), requireUser(request).id, request.body);
    return success(null);
  });
  for (const [prefix, entity, guard] of [
    ['/pool/account', customer, poolGuard],
    ['/pool/lead', clue, cluePoolGuard],
  ] as const) {
    app.post(`${prefix}/pick`, guard, async (request) => {
      await pickRecords(entity, requireOrganization(request), requireUser(request).id, request.body);
      return success(null);
    });
    app.post(`${prefix}/batch-pick`, guard, async (request) => {
      await pickRecords(entity, requireOrganization(request), requireUser(request).id, request.body);
      return success(null);
    });
    app.post(`${prefix}/assign`, guard, async (request) => {
      await assignRecords(entity, requireOrganization(request), requireUser(request).id, request.body);
      return success(null);
    });
    app.post(`${prefix}/batch-assign`, guard, async (request) => {
      await assignRecords(entity, requireOrganization(request), requireUser(request).id, request.body);
      return success(null);
    });
    app.post(`${prefix}/freeze`, guard, async (request) => {
      await freezeRecord(entity, requireOrganization(request), requireUser(request).id, request.body, true);
      return success(null);
    });
    app.post(`${prefix}/unfreeze`, guard, async (request) => {
      await freezeRecord(entity, requireOrganization(request), requireUser(request).id, request.body, false);
      return success(null);
    });
    app.get(`${prefix}/options`, guard, async (request) => {
      const spec = prefix === '/pool/account' ? customerPool : cluePool;
      const page = await pagePools(spec, requireOrganization(request), { current: 1, pageSize: 500 });
      return success(page.list);
    });
    app.post(`${prefix}/batch-update`, guard, async (request) => {
      await batchEdit(entity, requireOrganization(request), requireUser(request).id, request.body);
      return success(null);
    });
    app.post(`${prefix}/batch-delete`, guard, async (request) => {
      await removeEntities(entity, requireOrganization(request), requireUser(request).id, asIds(request.body));
      return success(null);
    });
  }

  app.post('/account/opportunity/page', { preHandler: requirePermission(...opportunity.read) }, async (request) => {
    return success(await pageEntity(opportunity, requireOrganization(request), requireUser(request).id, request.body));
  });
  app.post('/contract/order/page', { preHandler: requirePermission(Permission.ORDER_READ) }, async (request) => {
    return success(await pageEntity(entityByPrefix('/order'), requireOrganization(request), requireUser(request).id, request.body));
  });
  app.post('/lead/transition/account/page', customerGuard, async (request) => {
    return success(await pageEntity(customer, requireOrganization(request), requireUser(request).id, request.body));
  });
  app.get('/opportunity/contact/list/:id', { preHandler: requirePermission(...opportunity.read) }, async (request) => {
    const { id } = request.params as { id: string };
    return success(await opportunityContacts(opportunity, contact, requireOrganization(request), requireUser(request).id, id));
  });
  app.get('/account/contact/list/:id', { preHandler: requirePermission(...contact.read) }, async (request) => {
    const { id } = request.params as { id: string };
    const page = await pageEntity(contact, requireOrganization(request), requireUser(request).id, { customerId: id, current: 1, pageSize: 500 });
    return success(page.list);
  });
  app.post('/account/contact/disable/:id', { preHandler: requirePermission(...contact.update) }, async (request) => {
    const { id } = request.params as { id: string };
    const body = asObject(request.body);
    await setFlag(contact, id, requireOrganization(request), requireUser(request).id, { enable: true, disableReason: body.reason ?? null });
    return success(null);
  });
  app.get('/account/contact/enable/:id', { preHandler: requirePermission(...contact.update) }, async (request) => {
    const { id } = request.params as { id: string };
    await setFlag(contact, id, requireOrganization(request), requireUser(request).id, { enable: false, disableReason: null });
    return success(null);
  });
  app.get('/account/contact/opportunity/check/:id', { preHandler: requirePermission(...contact.read) }, async (request) => {
    const { id } = request.params as { id: string };
    const rows = await query<RowDataPacket & { total: number }>(
      'SELECT COUNT(*) AS total FROM opportunity WHERE organization_id = ? AND contact_id = ?',
      [requireOrganization(request), id],
    );
    return success(Number(rows[0]?.total ?? 0) > 0);
  });
  app.post('/follow/plan/status/update', { preHandler: requirePermission(...plan.update) }, async (request) => {
    const body = asObject(request.body);
    await setFlag(plan, String(body.id ?? ''), requireOrganization(request), requireUser(request).id, { status: body.status ?? 'COMPLETED' });
    return success(null);
  });
  app.get('/follow/plan/cancel/:id', { preHandler: requirePermission(...plan.update) }, async (request) => {
    const { id } = request.params as { id: string };
    await setFlag(plan, id, requireOrganization(request), requireUser(request).id, { status: 'CANCELLED' });
    return success(null);
  });
  for (const prefix of ['/account/follow/plan', '/lead/follow/plan', '/opportunity/follow/plan']) {
    app.post(`${prefix}/status/update`, { preHandler: requirePermission(...plan.update) }, async (request) => {
      const body = asObject(request.body);
      await setFlag(plan, String(body.id ?? ''), requireOrganization(request), requireUser(request).id, { status: body.status ?? 'COMPLETED' });
      return success(null);
    });
    app.get(`${prefix}/cancel/:id`, { preHandler: requirePermission(...plan.update) }, async (request) => {
      const { id } = request.params as { id: string };
      await setFlag(plan, id, requireOrganization(request), requireUser(request).id, { status: 'CANCELLED' });
      return success(null);
    });
  }

  for (const [path, source] of [
    ['/account/follow/record', '/follow/record'],
    ['/account/follow/plan', '/follow/plan'],
    ['/lead/follow/record', '/follow/record'],
    ['/lead/follow/plan', '/follow/plan'],
    ['/opportunity/follow/record', '/follow/record'],
    ['/opportunity/follow/plan', '/follow/plan'],
    ['/account/follow/record/pool', '/follow/record'],
    ['/lead/follow/record/pool', '/follow/record'],
  ] as const) {
    registerFollowAlias(app, path, source);
  }

  registerComments(app, 'follow_up_record_comment', '/follow/record/comment');
  registerComments(app, 'follow_up_plan_comment', '/follow/plan/comment');

  app.get('/account/owner/history/list/:id', customerGuard, async (request) => success(await ownerHistory(request)));
  app.get('/lead/owner/history/list/:id', { preHandler: requirePermission(...clue.read) }, async () => success([]));
  app.get('/account/collaboration/list/:id', customerGuard, async (request) => {
    const { id } = request.params as { id: string };
    const rows = await query<RowDataPacket>(
      `SELECT c.id, c.user_id, c.customer_id, c.collaboration_type, c.create_time, u.name AS user_name
       FROM customer_collaboration c LEFT JOIN sys_user u ON u.id = c.user_id
       WHERE c.customer_id = ?`,
      [id],
    );
    return success(rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      customerId: row.customer_id,
      collaborationType: row.collaboration_type,
      userName: row.user_name,
      createTime: row.create_time,
    })));
  });
  app.post('/account/collaboration/add', { preHandler: requirePermission(...customer.update) }, async (request) => {
    const body = asObject(request.body);
    const id = nextId();
    const now = Date.now();
    const user = requireUser(request);
    await execute(
      `INSERT INTO customer_collaboration
       (id, create_time, update_time, create_user, update_user, user_id, customer_id, collaboration_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, now, now, user.id, user.id, String(body.userId ?? ''), String(body.customerId ?? ''), String(body.collaborationType ?? 'READ')],
    );
    return success({ id });
  });
  app.post('/account/collaboration/update', { preHandler: requirePermission(...customer.update) }, async (request) => {
    const body = asObject(request.body);
    await execute('UPDATE customer_collaboration SET collaboration_type = ?, update_time = ?, update_user = ? WHERE id = ?', [
      String(body.collaborationType ?? 'READ'),
      Date.now(),
      requireUser(request).id,
      String(body.id ?? ''),
    ]);
    return success(null);
  });
  app.get('/account/collaboration/delete/:id', { preHandler: requirePermission(...customer.update) }, async (request) => {
    const { id } = request.params as { id: string };
    await execute('DELETE FROM customer_collaboration WHERE id = ?', [id]);
    return success(null);
  });
  app.post('/account/collaboration/batch/delete', { preHandler: requirePermission(...customer.update) }, async (request) => {
    const ids = asIds(request.body);
    if (ids.length > 0) {
      await execute(`DELETE FROM customer_collaboration WHERE id IN (${ids.map(() => '?').join(', ')})`, ids);
    }
    return success(null);
  });
  app.get('/account/relation/list/:id', customerGuard, async (request) => {
    const { id } = request.params as { id: string };
    const rows = await query<RowDataPacket>(
      `SELECT r.id, r.source_customer_id, r.target_customer_id, r.create_time, c.name AS target_name
       FROM customer_relation r LEFT JOIN customer c ON c.id = r.target_customer_id
       WHERE r.source_customer_id = ?`,
      [id],
    );
    return success(rows.map((row) => ({
      id: row.id,
      customerId: row.target_customer_id,
      customerName: row.target_name,
      relationType: 'SUBSIDIARY',
      sourceCustomerId: row.source_customer_id,
      targetCustomerId: row.target_customer_id,
      targetCustomerName: row.target_name,
      createTime: row.create_time,
    })));
  });
  app.post('/account/relation/add/:id', { preHandler: requirePermission(...customer.update) }, async (request) => {
    const { id } = request.params as { id: string };
    const body = asObject(request.body);
    const relationId = nextId();
    await execute(
      'INSERT INTO customer_relation (id, source_customer_id, target_customer_id, create_time) VALUES (?, ?, ?, ?)',
      [relationId, id, String(body.targetCustomerId ?? body.customerId ?? ''), Date.now()],
    );
    return success({ id: relationId });
  });
  app.post('/account/relation/save/:id', { preHandler: requirePermission(...customer.update) }, async (request) => {
    const { id } = request.params as { id: string };
    const items = Array.isArray(request.body) ? request.body : [];
    await execute('DELETE FROM customer_relation WHERE source_customer_id = ?', [id]);
    for (const item of items) {
      const target = String(asObject(item).customerId ?? '');
      if (!target) {
        continue;
      }
      await execute(
        'INSERT INTO customer_relation (id, source_customer_id, target_customer_id, create_time) VALUES (?, ?, ?, ?)',
        [nextId(), id, target, Date.now()],
      );
    }
    return success(null);
  });
  app.post('/account/relation/update/:id', { preHandler: requirePermission(...customer.update) }, async (request) => {
    const { id } = request.params as { id: string };
    const body = asObject(request.body);
    await execute(
      'UPDATE customer_relation SET target_customer_id = ? WHERE id = ? AND source_customer_id = ?',
      [String(body.customerId ?? ''), String(body.id ?? ''), id],
    );
    return success(null);
  });
  app.get('/account/relation/delete/:id', { preHandler: requirePermission(...customer.update) }, async (request) => {
    const { id } = request.params as { id: string };
    await execute('DELETE FROM customer_relation WHERE id = ?', [id]);
    return success(null);
  });

  for (const [prefix, spec, guard] of [
    ['/account-pool', customerPool, moduleGuard],
    ['/lead-pool', cluePool, moduleGuard],
  ] as const) {
    app.post(`${prefix}/page`, guard, async (request) => success(await pagePools(spec, requireOrganization(request), request.body)));
    app.post(`${prefix}/add`, { preHandler: requirePermission(Permission.MODULE_SETTING_UPDATE) }, async (request) => {
      return success(await savePool(spec, requireOrganization(request), requireUser(request).id, request.body));
    });
    app.post(`${prefix}/update`, { preHandler: requirePermission(Permission.MODULE_SETTING_UPDATE) }, async (request) => {
      return success(await savePool(spec, requireOrganization(request), requireUser(request).id, request.body));
    });
    app.post(`${prefix}/quick-update`, { preHandler: requirePermission(Permission.MODULE_SETTING_UPDATE) }, async (request) => {
      return success(await savePool(spec, requireOrganization(request), requireUser(request).id, request.body));
    });
    app.get(`${prefix}/switch/:id`, { preHandler: requirePermission(Permission.MODULE_SETTING_UPDATE) }, async (request) => {
      const { id } = request.params as { id: string };
      await switchPool(spec, id, requireOrganization(request));
      return success(null);
    });
    app.get(`${prefix}/delete/:id`, { preHandler: requirePermission(Permission.MODULE_SETTING_UPDATE) }, async (request) => {
      const { id } = request.params as { id: string };
      await deletePool(spec, id, requireOrganization(request));
      return success(null);
    });
    app.get(`${prefix}/no-pick/:id`, guard, async (request) => {
      const { id } = request.params as { id: string };
      return success(await poolHasRecords(spec, id, requireOrganization(request)));
    });
  }

  app.post('/opportunity-rule/page', moduleGuard, async (request) => success(await pageRules(requireOrganization(request), request.body)));
  app.post('/opportunity-rule/add', { preHandler: requirePermission(Permission.MODULE_SETTING_UPDATE) }, async (request) => {
    return success(await saveRule(requireOrganization(request), requireUser(request).id, request.body));
  });
  app.post('/opportunity-rule/update', { preHandler: requirePermission(Permission.MODULE_SETTING_UPDATE) }, async (request) => {
    return success(await saveRule(requireOrganization(request), requireUser(request).id, request.body));
  });
  app.get('/opportunity-rule/switch/:id', { preHandler: requirePermission(Permission.MODULE_SETTING_UPDATE) }, async (request) => {
    const { id } = request.params as { id: string };
    await switchRule(id, requireOrganization(request));
    return success(null);
  });
  app.get('/opportunity-rule/delete/:id', { preHandler: requirePermission(Permission.MODULE_SETTING_UPDATE) }, async (request) => {
    const { id } = request.params as { id: string };
    await deleteRule(id, requireOrganization(request));
    return success(null);
  });
  app.get('/account-capacity/get', moduleGuard, async (request) => success(await listCapacity('customer_capacity', requireOrganization(request))));
  app.get('/lead-capacity/get', moduleGuard, async (request) => success(await listCapacity('clue_capacity', requireOrganization(request))));
  app.post('/account-capacity/add', { preHandler: requirePermission(Permission.MODULE_SETTING_UPDATE) }, async (request) => {
    return success(await saveCapacity('customer_capacity', requireOrganization(request), requireUser(request).id, request.body));
  });
  app.post('/lead-capacity/add', { preHandler: requirePermission(Permission.MODULE_SETTING_UPDATE) }, async (request) => {
    return success(await saveCapacity('clue_capacity', requireOrganization(request), requireUser(request).id, request.body));
  });
  app.post('/account-capacity/update', { preHandler: requirePermission(Permission.MODULE_SETTING_UPDATE) }, async (request) => {
    return success(await saveCapacity('customer_capacity', requireOrganization(request), requireUser(request).id, request.body));
  });
  app.post('/lead-capacity/update', { preHandler: requirePermission(Permission.MODULE_SETTING_UPDATE) }, async (request) => {
    return success(await saveCapacity('clue_capacity', requireOrganization(request), requireUser(request).id, request.body));
  });
  app.get('/account-capacity/delete/:id', { preHandler: requirePermission(Permission.MODULE_SETTING_UPDATE) }, async (request) => {
    const { id } = request.params as { id: string };
    await deleteCapacity('customer_capacity', id, requireOrganization(request));
    return success(null);
  });
  app.get('/lead-capacity/delete/:id', { preHandler: requirePermission(Permission.MODULE_SETTING_UPDATE) }, async (request) => {
    const { id } = request.params as { id: string };
    await deleteCapacity('clue_capacity', id, requireOrganization(request));
    return success(null);
  });

  app.get('/module/form/config/:formKey', { preHandler: requirePermission(Permission.MODULE_SETTING_UPDATE, Permission.PROCESS_SETTING_READ) }, async (request) => {
    const { formKey } = request.params as { formKey: string };
    return success(await getFormConfig(formKey, requireOrganization(request)));
  });
  app.post('/module/form/save', { preHandler: requirePermission(Permission.MODULE_SETTING_UPDATE) }, async (request) => {
    const body = asObject(request.body);
    const saved = await saveFormConfig({
      formKey: String(body.formKey ?? ''),
      organizationId: requireOrganization(request),
      userId: requireUser(request).id,
      fields: Array.isArray(body.fields) ? body.fields as FormField[] : undefined,
      formProp: body.formProp && typeof body.formProp === 'object' ? body.formProp as Record<string, unknown> : undefined,
    });
    return success(saved);
  });
  app.get('/module/form/related/:formKey', { preHandler: requirePermission(Permission.MODULE_SETTING_UPDATE, Permission.PROCESS_SETTING_READ) }, async () => success([]));
  app.post('/module/form/detail-tab', { preHandler: requirePermission(Permission.MODULE_SETTING_UPDATE, Permission.PROCESS_SETTING_READ) }, async (request) => {
    const body = asObject(request.body);
    const page = normalizePage(Number(body.current), Number(body.pageSize));
    return success(toPager([], 0, page));
  });
}
