<template>
  <n-spin :show="loading" class="min-h-[300px]">
    <CrmList
      v-if="list.length"
      v-model:data="list"
      :virtual-scroll-height="props.virtualScrollHeight"
      :key-field="props.keyField"
      :item-height="114"
      :mode="props.messageList ? 'static' : 'remote'"
      @reach-bottom="handleReachBottom"
    >
      <template #item="{ item }">
        <div class="crm-message-item py-[8px]">
          <div class="crm-message-item-content h-full w-full gap-[24px] p-[16px]">
            <div class="mb-[8px] flex w-full items-center justify-between gap-[24px]">
              <div class="flex min-w-0 items-center gap-[8px]">
                <CrmTag theme="light" :type="messageTagType(item)">
                  {{ messageTagLabel(item) }}
                </CrmTag>
                <n-badge class="crm-message-item__badge" dot :show="item.status === SystemMessageStatusEnum.UNREAD">
                  <n-tooltip :delay="300">
                    <template #trigger>
                      <div
                        :class="`one-line-text message-title--${
                          item.status === SystemMessageStatusEnum.UNREAD ? 'normal' : 'read'
                        } font-medium`"
                      >
                        {{ messageTitle(item) }}
                      </div>
                    </template>
                    {{ messageTitle(item) }}
                  </n-tooltip>
                </n-badge>
              </div>
              <n-button
                v-if="item.status === SystemMessageStatusEnum.UNREAD"
                type="primary"
                text
                class="set-read-button flex-shrink-0"
                @click="setMessageRead(item)"
              >
                {{ t('system.message.setRead') }}
              </n-button>
            </div>
            <div class="flex flex-col pl-[48px]">
              <div :class="getMessageContentClass(item)" @click="goDetail(item)">
                {{ messageBody(item) }}
                <span
                  v-if="item.type === SystemMessageTypeEnum.ANNOUNCEMENT_NOTICE"
                  class="ml-[8px] cursor-pointer text-[var(--primary-8)]"
                  @click="goUrl(item.contentText)"
                >
                  {{ parseMessageContent(item)?.renameUrl ?? parseMessageContent(item)?.url }}
                </span>
              </div>
              <div class="text-[var(--text-n4)]">
                {{ dayjs(item.createTime).format('YYYY-MM-DD HH:mm:ss') }}
              </div>
            </div>
          </div>
        </div>
      </template>
    </CrmList>
    <div
      v-else-if="props.messageList ? !list.length : !loading && finished"
      class="w-full p-[16px] text-center text-[var(--text-n4)]"
    >
      {{ props.emptyText || t('common.noData') }}
    </div>
  </n-spin>
  <DetailDrawer
    v-model:show="showFollowDetailDrawer"
    :form-key="followDetailFormKey"
    :source-id="followDetailSourceId"
    :source-name="followDetailSourceName"
    :refresh-key="followDetailRefreshKey"
    readonly
  />
</template>

<script lang="ts" setup>
  import { NBadge, NButton, NSpin, NTooltip } from 'naive-ui';
  import dayjs from 'dayjs';

  import { FormDesignKeyEnum } from '@lib/shared/enums/formDesignEnum';
  import { SystemMessageStatusEnum, SystemMessageTypeEnum } from '@lib/shared/enums/systemEnum';
  import { useI18n } from '@lib/shared/hooks/useI18n';
  import type { MessageCenterItem, MessageCenterSubsetParams } from '@lib/shared/models/system/message';

  import CrmList from '@/components/pure/crm-list/index.vue';
  import CrmTag from '@/components/pure/crm-tag/index.vue';
  import DetailDrawer from '@/components/business/crm-follow-drawer/components/detailDrawer.vue';

  import { getNotificationList, setNotificationRead } from '@/api/modules';
  import useOpenNewPage from '@/hooks/useOpenNewPage';
  import useAppStore from '@/store/modules/app';
  import { hasAnyPermission } from '@/utils/permission';

  import { AppRouteEnum } from '@/enums/routeEnum';

  const appStore = useAppStore();
  const { openNewPage } = useOpenNewPage();

  const { t } = useI18n();

  interface MessageDetailAction {
    permission: string[];
    action: (item: MessageCenterItem) => void;
  }

  const props = defineProps<{
    keyField: string;
    virtualScrollHeight: string;
    emptyText?: string;
    loadParams?: MessageCenterSubsetParams;
    messageList?: MessageCenterItem[];
  }>();

  const emit = defineEmits<{
    (e: 'refreshCount'): void;
  }>();

  function openNewPageQuotation(item: MessageCenterItem) {
    openNewPage(AppRouteEnum.OPPORTUNITY_QUOTATION, {
      id: item.resourceId,
    });
  }

  function openNewPageContract(item: MessageCenterItem) {
    openNewPage(AppRouteEnum.CONTRACT_INDEX, {
      id: item.resourceId,
    });
  }

  function openNewPageContractPaymentPlan(item: MessageCenterItem) {
    openNewPage(AppRouteEnum.CONTRACT_PAYMENT, {
      id: item.resourceId,
    });
  }

  const showFollowDetailDrawer = ref(false);
  const followDetailSourceId = ref('');
  const followDetailSourceName = ref('');
  const followDetailRefreshKey = ref(0);
  const followDetailFormKey = ref(FormDesignKeyEnum.FOLLOW_RECORD);

  function openFollowDetail(
    item: MessageCenterItem,
    formKey: FormDesignKeyEnum.FOLLOW_RECORD | FormDesignKeyEnum.FOLLOW_PLAN
  ) {
    followDetailSourceId.value = item.resourceId;
    followDetailSourceName.value = item.resourceName || '';
    followDetailFormKey.value = formKey;
    followDetailRefreshKey.value += 1;
    showFollowDetailDrawer.value = true;
  }

  function openFollowRecordDetail(item: MessageCenterItem) {
    openFollowDetail(item, FormDesignKeyEnum.FOLLOW_RECORD);
  }

  function openFollowPlanDetail(item: MessageCenterItem) {
    openFollowDetail(item, FormDesignKeyEnum.FOLLOW_PLAN);
  }

  const followPermission = ['CLUE_MANAGEMENT:READ', 'CUSTOMER_MANAGEMENT:READ', 'OPPORTUNITY_MANAGEMENT:READ'];

  const permissionConfig = {
    OPPORTUNITY_QUOTATION_READ: ['OPPORTUNITY_QUOTATION:READ'],
    CONTRACT_READ: ['CONTRACT:READ'],
    CONTRACT_PAYMENT_PLAN_READ: ['CONTRACT_PAYMENT_PLAN:READ'],
  };

  const followCommentDetailConfig = [
    {
      operation: 'FOLLOW_UP_RECORD_COMMENT',
      permission: followPermission,
      action: openFollowRecordDetail,
    },
    {
      operation: 'FOLLOW_UP_PLAN_COMMENT',
      permission: followPermission,
      action: openFollowPlanDetail,
    },
  ];

  function openTicket(item: MessageCenterItem) {
    openNewPage(AppRouteEnum.TICKET_INDEX, { id: item.resourceId });
  }

  const messageDetailConfig: Record<string, MessageDetailAction> = {
    BUSINESS_QUOTATION_EXPIRED: {
      permission: permissionConfig.OPPORTUNITY_QUOTATION_READ,
      action: openNewPageQuotation,
    },
    BUSINESS_QUOTATION_EXPIRING: {
      permission: permissionConfig.OPPORTUNITY_QUOTATION_READ,
      action: openNewPageQuotation,
    },
    CONTRACT_EXPIRED: {
      permission: permissionConfig.CONTRACT_READ,
      action: openNewPageContract,
    },
    CONTRACT_EXPIRING: {
      permission: permissionConfig.CONTRACT_READ,
      action: openNewPageContract,
    },
    CONTRACT_PAYMENT_EXPIRING: {
      permission: permissionConfig.CONTRACT_PAYMENT_PLAN_READ,
      action: openNewPageContractPaymentPlan,
    },
    CONTRACT_PAYMENT_EXPIRED: {
      permission: permissionConfig.CONTRACT_PAYMENT_PLAN_READ,
      action: openNewPageContractPaymentPlan,
    },
    ASSIGN: { permission: ['TICKET:READ'], action: openTicket },
    ASSIGN_MANAGER: { permission: ['TICKET:READ'], action: openTicket },
    CC: { permission: ['TICKET:READ'], action: openTicket },
    REPLY: { permission: ['TICKET:READ'], action: openTicket },
    INTERNAL: { permission: ['TICKET:READ'], action: openTicket },
    STATUS: { permission: ['TICKET:READ'], action: openTicket },
    CLOSE: { permission: ['TICKET:READ'], action: openTicket },
    SATISFY_INVITE: { permission: ['TICKET:READ'], action: openTicket },
    URGE: { permission: ['TICKET:READ'], action: openTicket },
    RESTART: { permission: ['TICKET:READ'], action: openTicket },
  };

  function getMessageDetailAction(operation: string) {
    return (
      followCommentDetailConfig.find((item) => operation.includes(item.operation)) || messageDetailConfig[operation]
    );
  }

  function getMessageContentClass(item: MessageCenterItem) {
    const detailAction = getMessageDetailAction(item.operation);
    if (detailAction && hasAnyPermission(detailAction.permission)) {
      return 'cursor-pointer text-[var(--primary-8)]';
    }

    return `message-title--${item.status === SystemMessageStatusEnum.UNREAD ? 'normal' : 'read'}`;
  }

  const innerKeyword = defineModel<string>('keyword', {
    required: false,
    default: null,
  });

  const list = ref<MessageCenterItem[]>([]);
  const loading = ref(false);

  const pageNation = ref({
    total: 0,
    pageSize: 10,
    current: 1,
  });

  function isTicketMessage(item: MessageCenterItem) {
    return item.type === 'TICKET' || item.resourceType === 'TICKET';
  }

  function parseMessageContent(item: MessageCenterItem) {
    try {
      const value = JSON.parse(item.contentText || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch {
      return { content: item.contentText };
    }
  }

  function messageTagType(item: MessageCenterItem) {
    if (isTicketMessage(item)) return 'primary';
    return item.type === SystemMessageTypeEnum.SYSTEM_NOTICE ? 'info' : 'warning';
  }

  function messageTagLabel(item: MessageCenterItem) {
    if (isTicketMessage(item)) return t('module.ticket');
    return item.type === SystemMessageTypeEnum.SYSTEM_NOTICE
      ? t('system.message.system')
      : t('system.message.announcement');
  }

  function messageTitle(item: MessageCenterItem) {
    if (item.type === SystemMessageTypeEnum.SYSTEM_NOTICE) {
      return t('system.message.systemNotification');
    }
    return item.subject;
  }

  function messageBody(item: MessageCenterItem) {
    if (item.type === SystemMessageTypeEnum.SYSTEM_NOTICE) {
      return item.contentText;
    }
    return parseMessageContent(item)?.content || item.contentText || '-';
  }

  const finished = ref(false);
  async function loadMessageList(refresh = true) {
    try {
      if (!props.loadParams) return;
      loading.value = true;

      if (refresh) {
        finished.value = false;
        pageNation.value.current = 1;
        list.value = [];
      }
      const res = await getNotificationList({
        current: pageNation.value.current || 1,
        pageSize: pageNation.value.pageSize,
        keyword: innerKeyword.value,
        ...props.loadParams,
      });
      if (res) {
        list.value = list.value.concat(res.list);
        pageNation.value.total = res.total;
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.log(error);
    } finally {
      loading.value = false;
      finished.value = true;
    }
  }

  async function setMessageRead(item: MessageCenterItem) {
    if (item.status === SystemMessageStatusEnum.READ) return;
    try {
      await setNotificationRead(item.id);
      loadMessageList();
      appStore.initMessage();
      emit('refreshCount');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.log(error);
    }
  }

  function handleReachBottom() {
    pageNation.value.current += 1;
    if (pageNation.value.current > Math.ceil(pageNation.value.total / pageNation.value.pageSize)) {
      return;
    }
    loadMessageList(false);
  }

  function goUrl(context: string) {
    const url = JSON.parse(context)?.url;
    if (url) {
      window.open(url, '_blank');
    }
  }

  function goDetail(item: MessageCenterItem) {
    const detailAction = getMessageDetailAction(item.operation);
    if (!detailAction || !hasAnyPermission(detailAction.permission)) return;
    detailAction.action(item);
  }

  onBeforeMount(() => {
    if (props.messageList) return;
    loadMessageList();
  });

  watch(
    () => props.messageList,
    (val) => {
      if (val) {
        list.value = val;
      }
    }
  );

  defineExpose({
    loadMessageList,
  });
</script>

<style lang="less" scoped>
  .crm-message-item {
    background: var(--text-n10);
    .crm-message-item-content {
      min-height: 108px;
      border-radius: @border-radius-medium;
      background: var(--text-n9);
      .message-title {
        &--normal {
          color: var(--text-n1);
        }
        &--read {
          color: var(--text-n4);
        }
      }
      .set-read-button {
        opacity: 0;
      }
      &:hover {
        .set-read-button {
          opacity: 1;
        }
      }
    }
  }
  :deep(.crm-message-item__badge) {
    display: inline-flex;
    flex: 1;
    min-width: 0;
  }
</style>
