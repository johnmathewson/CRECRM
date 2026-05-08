import { redirect } from "next/navigation";

/** Soft-cutover redirect: legacy /deals → /cre-os/pipeline. */
export default function LegacyDealsPage() {
  redirect("/cre-os/pipeline");
}
