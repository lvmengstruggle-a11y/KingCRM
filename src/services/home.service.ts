import { query, type SqlRow } from '../support/db.js';
import { visibleOwnerIds } from './data-scope.js';

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

type Period = 'TODAY' | 'THIS_WEEK' | 'THIS_MONTH' | 'THIS_YEAR';
type StageScenario = 'UNDERWAY' | 'SUCCESS' | null;

export interface HomeSearch {
  searchType?: string;
  deptIds?: string[];
  userField?: string;
  timeField?: string;
  priorPeriodEnable?: boolean;
}

interface PeriodValue {
  value: number;
  priorPeriodCompareRate: number | null;
}

const PERIODS: Period[] = ['TODAY', 'THIS_WEEK', 'THIS_MONTH', 'THIS_YEAR'];

function shanghaiParts(ms: number): { year: number; month: number; day: number; weekday: number } {
  const shifted = new Date(ms + SHANGHAI_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
}

function startOfDay(year: number, month: number, day: number): number {
  return Date.UTC(year, month, day) - SHANGHAI_OFFSET_MS;
}

function endOfDay(year: number, month: number, day: number): number {
  return startOfDay(year, month, day) + 24 * 60 * 60 * 1000 - 1;
}

function addDays(year: number, month: number, day: number, days: number): { year: number; month: number; day: number } {
  const shifted = new Date(Date.UTC(year, month, day) + days * 24 * 60 * 60 * 1000);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth(), day: shifted.getUTCDate() };
}

/** 与 Java HomeStatisticSearchWrapperRequest 一致：周一为一周起点，时区按东八区。 */
function periodRange(period: Period, previous: boolean, now = Date.now()): { start: number; end: number } {
  const current = shanghaiParts(now);
  if (period === 'TODAY') {
    const day = previous ? addDays(current.year, current.month, current.day, -1) : current;
    return { start: startOfDay(day.year, day.month, day.day), end: endOfDay(day.year, day.month, day.day) };
  }
  if (period === 'THIS_WEEK') {
    const mondayOffset = current.weekday === 0 ? -6 : 1 - current.weekday;
    const monday = addDays(current.year, current.month, current.day, mondayOffset + (previous ? -7 : 0));
    const sunday = addDays(monday.year, monday.month, monday.day, 6);
    return { start: startOfDay(monday.year, monday.month, monday.day), end: endOfDay(sunday.year, sunday.month, sunday.day) };
  }
  if (period === 'THIS_MONTH') {
    const shifted = new Date(Date.UTC(current.year, current.month + (previous ? -1 : 0), 1));
    const year = shifted.getUTCFullYear();
    const month = shifted.getUTCMonth();
    const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return { start: startOfDay(year, month, 1), end: endOfDay(year, month, last) };
  }
  const year = current.year + (previous ? -1 : 0);
  return { start: startOfDay(year, 0, 1), end: endOfDay(year, 11, 31) };
}

function compareRate(current: number, previous: number): number | null {
  if (!previous) {
    return null;
  }
  return ((current - previous) * 100) / previous;
}

async function countNumber(sql: string, params: unknown[]): Promise<number> {
  const rows = await query<SqlRow & { total: number | string | null }>(sql, params);
  const value = rows[0]?.total;
  const number = value == null ? 0 : Number(value);
  return Number.isFinite(number) ? number : 0;
}

async function ownerClause(
  search: HomeSearch,
  organizationId: string,
  userId: string,
  column: string,
): Promise<{ sql: string; params: unknown[] }> {
  const allowed = await visibleOwnerIds(organizationId, userId);
  if (search.searchType === 'SELF') {
    const ids = allowed ? allowed.filter((id) => id === userId) : [userId];
    return ownerIn(column, ids);
  }
  const deptIds = search.deptIds ?? [];
  if (search.searchType === 'DEPARTMENT' && deptIds.length > 0) {
    const marks = deptIds.map(() => '?').join(', ');
    const members = await query<SqlRow & { user_id: string }>(
      `SELECT user_id FROM sys_organization_user WHERE organization_id = ? AND department_id IN (${marks})`,
      [organizationId, ...deptIds],
    );
    const memberIds = members.map((row) => row.user_id);
    return ownerIn(column, allowed ? memberIds.filter((id) => allowed.includes(id)) : memberIds);
  }
  if (allowed) {
    return ownerIn(column, allowed);
  }
  return { sql: '', params: [] };
}

function ownerIn(column: string, ids: string[]): { sql: string; params: unknown[] } {
  if (ids.length === 0) {
    return { sql: ' AND 1 = 0', params: [] };
  }
  return { sql: ` AND ${column} IN (${ids.map(() => '?').join(', ')})`, params: ids };
}

function emptyPeriods(keys: string[]): Record<string, PeriodValue> {
  return Object.fromEntries(keys.map((key) => [key, { value: 0, priorPeriodCompareRate: null }]));
}

async function periodValues(
  keys: { count: string; amount?: string },
  load: (start: number, end: number, amount: boolean) => Promise<number>,
  prior: boolean,
): Promise<Record<string, PeriodValue>> {
  const result: Record<string, PeriodValue> = {};
  for (const period of PERIODS) {
    const prefix = period === 'TODAY' ? 'today' : period === 'THIS_WEEK' ? 'thisWeek' : period === 'THIS_MONTH' ? 'thisMonth' : 'thisYear';
    const current = periodRange(period, false);
    const count = await load(current.start, current.end, false);
    const previousRange = periodRange(period, true);
    const previousCount = prior ? await load(previousRange.start, previousRange.end, false) : 0;
    result[`${prefix}${keys.count}`] = {
      value: count,
      priorPeriodCompareRate: prior ? compareRate(count, previousCount) : null,
    };
    if (keys.amount) {
      const amount = await load(current.start, current.end, true);
      const previousAmount = prior ? await load(previousRange.start, previousRange.end, true) : 0;
      result[`${prefix}${keys.amount}`] = {
        value: amount,
        priorPeriodCompareRate: prior ? compareRate(amount, previousAmount) : null,
      };
    }
  }
  return result;
}

export class HomeService {
  async leadStatistic(search: HomeSearch, organizationId: string, userId: string): Promise<Record<string, PeriodValue>> {
    if (search.searchType === 'DEPARTMENT' && !(search.deptIds ?? []).length) {
      return emptyPeriods(['todayClue', 'thisWeekClue', 'thisMonthClue', 'thisYearClue']);
    }
    const userColumn = search.userField === 'CREATE_USER' ? 'c.create_user' : 'c.owner';
    const scope = await ownerClause(search, organizationId, userId, userColumn);
    const poolSql = search.userField === 'CREATE_USER' ? '' : ' AND c.in_shared_pool = 0';
    return periodValues({ count: 'Clue' }, async (start, end) => countNumber(
      `SELECT COUNT(*) AS total FROM clue c
       WHERE c.organization_id = ?
         AND (c.transition_id IS NULL OR c.transition_id = '')
         ${poolSql}
         AND c.create_time >= ? AND c.create_time <= ?
         ${scope.sql}`,
      [organizationId, start, end, ...scope.params],
    ), Boolean(search.priorPeriodEnable));
  }

  async opportunityStatistic(
    search: HomeSearch,
    scenario: StageScenario,
    organizationId: string,
    userId: string,
  ): Promise<Record<string, PeriodValue>> {
    const keys = ['todayOpportunity', 'thisWeekOpportunity', 'thisMonthOpportunity', 'thisYearOpportunity',
      'todayOpportunityAmount', 'thisWeekOpportunityAmount', 'thisMonthOpportunityAmount', 'thisYearOpportunityAmount'];
    if (search.searchType === 'DEPARTMENT' && !(search.deptIds ?? []).length) {
      return emptyPeriods(keys);
    }
    const timeColumn = search.timeField === 'ACTUAL_END_TIME'
      ? 'c.actual_end_time'
      : search.timeField === 'EXPECTED_END_TIME'
        ? 'c.expected_end_time'
        : 'c.create_time';
    const scope = await ownerClause(search, organizationId, userId, 'c.owner');
    const stageSql = scenario === 'SUCCESS'
      ? " AND c.stage IN (SELECT id FROM opportunity_stage_config WHERE organization_id = ? AND `type` = 'END' AND rate = 100)"
      : scenario === 'UNDERWAY'
        ? " AND c.stage IN (SELECT id FROM opportunity_stage_config WHERE organization_id = ? AND `type` = 'AFOOT')"
        : '';
    const stageParams = scenario ? [organizationId] : [];
    return periodValues({ count: 'Opportunity', amount: 'OpportunityAmount' }, async (start, end, amount) => countNumber(
      `SELECT ${amount ? 'COALESCE(SUM(c.amount), 0)' : 'COUNT(*)'} AS total FROM opportunity c
       WHERE c.organization_id = ?
         ${stageSql}
         AND ${timeColumn} >= ? AND ${timeColumn} <= ?
         ${scope.sql}`,
      [organizationId, ...stageParams, start, end, ...scope.params],
    ), Boolean(search.priorPeriodEnable));
  }
}

export const homeService = new HomeService();
