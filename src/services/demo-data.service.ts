import type { RowDataPacket } from 'mysql2';

import { getFormConfig } from '../models/form.model.js';
import { deleteModuleFields, deleteRecords, insertRecord, replaceModuleFields, type ModuleFieldValue } from '../models/record.model.js';
import { execute, query } from '../support/db.js';
import { ident } from '../support/ident.js';
import { nextId } from '../support/id.js';

const MARK = '【模拟】';
const DEMO_TYPE = 'DEMO_DATA';

const FIELD_TABLES: Record<string, { field?: string; blob?: string }> = {
  product: { field: 'product_field', blob: 'product_field_blob' },
  customer: { field: 'customer_field', blob: 'customer_field_blob' },
  clue: { field: 'clue_field', blob: 'clue_field_blob' },
  opportunity: { field: 'opportunity_field', blob: 'opportunity_field_blob' },
  contract: { field: 'contract_field', blob: 'contract_field_blob' },
  sales_order: { field: 'sales_order_field', blob: 'sales_order_field_blob' },
};

export interface DemoCounts {
  products: number;
  customers: number;
  clues: number;
  opportunities: number;
  contracts: number;
  orders: number;
}

interface DemoRecord {
  table: string;
  id: string;
}

interface FieldIndex {
  byKey: Map<string, { id: string; type: string }>;
  types: Map<string, string>;
}

const PRODUCTS = [
  ['灵巧手关节模组', 12800],
  ['微型伺服驱动器', 4600],
  ['六维力传感器', 8600],
  ['关节控制主板', 3200],
  ['高柔性线束套件', 980],
  ['手持示教器', 5400],
  ['谐波减速器', 7600],
  ['末端快换模块', 2100],
] as const;

const CUSTOMERS = [
  ['华北精密制造', '3', '1', '2', '110108', '中关村大街18号'],
  ['申城金融科技', '2', '3', '3', '310115', '世纪大道100号'],
  ['岭南智能装备', '3', '2', '3', '440106', '体育西路88号'],
  ['西湖医疗器械', '1', '2', '2', '330106', '文三路66号'],
  ['滨海物流集团', '1', '2', '2', '120116', '滨海新区泰达大街'],
  ['锦城软件', '1', '1', '2', '510107', '天府大道中段'],
  ['星河教育', '1', '2', '1', '420111', '光谷大道'],
  ['江淮汽车零部件', '3', '2', '2', '340104', '望江西路'],
  ['珠江新能源', '3', '3', '2', '440305', '科技园南路'],
  ['渤海船舶配套', '3', '1', '2', '210202', '人民路'],
  ['秦岭矿业设备', '3', '2', '2', '610113', '科技路'],
  ['苏南电子', '1', '2', '3', '320506', '吴中大道'],
] as const;

const POOL_LEADS = [
  '启明机器人',
  '北辰自动化',
  '浦江传感',
  '粤海装备',
  '钱塘医疗',
  '津门仓储',
  '锦官软件',
  '光谷教育',
  '巢湖汽配',
  '前海能源',
  '大连船配',
  '高新矿业',
] as const;

const OWNED_LEADS = ['吴中电子', '雁塔检测', '武侯视觉', '洪山协作', '蜀山联调', '南山试点'] as const;

const OPP_STAGES = ['CREATE', 'CLEAR_REQUIREMENTS', 'SCHEME_VALIDATION', 'PROJECT_PROPOSAL_REPORT', 'BUSINESS_PROCUREMENT'];
const CONTRACT_STAGES = ['PENDING_SIGNING', 'SIGNED', 'IN_PROGRESS'];
const ORDER_STAGES = ['PENDING_SHIPMENT', 'PARTIALLY_SHIPPED', 'SHIPPED', 'PENDING_ACCEPTANCE'];
const AREAS = ['110108', '310115', '440106', '330106', '120116', '510107'];

export class DemoDataService {
  async status(organizationId: string): Promise<DemoCounts> {
    const records = await this.registered(organizationId);
    return countRecords(records);
  }

  async create(organizationId: string, userId: string): Promise<DemoCounts> {
    const now = Date.now();
    const records: DemoRecord[] = [];
    const productFields = await fieldIndex('product', organizationId);
    const customerFields = await fieldIndex('customer', organizationId);
    const clueFields = await fieldIndex('clue', organizationId);
    const opportunityFields = await fieldIndex('opportunity', organizationId);
    const contractFields = await fieldIndex('contract', organizationId);
    const orderFields = await fieldIndex('order', organizationId);
    const poolId = await this.ensurePool(organizationId, userId, now, records);

    const productIds: string[] = [];
    for (let index = 0; index < PRODUCTS.length; index += 1) {
      const [name, price] = PRODUCTS[index];
      const id = nextId();
      productIds.push(id);
      await insertRecord('product', baseRow(id, organizationId, userId, now + index, {
        name: `${MARK}${name}`,
        price,
        status: '1',
        pos: now + index,
      }));
      await writeFields('product', id, productFields, {
        productName: `${MARK}${name}`,
        productPrice: price,
        productStatus: '1',
        productDescription: `${name}，用于演示列表、筛选和删除。`,
      });
      records.push({ table: 'product', id });
    }

    const customerIds: string[] = [];
    for (let index = 0; index < CUSTOMERS.length; index += 1) {
      const [name, industry, level, type, area, detail] = CUSTOMERS[index];
      const id = nextId();
      customerIds.push(id);
      await insertRecord('customer', baseRow(id, organizationId, userId, now + index, {
        name: `${MARK}${name}`,
        owner: userId,
        inSharedPool: false,
        collectionTime: now,
        frozen: 0,
      }));
      await writeFields('customer', id, customerFields, {
        customerName: `${MARK}${name}`,
        customerIndustry: industry,
        customerLevel: level,
        customerType: type,
        customerSource: index % 2 === 0 ? '1' : '2',
        customerOnlineSource: String((index % 3) + 1),
        customerTag: ['模拟', index % 2 === 0 ? '重点跟进' : '新客户'],
        customerArea: `${area}-${detail}`,
        customerOwner: userId,
      });
      records.push({ table: 'customer', id });
    }

    const leadNames = [
      ...POOL_LEADS.map((name) => ({ name, pooled: true })),
      ...OWNED_LEADS.map((name) => ({ name, pooled: false })),
    ];
    for (let index = 0; index < leadNames.length; index += 1) {
      const item = leadNames[index];
      const id = nextId();
      const phone = `1380000${String(1000 + index).slice(-4)}`;
      const area = AREAS[index % AREAS.length];
      await insertRecord('clue', baseRow(id, organizationId, userId, now + index, {
        name: `${MARK}${item.name}`,
        owner: item.pooled ? null : userId,
        stage: 'FOLLOWING',
        contact: `${item.name}联系人`,
        phone,
        products: '[]',
        inSharedPool: item.pooled,
        poolId: item.pooled ? poolId : null,
        collectionTime: item.pooled ? null : now,
        transitionType: 'NONE',
        frozen: 0,
      }));
      await writeFields('clue', id, clueFields, {
        clueName: `${MARK}${item.name}`,
        clueProgress: index % 2 === 0 ? '2' : '1',
        clueSource: item.pooled ? '1' : '4',
        clueOnlineSource: String((index % 3) + 1),
        clueDemand: `${item.name}希望了解关节模组和力传感器。`,
        clueContactName: `${item.name.slice(0, 2)}经理`,
        clueContactPhone: phone,
        clueProduct: productIds.slice(index % 3, (index % 3) + 2),
        clueArea: `${area}-`,
        clueOwner: userId,
      });
      records.push({ table: 'clue', id });
    }

    const contractIds: string[] = [];
    for (let index = 0; index < customerIds.length; index += 1) {
      const customerId = customerIds[index];
      const customerName = CUSTOMERS[index][0];
      const amount = 30000 + index * 8500;
      const opportunityId = nextId();
      const end = Date.UTC(2026, 10, 1 + index);
      await insertRecord('opportunity', baseRow(opportunityId, organizationId, userId, now + index, {
        customerId,
        name: `${MARK}${customerName}关节采购`,
        amount,
        possible: 20 + (index % 6) * 10,
        products: '[]',
        stage: OPP_STAGES[index % OPP_STAGES.length],
        owner: userId,
        expectedEndTime: end,
        pos: now + index,
      }));
      await writeFields('opportunity', opportunityId, opportunityFields, {
        opportunityName: `${MARK}${customerName}关节采购`,
        opportunityCustomer: customerId,
        opportunityNo: `SIM-OPP-${String(index + 1).padStart(4, '0')}`,
        opportunitySource: String((index % 4) + 1),
        opportunityPrice: amount,
        opportunityProduct: productIds.slice(0, 2),
        opportunityEndTime: end,
        opportunityWinRate: 20 + (index % 6) * 10,
        opportunityArea: `${CUSTOMERS[index][4]}-`,
        opportunityOwner: userId,
        opportunityCustomerTag: ['模拟'],
      });
      records.push({ table: 'opportunity', id: opportunityId });

      if (index >= 8) {
        continue;
      }
      const contractId = nextId();
      contractIds.push(contractId);
      const number = `SIM-CON-${String(index + 1).padStart(4, '0')}-${nextId().slice(0, 4)}`;
      const start = Date.UTC(2026, 3, 10 + index);
      const finish = Date.UTC(2026, 11, 10 + index);
      await insertRecord('contract', baseRow(contractId, organizationId, userId, now + index, {
        name: `${MARK}${customerName}供货合同`,
        customerId,
        owner: userId,
        amount,
        number,
        approvalStatus: 'APPROVED',
        stage: CONTRACT_STAGES[index % CONTRACT_STAGES.length],
        startTime: start,
        endTime: finish,
        pos: now + index,
        approved: 1,
      }));
      await writeFields('contract', contractId, contractFields, {
        contractName: `${MARK}${customerName}供货合同`,
        contractCustomer: customerId,
        contractNo: number,
        contractOwner: userId,
      });
      records.push({ table: 'contract', id: contractId });

      const orderId = nextId();
      const orderNumber = `SIM-ORD-${String(index + 1).padStart(4, '0')}-${nextId().slice(0, 4)}`;
      await insertRecord('sales_order', baseRow(orderId, organizationId, userId, now + index, {
        number: orderNumber,
        name: `${MARK}${customerName}销售订单`,
        customerId,
        contractId,
        owner: userId,
        amount,
        stage: ORDER_STAGES[index % ORDER_STAGES.length],
        approvalStatus: 'APPROVED',
        pos: now + index,
        approved: 1,
      }));
      await writeFields('order', orderId, orderFields, {
        orderNo: orderNumber,
        orderCustomer: customerId,
        orderContract: contractId,
        orderName: `${MARK}${customerName}销售订单`,
        orderOwner: userId,
        orderAmount: amount,
        orderDeliveryAddress: `${CUSTOMERS[index][4]}-${CUSTOMERS[index][5]}`,
        orderConsignee: `${customerName.slice(0, 2)}收货人`,
        orderPhone: `1390000${String(2000 + index).slice(-4)}`,
      });
      records.push({ table: 'sales_order', id: orderId });
    }

    await this.append(organizationId, userId, now, records);
    return countRecords(await this.registered(organizationId));
  }

  async clear(organizationId: string): Promise<DemoCounts> {
    const records = await this.registered(organizationId);
    const grouped = new Map<string, string[]>();
    for (const record of records) {
      const list = grouped.get(record.table) ?? [];
      list.push(record.id);
      grouped.set(record.table, list);
    }
    for (const table of ['sales_order', 'contract', 'opportunity', 'clue', 'customer', 'product']) {
      const prefixed = await idsByName(table, organizationId);
      const ids = [...new Set([...(grouped.get(table) ?? []), ...prefixed])];
      if (ids.length === 0) {
        continue;
      }
      const fields = FIELD_TABLES[table];
      await deleteModuleFields(fields?.field, fields?.blob, ids);
      await deleteRecords(table, ids, organizationId);
    }
    const poolIds = [...new Set([...(grouped.get('clue_pool') ?? []), ...await poolIdsByName(organizationId)])];
    if (poolIds.length > 0) {
      const marks = poolIds.map(() => '?').join(', ');
      await execute(`DELETE FROM clue_pool_pick_rule WHERE pool_id IN (${marks})`, poolIds);
      await execute(`DELETE FROM clue_pool_recycle_rule WHERE pool_id IN (${marks})`, poolIds);
      await execute(`DELETE FROM clue_pool_hidden_field WHERE pool_id IN (${marks})`, poolIds);
      await deleteRecords('clue_pool', poolIds, organizationId);
    }
    await this.dropRegistry(organizationId);
    return { products: 0, customers: 0, clues: 0, opportunities: 0, contracts: 0, orders: 0 };
  }

  private async ensurePool(organizationId: string, userId: string, now: number, records: DemoRecord[]): Promise<string> {
    const existing = await query<RowDataPacket & { id: string }>(
      'SELECT id FROM clue_pool WHERE organization_id = ? AND name = ? LIMIT 1',
      [organizationId, `${MARK}默认线索池`],
    );
    if (existing[0]) {
      return existing[0].id;
    }
    const id = nextId();
    const members = JSON.stringify([userId]);
    await execute(
      `INSERT INTO clue_pool
       (id, name, scope_id, organization_id, owner_id, enable, auto, create_time, update_time, create_user, update_user)
       VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?)`,
      [id, `${MARK}默认线索池`, members, organizationId, members, now, now, userId, userId],
    );
    await execute(
      `INSERT INTO clue_pool_pick_rule
       (id, pool_id, limit_on_number, pick_number, limit_pre_owner, pick_interval_days, limit_new, new_pick_interval,
        create_user, create_time, update_user, update_time)
       VALUES (?, ?, 0, NULL, 0, NULL, 0, NULL, ?, ?, ?, ?)`,
      [nextId(), id, userId, now, userId, now],
    );
    await execute(
      `INSERT INTO clue_pool_recycle_rule
       (id, pool_id, operator, \`condition\`, create_time, update_time, create_user, update_user)
       VALUES (?, ?, 'AND', '[]', ?, ?, ?, ?)`,
      [nextId(), id, now, now, userId, userId],
    );
    records.push({ table: 'clue_pool', id });
    return id;
  }

  private async registered(organizationId: string): Promise<DemoRecord[]> {
    const rows = await query<RowDataPacket & { content: Buffer | string }>(
      `SELECT d.content
       FROM sys_organization_config c
       JOIN sys_organization_config_detail d ON d.config_id = c.id
       WHERE c.organization_id = ? AND c.type = ? AND d.type = ?
       LIMIT 1`,
      [organizationId, DEMO_TYPE, DEMO_TYPE],
    );
    if (!rows[0]) {
      return [];
    }
    const raw = Buffer.isBuffer(rows[0].content) ? rows[0].content.toString('utf8') : String(rows[0].content ?? '');
    try {
      const parsed = JSON.parse(raw) as { records?: DemoRecord[] };
      return Array.isArray(parsed.records) ? parsed.records.filter((item) => item?.table && item?.id) : [];
    } catch {
      return [];
    }
  }

  private async append(organizationId: string, userId: string, now: number, records: DemoRecord[]): Promise<void> {
    const current = await this.registered(organizationId);
    const content = Buffer.from(JSON.stringify({ records: [...current, ...records] }));
    const configs = await query<RowDataPacket & { id: string }>(
      'SELECT id FROM sys_organization_config WHERE organization_id = ? AND type = ? LIMIT 1',
      [organizationId, DEMO_TYPE],
    );
    if (!configs[0]) {
      const configId = nextId();
      const detailId = nextId();
      await execute(
        `INSERT INTO sys_organization_config
         (id, type, organization_id, sync, enable, create_time, update_time, create_user, update_user)
         VALUES (?, ?, ?, 0, 1, ?, ?, ?, ?)`,
        [configId, DEMO_TYPE, organizationId, now, now, userId, userId],
      );
      await execute(
        `INSERT INTO sys_organization_config_detail
         (id, config_id, type, enable, name, content, create_time, update_time, create_user, update_user)
         VALUES (?, ?, ?, 1, 'demo-records', ?, ?, ?, ?, ?)`,
        [detailId, configId, DEMO_TYPE, content, now, now, userId, userId],
      );
      return;
    }
    await execute(
      `UPDATE sys_organization_config_detail
       SET content = ?, update_time = ?, update_user = ?
       WHERE config_id = ? AND type = ?`,
      [content, now, userId, configs[0].id, DEMO_TYPE],
    );
  }

  private async dropRegistry(organizationId: string): Promise<void> {
    const configs = await query<RowDataPacket & { id: string }>(
      'SELECT id FROM sys_organization_config WHERE organization_id = ? AND type = ?',
      [organizationId, DEMO_TYPE],
    );
    if (configs.length === 0) {
      return;
    }
    const ids = configs.map((row) => row.id);
    const marks = ids.map(() => '?').join(', ');
    await execute(`DELETE FROM sys_organization_config_detail WHERE config_id IN (${marks})`, ids);
    await execute(`DELETE FROM sys_organization_config WHERE id IN (${marks})`, ids);
  }
}

export const demoDataService = new DemoDataService();

function baseRow(
  id: string,
  organizationId: string,
  userId: string,
  time: number,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id,
    organizationId,
    createTime: time,
    updateTime: time,
    createUser: userId,
    updateUser: userId,
    ...extra,
  };
}

async function fieldIndex(formKey: string, organizationId: string): Promise<FieldIndex> {
  const config = await getFormConfig(formKey, organizationId);
  const byKey = new Map<string, { id: string; type: string }>();
  const types = new Map<string, string>();
  for (const field of config.fields) {
    if (!field.internalKey) {
      continue;
    }
    byKey.set(field.internalKey, { id: field.id, type: field.type });
    types.set(field.id, field.type);
  }
  return { byKey, types };
}

async function writeFields(
  table: string,
  resourceId: string,
  index: FieldIndex,
  values: Record<string, unknown>,
): Promise<void> {
  const tables = FIELD_TABLES[table];
  const fields: ModuleFieldValue[] = [];
  for (const [key, value] of Object.entries(values)) {
    const field = index.byKey.get(key);
    if (!field || value == null || value === '') {
      continue;
    }
    fields.push({ fieldId: field.id, fieldValue: value });
  }
  await replaceModuleFields(tables?.field, tables?.blob, resourceId, fields, index.types);
}

async function idsByName(table: string, organizationId: string): Promise<string[]> {
  const rows = await query<RowDataPacket & { id: string }>(
    `SELECT id FROM ${ident(table)} WHERE organization_id = ? AND name LIKE ?`,
    [organizationId, `${MARK}%`],
  );
  return rows.map((row) => row.id);
}

async function poolIdsByName(organizationId: string): Promise<string[]> {
  const rows = await query<RowDataPacket & { id: string }>(
    'SELECT id FROM clue_pool WHERE organization_id = ? AND name LIKE ?',
    [organizationId, `${MARK}%`],
  );
  return rows.map((row) => row.id);
}

function countRecords(records: DemoRecord[]): DemoCounts {
  const count = (table: string) => records.filter((item) => item.table === table).length;
  return {
    products: count('product'),
    customers: count('customer'),
    clues: count('clue'),
    opportunities: count('opportunity'),
    contracts: count('contract'),
    orders: count('sales_order'),
  };
}
