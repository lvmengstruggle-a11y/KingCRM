export default function isVendorSite(value: string): boolean {
  try {
    const host = new URL(value, window.location.origin).hostname;
    return (
      host === 'kingcrm.cn' || host.endsWith('.kingcrm.cn') || host === 'fit2cloud.com' || host.endsWith('.fit2cloud.com')
    );
  } catch {
    return true;
  }
}
