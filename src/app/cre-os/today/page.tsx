import { TodayView, type TodayRow } from "@/components/cre-os/today/TodayView";
import { loadCommsStream } from "@/lib/cre-os/comms-stream-queries";
import { loadInboxList, type LeadCard } from "@/lib/cre-os/inbox-queries";
import { loadLatestBrief, briefLede } from "@/lib/cre-os/brief-queries";

/**
 * /cre-os/today — the home. One list of decisions, waiting-first.
 *
 *   Waiting on you  = people whose latest real message to us has no reply
 *                     (the same Unanswered rule the Communications stream
 *                     uses — one definition, comms-stream-queries).
 *   Next up         = ranked open leads that aren't already waiting
 *                     (hot first, SLA-overdue, draft ready, new).
 *
 * Tapping a row opens the ThreadPanel (thread + reply bar); every send goes
 * through the existing lead routes, so sending clears the row everywhere.
 */
export const dynamic = "force-dynamic";

function priority(l: LeadCard): number {
  const status = (l.status ?? "").toLowerCase();
  if (status === "archived" || status === "spam" || status === "sent" || l.finalSent) return -1;
  let p = 0;
  if (l.urgency === "hot") p += 500;
  else if (l.urgency === "warm") p += 250;
  if (l.slaOverdue) p += 400;
  if (l.hasDraft) p += 300;
  if (status === "new") p += 100;
  return p;
}

export default async function TodayPage() {
  const [stream, leads, brief] = await Promise.all([loadCommsStream(600), loadInboxList(), loadLatestBrief()]);

  // One row per person: their latest unanswered inbound.
  const seen = new Set<string>();
  const waiting: TodayRow[] = [];
  for (const r of stream.rows) {
    if (!r.unanswered || r.cleared || r.automated) continue;
    const key = r.contactId ?? r.who;
    if (seen.has(key)) continue;
    seen.add(key);
    waiting.push({
      id: r.id,
      kind: "comm",
      leadId: r.leadId,
      contactId: r.contactId,
      who: r.who,
      property: r.property?.name ?? null,
      what: r.subject || r.preview || `${r.channel} message`,
      channel: r.channel,
      when: r.when,
      action: "Reply",
    });
  }

  const waitingContacts = new Set(waiting.map((w) => w.contactId).filter(Boolean) as string[]);
  const next: TodayRow[] = leads
    .map((l) => ({ l, p: priority(l) }))
    .filter((x) => x.p >= 0 && !(x.l.contactId && waitingContacts.has(x.l.contactId)))
    .sort((a, b) => b.p - a.p)
    .slice(0, 8)
    .map(({ l }) => ({
      id: l.id,
      kind: "lead" as const,
      leadId: l.id,
      contactId: l.contactId,
      who: l.senderDisplay,
      property: l.property?.name ?? l.propertyLabel,
      what: l.qualifierSummary || l.rawSubject || "New inquiry",
      channel: l.source ?? "email",
      when: l.createdRelative,
      action: l.hasDraft ? "Send draft" : "Reply",
    }));

  return (
    <TodayView
      waiting={waiting}
      next={next}
      brief={brief ? { lede: briefLede(brief.content_text), date: brief.brief_date } : null}
    />
  );
}
