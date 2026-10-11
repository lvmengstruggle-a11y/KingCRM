<template>
  <div class="flex min-h-screen items-center justify-center bg-[var(--text-n9)] px-[16px] py-[32px]">
    <div class="w-full max-w-[520px] rounded-[12px] bg-white px-[28px] py-[24px] shadow-sm">
      <n-tabs v-model:value="tab" type="line">
        <n-tab-pane name="create" :tab="t('ticket.public.title')">
          <div class="mb-[16px] text-[13px] leading-[20px] text-[var(--text-n3)]">{{ t('ticket.public.hint') }}</div>
          <div v-if="number">
            <div class="mb-[8px] text-[16px]">{{ t('ticket.public.done') }}</div>
            <div class="mb-[4px] text-[12px] text-[var(--text-n3)]">{{ t('ticket.public.number') }}</div>
            <div class="mb-[16px] text-[18px] font-medium tracking-wide text-[var(--primary-8)]">{{ number }}</div>
            <div class="flex gap-[8px]">
              <n-button type="primary" @click="goRate">{{ t('ticket.public.goRate') }}</n-button>
              <n-button @click="goLogin">{{ t('ticket.public.back') }}</n-button>
            </div>
          </div>
          <n-form v-else label-placement="top">
            <n-form-item :label="t('ticket.public.contact')" required>
              <n-input v-model:value="form.contactName" maxlength="32" />
            </n-form-item>
            <n-form-item :label="t('ticket.field.mobile')">
              <n-input v-model:value="form.mobile" maxlength="11" />
            </n-form-item>
            <n-form-item :label="t('ticket.field.mail')">
              <n-input v-model:value="form.mail" maxlength="128" />
            </n-form-item>
            <n-form-item :label="t('ticket.field.title')" required>
              <n-input v-model:value="form.title" maxlength="255" />
            </n-form-item>
            <n-form-item :label="t('ticket.column.priority')">
              <n-select v-model:value="form.priority" :options="priorityOptions" />
            </n-form-item>
            <n-form-item :label="t('ticket.public.content')" required>
              <n-input v-model:value="form.content" type="textarea" :rows="5" maxlength="4000" />
            </n-form-item>
            <div class="flex items-center justify-between">
              <a class="cursor-pointer text-[var(--primary-8)]" @click="goLogin">{{ t('ticket.public.back') }}</a>
              <n-button type="primary" :loading="saving" @click="submit">{{ t('ticket.public.submit') }}</n-button>
            </div>
          </n-form>
        </n-tab-pane>
        <n-tab-pane name="rate" :tab="t('ticket.public.rate')">
          <div class="mb-[16px] text-[13px] leading-[20px] text-[var(--text-n3)]">{{
            t('ticket.public.rateHint')
          }}</div>
          <n-form label-placement="top">
            <n-form-item :label="t('ticket.column.number')" required>
              <n-input v-model:value="rate.number" maxlength="32" />
            </n-form-item>
            <n-form-item :label="t('ticket.field.mobile')">
              <n-input v-model:value="rate.mobile" maxlength="11" />
            </n-form-item>
            <n-form-item :label="t('ticket.field.mail')">
              <n-input v-model:value="rate.mail" maxlength="128" />
            </n-form-item>
            <div class="mb-[16px] flex justify-end">
              <n-button :loading="looking" @click="lookup">{{ t('ticket.public.lookup') }}</n-button>
            </div>
          </n-form>
          <div v-if="looked" class="border-t border-[var(--text-n8)] pt-[16px]">
            <div class="mb-[4px] text-[16px] font-medium">{{ looked.title }}</div>
            <div class="mb-[12px] text-[13px] text-[var(--text-n3)]">{{ looked.statusName }}</div>
            <div v-if="looked.score" class="mb-[8px]">
              <div class="mb-[6px] text-[13px]">{{ t('ticket.public.rated') }}</div>
              <n-rate :value="looked.score" readonly />
              <div v-if="looked.advice" class="mt-[8px] text-[13px] leading-[20px]">{{ looked.advice }}</div>
            </div>
            <div v-else-if="looked.canRate">
              <div class="mb-[8px] text-[13px] font-medium">{{ t('ticket.satisfy.customer') }}</div>
              <n-rate v-model:value="rate.score" />
              <n-input
                v-model:value="rate.advice"
                class="mt-[8px]"
                type="textarea"
                maxlength="1000"
                :placeholder="t('ticket.advice')"
              />
              <div class="mt-[12px] flex justify-end">
                <n-button type="primary" :loading="rating" @click="rateTicket">{{
                  t('ticket.public.submit')
                }}</n-button>
              </div>
            </div>
            <div v-else class="text-[13px] text-[var(--text-n3)]">
              {{ looked.ended ? t('ticket.public.closed') : t('ticket.public.notEnded') }}
            </div>
          </div>
        </n-tab-pane>
      </n-tabs>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { useRouter } from 'vue-router';
  import { NButton, NForm, NFormItem, NInput, NRate, NSelect, NTabPane, NTabs, useMessage } from 'naive-ui';

  import { useI18n } from '@lib/shared/hooks/useI18n';

  import { lookupPublicSatisfy, publishPublicTicket, submitPublicSatisfy } from '@/api/modules';

  interface LookupResult {
    title: string;
    number: string;
    statusName: string;
    ended: boolean;
    canRate: boolean;
    score: number | null;
    advice: string;
  }

  const { t } = useI18n();
  const router = useRouter();
  const message = useMessage();
  const tab = ref('create');
  const saving = ref(false);
  const looking = ref(false);
  const rating = ref(false);
  const number = ref('');
  const looked = ref<LookupResult | null>(null);
  const form = reactive({
    contactName: '',
    mobile: '',
    mail: '',
    title: '',
    priority: 1,
    content: '',
  });
  const rate = reactive({
    number: '',
    mobile: '',
    mail: '',
    score: 5,
    advice: '',
  });
  const priorityOptions = computed(() =>
    [1, 2, 3, 4].map((value) => ({ label: t(`ticket.priority.${value}`), value }))
  );

  function goLogin() {
    router.push({ name: 'login' });
  }

  function goRate() {
    rate.number = number.value;
    rate.mobile = form.mobile;
    rate.mail = form.mail;
    looked.value = null;
    tab.value = 'rate';
  }

  async function submit() {
    if (!form.contactName.trim() || !form.title.trim() || !form.content.trim()) {
      message.warning(t('ticket.public.hint'));
      return;
    }
    if (!form.mobile.trim() && !form.mail.trim()) {
      message.warning(t('ticket.public.hint'));
      return;
    }
    saving.value = true;
    try {
      const result = (await publishPublicTicket({ ...form })) as { number?: string };
      number.value = result?.number ?? '';
    } finally {
      saving.value = false;
    }
  }

  async function lookup() {
    if (!rate.number.trim() || (!rate.mobile.trim() && !rate.mail.trim())) {
      message.warning(t('ticket.public.rateHint'));
      return;
    }
    looking.value = true;
    try {
      looked.value = (await lookupPublicSatisfy({
        number: rate.number,
        mobile: rate.mobile,
        mail: rate.mail,
      })) as LookupResult;
    } finally {
      looking.value = false;
    }
  }

  async function rateTicket() {
    rating.value = true;
    try {
      await submitPublicSatisfy({
        number: rate.number,
        mobile: rate.mobile,
        mail: rate.mail,
        score: rate.score,
        advice: rate.advice,
      });
      await lookup();
    } finally {
      rating.value = false;
    }
  }
</script>
