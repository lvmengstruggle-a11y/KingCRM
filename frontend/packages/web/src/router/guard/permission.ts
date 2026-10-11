import { hasToken } from '@lib/shared/method/auth';

import usePermission from '@/hooks/usePermission';
import useAppStore from '@/store/modules/app';

import { featureRouteMap, NO_RESOURCE_ROUTE_NAME, WHITE_LIST } from '../constants';
import NProgress from 'nprogress';
import type { Router } from 'vue-router';

function matchedModuleId(routeName: string | symbol | null | undefined): string | undefined {
  const name = String(routeName ?? '');
  return Object.keys(featureRouteMap)
    .filter((key) => name.includes(key))
    .sort((left, right) => right.length - left.length)[0];
}

export default function setupPermissionGuard(router: Router) {
  router.beforeEach(async (to, _from, next) => {
    const appStore = useAppStore();
    if (hasToken()) {
      await appStore.ensureModuleConfig();
    }
    const Permission = usePermission();
    const permissionsAllow = Permission.accessRouter(to);
    const currentMenuConfig: string[] = appStore.moduleConfigList.filter((item) => item.enable).map((item) => item.moduleKey);
    const moduleId = matchedModuleId(to.name);
    const moduleClosed = Boolean(moduleId && featureRouteMap[moduleId] && !currentMenuConfig.includes(featureRouteMap[moduleId]));
    const allowed = WHITE_LIST.some((item) => item.name === to.name) || permissionsAllow;
    if (moduleClosed || !allowed) {
      next({ name: NO_RESOURCE_ROUTE_NAME });
    } else {
      next();
    }
    NProgress.done();
  });
}
