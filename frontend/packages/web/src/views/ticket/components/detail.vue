<template>
  <n-drawer v-model:show="show" :width="920" placement="right">
    <n-drawer-content closable body-content-class="!p-0">
      <template #header>
        <div class="min-w-0 pr-[24px]">
          <div class="truncate text-[16px] font-medium leading-[24px]">{{ detail?.title || t('ticket.detail') }}</div>
          <div v-if="detail" class="mt-[2px] truncate text-[12px] leading-[18px] text-[var(--text-n3)]">
            {{ detail.number }} · {{ detail.templateName }}
          </div>
        </div>
      </template>
      <n-spin :show="loading">
        <div v-if="detail" class="flex min-h-[calc(100vh-88px)] items-stretch">
          <div class="min-w-0 flex-1 px-[20px] py-[16px]">
            <div v-if="editing" class="mb-[16px] rounded-[8px] bg-[var(--text-n9)] p-[16px]">
              <n-input v-model:value="editTitle" class="mb-[8px]" />
              <n-input
                v-for="field in fields"
                :key="field.fieldId"
                v-model:value="field.fieldValue"
                type="textarea"
                class="mb-[8px]"
                :placeholder="fieldName(field.fieldId)"
              />
              <div class="flex justify-end">
                <n-button type="primary" size="small" @click="saveEdit">{{ t('ticket.save') }}</n-button>
              </div>
            </div>
            <div v-else class="mb-[16px] rounded-[8px] bg-[var(--text-n9)] p-[16px]">
              <div v-for="field in descriptionFields" :key="field.fieldId" class="mb-[12px] last:mb-0">
                <div class="mb-[4px] text-[12px] leading-[18px] text-[var(--text-n3)]">{{
                  fieldName(field.fieldId)
                }}</div>
                <div class="whitespace-pre-wrap leading-[22px]">{{ field.fieldValue || '-' }}</div>
              </div>
              <n-button v-if="canEdit" text type="primary" class="mt-[4px]" @click="startEdit">{{
                t('ticket.edit')
              }}</n-button>
            </div>
            <div
              v-for="item in detail.replies"
              :key="item.id"
              class="mb-[12px] rounded-[8px] border border-[var(--text-n8)] px-[16px] py-[12px]"
            >
              <div class="mb-[6px] flex items-center justify-between gap-[12px] text-[12px] text-[var(--text-n3)]">
                <span>{{ item.userName }}</span>
                <span class="shrink-0">{{ formatTime(item.createTime) }}</span>
              </div>
              <div class="whitespace-pre-wrap leading-[22px]">{{ item.content }}</div>
            </div>
            <div
              v-for="item in visibleInternalReplies"
              :key="item.id"
              class="mb-[12px] rounded-[8px] bg-[var(--text-n9)] px-[16px] py-[12px]"
            >
              <div class="mb-[6px] flex items-center justify-between gap-[12px] text-[12px] text-[var(--text-n3)]">
                <span>{{ t('ticket.internal') }} · {{ item.userName }}</span>
                <span class="shrink-0">{{ formatTime(item.createTime) }}</span>
              </div>
              <div class="whitespace-pre-wrap leading-[22px]">{{ item.content }}</div>
            </div>
            <div v-if="showRestart" class="mt-[8px]">
              <n-button type="primary" @click="restart">{{ t('ticket.restart') }}</n-button>
            </div>
            <ReplyBox
              v-else-if="canReply"
              ref="replyRef"
              :user-options="userOptions"
              :saving="acting"
              @submit="sendReply"
            />
          </div>
          <div class="w-[280px] shrink-0 border-l border-[var(--text-n8)] bg-[var(--text-n9)] px-[16px] py-[16px]">
            <n-form label-placement="left" label-width="64" size="small" :show-feedback="false">
              <n-form-item :label="t('ticket.column.status')" class="mb-[12px]">
                <n-select
                  :value="detail.statusId"
                  :options="statusOptions"
                  :disabled="!canUpdate"
                  @update:value="changeStatus"
                />
              </n-form-item>
              <n-form-item :label="t('ticket.column.priority')" class="mb-[12px]">
                <n-select
                  :value="detail.priority"
                  :options="priorityOptions"
                  :disabled="!canUpdate"
                  @update:value="changePriority"
                />
              </n-form-item>
              <n-form-item :label="t('ticket.column.handler')" class="mb-[12px]">
                <div class="flex w-full items-center justify-between gap-[8px]">
                  <span class="min-w-0 truncate">{{ detail.handlerName || t('ticket.unassigned') }}</span>
                  <n-button v-if="canUpdate" text type="primary" class="shrink-0" @click="showAssign = true">{{
                    t('ticket.assign')
                  }}</n-button>
                </div>
              </n-form-item>
              <n-form-item :label="t('ticket.column.publisher')" class="mb-[12px]">
                <span class="truncate">{{ detail.publisherName || t('ticket.public.guest') }}</span>
              </n-form-item>
              <n-form-item v-if="detail.mobile" :label="t('ticket.field.mobile')" class="mb-[12px]">
                <span class="truncate">{{ detail.mobile }}</span>
              </n-form-item>
              <n-form-item v-if="detail.mail" :label="t('ticket.field.mail')" class="mb-[12px]">
                <span class="truncate">{{ detail.mail }}</span>
              </n-form-item>
              <n-form-item v-if="detail.customerName" :label="t('ticket.column.customer')" class="mb-[12px]">
                <a
                  v-if="canOpenCustomer"
                  class="cursor-pointer truncate text-[var(--primary-8)]"
                  @click="showCustomer = true"
                  >{{ detail.customerName }}</a
                >
                <span v-else class="truncate">{{ detail.customerName }}</span>
              </n-form-item>
            </n-form>
            <div class="mb-[16px] flex gap-[8px]">
              <n-button v-if="canUpdate" size="small" @click="toggleFollow">
                {{ detail.followed ? t('ticket.unfollow') : t('ticket.follow') }}
              </n-button>
              <n-button v-if="canUpdate" size="small" @click="showUrge = true">{{ t('ticket.urge') }}</n-button>
            </div>
            <div v-if="canSatisfy" class="mb-[16px] border-t border-[var(--text-n8)] pt-[16px]">
              <div class="mb-[8px] text-[13px] font-medium">{{ t('ticket.satisfy.customer') }}</div>
              <n-rate v-model:value="score" />
              <n-input v-model:value="advice" class="mt-[8px]" type="textarea" :placeholder="t('ticket.advice')" />
              <n-button class="mt-[8px]" type="primary" size="small" @click="submitSatisfy">{{
                t('ticket.save')
              }}</n-button>
            </div>
            <div v-else-if="detail.satisfy" class="mb-[16px] border-t border-[var(--text-n8)] pt-[16px]">
              <div class="mb-[8px] text-[13px] font-medium">{{ t('ticket.satisfy.customer') }}</div>
              <n-rate :value="detail.satisfy.score" readonly />
              <div v-if="detail.satisfy.advice" class="mt-[6px] text-[13px] leading-[20px]">{{
                detail.satisfy.advice
              }}</div>
            </div>
            <div v-else-if="awaitingSatisfy" class="mb-[16px] border-t border-[var(--text-n8)] pt-[16px]">
              <div class="mb-[4px] text-[13px] font-medium">{{ t('ticket.satisfy.customer') }}</div>
              <div class="text-[13px] text-[var(--text-n3)]">{{ t('ticket.satisfy.wait') }}</div>
            </div>
            <div class="border-t border-[var(--text-n8)] pt-[16px]">
              <div class="mb-[12px] text-[13px] font-medium">{{ t('ticket.event') }}</div>
              <div v-for="event in detail.events" :key="String(event.id)" class="mb-[14px] last:mb-0">
                <div class="text-[13px] leading-[20px]">{{ eventLabel(String(event.eventType ?? '')) }}</div>
                <div class="mt-[2px] text-[12px] leading-[18px] text-[var(--text-n3)]">
                  {{ event.userName }} · {{ formatTime(Number(event.createTime)) }}
                </div>
                <div v-if="event.content" class="mt-[2px] break-all text-[12px] leading-[18px] text-[var(--text-n2)]">
                  {{ event.content }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </n-spin>
    </n-drawer-content>
  </n-drawer>
  <n-modal v-model:show="showAssign" preset="card" :title="t('ticket.assign')" class="w-[420px]">
    <n-select v-model:value="assignDepartmentId" class="mb-[8px]" :options="departmentOptions" />
    <n-select v-model:value="assignHandlerId" :options="departmentUsers" />
    <template #footer>
      <n-button type="primary" @click="submitAssign">{{ t('common.save') }}</n-button>
    </template>
  </n-modal>
  <n-modal v-model:show="showUrge" preset="card" :title="t('ticket.urge')" class="w-[420px]">
    <n-select v-model:value="urgeUserIds" multiple :options="userOptions" />
    <n-input v-model:value="urgeContent" class="mt-[8px]" type="textarea" />
    <template #footer>
      <n-button type="primary" @click="submitUrge">{{ t('common.save') }}</n-button>
    </template>
  </n-modal>
  <customerOverviewDrawer v-model:show="showCustomer" :source-id="detail?.customerId || ''" />
</template>

<script setup lang="ts">
  import {
    NButton,
    NDrawer,
    NDrawerContent,
    NForm,
    NFormItem,
    NInput,
    NModal,
    NRate,
    NSelect,
    NSpin,
    useMessage,
  } from 'naive-ui';
  import dayjs from 'dayjs';

  import { useI18n } from '@lib/shared/hooks/useI18n';

  import ReplyBox from './replyBox.vue';
  import customerOverviewDrawer from '@/views/customer/components/customerOverviewDrawer.vue';

  import {
    assignTicket,
    changeTicketPriority,
    changeTicketStatus,
    followTicket,
    getTicket,
    getTicketForm,
    getTicketOptions,
    internalReplyTicket,
    replyTicket,
    restartTicket,
    satisfyTicket,
    updateTicket,
    urgeTicket,
  } from '@/api/modules';
  import useUserStore from '@/store/modules/user';
  import { hasAnyPermission } from '@/utils/permission';

  interface FieldValue {
    fieldId: string;
    fieldValue: string;
  }
  interface ReplyItem {
    id: string;
    userName: string;
    content: string;
    createTime: number;
  }
  interface TicketDetailData {
    id: string;
    number: string;
    title: string;
    templateName: string;
    statusId: string;
    priority: number;
    publisherId: string;
    publisherName: string;
    handlerName: string;
    customerId: string | null;
    customerName: string;
    endTime: number | null;
    recycled: boolean;
    moduleFields: FieldValue[];
    replies: ReplyItem[];
    internalReplies: ReplyItem[];
    files: Array<{ fileId: string; replyId: string | null; internalReplyId: string | null }>;
    events: Array<Record<string, unknown>>;
    followed: boolean;
    satisfy: { score: number; advice: string } | null;
    config: { replyAfterClose: boolean; satisfyEnabled: boolean };
    deadline: number | null;
    mobile: string | null;
    mail: string | null;
  }

  const show = defineModel<boolean>('show', { required: true });
  const props = defineProps<{ sourceId: string }>();
  const emit = defineEmits<{ (e: 'changed'): void }>();
  const { t } = useI18n();
  const message = useMessage();

  const loading = ref(false);
  const acting = ref(false);
  const detail = ref<TicketDetailData | null>(null);
  const fieldNames = ref<Record<string, string>>({});
  const statusOptions = ref<Array<{ label: string; value: string }>>([]);
  const userOptions = ref<Array<{ label: string; value: string; departmentId: string | null }>>([]);
  const departmentOptions = ref<Array<{ label: string; value: string }>>([]);
  const editing = ref(false);
  const editTitle = ref('');
  const fields = ref<FieldValue[]>([]);
  const showAssign = ref(false);
  const showUrge = ref(false);
  const showCustomer = ref(false);
  const assignDepartmentId = ref<string | null>(null);
  const assignHandlerId = ref<string | null>(null);
  const urgeUserIds = ref<string[]>([]);
  const urgeContent = ref('');
  const score = ref(5);
  const advice = ref('');
  const replyRef = ref<{ clear: () => void } | null>(null);
  const userStore = useUserStore();
  const currentUserId = computed(() => userStore.userInfo.id);

  const priorityOptions = computed(() =>
    [1, 2, 3, 4].map((value) => ({ label: t(`ticket.priority.${value}`), value }))
  );
  const canUpdate = computed(() => hasAnyPermission(['TICKET:UPDATE']) && !detail.value?.recycled);
  const canReply = computed(() => hasAnyPermission(['TICKET:REPLY']) && !detail.value?.recycled);
  const canSeeInternal = computed(() => hasAnyPermission(['TICKET:UPDATE', 'TICKET:REPLY']));
  const visibleInternalReplies = computed(() => (canSeeInternal.value ? detail.value?.internalReplies ?? [] : []));
  const canEdit = computed(() => canUpdate.value && !detail.value?.endTime);
  const showRestart = computed(
    () => Boolean(detail.value?.endTime) && canReply.value && !detail.value?.config.replyAfterClose
  );
  const canSatisfy = computed(() => {
    const current = detail.value;
    if (!current?.endTime || current.satisfy || !current.config.satisfyEnabled) {
      return false;
    }
    return current.publisherId === currentUserId.value;
  });
  const awaitingSatisfy = computed(() => {
    const current = detail.value;
    return Boolean(current?.endTime && current.config.satisfyEnabled && !current.satisfy && !canSatisfy.value);
  });
  const canOpenCustomer = computed(
    () => hasAnyPermission(['CUSTOMER_MANAGEMENT:READ']) && Boolean(detail.value?.customerId)
  );
  const departmentUsers = computed(() =>
    userOptions.value
      .filter((item) => item.departmentId === assignDepartmentId.value)
      .map((item) => ({ label: item.label, value: item.value }))
  );

  function eventLabel(eventType: string) {
    const key = `ticket.event.${eventType}`;
    const label = t(key);
    return label === key ? eventType : label;
  }

  function formatTime(value: number) {
    return value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '';
  }

  function fieldName(fieldId: string) {
    return fieldNames.value[fieldId] || fieldId;
  }

  const descriptionFields = computed(() =>
    (detail.value?.moduleFields ?? []).filter((field) => fieldName(field.fieldId) !== t('ticket.column.priority'))
  );

  async function load() {
    if (!props.sourceId) {
      return;
    }
    loading.value = true;
    editing.value = false;
    try {
      const [ticket, formConfig, options] = await Promise.all([
        getTicket(props.sourceId) as Promise<TicketDetailData>,
        getTicketForm() as Promise<{ fields: Array<{ id: string; name: string }> }>,
        getTicketOptions() as Promise<{
          statuses: Array<{ id: string; name: string }>;
          users: Array<{ id: string; name: string; departmentId: string | null }>;
          departments: Array<{ id: string; name: string }>;
        }>,
      ]);
      detail.value = ticket;
      fieldNames.value = Object.fromEntries((formConfig.fields ?? []).map((field) => [field.id, field.name]));
      statusOptions.value = (options.statuses ?? []).map((item) => ({ label: item.name, value: item.id }));
      userOptions.value = (options.users ?? []).map((item) => ({
        label: item.name,
        value: item.id,
        departmentId: item.departmentId,
      }));
      departmentOptions.value = (options.departments ?? []).map((item) => ({ label: item.name, value: item.id }));
    } finally {
      loading.value = false;
    }
  }

  function startEdit() {
    if (!detail.value) {
      return;
    }
    editing.value = true;
    editTitle.value = detail.value.title;
    fields.value = detail.value.moduleFields.map((field) => ({ ...field }));
  }

  async function saveEdit() {
    if (!detail.value) {
      return;
    }
    await updateTicket({
      id: detail.value.id,
      title: editTitle.value,
      priority: detail.value.priority,
      customerId: detail.value.customerId ?? '',
      mobile: detail.value.mobile ?? '',
      mail: detail.value.mail ?? '',
      deadline: detail.value.deadline,
      moduleFields: fields.value,
      fileIds: (detail.value.files ?? [])
        .filter((file) => !file.replyId && !file.internalReplyId)
        .map((file) => file.fileId),
    });
    message.success(t('common.saveSuccess'));
    emit('changed');
    await load();
  }

  async function changeStatus(statusId: string) {
    if (!detail.value) {
      return;
    }
    await changeTicketStatus({ id: detail.value.id, statusId });
    emit('changed');
    await load();
  }

  async function changePriority(priority: number) {
    if (!detail.value) {
      return;
    }
    await changeTicketPriority({ id: detail.value.id, priority });
    emit('changed');
    await load();
  }

  async function sendReply(payload: { tab: 'reply' | 'internal'; content: string; mentionUserIds: string[] }) {
    if (!detail.value) {
      return;
    }
    acting.value = true;
    try {
      if (payload.tab === 'internal') {
        await internalReplyTicket({
          id: detail.value.id,
          content: payload.content,
          mentionUserIds: payload.mentionUserIds,
          fileIds: [],
        });
      } else {
        await replyTicket({ id: detail.value.id, content: payload.content, fileIds: [] });
      }
      replyRef.value?.clear();
      emit('changed');
      await load();
    } finally {
      acting.value = false;
    }
  }

  async function restart() {
    if (!detail.value) {
      return;
    }
    await restartTicket(detail.value.id);
    emit('changed');
    await load();
  }

  async function toggleFollow() {
    if (!detail.value) {
      return;
    }
    await followTicket({ id: detail.value.id, follow: !detail.value.followed });
    await load();
  }

  async function submitAssign() {
    if (!detail.value || !assignDepartmentId.value || !assignHandlerId.value) {
      return;
    }
    await assignTicket({
      id: detail.value.id,
      departmentId: assignDepartmentId.value,
      handlerId: assignHandlerId.value,
    });
    showAssign.value = false;
    emit('changed');
    await load();
  }

  async function submitUrge() {
    if (!detail.value || urgeUserIds.value.length === 0) {
      return;
    }
    await urgeTicket({ id: detail.value.id, userIds: urgeUserIds.value, content: urgeContent.value });
    showUrge.value = false;
    urgeContent.value = '';
    await load();
  }

  async function submitSatisfy() {
    if (!detail.value) {
      return;
    }
    await satisfyTicket({ id: detail.value.id, score: score.value, advice: advice.value });
    emit('changed');
    await load();
  }

  watch(
    () => [show.value, props.sourceId] as const,
    ([visible, id]) => {
      if (visible && id) {
        load();
      }
    }
  );
</script>
