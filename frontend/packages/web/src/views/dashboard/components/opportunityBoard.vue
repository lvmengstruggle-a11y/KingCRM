<template>
  <div class="flex h-full flex-col bg-[var(--text-n10)]">
    <div class="bg-[var(--primary-8)] px-[16px] py-[10px] text-center text-[16px] font-semibold text-white">
      新增商机看板
    </div>
    <div class="flex items-center gap-[12px] bg-white px-[16px] py-[12px]">
      <span class="text-[var(--text-n2)]">部门</span>
      <n-tree-select
        v-model:value="deptId"
        class="w-[220px]"
        clearable
        filterable
        label-field="name"
        key-field="id"
        children-field="children"
        :options="departments"
        @update:value="load"
      />
      <span class="text-[var(--text-n2)]">创建时间</span>
      <n-date-picker v-model:value="range" type="daterange" clearable class="w-[280px]" @update:value="load" />
      <n-button quaternary @click="reset">清空</n-button>
    </div>
    <n-spin :show="loading" class="min-h-0 flex-1" content-class="h-full overflow-auto p-[16px]">
      <div class="grid grid-cols-4 gap-[12px]">
        <div v-for="item in metrics" :key="item.label" class="bg-white p-[16px]">
          <div class="text-[var(--text-n3)]">{{ item.label }}</div>
          <div class="mt-[12px] text-[28px] font-semibold text-[var(--primary-8)]">{{ item.value }}</div>
        </div>
      </div>
      <div class="mt-[12px] grid grid-cols-4 gap-[12px]">
        <div v-for="panel in panels" :key="panel.title" class="min-h-[240px] bg-white p-[12px]">
          <div class="mb-[8px] font-medium">{{ panel.title }}</div>
          <div v-if="panel.points.length" :ref="(el) => setChart(panel.title, el)" class="h-[200px]"></div>
          <div v-else class="flex h-[200px] items-center justify-center text-[var(--text-n4)]">暂无数据</div>
        </div>
      </div>
    </n-spin>
  </div>
</template>

<script setup lang="ts">
  import { NButton, NDatePicker, NSpin, NTreeSelect } from 'naive-ui';
  import { BarChart, LineChart } from 'echarts/charts';
  import { GridComponent, TooltipComponent } from 'echarts/components';
  import * as echarts from 'echarts/core';
  import { CanvasRenderer } from 'echarts/renderers';

  import { getHomeDepartmentTree, getOpportunityBoard } from '@/api/modules';

  echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, CanvasRenderer]);

  interface Point {
    name: string;
    value: number;
  }

  interface Board {
    total: number;
    amount: number;
    unfollowed: number;
    bySource: Point[];
    byOwnerCount: Point[];
    byOwnerAmount: Point[];
    unfollowedByOwner: Point[];
    byProduct: Point[];
    trendCount: Point[];
    trendAmount: Point[];
  }

  function currentMonth(): [number, number] {
    const now = new Date();
    return [
      new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
      new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime(),
    ];
  }

  function formatAmount(value: number) {
    if (!value) {
      return '0';
    }
    if (value >= 10000) {
      return `${(value / 10000).toFixed(1)} 万`;
    }
    return value.toLocaleString('zh-CN');
  }

  const emptyBoard = (): Board => ({
    total: 0,
    amount: 0,
    unfollowed: 0,
    bySource: [],
    byOwnerCount: [],
    byOwnerAmount: [],
    unfollowedByOwner: [],
    byProduct: [],
    trendCount: [],
    trendAmount: [],
  });

  const loading = ref(false);
  const deptId = ref<string | null>(null);
  const departments = ref<Array<Record<string, unknown>>>([]);
  const range = ref<[number, number]>(currentMonth());
  const board = ref<Board>(emptyBoard());
  const chartNodes = new Map<string, HTMLElement>();
  const chartInstances = new Map<string, echarts.ECharts>();

  const metrics = computed(() => [
    { label: '新增商机（总数）', value: String(board.value.total) },
    { label: '新增商机（金额）', value: formatAmount(board.value.amount) },
    { label: '新增商机未跟进（数量）', value: String(board.value.unfollowed) },
  ]);

  const panels = computed(() => [
    { title: '新增商机（来源）', points: board.value.bySource, type: 'bar' as const },
    { title: '新增商机数（团队）', points: board.value.byOwnerCount, type: 'bar' as const },
    { title: '新增商机额（团队）', points: board.value.byOwnerAmount, type: 'bar' as const },
    { title: '新增商机未跟进（团队）', points: board.value.unfollowedByOwner, type: 'bar' as const },
    { title: '新增商机（产品）', points: board.value.byProduct, type: 'bar' as const },
    { title: '新增商机数（趋势）', points: board.value.trendCount, type: 'line' as const },
    { title: '新增商机金额（趋势）', points: board.value.trendAmount, type: 'line' as const },
  ]);

  function setChart(title: string, element: Element | null) {
    if (element instanceof HTMLElement) {
      chartNodes.set(title, element);
    }
  }

  function draw() {
    panels.value.forEach((panel) => {
      const element = chartNodes.get(panel.title);
      if (!element || panel.points.length === 0) {
        return;
      }
      const chart = chartInstances.get(panel.title) ?? echarts.init(element);
      chartInstances.set(panel.title, chart);
      const names = panel.points.map((point) => point.name);
      const values = panel.points.map((point) => point.value);
      const horizontal = panel.type === 'bar';
      const valueAxis = {
        type: 'value' as const,
        splitNumber: 3,
        axisLabel: {
          hideOverlap: true,
          formatter: (value: number) => (value >= 10000 ? `${value / 10000}万` : String(value)),
        },
      };
      chart.setOption(
        {
          tooltip: { trigger: 'axis' },
          grid: { left: 8, right: 16, top: 12, bottom: 8, containLabel: true },
          xAxis: horizontal ? valueAxis : { type: 'category', data: names },
          yAxis: horizontal ? { type: 'category', data: names } : valueAxis,
          series: [{ type: panel.type, data: values, smooth: true }],
        },
        true
      );
      chart.resize();
    });
  }

  async function load() {
    const [start, end] = range.value ?? currentMonth();
    loading.value = true;
    try {
      board.value = await getOpportunityBoard({
        deptIds: deptId.value ? [deptId.value] : [],
        start,
        end,
      });
      await nextTick();
      draw();
    } finally {
      loading.value = false;
    }
  }

  function reset() {
    deptId.value = null;
    range.value = currentMonth();
    load();
  }

  onMounted(async () => {
    try {
      departments.value = (await getHomeDepartmentTree()) ?? [];
    } catch {
      departments.value = [];
    }
    await load();
  });

  onUnmounted(() => {
    chartInstances.forEach((chart) => chart.dispose());
  });
</script>
