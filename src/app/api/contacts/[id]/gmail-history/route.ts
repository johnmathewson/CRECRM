/**
 * GET /api/contacts/[id]/gmail-history
 *
 * Returns every Gmail message where the contact is sender OR recipient,
 * so the call panel can show the full back-and-forth (their original
 * inquiry, our reply, their follow-up — anything, on any lead).
 *
 * Approach:
 *   1. Load contact's email from contacts table
 *   2. Query Gmail with `from:X OR to:X` — one round-trip for IDs
 *   3. Fetch each message body in parallel (capped to prevent runaway)
 *   4. Extract sender/recipient/subject/date/body from each
 *   5. Sort chronologically, oldest first (natural conversation order)
 *   6. Return grouped by thread_id so the UI can render conversation threads
 *
 * Caps at 50 messages per contact to keep tokens + latency in check.
 * If a contact has more history, they see the newest 50 across threads.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getActiveGmailToken } from "@/lib/gmail-auth";
import { listMessages, getMessage, getHeader, extractBody, parseAddress } from "@/lib/gmail";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ORG_ID = "a0000000-0000-0000-0000-000000000001";
const MAX_MESSAGES = 50;

interface ThreadMessage {
  id: string;
  thread_id: string;
  date: string | null;
  from_name: string | null;
  from_email: string | null;
  to: string | null;
  subject: string | null;
  snippet: string;
  body_text: string;
  is_from_broker: boolean;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: contact, error: contactErr } = await sb
    .from("contacts")
    .select("id, full_name, email")
    .eq("id", params.id)
    .eq("organization_id", ORG_ID)
    .maybeSingle();

  if (contactErr) return NextResponse.json({ error: contactErr.message }, { status: 500 });
  if (!contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  if (!contact.email) {
    return NextResponse.json({ threads: [], reason: "no_email_on_contact" });
  }

  // Get an active Gmail OAuth token — this handles refresh transparently.
  const token = await getActiveGmailToken(sb);
  if (!token) {
    return NextResponse.json(
      { error: "Gmail is not connected. Reconnect at /cre-os/settings/gmail." },
      { status: 503 }
    );
  }

  const contactEmail = contact.email.toLowerCase();
  const brokerEmail = (token.email || "").toLowerCase();

  // Query Gmail for every message this contact is on. Single query with
  // OR handles both directions (inbound + outbound) in one call.
  const query = `(from:${contactEmail} OR to:${contactEmail})`;
  let messageIds: { id: string; threadId: string }[] = [];
  try {
    // listMessages returns the array directly (id + threadId per message)
    messageIds = await listMessages(token.accessToken, query, MAX_MESSAGES);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Gmail search failed: ${msg}` }, { status: 502 });
  }

  if (messageIds.length === 0) {
    return NextResponse.json({ threads: [] });
  }

  // Fetch each message body in parallel — capped, so this is bounded.
  const results = await Promise.allSettled(
    messageIds.map(async (m): Promise<ThreadMessage | null> => {
      try {
        const msg = await getMessage(token.accessToken, m.id);
        const payload = msg.payload;
        const from = getHeader(payload, "From");
        const to = getHeader(payload, "To");
        const subject = getHeader(payload, "Subject");
        const date = getHeader(payload, "Date");
        const { text } = extractBody(payload);
        const parsed = parseAddress(from);
        const fromEmail = parsed.email?.toLowerCase() ?? null;
        return {
          id: msg.id,
          thread_id: msg.threadId,
          date,
          from_name: parsed.name,
          from_email: parsed.email,
          to,
          subject,
          snippet: msg.snippet ?? "",
          body_text: text,
          // True when the broker sent it — helps the UI split "you"
          // vs "them" bubbles without further parsing.
          is_from_broker: !!brokerEmail && fromEmail === brokerEmail,
        };
      } catch {
        return null;
      }
    })
  );

  const messages = results
    .flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value] : []))
    // Sort oldest → newest so threads read chronologically
    .sort((a, b) => {
      const da = a.date ? new Date(a.date).getTime() : 0;
      const db = b.date ? new Date(b.date).getTime() : 0;
      return da - db;
    });

  // Group by thread_id, preserving the newest-thread-first ordering
  // (each thread's messages stay oldest-first inside).
  const threadMap = new Map<string, ThreadMessage[]>();
  for (const m of messages) {
    const list = threadMap.get(m.thread_id);
    if (list) list.push(m);
    else threadMap.set(m.thread_id, [m]);
  }
  const threads = Array.from(threadMap.entries())
    .map(([thread_id, msgs]) => ({
      thread_id,
      subject: msgs[msgs.length - 1]?.subject ?? msgs[0]?.subject ?? "(no subject)",
      last_date: msgs[msgs.length - 1]?.date ?? null,
      message_count: msgs.length,
      messages: msgs,
    }))
    .sort((a, b) => {
      const da = a.last_date ? new Date(a.last_date).getTime() : 0;
      const db = b.last_date ? new Date(b.last_date).getTime() : 0;
      return db - da; // newest thread first
    });

  return NextResponse.json({
    contact: { id: contact.id, name: contact.full_name, email: contact.email },
    threads,
    total_messages: messages.length,
    capped: messageIds.length >= MAX_MESSAGES,
  });
}
