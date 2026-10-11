<template>
  <div class="rounded-[8px] border border-[var(--text-n8)] px-[12px] pb-[12px]">
    <n-tabs v-model:value="tab" type="line" size="small">
      <n-tab-pane name="reply" :tab="t('ticket.reply')" />
      <n-tab-pane name="internal" :tab="t('ticket.internal')" />
    </n-tabs>
    <n-input v-model:value="content" type="textarea" :rows="3" :placeholder="t('ticket.replyPlaceholder')" />
    <div v-if="tab === 'internal'" class="mt-[8px]">
      <n-select
        v-model:value="mentionUserIds"
        multiple
        filterable
        :options="userOptions"
        :placeholder="t('ticket.field.cc')"
      />
    </div>
    <div class="mt-[8px] flex justify-end">
      <n-button type="primary" size="small" :disabled="!content.trim()" :loading="saving" @click="submit">{{
        t('ticket.reply')
      }}</n-button>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { NButton, NInput, NSelect, NTabPane, NTabs } from 'naive-ui';

  import { useI18n } from '@lib/shared/hooks/useI18n';

  defineProps<{
    userOptions: Array<{ label: string; value: string }>;
    saving: boolean;
  }>();
  const emit = defineEmits<{
    (e: 'submit', payload: { tab: 'reply' | 'internal'; content: string; mentionUserIds: string[] }): void;
  }>();
  const { t } = useI18n();
  const tab = ref<'reply' | 'internal'>('reply');
  const content = ref('');
  const mentionUserIds = ref<string[]>([]);

  function submit() {
    emit('submit', { tab: tab.value, content: content.value, mentionUserIds: mentionUserIds.value });
  }

  function clear() {
    content.value = '';
    mentionUserIds.value = [];
  }

  defineExpose({ clear });
</script>
