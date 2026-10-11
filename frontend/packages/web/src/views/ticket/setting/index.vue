<template>
  <n-drawer v-model:show="show" :width="720" placement="right">
    <n-drawer-content :title="t('ticket.setting')" closable>
      <n-tabs v-model:value="tab" type="line">
        <n-tab-pane name="template" :tab="t('ticket.template')">
          <div v-for="item in templates" :key="item.id" class="mb-[12px] flex items-center justify-between">
            <span>{{ item.name }}</span>
            <n-button v-if="canUpdate" text type="error" @click="removeTemplate(item.id)">{{
              t('ticket.recycle')
            }}</n-button>
          </div>
          <n-form v-if="canUpdate" label-placement="left" label-width="88">
            <n-form-item :label="t('ticket.template')"><n-input v-model:value="templateForm.name" /></n-form-item>
            <n-form-item :label="t('ticket.field.customer')"
              ><n-switch v-model:value="templateForm.enableCustomer"
            /></n-form-item>
            <n-form-item :label="t('ticket.field.cc')"><n-switch v-model:value="templateForm.enableCc" /></n-form-item>
            <n-form-item :label="t('ticket.field.handler')"
              ><n-switch v-model:value="templateForm.enableHandler"
            /></n-form-item>
            <n-form-item :label="t('ticket.field.deadline')"
              ><n-switch v-model:value="templateForm.enableDeadline"
            /></n-form-item>
            <n-button type="primary" @click="saveTemplate">{{ t('common.save') }}</n-button>
          </n-form>
        </n-tab-pane>
        <n-tab-pane name="status" :tab="t('ticket.status')">
          <div v-for="(item, index) in statuses" :key="item.id" class="mb-[8px] flex items-center gap-[8px]">
            <i class="inline-block h-[8px] w-[8px] rounded-full" :style="{ background: item.color }" />
            <span class="flex-1">{{ item.name }}</span>
            <n-button v-if="canUpdate" text :disabled="index === 0" @click="moveStatus(index, -1)">↑</n-button>
            <n-button v-if="canUpdate" text :disabled="index === statuses.length - 1" @click="moveStatus(index, 1)"
              >↓</n-button
            >
            <n-button
              v-if="canUpdate && !item.isInitial && !item.isTerminal"
              text
              type="error"
              @click="removeStatus(item.id)"
              >{{ t('ticket.recycle') }}</n-button
            >
          </div>
          <n-button v-if="canUpdate" class="mb-[12px]" @click="sortStatus">{{ t('common.save') }}</n-button>
          <n-form v-if="canUpdate" label-placement="left" label-width="88">
            <n-form-item :label="t('ticket.field.title')"><n-input v-model:value="statusForm.name" /></n-form-item>
            <n-form-item :label="t('ticket.column.status')"><n-input v-model:value="statusForm.color" /></n-form-item>
            <n-form-item label="初始"><n-switch v-model:value="statusForm.isInitial" /></n-form-item>
            <n-form-item label="结束"><n-switch v-model:value="statusForm.isTerminal" /></n-form-item>
            <n-button type="primary" @click="saveStatus">{{ t('common.save') }}</n-button>
          </n-form>
        </n-tab-pane>
        <n-tab-pane name="route" :tab="t('ticket.route')">
          <div v-for="item in routes" :key="item.id" class="mb-[8px] flex items-center justify-between">
            <span>{{ item.templateName }} → {{ item.departmentName }}</span>
            <n-button v-if="canUpdate" text type="error" @click="removeRoute(item.id)">{{
              t('ticket.recycle')
            }}</n-button>
          </div>
          <n-form v-if="canUpdate" label-placement="left" label-width="88">
            <n-form-item :label="t('ticket.template')">
              <n-select v-model:value="routeForm.templateId" :options="templateOptions" />
            </n-form-item>
            <n-form-item :label="t('ticket.column.department')">
              <n-select v-model:value="routeForm.departmentId" :options="departmentOptions" />
            </n-form-item>
            <n-button type="primary" @click="saveRoute">{{ t('common.save') }}</n-button>
          </n-form>
        </n-tab-pane>
        <n-tab-pane name="config" :tab="t('ticket.config')">
          <n-form v-if="config" label-placement="left" label-width="140">
            <n-form-item :label="t('ticket.column.department')">
              <n-select
                v-model:value="config.defaultDepartmentId"
                clearable
                :options="departmentOptions"
                :disabled="!canUpdate"
              />
            </n-form-item>
            <n-form-item label="处理人可结束"
              ><n-switch v-model:value="config.handlerCanClose" :disabled="!canUpdate"
            /></n-form-item>
            <n-form-item label="发布人可结束"
              ><n-switch v-model:value="config.publisherCanClose" :disabled="!canUpdate"
            /></n-form-item>
            <n-form-item label="结束后可回复"
              ><n-switch v-model:value="config.replyAfterClose" :disabled="!canUpdate"
            /></n-form-item>
            <n-form-item label="允许状态回退"
              ><n-switch v-model:value="config.allowStatusBack" :disabled="!canUpdate"
            /></n-form-item>
            <n-form-item label="分配通知"
              ><n-switch v-model:value="config.notifyAssign" :disabled="!canUpdate"
            /></n-form-item>
            <n-form-item label="回复通知发布人"
              ><n-switch v-model:value="config.notifyReplyPublisher" :disabled="!canUpdate"
            /></n-form-item>
            <n-form-item label="回复通知处理人"
              ><n-switch v-model:value="config.notifyReplyHandler" :disabled="!canUpdate"
            /></n-form-item>
            <n-form-item label="回复通知抄送"
              ><n-switch v-model:value="config.notifyReplyCc" :disabled="!canUpdate"
            /></n-form-item>
            <n-form-item label="回复通知关注人"
              ><n-switch v-model:value="config.notifyReplyFollow" :disabled="!canUpdate"
            /></n-form-item>
            <n-form-item label="内部协作通知"
              ><n-switch v-model:value="config.notifyInternalHandler" :disabled="!canUpdate"
            /></n-form-item>
            <n-form-item label="状态通知发布人"
              ><n-switch v-model:value="config.notifyStatusPublisher" :disabled="!canUpdate"
            /></n-form-item>
            <n-form-item label="结束通知发布人"
              ><n-switch v-model:value="config.notifyClosePublisher" :disabled="!canUpdate"
            /></n-form-item>
            <n-form-item label="重启通知处理人"
              ><n-switch v-model:value="config.notifyRestartHandler" :disabled="!canUpdate"
            /></n-form-item>
            <n-form-item :label="t('ticket.satisfy')"
              ><n-switch v-model:value="config.satisfyEnabled" :disabled="!canUpdate"
            /></n-form-item>
            <n-button v-if="canUpdate" type="primary" @click="saveConfig">{{ t('common.save') }}</n-button>
          </n-form>
        </n-tab-pane>
      </n-tabs>
    </n-drawer-content>
  </n-drawer>
</template>

<script setup lang="ts">
  import {
    NButton,
    NDrawer,
    NDrawerContent,
    NForm,
    NFormItem,
    NInput,
    NSelect,
    NSwitch,
    NTabPane,
    NTabs,
    useMessage,
  } from 'naive-ui';

  import { useI18n } from '@lib/shared/hooks/useI18n';

  import {
    deleteTicketRoute,
    deleteTicketStatusConfig,
    deleteTicketTemplate,
    getTicketConfig,
    getTicketOptions,
    listTicketRoute,
    listTicketStatusConfig,
    listTicketTemplate,
    saveTicketConfig,
    saveTicketRoute,
    saveTicketStatusConfig,
    saveTicketTemplate,
    sortTicketStatusConfig,
  } from '@/api/modules';
  import { hasAnyPermission } from '@/utils/permission';

  interface TemplateItem {
    id: string;
    name: string;
  }
  interface StatusItem {
    id: string;
    name: string;
    color: string;
    isInitial: boolean;
    isTerminal: boolean;
  }
  interface RouteItem {
    id: string;
    templateName: string;
    departmentName: string;
  }
  interface ConfigItem {
    defaultDepartmentId: string | null;
    handlerCanClose: boolean;
    publisherCanClose: boolean;
    replyAfterClose: boolean;
    allowStatusBack: boolean;
    notifyAssign: boolean;
    notifyReplyPublisher: boolean;
    notifyReplyHandler: boolean;
    notifyReplyCc: boolean;
    notifyReplyFollow: boolean;
    notifyInternalHandler: boolean;
    notifyStatusPublisher: boolean;
    notifyClosePublisher: boolean;
    notifyRestartHandler: boolean;
    satisfyEnabled: boolean;
  }

  const show = defineModel<boolean>('show', { required: true });
  const { t } = useI18n();
  const message = useMessage();
  const tab = ref('template');
  const canUpdate = computed(() => hasAnyPermission(['TICKET_SETTING:UPDATE']));
  const templates = ref<TemplateItem[]>([]);
  const statuses = ref<StatusItem[]>([]);
  const routes = ref<RouteItem[]>([]);
  const config = ref<ConfigItem | null>(null);
  const departmentOptions = ref<Array<{ label: string; value: string }>>([]);
  const templateForm = reactive({
    name: '',
    enableCustomer: true,
    enableCc: true,
    enableHandler: false,
    enableDeadline: true,
  });
  const statusForm = reactive({ name: '', color: '#3290f9', isInitial: false, isTerminal: false });
  const routeForm = reactive({ templateId: null as string | null, departmentId: null as string | null });
  const templateOptions = computed(() => templates.value.map((item) => ({ label: item.name, value: item.id })));

  async function load() {
    const [templateList, statusList, routeList, configRow, options] = await Promise.all([
      listTicketTemplate() as Promise<TemplateItem[]>,
      listTicketStatusConfig() as Promise<StatusItem[]>,
      listTicketRoute() as Promise<RouteItem[]>,
      getTicketConfig() as Promise<ConfigItem>,
      getTicketOptions() as Promise<{ departments: Array<{ id: string; name: string }> }>,
    ]);
    templates.value = templateList ?? [];
    statuses.value = statusList ?? [];
    routes.value = routeList ?? [];
    config.value = configRow;
    departmentOptions.value = (options.departments ?? []).map((item) => ({ label: item.name, value: item.id }));
  }

  async function saveTemplate() {
    await saveTicketTemplate({
      name: templateForm.name,
      enable: true,
      enableCustomer: templateForm.enableCustomer,
      enableCc: templateForm.enableCc,
      enableHandler: templateForm.enableHandler,
      enableDeadline: templateForm.enableDeadline,
      enableMobile: false,
      mobileRequired: false,
      enableMail: false,
      mailRequired: false,
    });
    templateForm.name = '';
    message.success(t('common.saveSuccess'));
    await load();
  }

  async function removeTemplate(id: string) {
    await deleteTicketTemplate(id);
    await load();
  }

  async function saveStatus() {
    await saveTicketStatusConfig({ ...statusForm, stopTiming: false });
    statusForm.name = '';
    message.success(t('common.saveSuccess'));
    await load();
  }

  function moveStatus(index: number, offset: number) {
    const next = index + offset;
    const list = statuses.value;
    const current = list[index];
    const target = list[next];
    if (!current || !target) {
      return;
    }
    list[index] = target;
    list[next] = current;
  }

  async function sortStatus() {
    await sortTicketStatusConfig(statuses.value.map((item) => item.id));
    message.success(t('common.saveSuccess'));
    await load();
  }

  async function removeStatus(id: string) {
    await deleteTicketStatusConfig(id);
    await load();
  }

  async function saveRoute() {
    if (!routeForm.templateId || !routeForm.departmentId) {
      return;
    }
    await saveTicketRoute({ templateId: routeForm.templateId, departmentId: routeForm.departmentId });
    message.success(t('common.saveSuccess'));
    await load();
  }

  async function removeRoute(id: string) {
    await deleteTicketRoute(id);
    await load();
  }

  async function saveConfig() {
    if (!config.value) {
      return;
    }
    await saveTicketConfig({ ...config.value, defaultDepartmentId: config.value.defaultDepartmentId || null });
    message.success(t('common.saveSuccess'));
  }

  watch(show, (visible) => {
    if (visible) {
      load();
    }
  });
</script>
