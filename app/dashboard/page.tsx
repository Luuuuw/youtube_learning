import DashboardClient from '@/components/dashboard-client';

// auth + header 由 app/dashboard/layout.tsx 统一处理
export default function DashboardPage() {
  return <DashboardClient />;
}
