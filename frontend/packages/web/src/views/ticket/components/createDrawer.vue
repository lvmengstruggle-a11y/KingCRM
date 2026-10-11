<template>
  <n-drawer v-model:show="show" :width="560" placement="right">
    <n-drawer-content :title="t('ticket.create.title')" closable>
      <n-form label-placement="top">
        <n-form-item :label="t('ticket.field.template')" required>
          <n-select v-model:value="form.templateId" :options="templateOptions" @update:value="onTemplate" />
        </n-form-item>
        <n-form-item :label="t('ticket.field.title')" required>
          <n-input v-model:value="form.title" maxlength="255" />
        </n-form-item>
        <n-form-item :label="t('ticket.column.priority')">
          <n-select v-model:value="form.priority" :options="priorityOptions" />
        </n-form-item>
        <n-form-item v-for="field in fields" :key="field.id" :label="field.name" :required="field.required">
          <n-input v-if="field.type === 'TEXTAREA'" v-model:value="fieldValues[field.id]" type="textarea" :rows="4" />
          <n-select
            v-else-if="field.type === 'SELECT'"
            v-model:value="fieldValues[field.id]"
            :options="field.options"
          />
          <n-input v-else v-model:value="fieldValues[field.id]" />
        </n-form-item>
        <n-form-item v-if="template?.enableCustomer" :label="t('ticket.field.customer')">
          <n-select v-model:value="form.customerId" clearable filterable :options="customerOptions" />
        </n-form-item>
        <n-form-item v-if="template?.enableHandler" :label="t('ticket.field.handler')" required>
          <n-select v-model:value="form.handlerId" filterable :options="userOptions" />
        </n-form-item>
        <n-form-item v-if="template?.enableCc" :label="t('ticket.field.cc')">
          <n-select v-model:value="form.ccUserIds" multiple filterable :options="userOptions" />
        </n-form-item>
        <n-form-item v-if="template?.enableDeadline" :label="t('ticket.field.deadline')">
          <n-date-picker v-model:value="form.deadline" type="datetime" clearable class="w-full" />
        </n-form-item>
        <n-form-item
          v-if="template?.enableMobile"
          :label="t('ticket.field.mobile')"
          :required="template.mobileRequired"
        >
          <n-input v-model:value="form.mobile" />
        </n-form-item>
        <n-form-item v-if="template?.enableMail" :label="t('ticket.field.mail')" :required="template.mailRequired">
          <n-input v-model:value="form.mail" />
        </n-form-item>
        <n-form-item :label="t('ticket.field.files')">
          <n-upload :custom-request="uploadFile" multiple @remove="removeFile">
            <n-button>{{ t('ticket.field.files') }}</n-button>
          </n-upload>
        </n-form-item>
      </n-form>
      <template #footer>
        <n-button class="mr-[8px]" @click="show = false">{{ t('common.cancel') }}</n-button>
        <n-button type="primary" :loading="saving" @click="submit">{{ t('common.save') }}</n-button>
      </template>
    </n-drawer-content>
  </n-drawer>
</template>

<script setup lang="ts">
  import {
    NButton,
    NDatePicker,
    NDrawer,
    NDrawerContent,
    NForm,
    NFormItem,
    NInput,
    NSelect,
    NUpload,
    useMessage,
  } from 'naive-ui';

  import { useI18n } from '@lib/shared/hooks/useI18n';

  import { addTicket, getTicketForm, getTicketOptions, uploadTempFile } from '@/api/modules';

  import type { UploadCustomRequestOptions, UploadFileInfo } from 'naive-ui';

  interface TemplateItem {
    id: string;
    name: string;
    enableCustomer: boolean;
    enableCc: boolean;
    enableHandler: boolean;
    enableDeadline: boolean;
    enableMobile: boolean;
    mobileRequired: boolean;
    enableMail: boolean;
    mailRequired: boolean;
  }

  interface FormFieldItem {
    id: string;
    name: string;
    type: string;
    required: boolean;
    options: Array<{ label: string; value: string }>;
  }

  const show = defineModel<boolean>('show', { required: true });
  const emit = defineEmits<{ (e: 'saved'): void }>();
  const { t } = useI18n();
  const message = useMessage();

  const templates = ref<TemplateItem[]>([]);
  const fields = ref<FormFieldItem[]>([]);
  const fieldValues = reactive<Record<string, string>>({});
  const userOptions = ref<Array<{ label: string; value: string }>>([]);
  const customerOptions = ref<Array<{ label: string; value: string }>>([]);
  const fileIds = ref<string[]>([]);
  const saving = ref(false);
  const form = reactive({
    templateId: '',
    title: '',
    priority: 1,
    customerId: null as string | null,
    handlerId: null as string | null,
    ccUserIds: [] as string[],
    deadline: null as number | null,
    mobile: '',
    mail: '',
  });

  const template = computed(() => templates.value.find((item) => item.id === form.templateId));
  const templateOptions = computed(() => templates.value.map((item) => ({ label: item.name, value: item.id })));
  const priorityOptions = computed(() =>
    [1, 2, 3, 4].map((value) => ({ label: t(`ticket.priority.${value}`), value }))
  );

  function onTemplate() {
    form.handlerId = null;
    form.ccUserIds = [];
    form.customerId = null;
  }

  async function uploadFile({ file, onFinish, onError }: UploadCustomRequestOptions) {
    try {
      const result = await uploadTempFile(file.file as File);
      const ids = Array.isArray(result?.data) ? result.data : [];
      fileIds.value.push(...ids);
      onFinish();
    } catch {
      onError();
    }
  }

  function removeFile(info: { file: UploadFileInfo }) {
    const index = fileIds.value.findIndex((_, itemIndex) => info.file.id === String(itemIndex));
    if (index >= 0) {
      fileIds.value.splice(index, 1);
    }
    return true;
  }

  async function load() {
    const [options, formConfig] = await Promise.all([
      getTicketOptions() as Promise<{
        templates: TemplateItem[];
        users: Array<{ id: string; name: string }>;
        customers: Array<{ id: string; name: string }>;
      }>,
      getTicketForm() as Promise<{ fields: Array<Record<string, unknown>> }>,
    ]);
    templates.value = options.templates ?? [];
    if (!form.templateId && templates.value[0]) {
      form.templateId = templates.value[0].id;
    }
    userOptions.value = (options.users ?? []).map((item) => ({ label: item.name, value: item.id }));
    customerOptions.value = (options.customers ?? []).map((item) => ({ label: item.name, value: item.id }));
    fields.value = (formConfig.fields ?? [])
      .filter((field) => field.internalKey !== 'ticketPriority')
      .map((field) => {
        const rules = Array.isArray(field.rules) ? field.rules : [];
        const optionsOfField = Array.isArray(field.options)
          ? (field.options as Array<{ label: string; value: string }>)
          : [];
        return {
          id: String(field.id),
          name: String(field.name ?? ''),
          type: String(field.type ?? 'INPUT'),
          required: rules.some(
            (rule) => rule && typeof rule === 'object' && (rule as { key?: string }).key === 'required'
          ),
          options: optionsOfField,
        };
      });
    fields.value.forEach((field) => {
      if (fieldValues[field.id] == null) {
        fieldValues[field.id] = '';
      }
    });
  }

  async function submit() {
    if (!form.templateId || !form.title.trim()) {
      message.warning(t('ticket.field.title'));
      return;
    }
    saving.value = true;
    try {
      await addTicket({
        templateId: form.templateId,
        title: form.title.trim(),
        priority: form.priority,
        customerId: form.customerId ?? '',
        contractId: '',
        orderId: '',
        handlerId: form.handlerId ?? '',
        ccUserIds: form.ccUserIds,
        mobile: form.mobile,
        mail: form.mail,
        deadline: form.deadline,
        moduleFields: fields.value.map((field) => ({ fieldId: field.id, fieldValue: fieldValues[field.id] ?? '' })),
        fileIds: fileIds.value,
      });
      message.success(t('common.saveSuccess'));
      show.value = false;
      form.title = '';
      fileIds.value = [];
      window.setTimeout(() => emit('saved'), 300);
    } finally {
      saving.value = false;
    }
  }

  watch(show, (visible) => {
    if (visible) {
      load();
    }
  });
</script>
