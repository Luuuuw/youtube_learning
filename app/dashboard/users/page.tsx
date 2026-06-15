import UserAnalyticsClient from '@/components/user-analytics-client';

// auth + header 由 app/dashboard/layout.tsx 统一处理
export default function DashboardUsersPage() {
  return <UserAnalyticsClient />;
}
