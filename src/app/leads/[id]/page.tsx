import { LeadDetailScreen } from "@/screens/lead-detail-screen";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LeadDetailScreen leadId={decodeURIComponent(id)} />;
}
