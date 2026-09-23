import {
  crmConfigured,
  getCrmBirthdayVouchers,
  getCrmCheckouts,
  getCrmCustomers,
  getCrmMembershipConfig,
  getCrmMetrics,
  getCrmOrders,
} from '@/src/crm-data';
import {CrmView} from '@/components/analyst/crm-view';

// Live proxy over the CRM Worker: never statically rendered, because the point
// of the page is that it agrees with the storefront admin right now.
export const dynamic = 'force-dynamic';

export default async function Page() {
  const [metrics, customers, orders, checkouts, birthdayVouchers, membership] = await Promise.all([
    getCrmMetrics(),
    getCrmCustomers(),
    getCrmOrders(),
    getCrmCheckouts(),
    getCrmBirthdayVouchers(),
    getCrmMembershipConfig(),
  ]);
  return (
    <CrmView
      metrics={metrics}
      customers={customers}
      orders={orders}
      checkouts={checkouts}
      birthdayVouchers={birthdayVouchers}
      membership={membership}
      configured={crmConfigured()}
      fetchedAt={new Date().toISOString()}
    />
  );
}
