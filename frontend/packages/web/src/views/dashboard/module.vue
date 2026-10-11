<template>
  <CrmCard no-content-padding hide-footer>
    <n-spin class="block h-full flex-1" :show="loading" content-class="h-full">
      <opportunity-board v-if="isError" />
      <iframe v-else id="iframe-dashboard-view" style="width: 100%; height: 100%; border: 0" :src="iframeSrc"></iframe>
    </n-spin>
  </CrmCard>
</template>

<script setup lang="ts">
  import { NSpin } from 'naive-ui';

  import CrmCard from '@/components/pure/crm-card/index.vue';
  import opportunityBoard from './components/opportunityBoard.vue';

  import { getDEToken } from '@/api/modules';
  import isVendorSite from '@/utils/vendor-site';

  const loading = ref(false);
  const isError = ref(false);
  const iframeSrc = ref('');
  const params = {
    // 固定写法 DashboardPanel 仪表板模块。
    'type': 'DashboardPanel',
    //  JWT token 认证
    'embeddedToken': '',
    // 固定写法
    'de-embedded': true,
  };

  const onMessage = (event: MessageEvent) => {
    const iframe = document.getElementById('iframe-dashboard-view') as HTMLIFrameElement | null;
    if (!iframe?.contentWindow || event.source !== iframe.contentWindow) {
      return;
    }
    if (!event.origin || isVendorSite(event.origin)) {
      return;
    }
    if (event.data?.msgOrigin === 'de-fit2cloud') {
      iframe.contentWindow.postMessage(params, event.origin);
      loading.value = false;
    }
  };

  async function init() {
    try {
      loading.value = true;
      isError.value = false;
      const res = await getDEToken(true);
      if (!res?.url || isVendorSite(res.url)) {
        params.embeddedToken = '';
        iframeSrc.value = '';
        isError.value = true;
        return;
      }
      params.embeddedToken = res.token;
      iframeSrc.value = `${res.url}/#/chart-view`;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error initializing dashboard:', error);
      isError.value = true;
    } finally {
      loading.value = false;
    }
  }

  onBeforeMount(() => {
    window.addEventListener('message', onMessage, false);
    init();
  });

  onUnmounted(() => {
    window.removeEventListener('message', onMessage, false);
  });
</script>

<style lang="less" scoped></style>
