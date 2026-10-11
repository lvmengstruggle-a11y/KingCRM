<template>
  <CrmCard auto-height hide-footer>
    <div class="flex max-w-[720px] flex-col gap-[16px] p-[24px]">
      <div class="text-[16px] font-medium text-[var(--color-text-1)]">{{ t('system.business.demoData.title') }}</div>
      <div class="text-[14px] leading-[22px] text-[var(--text-n4)]">{{ t('system.business.demoData.desc') }}</div>
      <div class="text-[14px] text-[var(--color-text-1)]">
        {{
          t('system.business.demoData.summary', {
            products: counts.products,
            customers: counts.customers,
            clues: counts.clues,
            opportunities: counts.opportunities,
            contracts: counts.contracts,
            orders: counts.orders,
          })
        }}
      </div>
      <div class="flex gap-[8px]">
        <n-button v-permission="['SYSTEM_SETTING:UPDATE']" type="primary" :loading="creating" @click="createData">
          {{ t('system.business.demoData.create') }}
        </n-button>
        <n-button
          v-permission="['SYSTEM_SETTING:UPDATE']"
          type="error"
          ghost
          :loading="clearing"
          :disabled="total === 0"
          @click="clearData"
        >
          {{ t('system.business.demoData.clear') }}
        </n-button>
      </div>
    </div>
  </CrmCard>
</template>

<script setup lang="ts">
  import { NButton, useMessage } from 'naive-ui';

  import { useI18n } from '@lib/shared/hooks/useI18n';

  import CrmCard from '@/components/pure/crm-card/index.vue';

  import CDR from '@/api/http';
  import useModal from '@/hooks/useModal';

  interface DemoCounts {
    products: number;
    customers: number;
    clues: number;
    opportunities: number;
    contracts: number;
    orders: number;
  }

  const { t } = useI18n();
  const { openModal } = useModal();
  const Message = useMessage();
  const creating = ref(false);
  const clearing = ref(false);
  const counts = ref<DemoCounts>({
    products: 0,
    customers: 0,
    clues: 0,
    opportunities: 0,
    contracts: 0,
    orders: 0,
  });
  const total = computed(
    () =>
      counts.value.products +
      counts.value.customers +
      counts.value.clues +
      counts.value.opportunities +
      counts.value.contracts +
      counts.value.orders
  );

  async function loadStatus() {
    counts.value = await CDR.get<DemoCounts>({ url: '/system/demo-data' });
  }

  async function createData() {
    try {
      creating.value = true;
      counts.value = await CDR.post<DemoCounts>({ url: '/system/demo-data' });
      Message.success(t('system.business.demoData.created'));
    } finally {
      creating.value = false;
    }
  }

  function clearData() {
    openModal({
      title: t('system.business.demoData.clear'),
      type: 'warning',
      content: t('system.business.demoData.clearTip'),
      positiveText: t('common.confirm'),
      negativeText: t('common.cancel'),
      onPositiveClick: async () => {
        clearing.value = true;
        try {
          counts.value = await CDR.post<DemoCounts>({ url: '/system/demo-data/clear' });
          Message.success(t('system.business.demoData.cleared'));
        } finally {
          clearing.value = false;
        }
      },
    });
  }

  onMounted(() => {
    loadStatus();
  });
</script>
