<template>
  <div>
    <n-data-table
      remote
      :columns="columns"
      :data="rows"
      :loading="loading"
      :pagination="pagination"
      :bordered="false"
      @update:page="changePage"
    />
    <TicketDetail v-model:show="showDetail" :source-id="activeId" />
  </div>
</template>

<script setup lang="ts">
  import { NButton, NDataTable } from 'naive-ui';
  import dayjs from 'dayjs';

  import { useI18n } from '@lib/shared/hooks/useI18n';

  import TicketDetail from './detail.vue';

  import { pageAccountTicket } from '@/api/modules';

  interface TicketRow {
    id: string;
    number: string;
    title: string;
    statusName: string;
    statusColor: string;
    handlerName: string;
    createTime: number;
  }

  const props = defineProps<{ sourceId: string }>();
  const { t } = useI18n();

  const rows = ref<TicketRow[]>([]);
  const loading = ref(false);
  const current = ref(1);
  const pageSize = ref(10);
  const total = ref(0);
  const showDetail = ref(false);
  const activeId = ref('');

  function openDetail(id: string) {
    activeId.value = id;
    showDetail.value = true;
  }

  const columns = computed(() => [
    {
      title: t('ticket.column.number'),
      key: 'number',
      width: 168,
      ellipsis: { tooltip: true },
    },
    {
      title: t('ticket.column.title'),
      key: 'title',
      ellipsis: { tooltip: true },
      render: (row: TicketRow) =>
        h(NButton, { text: true, type: 'primary', onClick: () => openDetail(row.id) }, { default: () => row.title }),
    },
    {
      title: t('ticket.column.status'),
      key: 'statusName',
      width: 110,
      render: (row: TicketRow) =>
        h('span', { class: 'inline-flex items-center gap-[6px]' }, [
          h('span', {
            class: 'inline-block h-[8px] w-[8px] rounded-full',
            style: { background: row.statusColor || '#b8d900' },
          }),
          row.statusName,
        ]),
    },
    {
      title: t('ticket.column.handler'),
      key: 'handlerName',
      width: 120,
      render: (row: TicketRow) => row.handlerName || t('ticket.unassigned'),
    },
    {
      title: t('ticket.column.created'),
      key: 'createTime',
      width: 148,
      render: (row: TicketRow) => (row.createTime ? dayjs(row.createTime).format('YYYY-MM-DD HH:mm') : ''),
    },
  ]);

  const pagination = computed(() => ({
    page: current.value,
    pageSize: pageSize.value,
    itemCount: total.value,
  }));

  async function load() {
    if (!props.sourceId) {
      rows.value = [];
      total.value = 0;
      return;
    }
    loading.value = true;
    try {
      const result = (await pageAccountTicket({
        current: current.value,
        pageSize: pageSize.value,
        customerId: props.sourceId,
        keyword: '',
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

  function changePage(page: number) {
    current.value = page;
    load();
  }

  watch(
    () => props.sourceId,
    () => {
      current.value = 1;
      load();
    },
    { immediate: true }
  );
</script>
