import { notFound } from "next/navigation";
import { ApplicationDetailView } from "@/components/cre-os/applications/ApplicationDetailView";
import { loadApplication } from "@/lib/cre-os/lease-application-queries";

export const dynamic = "force-dynamic";

export default async function ApplicationPage({ params }: { params: { id: string } }) {
  const app = await loadApplication(params.id);
  if (!app) notFound();
  return <ApplicationDetailView app={app} />;
}
