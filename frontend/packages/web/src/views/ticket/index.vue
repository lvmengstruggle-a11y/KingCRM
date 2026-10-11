<template>
  <div class="h-full">
    <CrmCard no-content-padding hide-footer>
      <div class="flex h-full flex-col px-[16px] pt-[16px]">
        <div class="mb-[12px] flex items-center justify-between gap-[12px]">
          <n-tabs :value="view" type="line" @update:value="changeView">
            <n-tab v-for="tab in tabs" :key="tab.value" :name="tab.value">{{ tab.label }}</n-tab>
          </n-tabs>
          <div class="flex shrink-0 items-center gap-[8px]">
            <n-input
              v-model:value="keyword"
              clearable
              class="!w-[220px]"
              :placeholder="t('ticket.search')"
              @keyup.enter="reload"
              @clear="reload"
            />
            <n-button v-if="canAdd" type="primary" @click="showCreate = true">{{ t('ticket.publish') }}</n-button>
            <n-button v-if="canSetting" @click="showSetting = true">{{ t('ticket.setting') }}</n-button>
          </div>
        </div>
        <n-data-table
          :columns="columns"
          :data="rows"
          :loading="loading"
          :pagination="false"
          :max-height="560"
          :row-key="(row: TicketRow) => row.id"
        />
        <div class="flex justify-end py-[12px]">
          <n-pagination
            v-model:page="current"
            v-model:page-size="pageSize"
            :item-count="total"
            :page-sizes="[20, 50, 100]"
            show-size-picker
            @update:page="load"
            @update:page-size="reload"
          />
        </div>
      </div>
    </CrmCard>
    <CreateDrawer v-model:show="showCreate" @saved="reload" />
    <TicketDetail v-model:show="showDetail" :source-id="activeId" @changed="load" />
    <SettingDrawer v-model:show="showSetting" />
  </div>
</template>

<script setup lang="ts">
  import { useRoute } from 'vue-router';
  import { NButton, NDataTable, NInput, NPagination, NTab, NTabs, useMessage } from 'naive-ui';
  import dayjs from 'dayjs';

  import { useI18n } from '@lib/shared/hooks/useI18n';

  import CrmCard from '@/components/pure/crm-card/index.vue';
  import CreateDrawer from './components/createDrawer.vue';
  import TicketDetail from './components/detail.vue';
  import SettingDrawer from './setting/index.vue';

  import { pageTicket, purgeTicket, recoverTicket, recycleTicket } from '@/api/modules';
  import { hasAnyPermission } from '@/utils/permission';

  import type { DataTableColumns } from 'naive-ui';

  interface TicketRow {
    id: string;
    number: string;
    title: string;
    statusName: string;
    statusColor: string;
    priority: number;
    publisherName: string;
    handlerName: string;
    departmentName: string;
    customerId: string;
    customerName: string;
    satisfyScore: number | null;
    endTime: number | null;
    createTime: number;
  }

  const { t } = useI18n();
  const message = useMessage();
  const route = useRoute();

  const view = ref('all');
  const keyword = ref('');
  const current = ref(1);
  const pageSize = ref(20);
  const total = ref(0);
  const rows = ref<TicketRow[]>([]);
  const loading = ref(false);
  const showCreate = ref(false);
  const showDetail = ref(false);
  const showSetting = ref(false);
  const activeId = ref('');

  const canAdd = computed(() => hasAnyPermission(['TICKET:ADD']));
  const canDelete = computed(() => hasAnyPermission(['TICKET:DELETE']));
  const canSetting = computed(() => hasAnyPermission(['TICKET_SETTING:READ', 'TICKET_SETTING:UPDATE']));

  const tabs = computed(() => {
    const list = [
      { value: 'all', label: t('ticket.view.all') },
      { value: 'mine', label: t('ticket.view.mine') },
      { value: 'handling', label: t('ticket.view.handling') },
      { value: 'department', label: t('ticket.view.department') },
      { value: 'cc', label: t('ticket.view.cc') },
    ];
    if (canDelete.value) {
      list.push({ value: 'recycle', label: t('ticket.view.recycle') });
    }
    return list;
  });

  function openDetail(id: string) {
    activeId.value = id;
    showDetail.value = true;
  }

  async function load() {
    loading.value = true;
    try {
      const result = (await pageTicket({
        current: current.value,
        pageSize: pageSize.value,
        view: view.value,
        keyword: keyword.value.trim(),
        statusId: '',
        priority: 0,
        templateId: '',
        handlerId: '',
      })) as { list: TicketRow[]; total: number };
      rows.value = result?.list ?? [];
      total.value = result?.total ?? 0;
    } finally {
      loading.value = false;
    }
  }

  function reload() {
    current.value = 1;
    load();
  }

  function changeView(value: string) {
    view.value = value;
    reload();
  }

  async function recycle(id: string) {
    await recycleTicket(id);
    message.success(t('common.saveSuccess'));
    load();
  }

  async function recover(id: string) {
    await recoverTicket([id]);
    message.success(t('common.saveSuccess'));
    load();
  }

  async function purge(id: string) {
    await purgeTicket([id]);
    message.success(t('common.saveSuccess'));
    load();
  }

  const columns = computed<DataTableColumns<TicketRow>>(() => {
    const base: DataTableColumns<TicketRow> = [
      {
        title: t('ticket.column.number'),
        key: 'number',
        width: 188,
        ellipsis: { tooltip: true },
      },
      {
        title: t('ticket.column.title'),
        key: 'title',
        minWidth: 160,
        ellipsis: { tooltip: true },
        render: (row) =>
          h('a', { class: 'cursor-pointer text-[var(--primary-8)]', onClick: () => openDetail(row.id) }, row.title),
      },
      {
        title: t('ticket.column.status'),
        key: 'statusName',
        width: 110,
        render: (row) =>
          h('span', { class: 'inline-flex items-center gap-[6px]' }, [
            h('i', {
              class: 'inline-block h-[8px] w-[8px] rounded-full',
              style: { background: row.statusColor || '#999' },
            }),
            row.statusName,
          ]),
      },
      {
        title: t('ticket.satisfy'),
        key: 'satisfyScore',
        width: 88,
        render: (row) => {
          if (row.satisfyScore) {
            return `${row.satisfyScore}${t('ticket.satisfy.score')}`;
          }
          return row.endTime ? t('ticket.satisfy.pending') : '-';
        },
      },
      {
        title: t('ticket.column.priority'),
        key: 'priority',
        width: 90,
        render: (row) => t(`ticket.priority.${row.priority}`),
      },
      { title: t('ticket.column.publisher'), key: 'publisherName', width: 120 },
      {
        title: t('ticket.column.handler'),
        key: 'handlerName',
        width: 120,
        render: (row) => row.handlerName || t('ticket.unassigned'),
      },
      { title: t('ticket.column.department'), key: 'departmentName', width: 110, ellipsis: { tooltip: true } },
      { title: t('ticket.column.customer'), key: 'customerName', width: 100, ellipsis: { tooltip: true } },
      {
        title: t('ticket.column.created'),
        key: 'createTime',
        width: 148,
        render: (row) => dayjs(row.createTime).format('YYYY-MM-DD HH:mm'),
      },
    ];
    if (canDelete.value) {
      base.push({
        title: t('ticket.column.action'),
        key: 'actions',
        width: view.value === 'recycle' ? 148 : 64,
        render: (row) =>
          h(
            'div',
            { class: 'flex gap-[8px]' },
            view.value === 'recycle'
              ? [
                  h(
                    NButton,
                    { text: true, type: 'primary', onClick: () => recover(row.id) },
                    { default: () => t('ticket.recover') }
                  ),
                  h(
                    NButton,
                    { text: true, type: 'error', onClick: () => purge(row.id) },
                    { default: () => t('ticket.purge') }
                  ),
                ]
              : [
                  h(
                    NButton,
                    { text: true, type: 'error', onClick: () => recycle(row.id) },
                    { default: () => t('ticket.recycle') }
                  ),
                ]
          ),
      });
    }
    return base;
  });

  watch(
    () => route.query.id,
    (id) => {
      if (typeof id === 'string' && id) {
        openDetail(id);
      }
    },
    { immediate: true }
  );

  onMounted(load);
</script>
