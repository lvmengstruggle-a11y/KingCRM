import { defineStore } from 'pinia';
import dayjs from 'dayjs';

import { useI18n } from '@lib/shared/hooks/useI18n';
import { LicenseInfo } from '@lib/shared/models/system/authorizedManagement';

import type { DialogOptionsConfig } from '@/hooks/useModal';

let licenseValidationPromise: Promise<boolean> | null = null;

const useLicenseStore = defineStore('license', {
  persist: {
    paths: ['licenseInfo', 'expiredDuring', 'expiredDays'],
  },
  state: (): {
    licenseInfo: LicenseInfo | null;
    expiredDuring: boolean;
    expiredDays: number;
    noLicenseFeature: string | null;
  } => ({
    licenseInfo: null,
    expiredDuring: false,
    expiredDays: 0,
    noLicenseFeature: null,
  }),
  actions: {
    setLicenseInfo(info: LicenseInfo) {
      this.licenseInfo = info;
    },
    removeLicenseStatus() {
      if (this.licenseInfo) {
        this.licenseInfo.status = null;
      }
    },
    hasLicense() {
      return this.licenseInfo?.status === 'valid';
    },
    isEnterpriseVersion() {
      return ['valid', 'expired'].includes(this.licenseInfo?.status || '');
    },
    getExpirationTime(resTime: string) {
      if (!this.isEnterpriseVersion()) {
        this.expiredDuring = false;
        this.expiredDays = 0;
        return;
      }

      if (!resTime && !this.hasLicense() && this.isEnterpriseVersion()) {
        this.expiredDuring = true;
        this.expiredDays = 0;
        return;
      }

      const today = dayjs().startOf('day'); // 今天的开始时间
      const expirationDate = dayjs(resTime).startOf('day'); // license到期日的开始时间

      // 计算天数差（不包含当天）
      const daysDifference = expirationDate.diff(today, 'day');
      if (daysDifference < 0) {
        // 已过期情况
        const daysExpired = Math.abs(daysDifference);
        this.expiredDays = -daysExpired; // 负数表示已过期天数
        this.expiredDuring = daysExpired <= 30; // 过期后只显示30天
      } else if (daysDifference === 0) {
        // 今天到期（显示"剩余1天"）
        this.expiredDays = 1;
        this.expiredDuring = true;
      } else if (daysDifference <= 29) {
        // 1-29天后到期（显示剩余天数+1）
        this.expiredDays = daysDifference + 1;
        this.expiredDuring = true;
      } else if (daysDifference === 30) {
        // 30天后到期（显示"剩余30天"）
        this.expiredDays = daysDifference + 1;
        this.expiredDuring = false;
      } else {
        // 31+天后到期
        this.expiredDays = daysDifference + 1;
        this.expiredDuring = false;
      }
    },
    async getValidateLicense(): Promise<boolean> {
      this.licenseInfo = {
        status: 'valid',
        corporation: '本地部署',
        expired: '2099-12-31',
        product: 'KingCRM',
        edition: 'enterprise',
        licenseVersion: 'local',
        count: 0,
      };
      this.expiredDuring = false;
      this.expiredDays = 0;
      return true;
    },
    // 请求失败时清空缓存，后续可重新校验
    async ensureLicenseValidated() {
      if (!licenseValidationPromise) {
        licenseValidationPromise = this.getValidateLicense();
      }
      const validated = await licenseValidationPromise;
      if (!validated) {
        licenseValidationPromise = null;
      }
    },
    resetLicenseValidation() {
      licenseValidationPromise = null;
    },
    setNoLicenseFeature(feature: string) {
      this.noLicenseFeature = feature;
    },
    clearNoLicenseFeature() {
      this.noLicenseFeature = null;
    },
    getNoLicenseModalConfig(): DialogOptionsConfig {
      const { t } = useI18n();
      return {
        title: t('common.tip'),
        type: 'warning',
        positiveText: t('common.gotIt'),
        positiveButtonProps: {
          type: 'primary',
        },
        content: () => t('common.businessFeatureTip'),
        onPositiveClick: async () => {
          return Promise.resolve();
        },
      };
    },
  },
});

export default useLicenseStore;
