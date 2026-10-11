<template>
  <CrmModal v-model:show="showModal" size="small" :title="t('common.update')" @cancel="cancel">
    <n-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-placement="left"
      require-mark-placement="left"
      :label-width="80"
    >
      <n-form-item path="phone" :label="t('system.personal.phone')">
        <n-input v-model:value="form.phone" :placeholder="t('common.pleaseInput')" />
      </n-form-item>
      <n-form-item path="email" :label="t('system.personal.email')">
        <n-input v-model:value="form.email" :placeholder="t('common.pleaseInput')" />
      </n-form-item>
      <n-form-item v-if="emailChanged" :label="t('system.personal.code')">
        <div class="flex w-full gap-[8px]">
          <n-input v-model:value="mailCode" maxlength="6" :placeholder="t('common.pleaseInput')" />
          <n-button :disabled="codeWait > 0 || sendingCode" @click="sendCode">
            {{ codeWait > 0 ? `${codeWait}s` : t('system.personal.getCode') }}
          </n-button>
        </div>
      </n-form-item>
    </n-form>
    <template #footer>
      <div class="flex w-full items-center justify-end">
        <n-button :disabled="loading" secondary class="mx-[8px]" @click="cancel">
          {{ t('common.cancel') }}
        </n-button>
        <n-button :loading="loading" type="primary" @click="confirmHandler">
          {{ t('common.update') }}
        </n-button>
      </div>
    </template>
  </CrmModal>
</template>

<script setup lang="ts">
  import { computed, onUnmounted, ref } from 'vue';
  import { FormInst, FormItemRule, FormRules, NButton, NForm, NFormItem, NInput, useMessage } from 'naive-ui';

  import { useI18n } from '@lib/shared/hooks/useI18n';
  import { validateEmail, validatePhone } from '@lib/shared/method/validate';
  import { PersonalInfoRequest } from '@lib/shared/models/system/business';

  import CrmModal from '@/components/pure/crm-modal/index.vue';

  import { sendEmailCode, updatePersonalInfo } from '@/api/modules';
  import useUserStore from '@/store/modules/user';

  const { t } = useI18n();
  const Message = useMessage();

  const props = defineProps<{
    integration?: PersonalInfoRequest;
  }>();

  const showModal = defineModel<boolean>('show', {
    required: true,
    default: false,
  });

  const emit = defineEmits<{
    (e: 'initSync'): void;
  }>();

  const form = ref<PersonalInfoRequest>({
    phone: '',
    email: '',
  });
  const mailCode = ref('');
  const sendingCode = ref(false);
  const codeWait = ref(0);
  let codeTimer = 0;
  const emailChanged = computed(() => form.value.email.trim() !== (props.integration?.email ?? '').trim());

  const userStore = useUserStore();

  watch(
    () => props.integration,
    (val) => {
      if (val) {
        form.value = { ...val };
      }
    },
    { deep: true }
  );

  function validatePhoneLength(rule: FormItemRule, value: string): boolean | Error {
    if (userStore.isAdmin) {
      return true;
    }
    if (!value) {
      return new Error(t('common.notNull', { value: `${t('common.phoneNumber')}` }));
    }
    if (!validatePhone(value)) {
      return new Error(t('common.userPhoneErrTip'));
    }
    return true;
  }

  function validateEmailStyle(rule: FormItemRule, value: string): boolean | Error {
    if (userStore.isAdmin) {
      return true;
    }
    if (!value) {
      return new Error(t('common.notNull', { value: `${t('org.userEmail')}` }));
    }
    if (!validateEmail(value)) {
      return new Error(t('common.emailErrTip'));
    }
    return true;
  }

  const rules: FormRules = {
    phone: [{ required: true, validator: validatePhoneLength, trigger: ['input', 'blur'] }],
    email: [{ required: true, validator: validateEmailStyle, trigger: ['input', 'blur'] }],
  };

  const formRef = ref<FormInst | null>(null);
  function cancel() {
    if (props.integration) {
      form.value = { ...props.integration };
    }
    showModal.value = false;
  }
  /** *
   * 保存
   */
  const loading = ref(false);

  function sendCode() {
    if (!validateEmail(form.value.email)) {
      Message.error(t('common.emailErrTip'));
      return;
    }
    sendingCode.value = true;
    sendEmailCode(form.value.email)
      .then(() => {
        Message.success(t('system.personal.codeSent'));
        codeWait.value = 60;
        window.clearInterval(codeTimer);
        codeTimer = window.setInterval(() => {
          codeWait.value -= 1;
          if (codeWait.value <= 0) {
            window.clearInterval(codeTimer);
          }
        }, 1000);
      })
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.log(error);
      })
      .finally(() => {
        sendingCode.value = false;
      });
  }

  onUnmounted(() => {
    window.clearInterval(codeTimer);
  });

  function confirmHandler() {
    formRef.value?.validate(async (error) => {
      if (!error) {
        if (emailChanged.value && !/^\d{6}$/.test(mailCode.value)) {
          Message.error(t('system.personal.codeRequired'));
          return;
        }
        try {
          loading.value = true;
          await updatePersonalInfo({ ...form.value, code: mailCode.value });
          Message.success(t('common.updateSuccess'));
          showModal.value = false;
          emit('initSync');
        } catch (e) {
          // eslint-disable-next-line no-console
          console.log(e);
        } finally {
          loading.value = false;
        }
      }
    });
  }
</script>
