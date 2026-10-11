import type { KingAxios } from '@lib/shared/api/http/Axios';
import { LocaleChangeUrl, VersionUrl } from '@lib/shared/api/requrls/sys';
import type { SystemVersion } from '@lib/shared/models/common';

export default function useSysApi(CDR: KingAxios) {
  // 获取系统版本信息
  function getSystemVersion() {
    return CDR.get<SystemVersion>({ url: VersionUrl });
  }

  function changeLocaleBackEnd(language: string) {
    return CDR.post({ url: LocaleChangeUrl, data: { language } });
  }

  return {
    getSystemVersion,
    changeLocaleBackEnd,
  };
}
