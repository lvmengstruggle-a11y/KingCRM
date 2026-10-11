import { TicketRouteEnum } from '@/enums/routeEnum';

import { DEFAULT_LAYOUT } from '../base';
import type { AppRouteRecordRaw } from '../types';

const ticket: AppRouteRecordRaw = {
  path: '/ticket',
  name: TicketRouteEnum.TICKET,
  redirect: '/ticket/index',
  component: DEFAULT_LAYOUT,
  meta: {
    locale: 'module.ticket',
    permissions: ['TICKET:READ'],
    icon: 'iconicon_contract',
    hideChildrenInMenu: true,
    collapsedLocale: 'module.ticket',
  },
  children: [
    {
      path: 'index',
      name: TicketRouteEnum.TICKET_INDEX,
      component: () => import('@/views/ticket/index.vue'),
      meta: {
        locale: 'module.ticket',
        isTopMenu: true,
        permissions: ['TICKET:READ'],
      },
    },
  ],
};

export default ticket;
