/**
 * CRE OS — inbox bucket classifier (client-safe).
 *
 * Lives separately from inbox-queries.ts because the queries module imports
 * server-only deps (next/headers via Supabase SSR). The bucket logic is a
 * pure function over the LeadCard shape — safe to call from client
 * components.
 */

import type { LeadCard, LeadBucket } from "./inbox-queries";

export function bucketsForLead(card: LeadCard): LeadBucket[] {
  const out: LeadBucket[] = ["all"];
  const status = (card.status ?? "").toLowerCase();
  if (card.urgency === "hot" && !card.finalSent && status !== "archived" && status !== "spam") out.push("hot");
  if (status === "new" && !card.finalSent) out.push("needs-response");
  if (card.hasDraft && !card.finalSent) out.push("drafted");
  if (status === "archived") out.push("archived");
  if (status === "spam") out.push("spam");
  if (card.hoursSinceArrival < 24 && status !== "archived" && status !== "spam") out.push("today");
  return out;
}
