import type { FastifyInstance, FastifyReply } from 'fastify';

import { entityByPrefix } from '../../services/crm-catalog.js';
import { pageEntity } from '../../services/record.service.js';
import { deleteTempFile, fileType, readTempFile, saveTempFiles } from '../../services/file.service.js';
import {
  businessTitlePage,
  checkRepeat,
  copyPrice,
  displayConfig,
  emptyPage,
  getMaskConfig,
  getSearchConfig,
  globalCounts,
  invoiceStatistic,
  moveRecord,
  pageByCustomer,
  planStatistic,
  recordStatistic,
  contractStatistic,
  resetSearchConfig,
  saveMaskConfig,
  saveSearchConfig,
  sourceDetail,
  sourcePage,
  transformClue,
} from '../../services/gap.service.js';
import { requireOrganization, requireUser } from '../../support/context.js';
import { parseMultipart } from '../../support/multipart.js';
import { Permission } from '../../support/permission.js';
import { success } from '../../support/result.js';
import { requirePermission } from '../middleware/permission.middleware.js';

const sources: Array<[string, string]> = [
  ['/field/source/account', '/account'],
  ['/field/source/contact', '/account/contact'],
  ['/field/source/lead', '/lead'],
  ['/field/source/opportunity', '/opportunity'],
  ['/field/source/product', '/product'],
  ['/field/source/price', '/price'],
  ['/field/source/quotation', '/opportunity/quotation'],
  ['/field/source/contract', '/contract'],
  ['/field/source/contract/payment-plan', '/contract/payment-plan'],
  ['/field/source/contract/payment-record', '/contract/payment-record'],
  ['/field/source/invoice', '/invoice'],
  ['/field/source/order', '/order'],
];

const searches: Array<[string, string]> = [
  ['/global/search/account', '/account'],
  ['/global/search/customer_pool', '/pool/account'],
  ['/global/search/contact', '/account/contact'],
  ['/global/search/lead', '/lead'],
  ['/global/search/clue_pool', '/pool/lead'],
  ['/global/search/opportunity', '/opportunity'],
  ['/advanced/search/account', '/account'],
  ['/advanced/search/account-pool', '/pool/account'],
  ['/advanced/search/contact', '/account/contact'],
  ['/advanced/search/lead', '/lead'],
  ['/advanced/search/lead/detail', '/lead'],
  ['/advanced/search/lead-pool', '/pool/lead'],
  ['/advanced/search/opportunity', '/opportunity'],
  ['/advanced/search/opportunity/detail', '/opportunity'],
];

async function sendFile(reply: FastifyReply, id: string, download: boolean): Promise<Buffer> {
  const file = await readTempFile(id);
  reply.type(fileType(file.filename));
  reply.header('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(file.filename)}"`);
  return file.data;
}

export async function registerGapRoutes(app: FastifyInstance): Promise<void> {
  app.post('/search/config/save', async (request) => {
    await saveSearchConfig(requireOrganization(request), requireUser(request).id, request.body);
    return success(null);
  });
  app.get('/search/config/get', async (request) => {
    return success(await getSearchConfig(requireOrganization(request), requireUser(request).id));
  });
  app.get('/search/config/reset', async (request) => {
    await resetSearchConfig(requireOrganization(request), requireUser(request).id);
    return success(null);
  });
  app.post('/mask/config/save', { preHandler: requirePermission(Permission.MODULE_SETTING_UPDATE) }, async (request) => {
    await saveMaskConfig(requireOrganization(request), requireUser(request).id, request.body);
    return success(null);
  });
  app.get('/mask/config/get', { preHandler: requirePermission(Permission.MODULE_SETTING_READ, Permission.MODULE_SETTING_UPDATE) }, async (request) => {
    return success(await getMaskConfig(requireOrganization(request)));
  });

  for (const [path, prefix] of sources) {
    const spec = entityByPrefix(prefix);
    app.post(path, { preHandler: requirePermission(...spec.read) }, async (request) => {
      return success(await sourcePage(spec, requireOrganization(request), requireUser(request).id, request.body));
    });
  }
  app.post('/field/source/custom-form-data', async (request) => success(await emptyPage(request.body)));
  app.post('/field/source/business-title', { preHandler: requirePermission(Permission.CONTRACT_READ, Permission.CUSTOMER_MANAGEMENT_READ) }, async (request) => {
    return success(await businessTitlePage(requireOrganization(request), request.body));
  });
  app.post('/field/check/repeat', async (request) => success(await checkRepeat(requireOrganization(request), request.body)));
  app.post('/field/source/ref-detail', async (request) => success(await sourceDetail(requireOrganization(request), request.body)));
  app.get('/field/display/:formKey', async (request) => {
    const { formKey } = request.params as { formKey: string };
    return success(await displayConfig(formKey, requireOrganization(request)));
  });
  app.get('/field/source/config/:type', async (request) => {
    const { type } = request.params as { type: string };
    return success(await displayConfig(type, requireOrganization(request)));
  });

  app.post('/lead/transform', { preHandler: requirePermission(Permission.CLUE_MANAGEMENT_UPDATE, Permission.CUSTOMER_MANAGEMENT_ADD) }, async (request) => {
    return success(await transformClue(requireOrganization(request), requireUser(request).id, request.body));
  });

  const customerPages: Array<[string, string, boolean]> = [
    ['/account/contract/page', '/contract', false],
    ['/account/order/page', '/order', false],
    ['/account/invoice/page', '/invoice', true],
    ['/account/contract/payment-plan/page', '/contract/payment-plan', true],
    ['/account/contract/payment-record/page', '/contract/payment-record', true],
  ];
  for (const [path, prefix, viaContract] of customerPages) {
    const spec = entityByPrefix(prefix);
    app.post(path, { preHandler: requirePermission(...spec.read) }, async (request) => {
      return success(await pageByCustomer(spec, requireOrganization(request), requireUser(request).id, request.body, viaContract));
    });
  }
  app.get('/account/contract/statistic/:id', { preHandler: requirePermission(Permission.CONTRACT_READ) }, async (request) => {
    const { id } = request.params as { id: string };
    return success(await contractStatistic(requireOrganization(request), id));
  });
  app.get('/account/contract/payment-plan/statistic/:id', { preHandler: requirePermission(Permission.CONTRACT_READ) }, async (request) => {
    const { id } = request.params as { id: string };
    return success(await planStatistic(requireOrganization(request), id));
  });
  app.get('/account/contract/payment-record/statistic/:id', { preHandler: requirePermission(Permission.CONTRACT_READ) }, async (request) => {
    const { id } = request.params as { id: string };
    return success(await recordStatistic(requireOrganization(request), id));
  });
  app.post('/contract/contract-payment-plan/page', { preHandler: requirePermission(Permission.CONTRACT_READ) }, async (request) => {
    return success(await pageEntity(entityByPrefix('/contract/payment-plan'), requireOrganization(request), requireUser(request).id, request.body));
  });
  app.post('/contract/invoice/page', { preHandler: requirePermission(Permission.CONTRACT_READ) }, async (request) => {
    return success(await pageEntity(entityByPrefix('/invoice'), requireOrganization(request), requireUser(request).id, request.body));
  });
  app.get('/account/invoice/statistic/:id', { preHandler: requirePermission(Permission.CONTRACT_READ) }, async (request) => {
    const { id } = request.params as { id: string };
    return success(await invoiceStatistic(requireOrganization(request), id));
  });

  for (const [path, prefix] of searches) {
    const spec = entityByPrefix(prefix);
    app.post(path, { preHandler: requirePermission(...spec.read) }, async (request) => {
      return success(await sourcePage(spec, requireOrganization(request), requireUser(request).id, request.body));
    });
  }
  app.post('/global/search/module/count', async (request) => {
    const keyword = String((request.query as { keyword?: string }).keyword ?? '');
    return success(await globalCounts(requireOrganization(request), requireUser(request).id, keyword));
  });

  app.post('/product/edit/pos', { preHandler: requirePermission(Permission.PRODUCT_MANAGEMENT_UPDATE) }, async (request) => {
    await moveRecord('product', requireOrganization(request), request.body);
    return success(null);
  });
  app.post('/price/edit/pos', { preHandler: requirePermission(Permission.PRICE_UPDATE) }, async (request) => {
    await moveRecord('product_price', requireOrganization(request), request.body);
    return success(null);
  });
  app.get('/price/copy/:id', { preHandler: requirePermission(Permission.PRICE_ADD) }, async (request) => {
    const { id } = request.params as { id: string };
    return success(await copyPrice(requireOrganization(request), requireUser(request).id, id));
  });

  app.post('/pic/upload/temp', async (request) => success(await uploaded(request)));
  app.post('/attachment/upload/temp', async (request) => success(await uploaded(request)));
  app.get('/pic/preview/:id', async (request, reply) => sendFile(reply, (request.params as { id: string }).id, false));
  app.get('/pic/download/:id', async (request, reply) => sendFile(reply, (request.params as { id: string }).id, true));
  app.get('/attachment/preview/:id', async (request, reply) => sendFile(reply, (request.params as { id: string }).id, false));
  app.get('/attachment/download/:id', async (request, reply) => sendFile(reply, (request.params as { id: string }).id, true));
  app.get('/attachment/delete/:id', async (request) => {
    await deleteTempFile((request.params as { id: string }).id);
    return success(null);
  });
}

async function uploaded(request: { headers: { 'content-type'?: string }; body: unknown }): Promise<string[]> {
  const contentType = request.headers['content-type'] ?? '';
  const body = Buffer.isBuffer(request.body) ? request.body : Buffer.from('');
  const parsed = parseMultipart(body, contentType);
  return saveTempFiles(parsed.files);
}
