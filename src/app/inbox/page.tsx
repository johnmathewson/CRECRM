import { redirect } from "next/navigation";

/** Soft-cutover redirect: legacy /inbox → /cre-os/inbox. */
export default function LegacyInboxPage() {
  redirect("/cre-os/inbox");
}
