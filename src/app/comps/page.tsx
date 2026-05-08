import { redirect } from "next/navigation";

/** Soft-cutover redirect: legacy /comps → /cre-os/market. */
export default function LegacyCompsPage() {
  redirect("/cre-os/market");
}
