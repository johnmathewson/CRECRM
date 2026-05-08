import { redirect } from "next/navigation";

/** Soft-cutover redirect: legacy /reports → /cre-os/reports. */
export default function LegacyReportsPage() {
  redirect("/cre-os/reports");
}
