import { ApplicationsView } from "@/components/cre-os/applications/ApplicationsView";
import { loadApplications } from "@/lib/cre-os/lease-application-queries";

export const dynamic = "force-dynamic";

export default async function ApplicationsPage() {
  const applications = await loadApplications();
  return <ApplicationsView applications={applications} />;
}
