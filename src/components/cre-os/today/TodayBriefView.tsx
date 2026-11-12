"use client";

import { useState } from "react";
import { AppShell } from "@/components/cre-os/AppShell";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import type { RailSection } from "@/components/cre-os/InsightsRail";
import { StewardFeedback } from "./StewardFeedback";
import type { TodayBriefingRow } from "@/lib/cre-os/brief-queries";

/**
 * TodayBriefView — read-only render of the latest Steward brief, plus
 * regenerate + feedback widgets. The brief is the same content delivered
 * via email; this page is the in-CRM rendering so John can work the
 * brief without leaving the app.
 *
 * Sections:
 *   - Header: brief date, "Generated at" timestamp, regenerate button,
 *     email-delivery status
 *   - Body: the brief itself (HTML pre-rendered server-side from
 *     content_text)
 *   - Footer: telemetry (sources read, tokens, duration)
 *   - Feedback widget: thumbs + chat
 *
 * The rail surfaces what Steward read this morning so John can verify
 * her sources at a glance.
 */
export function TodayBriefView({ brief }: { brief: TodayBriefingRow | null }) {
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);

  async function handleRegenerate() {
    setRegenerating(true);
    setRegenError(null);
    try {
      const r = await fetch("/api/agents/steward/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ briefType: "daily" }),
      });
      if (!r.ok && r.status !== 202) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${r.status}`);
      }
      // Background function takes 60-90s. Poll every 5s, reload page
      // when the row's generated_at advances past our current view.
      const previousGeneratedAt = brief?.generated_at ?? "";
      const startedAt = Date.now();
      const TIMEOUT_MS = 180_000;
      const POLL_MS = 5_000;

      const poll = async (): Promise<void> => {
        if (Date.now() - startedAt > TIMEOUT_MS) {
          setRegenerating(false);
          setRegenError("Took longer than 3 minutes — refresh manually.");
          return;
        }
        const probe = await fetch("/api/agents/steward/latest", { cache: "no-store" });
        if (probe.ok) {
          const j = await probe.json();
          if (j?.generated_at && j.generated_at !== previousGeneratedAt) {
            window.location.reload();
            return;
          }
        }
        setTimeout(poll, POLL_MS);
      };
      setTimeout(poll, POLL_MS);
    } catch (err) {
      setRegenerating(false);
      setRegenError(err instanceof Error ? err.message : String(err));
    }
  }

  const rail = brief ? buildRail(brief) : [];

  return (
    <AppShell rail={rail}>
      <div className="today-shell max-w-3xl space-y-6">
        <header className="flex items-start justify-between gap-x-4 gap-y-3 flex-wrap">
          <div className="min-w-0">
            <Eyebrow tone="coral">Steward · Chief Operating Officer</Eyebrow>
            <h1 className="mt-1 font-display text-[30px] font-extrabold text-cream leading-none">
              Today&apos;s Brief
            </h1>
            <p className="mt-2 font-mono text-[11px] text-cream-muted">
              {brief
                ? `${formatDate(brief.brief_date)} · generated ${formatRelative(brief.generated_at)}`
                : "No brief has been generated yet."}
              {brief?.email_sent_at ? (
                <span className="ml-2 inline-block px-1.5 py-px rounded bg-teal-400/[0.08] border border-teal-400/30 text-teal-300">
                  emailed
                </span>
              ) : null}
            </p>
          </div>
          <button
            onClick={handleRegenerate}
            disabled={regenerating}
            className="px-3.5 py-2 rounded border border-coral-400/40 bg-coral-400/[0.08] hover:bg-coral-400/[0.15] disabled:opacity-50 font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-coral-300 whitespace-nowrap"
          >
            {regenerating ? "Regenerating…" : "Regenerate"}
          </button>
        </header>

        {regenError ? (
          <div className="rounded border border-coral-400/40 bg-coral-400/[0.08] px-3 py-2 font-body text-[12px] text-coral-300">
            {regenError}
          </div>
        ) : null}

        {brief ? (
          <>
            <article
              className="brief-body border border-white/[0.08] bg-steward-surface px-5 py-5 lg:px-8 lg:py-7"
              dangerouslySetInnerHTML={{ __html: brief.content_html_inner }}
            />

            <footer className="font-mono text-[10px] text-cream-subtle border-t border-white/[0.04] pt-3 leading-relaxed">
              {brief.model_used} · {brief.agent_iterations} iterations ·{" "}
              {brief.tokens_input?.toLocaleString()}+{brief.tokens_output?.toLocaleString()} tokens ·{" "}
              {brief.duration_ms ? `${(brief.duration_ms / 1000).toFixed(1)}s` : "—"}
            </footer>

            <StewardFeedback briefId={brief.id} existingChat={brief.feedback_chat} existingThumbs={brief.feedback_thumbs} />
          </>
        ) : (
          <div className="rounded-md border border-white/[0.08] bg-white/[0.02] p-8 text-center">
            <p className="font-body text-[14px] text-cream-dim mb-4">
              Steward hasn&apos;t generated any briefs yet. The first one will land Mon&ndash;Sat at 6:00&nbsp;AM CT.
              Want to generate one now?
            </p>
            <button
              onClick={handleRegenerate}
              disabled={regenerating}
              className="px-4 py-2 rounded border border-coral-400/40 bg-coral-400/[0.10] hover:bg-coral-400/[0.20] disabled:opacity-50 font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-coral-300"
            >
              {regenerating ? "Generating…" : "Generate now"}
            </button>
          </div>
        )}
      </div>

      <style jsx global>{`
        /* The brief is marked-rendered HTML (h1–h3, p, ul/ol, table, a,
           blockquote, hr). Brand Guide v1.0 on the light canvas: Ink text on
           a white card, Copper accents, no radius. Written for reading on a
           phone at 6 AM — full-contrast body text, no faded tiers. */
        .brief-body {
          color: #191D21;
          font-family: var(--font-body, ui-sans-serif), system-ui, sans-serif;
          font-size: 15px;
          line-height: 1.6;
        }
        .brief-body h1,
        .brief-body h2,
        .brief-body h3,
        .brief-body h4 {
          font-family: var(--font-display, ui-sans-serif), system-ui, sans-serif;
          color: #191D21;
          font-weight: 800;
          letter-spacing: -0.01em;
          line-height: 1.25;
        }
        .brief-body > :first-child { margin-top: 0; }
        .brief-body h1 { font-size: 22px; margin-top: 8px; margin-bottom: 12px; }
        .brief-body h2 {
          font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em;
          margin-top: 30px; margin-bottom: 12px; padding-bottom: 6px;
          border-bottom: 2px solid #191D21;
        }
        .brief-body h3 { font-size: 15px; margin-top: 20px; margin-bottom: 8px; color: #B4552F; }
        .brief-body p { margin-top: 0; margin-bottom: 12px; }
        .brief-body strong { color: #191D21; font-weight: 700; }
        .brief-body em { color: #4A5056; font-style: italic; }
        .brief-body a { color: #B4552F; text-decoration: underline; text-underline-offset: 2px; word-break: break-word; }
        .brief-body a:hover { color: #7E361B; }
        .brief-body ul,
        .brief-body ol { margin: 8px 0 14px 0; padding-left: 22px; }
        .brief-body li { margin-bottom: 8px; }
        .brief-body ul > li { list-style-type: disc; }
        .brief-body ol > li { list-style-type: decimal; }
        .brief-body li::marker { color: #B4552F; font-weight: 700; }
        .brief-body blockquote {
          margin: 14px 0;
          padding: 12px 16px;
          border-left: 3px solid #B4552F;
          background: #F0EDE7;
          color: #191D21;
          font-style: normal;
        }
        .brief-body blockquote p:last-child { margin-bottom: 0; }
        .brief-body code {
          font-family: var(--font-mono, ui-monospace), SFMono-Regular, monospace;
          background: #F0EDE7;
          padding: 1px 5px;
          font-size: 13px;
          color: #191D21;
        }
        .brief-body hr {
          border: 0;
          border-top: 1px solid #E7E4DE;
          margin: 24px 0;
        }
        .brief-body table {
          display: block;
          max-width: 100%;
          overflow-x: auto;
          border-collapse: collapse;
          margin: 12px 0 16px 0;
          font-size: 13.5px;
        }
        .brief-body th,
        .brief-body td {
          padding: 8px 10px;
          text-align: left;
          border-bottom: 1px solid #E7E4DE;
          vertical-align: top;
        }
        .brief-body th {
          font-family: var(--font-mono, ui-monospace), monospace;
          font-size: 10.5px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #4A5056;
          font-weight: 600;
          white-space: nowrap;
        }
        .brief-body td { color: #191D21; }
        .brief-body table tr:last-child td { border-bottom: none; }
      `}</style>
    </AppShell>
  );
}

function buildRail(brief: TodayBriefingRow): RailSection[] {
  const sources = Object.entries(brief.sources_read).sort(([a], [b]) => a.localeCompare(b));
  return [
    {
      eyebrow: "Sources Steward read",
      children: (
        <ul className="space-y-1.5 font-mono text-[10.5px] text-cream-dim">
          {sources.length === 0 ? (
            <li className="italic text-cream-subtle">none recorded</li>
          ) : (
            sources.map(([name, count]) => (
              <li key={name} className="flex items-center justify-between border-b border-white/[0.04] pb-1.5 last:border-b-0 last:pb-0">
                <span>{name.replace(/^get_/, "")}</span>
                <span className="text-cream font-semibold">×{count}</span>
              </li>
            ))
          )}
        </ul>
      ),
    },
    {
      eyebrow: "Delivery",
      children: (
        <div className="space-y-1.5 font-mono text-[10.5px] text-cream-dim">
          <div className="flex items-baseline justify-between border-b border-white/[0.04] pb-1.5">
            <span className="text-cream-subtle">Generated</span>
            <span className="text-cream">{formatTime(brief.generated_at)}</span>
          </div>
          <div className="flex items-baseline justify-between border-b border-white/[0.04] pb-1.5">
            <span className="text-cream-subtle">Brief date</span>
            <span className="text-cream">{brief.brief_date}</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-cream-subtle">Emailed</span>
            <span className={brief.email_sent_at ? "text-teal-300" : "text-coral-300"}>
              {brief.email_sent_at ? "yes" : "no"}
            </span>
          </div>
        </div>
      ),
    },
    {
      eyebrow: "Playbook",
      children: (
        <p className="font-body text-[11px] text-cream-dim leading-relaxed">
          Edit Steward&apos;s instructions directly in{" "}
          <code className="font-mono text-[10px] bg-white/[0.05] px-1 py-px rounded text-coral-300">agents/steward.md</code>{" "}
          in the repo. Changes apply on the next brief.
        </p>
      ),
    },
  ];
}

function formatDate(iso: string): string {
  // iso is "YYYY-MM-DD" — display as "Wed, June 18"
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric" });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const mins = Math.floor((now - then) / 60_000);
  if (mins < 1) return "moments ago";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
