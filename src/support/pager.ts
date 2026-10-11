import { validateFailed } from './errors.js';

export interface PageQuery {
  current: number;
  pageSize: number;
}

export interface Pager<T> {
  list: T[];
  total: number;
  pageSize: number;
  current: number;
}

export function normalizePage(current: number | undefined, pageSize: number | undefined): PageQuery {
  const page = current && current > 0 ? current : 1;
  const size = pageSize && pageSize > 0 ? pageSize : 10;
  if (size > 500) {
    throw validateFailed('每页显示条数不能大于500');
  }
  return { current: page, pageSize: size };
}

export function toPager<T>(list: T[], total: number, page: PageQuery): Pager<T> {
  return {
    list,
    total,
    pageSize: page.pageSize,
    current: page.current,
  };
}
