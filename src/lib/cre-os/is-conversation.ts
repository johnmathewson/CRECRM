/**
 * ONE definition of "is this communications row a real human message?"
 *
 * Shared by the Stream (comms-stream-queries), the lead thread
 * (/api/leads/[id]) and the contact thread (/api/contacts/[id]/thread).
 * Before this module the Stream filtered CREXi engagement signals and
 * automated sends via a private isSignal(), while both thread endpoints
 * returned every row verbatim — so a CREXi page-view, or a notification
 * from emails@notifications.crexi.com that had been filed under the lead's
 * contact, rendered in a person's thread as if THEY wrote it. Two readers,
 * two truths. Keep the predicate here and only here.
 *
 * Nothing is dropped on the floor: splitThread() returns the signals
 * separately so a caller can still show them (as a quiet activity line,
 * never as a message bubble).
 */

// Outbound kinds the system sends on its own. They are real sends and stay
// in the record, but they are not a human writing to another human.
export const AUTOMATED_KINDS = new Set(["ai_followup", "auto_ack", "internal", "campaign"]);

/** Senders that are platforms, not people. A row "from" one of these is an
 *  engagement notification, regardless of which contact it was filed under. */
const PLATFORM_SENDERS = [
  "notifications.crexi.com",
  "@crexi.com",
  "@loopnet.com",
  "@costar.com",
  // Bounces. "Mail Delivery Subsystem" is not a person waiting on a reply.
  "mailer-daemon@",
  "postmaster@",
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

/** CREXi engagement signals (page views, CA executions, OM downloads…) are
 *  robot events written into communications by the report path. Matched by
 *  source AND subject prefix: a 7/29 backfill once wrote them under a
 *  different source and polluted the Unanswered count with 81 phantoms. */
export function isSignal(r: Row): boolean {
  const source = String(r?.raw_payload?.source ?? "");
  const subject = String(r?.subject ?? "");
  const from = String(r?.from_address ?? "").toLowerCase();
  if (source === "crexi_report") return true;
  if (subject.startsWith("CREXi activity")) return true;
  // The bot-filed-under-a-human case: the sender is a platform address.
  if (r?.direction === "inbound" && PLATFORM_SENDERS.some((p) => from.includes(p))) return true;
  return false;
}

/** System mail (Steward briefs to John, etc.) and automated sends. */
export function isAutomated(r: Row): boolean {
  return AUTOMATED_KINDS.has(String(r?.touch_kind ?? ""));
}

/** A real message between humans: not a signal, not system mail. Automated
 *  outbound (acks, AI follow-ups, campaigns) still counts as a message the
 *  person received, so it stays in the thread; only `internal` is excluded. */
export function isConversation(r: Row): boolean {
  if (isSignal(r)) return false;
  if (String(r?.touch_kind ?? "") === "internal") return false;
  return true;
}

/** Split a chronological thread into what a person actually said/received
 *  vs. the engagement signals around it. Order is preserved in both. */
export function splitThread<T extends Row>(rows: T[]): { messages: T[]; signals: T[] } {
  const messages: T[] = [];
  const signals: T[] = [];
  for (const r of rows) (isConversation(r) ? messages : signals).push(r);
  return { messages, signals };
}
