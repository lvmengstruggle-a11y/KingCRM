import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { entityByPrefix, type EntitySpec } from '../../services/crm-catalog.js';
import {
  addCustomForm,
  addFormData,
  batchUpdateFormData,
  canCreate,
  deleteCustomForm,
  deleteFormData,
  getAdmins,
  getCustomForm,
  getFormData,
  listCustomForms,
  listRoles,
  pageFormData,
  pageRoleUsers,
  relateMembers,
  removeMembers,
  setAdmins,
  setCustomFormEnable,
  updateCustomForm,
  updateFormData,
} from '../../services/custom-form.service.js';
import { employeeService } from '../../services/employee.service.js';
import { roleAdminService } from '../../services/role-admin.service.js';
import {
  batchQuotation,
  cancelExport,
  exportFile,
  exportRecords,
  importRows,
  importTitles,
  importUsers,
  listExportTasks,
  mergeCustomers,
  personalPlans,
  readSheet,
  retransitionLeads,
  revokeApproval,
  setQuotationState,
  templateCsv,
  transitionLead,
  type SheetCheck,
} from '../../services/transfer.service.js';
import { requireOrganization, requireUser } from '../../support/context.js';
import { forbidden, validateFailed } from '../../support/errors.js';
import { parseMultipart } from '../../support/multipart.js';
import { Permission } from '../../support/permission.js';
import { success } from '../../support/result.js';
import { asIds, pageEntity } from '../../services/record.service.js';
import { requirePermission } from '../middleware/permission.middleware.js';

const customerWrite = { preHandler: requirePermission(Permission.CUSTOMER_MANAGEMENT_UPDATE) };
const clueWrite = { preHandler: requirePermission(Permission.CLUE_MANAGEMENT_UPDATE) };
const opportunityWrite = { preHandler: requirePermission(Permission.OPPORTUNITY_MANAGEMENT_UPDATE) };
const moduleWrite = { preHandler: requirePermission(Permission.MODULE_SETTING_UPDATE) };
const contractWrite = { preHandler: requirePermission(Permission.CONTRACT_UPDATE) };

function plainSpec(table: string): EntitySpec {
  return {
    prefix: '',
    table,
    formKey: table,
    viewType: table,
    keywordColumns: ['name'],
    read: [],
    add: [],
    update: [],
    remove: [],
  };
}

export async function registerFinishRoutes(app: FastifyInstance): Promise<void> {
  app.post('/custom-form/add', moduleWrite, async (request) => success(await addCustomForm(requireOrganization(request), requireUser(request).id, request.body)));
  app.post('/custom-form/update', moduleWrite, async (request) => {
    await updateCustomForm(requireOrganization(request), requireUser(request).id, request.body);
    return success(null);
  });
  app.get('/custom-form/get/:id', async (request) => success(await getCustomForm((request.params as { id: string }).id, requireOrganization(request))));
  app.get('/custom-form/list', async (request) => success(await listCustomForms(requireOrganization(request), requireUser(request).id, false)));
  app.get('/custom-form/option', async (request) => success(await listCustomForms(requireOrganization(request), requireUser(request).id, true)));
  app.get('/custom-form/delete/:id', moduleWrite, async (request) => {
    await deleteCustomForm((request.params as { id: string }).id, requireOrganization(request));
    return success(null);
  });
  app.get('/custom-form/enable/:id', moduleWrite, async (request) => {
    await setCustomFormEnable((request.params as { id: string }).id, requireOrganization(request), requireUser(request).id, true);
    return success(null);
  });
  app.get('/custom-form/disable/:id', moduleWrite, async (request) => {
    await setCustomFormEnable((request.params as { id: string }).id, requireOrganization(request), requireUser(request).id, false);
    return success(null);
  });
  app.get('/custom-form/admin/get/:id', async (request) => success(await getAdmins((request.params as { id: string }).id)));
  app.post('/custom-form/admin/set', moduleWrite, async (request) => {
    await setAdmins(request.body);
    return success(null);
  });
  app.get('/custom-form/role/list/:id', async (request) => success(await listRoles((request.params as { id: string }).id)));
  app.post('/custom-form/role/users', async (request) => success(await pageRoleUsers(requireOrganization(request), request.body)));
  app.post('/custom-form/role/user/add', moduleWrite, async (request) => {
    await relateMembers(requireOrganization(request), requireUser(request).id, request.body);
    return success(null);
  });
  app.post('/custom-form/role/user/remove', moduleWrite, async (request) => {
    await removeMembers(request.body);
    return success(null);
  });
  app.get('/custom-form/role/user/dept/tree', async (request) => success(await employeeService.deptUserTree(requireOrganization(request), false)));
  app.get('/custom-form/role/user/role/tree', async (request) => success(await roleAdminService.roleTree(requireOrganization(request))));
  app.get('/custom-form/data/create-permission/:id', async (request) => success(await canCreate((request.params as { id: string }).id, requireUser(request).id)));
  app.post('/custom-form/data/add', async (request) => {
    await assertCreate(request);
    return success(await addFormData(requireOrganization(request), requireUser(request).id, request.body));
  });
  app.post('/custom-form/data/update', async (request) => {
    await updateFormData(requireOrganization(request), requireUser(request).id, request.body);
    return success(null);
  });
  app.post('/custom-form/data/page', async (request) => success(await pageFormData(requireOrganization(request), requireUser(request).id, request.body)));
  app.get('/custom-form/data/get/:id', async (request) => success(await getFormData((request.params as { id: string }).id, requireOrganization(request), requireUser(request).id)));
  app.get('/custom-form/data/delete/:id', async (request) => {
    await deleteFormData([(request.params as { id: string }).id], requireOrganization(request));
    return success(null);
  });
  app.post('/custom-form/data/batch/delete', async (request) => {
    await deleteFormData(asIds(request.body), requireOrganization(request));
    return success(null);
  });
  app.post('/custom-form/data/batch/update', async (request) => {
    await batchUpdateFormData(requireOrganization(request), requireUser(request).id, request.body);
    return success(null);
  });

  app.post('/account/merge', customerWrite, async (request) => {
    await mergeCustomers(requireOrganization(request), requireUser(request).id, request.body);
    return success(null);
  });
  app.post('/account/merge/page', { preHandler: requirePermission(Permission.CUSTOMER_MANAGEMENT_READ) }, async (request) => {
    return success(await pageEntity(entityByPrefix('/account'), requireOrganization(request), requireUser(request).id, request.body));
  });
  app.post('/lead/transition/account', clueWrite, async (request) => success(await transitionLead(requireOrganization(request), requireUser(request).id, request.body)));
  app.post('/lead/re-transition/account', clueWrite, async (request) => {
    await retransitionLeads(requireOrganization(request), requireUser(request).id, request.body);
    return success(null);
  });

  app.get('/opportunity/quotation/voided/:id', opportunityWrite, async (request) => {
    await setQuotationState(requireOrganization(request), requireUser(request).id, (request.params as { id: string }).id, 'void');
    return success(null);
  });
  app.get('/opportunity/quotation/revoke/:id', opportunityWrite, async (request) => {
    await setQuotationState(requireOrganization(request), requireUser(request).id, (request.params as { id: string }).id, 'revoke');
    return success(null);
  });
  app.post('/opportunity/quotation/approve', opportunityWrite, async (request) => {
    const id = String((request.body as { id?: string }).id ?? '');
    await setQuotationState(requireOrganization(request), requireUser(request).id, id, 'approve', request.body);
    return success(null);
  });
  app.post('/opportunity/quotation/batch/approve', opportunityWrite, async (request) => success(await batchQuotation(requireOrganization(request), requireUser(request).id, request.body, 'approve')));
  app.post('/opportunity/quotation/batch/voided', opportunityWrite, async (request) => success(await batchQuotation(requireOrganization(request), requireUser(request).id, request.body, 'void')));
  app.get('/opportunity/quotation/download/:id', { preHandler: requirePermission(Permission.OPPORTUNITY_MANAGEMENT_READ) }, async () => success(null));
  app.get('/contract/revoke/:id', contractWrite, async (request) => {
    await revokeApproval('contract', requireOrganization(request), requireUser(request).id, (request.params as { id: string }).id);
    return success(null);
  });
  app.get('/invoice/revoke/:id', contractWrite, async (request) => {
    await revokeApproval('contract_invoice', requireOrganization(request), requireUser(request).id, (request.params as { id: string }).id);
    return success(null);
  });
  app.get('/contract/business-title/revoke/:id', contractWrite, async (request) => {
    await revokeApproval('business_title', requireOrganization(request), requireUser(request).id, (request.params as { id: string }).id);
    return success(null);
  });

  app.post('/personal/center/follow/plan/list', async (request) => success(await personalPlans(requireOrganization(request), requireUser(request).id, request.body)));
  app.post('/export/center/list', async (request) => success(await listExportTasks(requireOrganization(request), requireUser(request).id, request.body)));
  app.get('/export/center/download/:id', async (request, reply) => {
    const file = await exportFile((request.params as { id: string }).id, requireOrganization(request));
    reply.type('text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"`);
    return file.data;
  });
  app.get('/export/center/cancel/:id', async (request) => {
    await cancelExport((request.params as { id: string }).id, requireOrganization(request), requireUser(request).id);
    return success(null);
  });

  registerExchange(app, '/account', '/account', 'customer', ['名称']);
  registerExchange(app, '/pool/account', '/pool/account', 'customer_pool', ['名称']);
  registerExchange(app, '/account/contact', '/account/contact', 'contact', ['名称', '手机号']);
  registerExchange(app, '/lead', '/lead', 'clue', ['名称', '手机号'], { all: '/lead/export' });
  registerExchange(app, '/pool/lead', '/pool/lead', 'clue_pool', ['名称', '手机号']);
  registerExchange(app, '/opportunity', '/opportunity', 'opportunity', ['名称']);
  registerExchange(app, '/product', '/product', 'product', ['名称']);
  registerExchange(app, '/price', '/price', 'price', ['名称'], { all: '/price/export' });
  registerExchange(app, '/contract', '/contract', 'contract', ['名称']);
  registerExchange(app, '/contract/payment-plan', '/contract/payment-plan', 'payment_plan', ['名称']);
  registerExchange(app, '/contract/payment-record', '/contract/payment-record', 'payment_record', ['名称']);
  registerExchange(app, '/invoice', '/invoice', 'invoice', ['名称']);
  registerExchange(app, '/order', '/order', 'order', ['名称']);
  registerTitleExchange(app);
  registerCustomExchange(app);
  app.post('/user/import/pre-check', { preHandler: requirePermission(Permission.SYS_ORGANIZATION_ADD) }, async (request) => {
    const sheet = await sheetOf(request);
    return success(sheetResult(sheet));
  });
  app.post('/user/import', { preHandler: requirePermission(Permission.SYS_ORGANIZATION_ADD) }, async (request) => {
    const sheet = await sheetOf(request);
    const imported = await importUsers(requireOrganization(request), requireUser(request).id, sheet.rows);
    return success(sheetResult(imported));
  });
  app.get('/user/template/download', { preHandler: requirePermission(Permission.SYS_ORGANIZATION_READ) }, async (_request, reply) => sendCsv(reply, ['姓名', '手机号', '邮箱', '部门']));
}

function registerExchange(app: FastifyInstance, prefix: string, entityPrefix: string, resource: string, headers: string[], paths?: { all?: string }): void {
  const spec = entityByPrefix(entityPrefix);
  const read = { preHandler: requirePermission(...spec.read) };
  const add = { preHandler: requirePermission(...spec.add) };
  const all = paths?.all ?? `${prefix}/export-all`;
  app.post(all, read, async (request) => success(await exportRecords(spec, requireOrganization(request), requireUser(request).id, request.body, resource, false)));
  app.post(`${prefix}/export-select`, read, async (request) => success(await exportRecords(spec, requireOrganization(request), requireUser(request).id, request.body, resource, true)));
  app.get(`${prefix}/template/download`, read, async (_request, reply) => sendCsv(reply, headers));
  app.post(`${prefix}/import/pre-check`, add, async (request) => success(sheetResult(await sheetOf(request))));
  app.post(`${prefix}/import`, add, async (request) => {
    const sheet = await sheetOf(request);
    await importRows(spec, requireOrganization(request), requireUser(request).id, sheet.rows);
    return success(sheetResult(sheet));
  });
}

function registerTitleExchange(app: FastifyInstance): void {
  const guard = { preHandler: requirePermission(Permission.CONTRACT_READ, Permission.CONTRACT_UPDATE) };
  const spec = plainSpec('business_title');
  app.post('/contract/business-title/export-all', guard, async (request) => success(await exportRecords(spec, requireOrganization(request), requireUser(request).id, request.body, 'business_title', false)));
  app.post('/contract/business-title/export-select', guard, async (request) => success(await exportRecords(spec, requireOrganization(request), requireUser(request).id, request.body, 'business_title', true)));
  app.get('/contract/business-title/template/download', guard, async (_request, reply) => sendCsv(reply, ['名称']));
  app.post('/contract/business-title/import/pre-check', contractWrite, async (request) => success(sheetResult(await sheetOf(request))));
  app.post('/contract/business-title/import', contractWrite, async (request) => {
    const sheet = await sheetOf(request);
    await importTitles(requireOrganization(request), requireUser(request).id, sheet.rows);
    return success(sheetResult(sheet));
  });
}

function registerCustomExchange(app: FastifyInstance): void {
  const spec = plainSpec('custom_form_data');
  app.post('/custom-form/data/export-all', async (request) => success(await exportRecords(spec, requireOrganization(request), requireUser(request).id, request.body, 'custom_form', false)));
  app.post('/custom-form/data/export-select', async (request) => success(await exportRecords(spec, requireOrganization(request), requireUser(request).id, request.body, 'custom_form', true)));
  app.get('/custom-form/data/template/download', async (_request, reply) => sendCsv(reply, ['名称']));
  app.post('/custom-form/data/import/pre-check', async (request) => success(sheetResult(await sheetOf(request))));
  app.post('/custom-form/data/import', async (request) => {
    const parsed = parsedBody(request);
    const sheet = readSheet(parsed.file);
    const customFormId = String(parsed.meta.customFormId ?? '');
    for (const row of sheet.rows) {
      await addFormData(requireOrganization(request), requireUser(request).id, { customFormId, name: row['名称'] || row['name'], owner: requireUser(request).id });
    }
    return success(sheetResult(sheet));
  });
}

async function assertCreate(request: FastifyRequest): Promise<void> {
  const customFormId = String((request.body as { customFormId?: string } | null)?.customFormId ?? '');
  if (!(await canCreate(customFormId, requireUser(request).id))) {
    throw forbidden('没有创建权限');
  }
}

function sheetResult(sheet: SheetCheck): Pick<SheetCheck, 'failCount' | 'successCount' | 'errorMessages'> {
  return { failCount: sheet.failCount, successCount: sheet.successCount, errorMessages: sheet.errorMessages };
}

async function sheetOf(request: FastifyRequest): Promise<SheetCheck> {
  return readSheet(parsedBody(request).file);
}

function parsedBody(request: FastifyRequest): { file: Buffer; meta: Record<string, unknown> } {
  const contentType = request.headers['content-type'] ?? '';
  const body = Buffer.isBuffer(request.body) ? request.body : Buffer.from('');
  const parsed = parseMultipart(body, contentType);
  const file = parsed.files[0]?.data;
  if (!file) throw validateFailed('请上传文件');
  let meta: Record<string, unknown> = {};
  const raw = parsed.fields.get('request');
  if (raw) {
    try {
      meta = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      meta = {};
    }
  }
  return { file, meta };
}

function sendCsv(reply: FastifyReply, headers: string[]): Buffer {
  reply.type('text/csv; charset=utf-8');
  reply.header('Content-Disposition', 'attachment; filename="template.csv"');
  return templateCsv(headers);
}
