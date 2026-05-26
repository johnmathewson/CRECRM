/**
 * Gmail API client — thin wrapper over the REST endpoints we actually use.
 *
 * Used by:
 *   - /api/cron/poll-gmail   (history.list + messages.get to ingest inbound)
 *   - /api/leads/[id]/send   (messages.send for John's reviewed drafts)
 *   - /api/leads/[id]/ack    (messages.send for the 2-5 min auto-ack)
 *
 * Auth: each call takes an access_token. Callers refresh via the
 * google-oauth helper when expired.
 */

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface GmailMessageHeader {
  name: string;
  value: string;
}

export interface GmailMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailMessageHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailMessagePart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  internalDate?: string;
  payload?: GmailMessagePart;
  sizeEstimate?: number;
  raw?: string;
}

export interface GmailHistoryRecord {
  id: string;
  messages?: { id: string; threadId: string }[];
  messagesAdded?: { message: { id: string; threadId: string; labelIds?: string[] } }[];
  messagesDeleted?: { message: { id: string; threadId: string } }[];
  labelsAdded?: any[];
  labelsRemoved?: any[];
}

export interface GmailHistoryListResponse {
  history?: GmailHistoryRecord[];
  nextPageToken?: string;
  historyId?: string;
}

export interface GmailProfile {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
}

async function gmailFetch(
  path: string,
  accessToken: string,
  init?: RequestInit
): Promise<Response> {
  const res = await fetch(`${GMAIL_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  return res;
}

async function gmailJson<T>(path: string, accessToken: string, init?: RequestInit): Promise<T> {
  const res = await gmailFetch(path, accessToken, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail API ${path} failed (${res.status}): ${text.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

export async function getProfile(accessToken: string): Promise<GmailProfile> {
  return gmailJson<GmailProfile>("/profile", accessToken);
}

/**
 * Search Gmail messages by query (e.g. "in:sent after:2026/05/01").
 * Returns up to maxResults message stubs { id, threadId }.
 * Does NOT fetch message bodies — call getMessage() on each id for that.
 */
export async function listMessages(
  accessToken: string,
  query: string,
  maxResults: number = 25
): Promise<{ id: string; threadId: string }[]> {
  const params = new URLSearchParams({
    q: query,
    maxResults: String(Math.min(maxResults, 100)),
  });
  const res = await gmailJson<{
    messages?: { id: string; threadId: string }[];
    nextPageToken?: string;
    resultSizeEstimate?: number;
  }>(`/messages?${params.toString()}`, accessToken);
  return res.messages ?? [];
}

/**
 * List history records since startHistoryId. Returns only messagesAdded changes
 * by filtering on historyTypes=messageAdded.
 */
export async function listHistory(
  accessToken: string,
  startHistoryId: string,
  pageToken?: string
): Promise<GmailHistoryListResponse> {
  const params = new URLSearchParams({
    startHistoryId,
    historyTypes: "messageAdded",
    maxResults: "100",
  });
  if (pageToken) params.set("pageToken", pageToken);
  return gmailJson<GmailHistoryListResponse>(`/history?${params.toString()}`, accessToken);
}

export async function getMessage(accessToken: string, messageId: string): Promise<GmailMessage> {
  return gmailJson<GmailMessage>(`/messages/${messageId}?format=full`, accessToken);
}

export interface SendMessageInput {
  to: string;
  from: string; // "John Mathewson <inquiries@stewardshipcre.com>"
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  inReplyTo?: string; // RFC 822 Message-ID for threading
  references?: string;
  threadId?: string; // Gmail thread id (preferred for keeping replies in same thread)
}

export interface SendMessageResponse {
  id: string;
  threadId: string;
  labelIds?: string[];
}

/**
 * Send an email via Gmail. Returns the new message's gmail id + thread id.
 *
 * The message is RFC 822 formatted, then base64url-encoded as required by
 * messages.send. Threading is handled via threadId on the request body when
 * provided (Gmail keeps it in the same thread); we also include In-Reply-To
 * + References headers as a fallback for clients that don't honor threadId.
 */
export async function sendMessage(
  accessToken: string,
  input: SendMessageInput
): Promise<SendMessageResponse> {
  const headers: string[] = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    "MIME-Version: 1.0",
  ];
  if (input.inReplyTo) headers.push(`In-Reply-To: ${input.inReplyTo}`);
  if (input.references) headers.push(`References: ${input.references}`);

  let body = "";
  if (input.bodyHtml && input.bodyText) {
    const boundary = `bnd_${Math.random().toString(36).slice(2)}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    body =
      `--${boundary}\r\n` +
      `Content-Type: text/plain; charset="UTF-8"\r\n` +
      `Content-Transfer-Encoding: 7bit\r\n\r\n` +
      `${input.bodyText}\r\n\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: text/html; charset="UTF-8"\r\n` +
      `Content-Transfer-Encoding: 7bit\r\n\r\n` +
      `${input.bodyHtml}\r\n\r\n` +
      `--${boundary}--`;
  } else {
    headers.push(`Content-Type: text/plain; charset="UTF-8"`);
    headers.push(`Content-Transfer-Encoding: 7bit`);
    body = input.bodyText;
  }

  const rfc822 = headers.join("\r\n") + "\r\n\r\n" + body;
  const raw = base64UrlEncode(rfc822);

  const payload: any = { raw };
  if (input.threadId) payload.threadId = input.threadId;

  return gmailJson<SendMessageResponse>("/messages/send", accessToken, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ── Message parsing helpers ────────────────────────────────────────────────

export function getHeader(payload: GmailMessagePart | undefined, name: string): string | null {
  if (!payload?.headers) return null;
  const h = payload.headers.find(h => h.name.toLowerCase() === name.toLowerCase());
  return h?.value || null;
}

/**
 * Walks the MIME tree and pulls out the text/plain body if present, else the
 * text/html body stripped of tags. Gmail nests parts arbitrarily deep —
 * this recurses.
 */
export function extractBody(payload: GmailMessagePart | undefined): { text: string; html: string | null } {
  if (!payload) return { text: "", html: null };

  let textBody = "";
  let htmlBody: string | null = null;

  function walk(part: GmailMessagePart) {
    const mime = (part.mimeType || "").toLowerCase();
    if (mime === "text/plain" && part.body?.data) {
      const decoded = base64UrlDecode(part.body.data);
      if (decoded.length > textBody.length) textBody = decoded;
    } else if (mime === "text/html" && part.body?.data) {
      const decoded = base64UrlDecode(part.body.data);
      if (!htmlBody || decoded.length > htmlBody.length) htmlBody = decoded;
    }
    if (part.parts) part.parts.forEach(walk);
  }
  walk(payload);

  // If we got HTML but no plaintext, strip tags as a fallback.
  if (!textBody && htmlBody) {
    // Local const so TS keeps narrowing across the chained .replace calls.
    const html: string = htmlBody;
    textBody = html
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  return { text: textBody, html: htmlBody };
}

/** Parses "John Doe <john@example.com>" → { name, email }. */
export function parseAddress(value: string | null): { name: string | null; email: string | null } {
  if (!value) return { name: null, email: null };
  const match = value.match(/^"?([^"<]+?)"?\s*<([^>]+)>$/);
  if (match) return { name: match[1].trim() || null, email: match[2].trim() };
  if (value.includes("@")) return { name: null, email: value.trim() };
  return { name: value.trim() || null, email: null };
}

// ── base64url ─────────────────────────────────────────────────────────────

function base64UrlEncode(input: string): string {
  // Convert UTF-8 string to base64url.
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(input: string): string {
  // base64url → base64 → UTF-8 string
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}
