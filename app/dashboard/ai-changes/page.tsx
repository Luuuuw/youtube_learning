import AiChangesClient from '@/components/ai-changes-client';

// auth + header 由 app/dashboard/layout.tsx 统一处理
export default function Page() {
  return <AiChangesClient />;
}
