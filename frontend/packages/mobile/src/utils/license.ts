import { showDialog } from 'vant';

export default function showNoLicenseDialog(t: (key: string) => string): void {
  showDialog({
    title: t('common.tip'),
    message: t('common.businessFeatureTip'),
    confirmButtonText: t('common.confirm'),
  });
}
