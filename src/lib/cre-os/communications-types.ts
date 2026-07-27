/**
 * Communications dashboard types + display constants.
 *
 * Deliberately free of any server-only import (no next/headers, no
 * Supabase client). Client components import from here; the loader in
 * communications-queries.ts imports these same types on the server.
 * Keeping them split stops the server module from being pulled into the
 * client bundle.
 */

export type TouchKind =
  | "ai_followup"
  | "campaign"
  | "auto_ack"
  | "manual"
  | "internal";

export const TOUCH_KIND_LABEL: Record<string, string> = {
  ai_followup: "AI follow-up",
  campaign: "Campaign",
  auto_ack: "Auto-ack",
  manual: "Manual",
  internal: "Internal",
  unclassified: "Unclassified",
};

export type CommsChannel =
  | "email"
  | "sms"
  | "phone"
  | "website"
  | "calendar"
  | "voice"
  | "manual_test";

export const CHANNEL_LABEL: Record<string, string> = {
  email: "Email",
  sms: "SMS",
  phone: "Phone",
  website: "Website",
  calendar: "Calendar",
  voice: "Voice",
  manual_test: "Test",
};

export interface AttachmentMeta {
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
}

export interface CommsFilters {
  /** Free-text over subject, body preview, from address */
  q?: string;
  propertyId?: string;
  touchKind?: TouchKind | "all";
  channel?: CommsChannel | "all";
  direction?: "inbound" | "outbound" | "all";
  /** ISO date, inclusive */
  since?: string;
  /** ISO date, inclusive */
  until?: string;
  limit?: number;
}

export interface CommsRow {
  id: string;
  direction: "inbound" | "outbound";
  channel: string;
  touchKind: string | null;
  subject: string | null;
  bodyPreview: string | null;
  fromAddress: string | null;
  toAddresses: string[];
  attachments: AttachmentMeta[];
  occurredAt: string;
  occurredRelative: string;
  property: { id: string; name: string; slug: string } | null;
  contact: { id: string; name: string; email: string | null } | null;
  leadId: string | null;
}

export interface CommsSummary {
  total: number;
  inbound: number;
  outbound: number;
  byKind: Record<string, number>;
  byChannel: Record<string, number>;
  distinctRecipients: number;
  /** inbound / (outbound excluding internal + auto_ack). Null when no
   *  reply-eligible outbound in range — avoids a misleading 0%. */
  replyRatePct: number | null;
  firstAt: string | null;
  lastAt: string | null;
}

export interface PropertyCommsRollup {
  propertyId: string;
  propertyName: string;
  propertySlug: string;
  total: number;
  outbound: number;
  inbound: number;
  aiFollowup: number;
  campaign: number;
  manual: number;
  lastTouchAt: string | null;
  lastTouchRelative: string;
}

export interface CommsSnapshot {
  rows: CommsRow[];
  summary: CommsSummary;
  byProperty: PropertyCommsRollup[];
  propertyOptions: { id: string; name: string }[];
  /** Row list hit the cap — UI shows "showing N of M" */
  truncated: boolean;
}
