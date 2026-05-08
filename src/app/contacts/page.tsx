import { redirect } from "next/navigation";

/** Soft-cutover redirect: legacy /contacts → /cre-os/relationships. */
export default function LegacyContactsPage() {
  redirect("/cre-os/relationships");
}
