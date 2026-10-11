import { Permission } from '../support/permission.js';

export interface EntitySpec {
  prefix: string;
  table: string;
  fieldTable?: string;
  blobTable?: string;
  formKey: string;
  viewType: string;
  poolColumn?: string;
  inPool?: boolean;
  stageTable?: string;
  formSnapshot?: {
    table: string;
    idColumn: string;
    propColumn: string;
  };
  keywordColumns: string[];
  read: string[];
  add: string[];
  update: string[];
  remove: string[];
}

const customerRead = [Permission.CUSTOMER_MANAGEMENT_READ];
const customerWrite = [Permission.CUSTOMER_MANAGEMENT_UPDATE];
const clueRead = [Permission.CLUE_MANAGEMENT_READ];
const opportunityRead = [Permission.OPPORTUNITY_MANAGEMENT_READ];
const followRead = [Permission.CUSTOMER_MANAGEMENT_READ, Permission.CLUE_MANAGEMENT_READ, Permission.OPPORTUNITY_MANAGEMENT_READ];
const contractRead = [Permission.CONTRACT_READ];
const contractWrite = [Permission.CONTRACT_UPDATE];

export const entities: EntitySpec[] = [
  {
    prefix: '/account',
    table: 'customer',
    fieldTable: 'customer_field',
    blobTable: 'customer_field_blob',
    formKey: 'customer',
    viewType: 'CUSTOMER',
    poolColumn: 'in_shared_pool',
    inPool: false,
    keywordColumns: ['name'],
    read: customerRead,
    add: [Permission.CUSTOMER_MANAGEMENT_ADD],
    update: customerWrite,
    remove: [Permission.CUSTOMER_MANAGEMENT_DELETE],
  },
  {
    prefix: '/pool/account',
    table: 'customer',
    fieldTable: 'customer_field',
    blobTable: 'customer_field_blob',
    formKey: 'customer',
    viewType: 'CUSTOMER_POOL',
    poolColumn: 'in_shared_pool',
    inPool: true,
    keywordColumns: ['name'],
    read: [Permission.CUSTOMER_MANAGEMENT_POOL_READ, Permission.CUSTOMER_MANAGEMENT_READ],
    add: [Permission.CUSTOMER_MANAGEMENT_ADD, Permission.CUSTOMER_MANAGEMENT_POOL_READ],
    update: [Permission.CUSTOMER_MANAGEMENT_UPDATE, Permission.CUSTOMER_MANAGEMENT_POOL_READ],
    remove: [Permission.CUSTOMER_MANAGEMENT_DELETE, Permission.CUSTOMER_MANAGEMENT_POOL_READ],
  },
  {
    prefix: '/lead',
    table: 'clue',
    fieldTable: 'clue_field',
    blobTable: 'clue_field_blob',
    formKey: 'clue',
    viewType: 'CLUE',
    poolColumn: 'in_shared_pool',
    inPool: false,
    keywordColumns: ['name', 'phone', 'contact'],
    read: clueRead,
    add: [Permission.CLUE_MANAGEMENT_ADD],
    update: [Permission.CLUE_MANAGEMENT_UPDATE],
    remove: [Permission.CLUE_MANAGEMENT_DELETE],
  },
  {
    prefix: '/pool/lead',
    table: 'clue',
    fieldTable: 'clue_field',
    blobTable: 'clue_field_blob',
    formKey: 'clue',
    viewType: 'CLUE_POOL',
    poolColumn: 'in_shared_pool',
    inPool: true,
    keywordColumns: ['name', 'phone', 'contact'],
    read: [Permission.CLUE_MANAGEMENT_POOL_READ, Permission.CLUE_MANAGEMENT_READ],
    add: [Permission.CLUE_MANAGEMENT_ADD, Permission.CLUE_MANAGEMENT_POOL_READ],
    update: [Permission.CLUE_MANAGEMENT_UPDATE, Permission.CLUE_MANAGEMENT_POOL_READ],
    remove: [Permission.CLUE_MANAGEMENT_DELETE, Permission.CLUE_MANAGEMENT_POOL_READ],
  },
  {
    prefix: '/opportunity',
    table: 'opportunity',
    fieldTable: 'opportunity_field',
    blobTable: 'opportunity_field_blob',
    formKey: 'opportunity',
    viewType: 'OPPORTUNITY',
    stageTable: 'opportunity_stage_config',
    keywordColumns: ['name'],
    read: opportunityRead,
    add: [Permission.OPPORTUNITY_MANAGEMENT_ADD],
    update: [Permission.OPPORTUNITY_MANAGEMENT_UPDATE],
    remove: [Permission.OPPORTUNITY_MANAGEMENT_DELETE],
  },
  {
    prefix: '/opportunity/quotation',
    table: 'opportunity_quotation',
    fieldTable: 'opportunity_quotation_field',
    blobTable: 'opportunity_quotation_field_blob',
    formKey: 'quotation',
    viewType: 'OPPORTUNITY_QUOTATION',
    formSnapshot: {
      table: 'opportunity_quotation_snapshot',
      idColumn: 'quotation_id',
      propColumn: 'quotation_prop',
    },
    keywordColumns: ['name'],
    read: opportunityRead,
    add: [Permission.OPPORTUNITY_MANAGEMENT_ADD],
    update: [Permission.OPPORTUNITY_MANAGEMENT_UPDATE],
    remove: [Permission.OPPORTUNITY_MANAGEMENT_DELETE],
  },
  {
    prefix: '/product',
    table: 'product',
    fieldTable: 'product_field',
    blobTable: 'product_field_blob',
    formKey: 'product',
    viewType: 'PRODUCT',
    keywordColumns: ['name'],
    read: [Permission.PRODUCT_MANAGEMENT_READ],
    add: [Permission.PRODUCT_MANAGEMENT_ADD],
    update: [Permission.PRODUCT_MANAGEMENT_UPDATE],
    remove: [Permission.PRODUCT_MANAGEMENT_DELETE],
  },
  {
    prefix: '/price',
    table: 'product_price',
    fieldTable: 'product_price_field',
    blobTable: 'product_price_field_blob',
    formKey: 'price',
    viewType: 'PRICE',
    keywordColumns: ['name'],
    read: [Permission.PRICE_READ],
    add: [Permission.PRICE_ADD],
    update: [Permission.PRICE_UPDATE],
    remove: [Permission.PRICE_DELETE],
  },
  {
    prefix: '/contract',
    table: 'contract',
    fieldTable: 'contract_field',
    blobTable: 'contract_field_blob',
    formKey: 'contract',
    viewType: 'CONTRACT',
    stageTable: 'contract_stage_config',
    formSnapshot: {
      table: 'contract_snapshot',
      idColumn: 'contract_id',
      propColumn: 'contract_prop',
    },
    keywordColumns: ['name', 'number'],
    read: contractRead,
    add: [Permission.CONTRACT_ADD],
    update: contractWrite,
    remove: [Permission.CONTRACT_DELETE],
  },
  {
    prefix: '/contract/payment-plan',
    table: 'contract_payment_plan',
    fieldTable: 'contract_payment_plan_field',
    blobTable: 'contract_payment_plan_field_blob',
    formKey: 'contractPaymentPlan',
    viewType: 'CONTRACT_PAYMENT_PLAN',
    keywordColumns: ['name'],
    read: contractRead,
    add: [Permission.CONTRACT_ADD],
    update: contractWrite,
    remove: [Permission.CONTRACT_DELETE],
  },
  {
    prefix: '/contract/payment-record',
    table: 'contract_payment_record',
    fieldTable: 'contract_payment_record_field',
    blobTable: 'contract_payment_record_field_blob',
    formKey: 'contractPaymentRecord',
    viewType: 'CONTRACT_PAYMENT_RECORD',
    keywordColumns: ['name', 'no'],
    read: contractRead,
    add: [Permission.CONTRACT_ADD],
    update: contractWrite,
    remove: [Permission.CONTRACT_DELETE],
  },
  {
    prefix: '/invoice',
    table: 'contract_invoice',
    fieldTable: 'contract_invoice_field',
    blobTable: 'contract_invoice_field_blob',
    formKey: 'invoice',
    viewType: 'CONTRACT_INVOICE',
    formSnapshot: {
      table: 'contract_invoice_snapshot',
      idColumn: 'invoice_id',
      propColumn: 'invoice_prop',
    },
    keywordColumns: ['name'],
    read: contractRead,
    add: [Permission.CONTRACT_ADD],
    update: contractWrite,
    remove: [Permission.CONTRACT_DELETE],
  },
  {
    prefix: '/contract/business-title',
    table: 'business_title',
    formKey: 'businessTitle',
    viewType: 'BUSINESS_TITLE',
    keywordColumns: ['name'],
    read: contractRead,
    add: [Permission.CONTRACT_ADD],
    update: contractWrite,
    remove: [Permission.CONTRACT_DELETE],
  },
  {
    prefix: '/order',
    table: 'sales_order',
    fieldTable: 'sales_order_field',
    blobTable: 'sales_order_field_blob',
    formKey: 'order',
    viewType: 'ORDER',
    stageTable: 'sales_order_stage_config',
    formSnapshot: {
      table: 'sales_order_snapshot',
      idColumn: 'order_id',
      propColumn: 'order_prop',
    },
    keywordColumns: ['name', 'number'],
    read: [Permission.ORDER_READ],
    add: [Permission.ORDER_ADD],
    update: [Permission.ORDER_UPDATE],
    remove: [Permission.ORDER_DELETE],
  },
  {
    prefix: '/account/contact',
    table: 'customer_contact',
    fieldTable: 'customer_contact_field',
    blobTable: 'customer_contact_field_blob',
    formKey: 'contact',
    viewType: 'CUSTOMER_CONTACT',
    keywordColumns: ['name', 'phone'],
    read: [Permission.CUSTOMER_MANAGEMENT_CONTACT_READ, Permission.CUSTOMER_MANAGEMENT_READ],
    add: [Permission.CUSTOMER_MANAGEMENT_CONTACT_ADD, Permission.CUSTOMER_MANAGEMENT_ADD],
    update: [Permission.CUSTOMER_MANAGEMENT_CONTACT_UPDATE, Permission.CUSTOMER_MANAGEMENT_UPDATE],
    remove: [Permission.CUSTOMER_MANAGEMENT_CONTACT_DELETE, Permission.CUSTOMER_MANAGEMENT_DELETE],
  },
  {
    prefix: '/follow/record',
    table: 'follow_up_record',
    fieldTable: 'follow_up_record_field',
    blobTable: 'follow_up_record_field_blob',
    formKey: 'record',
    viewType: 'FOLLOW_RECORD',
    keywordColumns: ['content'],
    read: followRead,
    add: followRead,
    update: followRead,
    remove: followRead,
  },
  {
    prefix: '/follow/plan',
    table: 'follow_up_plan',
    fieldTable: 'follow_up_plan_field',
    blobTable: 'follow_up_plan_field_blob',
    formKey: 'plan',
    viewType: 'FOLLOW_PLAN',
    keywordColumns: ['content'],
    read: followRead,
    add: followRead,
    update: followRead,
    remove: followRead,
  },
];

export function entityByPrefix(prefix: string): EntitySpec {
  const found = entities.find((entity) => entity.prefix === prefix);
  if (!found) {
    throw new Error(`unknown entity ${prefix}`);
  }
  return found;
}
