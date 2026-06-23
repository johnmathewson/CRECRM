import { redirect } from "next/navigation";

/**
 * Legacy /cre-os/properties/pipeline route. The kanban now lives
 * INSIDE /cre-os/properties as a view toggle (?view=pipeline), so
 * old bookmarks + outbound links land in the right place without
 * a 404.
 */
export default function PipelinePageRedirect() {
  redirect("/cre-os/properties?view=pipeline");
}
