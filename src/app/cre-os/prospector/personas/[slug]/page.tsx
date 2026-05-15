/**
 * /cre-os/prospector/personas/[slug]
 *
 * Edit a single persona's voice + skill + angle prompt.
 */

import { notFound } from "next/navigation";
import { loadPersonaBySlug } from "@/lib/cre-os/personas-queries";
import { PersonaEditView } from "@/components/cre-os/prospector/PersonaEditView";

export const dynamic = "force-dynamic";

export default async function PersonaEditPage({
  params,
}: {
  params: { slug: string };
}) {
  const persona = await loadPersonaBySlug(params.slug);
  if (!persona) notFound();
  return <PersonaEditView persona={persona} />;
}
