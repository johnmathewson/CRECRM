"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/cre-os/AppShell";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { Panel } from "@/components/cre-os/Panel";
import { StatusBadge } from "@/components/cre-os/StatusBadge";
import type { RailSection } from "@/components/cre-os/InsightsRail";

/**
 * SettingsView — settings & integrations command surface inside CRE OS.
 * Wraps the same endpoints the legacy /settings/integrations page used:
 *
 *   GET  /api/integrations/google/status      — Gmail OAuth status
 *   POST /api/integrations/google/disconnect  — revoke + clear stored tokens
 *   POST /api/cron/poll-gmail                  — fire a one-off Gmail poll
 *   GET  /api/extension/api-keys               — list keys
 *   POST /api/extension/api-keys               — generate (plaintext returned ONCE)
 *   DELETE /api/extension/api-keys/[id]        — revoke
 *
 * No new server logic — just a brand-consistent surface so the broker
 * doesn't bounce back to legacy.
 */
interface GmailStatus {
  connected: boolean;
  email?: string;
  scopes?: string[];
  granted_at?: string;
  last_polled_at?: string;
  poll_error?: string;
}

interface ApiKeyRow {
  id: string;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

const fmtTime = (iso?: string | null): string => {
  if (!iso) return "never";
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
};
const timeAgo = (iso?: string | null): string => {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
};

export function SettingsView() {
  return (
    <AppShell
      rail={[
        {
          eyebrow: "Settings · Connections",
          children: (
            <p className="font-body text-[11px] text-cream-dim leading-relaxed">
              Gmail powers the Inbox lead routing. The Chrome extension powers CREXi/LoopNet metric scraping that
              feeds the Performance tab and Listings page.
            </p>
          ),
        },
        {
          eyebrow: "Need to add something?",
          children: (
            <ul className="space-y-1.5 font-body text-[11px] text-cream-dim leading-relaxed list-disc list-inside marker:text-coral-400">
              <li>Org-level commission defaults — coming.</li>
              <li>User accounts / roles — single-user today.</li>
              <li>Webhooks — coming if needed.</li>
            </ul>
          ),
        },
      ]}
    >
      <div className="space-y-7">
        <header>
          <Eyebrow tone="coral">Settings · Integrations</Eyebrow>
          <h1 className="mt-1 font-display font-medium text-3xl text-cream tracking-tight">Settings</h1>
          <p className="mt-2 font-heading text-[14px] text-cream-dim leading-relaxed max-w-3xl">
            Connections that power the inbox, the listing-performance dashboards, and the Chrome extension that
            scrapes CREXi/LoopNet seller dashboards.
          </p>
        </header>

        <DataImportsSection />
        <GmailSection />
        <ExtensionKeysSection />
      </div>
    </AppShell>
  );
}

function DataImportsSection() {
  return (
    <Panel
      eyebrow="Data imports"
      num={0}
      title="CoStar & PropStream uploads"
      actions={
        <a
          href="/cre-os/settings/data-imports"
          className="px-3 py-2 rounded border border-coral-400/40 bg-coral-400/[0.10] hover:bg-coral-400/[0.18] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-coral-300 transition-colors"
        >
          Open uploader →
        </a>
      }
    >
      <p className="font-body text-[12px] text-cream-dim leading-relaxed">
        Drop CoStar exports to seed the cold universe. Drop PropStream weekly exports to layer
        foreclosure, refi-maturity, and tax-delinquency signals onto matched properties.
        Properties in your warm pipeline are never modified.
      </p>
    </Panel>
  );
}

// ── Gmail integration ──────────────────────────────────────────────────────

function GmailSection() {
  const [gmail, setGmail] = useState<GmailStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"poll" | "disconnect" | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/google/status", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setGmail(json);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function disconnect() {
    if (!confirm("Disconnect Gmail? Inbox lead routing will stop until reconnected.")) return;
    setBusy("disconnect");
    setActionMsg(null);
    try {
      const res = await fetch("/api/integrations/google/disconnect", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setActionMsg("Disconnected.");
      await refresh();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusy(null);
    }
  }

  async function pollNow() {
    setBusy("poll");
    setActionMsg(null);
    try {
      const res = await fetch("/api/cron/poll-gmail", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setActionMsg(`Polled. ${json.processed ?? 0} new message${json.processed === 1 ? "" : "s"}.`);
      await refresh();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusy(null);
    }
  }

  // Connect URL — same OAuth start route the legacy page uses.
  const connectUrl = "/api/integrations/google";

  return (
    <Panel
      eyebrow="Gmail"
      num={1}
      title="Inbox lead routing"
      actions={
        loading ? (
          <span className="font-mono text-[10px] text-cream-subtle">Loading…</span>
        ) : gmail?.connected ? (
          <StatusBadge tone="teal" size="xs">Connected</StatusBadge>
        ) : (
          <StatusBadge tone="amber" size="xs">Not connected</StatusBadge>
        )
      }
    >
      <p className="font-body text-[12px] text-cream-dim mb-4 leading-relaxed">
        Authorizes the Stewardship inbox watcher to read messages from your Gmail and route inbound leads into
        the CRE OS Inbox. Read-only on the Gmail side; nothing is sent or modified.
      </p>

      {gmail?.connected && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <Stat label="Account" value={gmail.email ?? "—"} />
          <Stat label="Authorized" value={fmtTime(gmail.granted_at)} />
          <Stat label="Last polled" value={timeAgo(gmail.last_polled_at)} sub={fmtTime(gmail.last_polled_at)} />
        </div>
      )}

      {gmail?.poll_error && (
        <div className="mb-3 rounded border border-amber/30 bg-amber/[0.08] px-3 py-2 font-body text-[11px] text-amber">
          Last poll error: {gmail.poll_error}
        </div>
      )}

      {error && (
        <div className="mb-3 rounded border border-red-400/30 bg-red-500/[0.08] px-3 py-2 font-body text-[11px] text-red-300">
          {error}
        </div>
      )}
      {actionMsg && (
        <div className="mb-3 rounded border border-teal-400/30 bg-teal-400/[0.08] px-3 py-2 font-body text-[11px] text-teal-300">
          {actionMsg}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {!gmail?.connected ? (
          <a
            href={connectUrl}
            className="px-4 py-2 rounded border border-coral-400/40 bg-coral-400/[0.10] hover:bg-coral-400/[0.18] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-coral-300 transition-colors"
          >
            Connect Gmail
          </a>
        ) : (
          <>
            <button
              onClick={pollNow}
              disabled={!!busy}
              className="px-3 py-2 rounded border border-coral-400/40 bg-coral-400/[0.10] hover:bg-coral-400/[0.18] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-coral-300 transition-colors disabled:opacity-50"
            >
              {busy === "poll" ? "Polling…" : "Poll now"}
            </button>
            <a
              href={connectUrl}
              className="px-3 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-cream-dim hover:text-cream transition-colors"
            >
              Reconnect
            </a>
            <button
              onClick={disconnect}
              disabled={!!busy}
              className="ml-auto px-3 py-2 rounded border border-red-400/30 bg-red-500/[0.06] hover:bg-red-500/[0.14] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-red-300 disabled:opacity-50"
            >
              {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
            </button>
          </>
        )}
      </div>
    </Panel>
  );
}

// ── Chrome extension API keys ──────────────────────────────────────────────

function ExtensionKeysSection() {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showKey, setShowKey] = useState<{ id: string; plaintext: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/extension/api-keys", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setKeys(json.keys ?? []);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/extension/api-keys", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      // Plaintext only returned once — capture in state so we can show it.
      setShowKey({ id: json.key.id, plaintext: json.api_key });
      await refresh();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this key? The Chrome extension using it will stop syncing until you generate a replacement.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/extension/api-keys/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      if (showKey?.id === id) setShowKey(null);
      await refresh();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  function copy(value: string) {
    navigator.clipboard.writeText(value);
  }

  const active = keys.filter((k) => !k.revoked_at);
  const revoked = keys.filter((k) => !!k.revoked_at);

  return (
    <Panel
      eyebrow="Chrome extension"
      num={2}
      title="Listing-metrics scraping"
      actions={
        <button
          onClick={generate}
          disabled={busy}
          className="px-3 py-1.5 rounded border border-coral-400/40 bg-coral-400/[0.10] hover:bg-coral-400/[0.18] font-heading text-[10px] uppercase tracking-eyebrow font-semibold text-coral-300 transition-colors disabled:opacity-50"
        >
          {busy ? "…" : "+ Generate key"}
        </button>
      }
    >
      <p className="font-body text-[12px] text-cream-dim mb-4 leading-relaxed">
        The Stewardship Chrome extension scrapes listing-performance numbers from CREXi and LoopNet seller
        dashboards and posts them to the CRM. Each browser/profile that runs the extension needs its own key.
        Keys are shown <span className="text-coral-300 font-semibold">once</span> at generation; revoke + regenerate if you lose one.
      </p>

      {error && (
        <div className="mb-3 rounded border border-red-400/30 bg-red-500/[0.08] px-3 py-2 font-body text-[11px] text-red-300">
          {error}
        </div>
      )}

      {/* Plaintext capture for the just-generated key. Only shown until the
          page is reloaded or the user clicks "Got it" — same security
          posture as the legacy view. */}
      {showKey && (
        <div className="mb-4 rounded border border-coral-400/40 bg-coral-400/[0.06] p-3">
          <div className="font-mono text-[9px] uppercase tracking-eyebrow text-coral-300 mb-1">
            New key — save this now, it will not be shown again
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 font-mono text-[12px] text-cream break-all bg-black/30 px-3 py-2 rounded">
              {showKey.plaintext}
            </code>
            <button
              onClick={() => copy(showKey.plaintext)}
              className="shrink-0 px-2.5 py-2 rounded border border-coral-400/40 bg-coral-400/[0.10] hover:bg-coral-400/[0.18] font-heading text-[10px] uppercase tracking-eyebrow font-semibold text-coral-300"
            >
              Copy
            </button>
            <button
              onClick={() => setShowKey(null)}
              className="shrink-0 px-2.5 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-heading text-[10px] uppercase tracking-eyebrow font-semibold text-cream-dim hover:text-cream"
            >
              Got it
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="font-body text-[12px] text-cream-subtle py-4 text-center">Loading keys…</p>
      ) : active.length === 0 && revoked.length === 0 ? (
        <p className="font-body text-[12px] text-cream-subtle py-4">
          No keys yet. Generate one to install the Chrome extension on a new browser.
        </p>
      ) : (
        <div>
          {active.length > 0 && (
            <div className="space-y-1.5">
              {active.map((k) => (
                <KeyRow key={k.id} k={k} onRevoke={() => revoke(k.id)} busy={busy} />
              ))}
            </div>
          )}
          {revoked.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle hover:text-cream-dim">
                Revoked ({revoked.length})
              </summary>
              <div className="mt-2 space-y-1.5 opacity-60">
                {revoked.map((k) => (
                  <KeyRow key={k.id} k={k} onRevoke={() => {}} busy={busy} revoked />
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </Panel>
  );
}

function KeyRow({
  k,
  onRevoke,
  busy,
  revoked,
}: {
  k: ApiKeyRow;
  onRevoke: () => void;
  busy: boolean;
  revoked?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 rounded border border-white/[0.06] bg-white/[0.02]">
      <div className="min-w-0 flex-1">
        <div className="font-heading text-[12px] text-cream font-medium truncate" title={k.label || ""}>
          {k.label || "Unlabeled key"}
        </div>
        <div className="font-mono text-[10px] text-cream-subtle">
          Created {fmtTime(k.created_at)}
          {k.last_used_at ? ` · last used ${timeAgo(k.last_used_at)}` : " · never used"}
          {k.revoked_at ? ` · revoked ${fmtTime(k.revoked_at)}` : ""}
        </div>
      </div>
      {!revoked && (
        <button
          onClick={onRevoke}
          disabled={busy}
          className="shrink-0 px-2.5 py-1 rounded border border-red-400/25 bg-red-500/[0.06] hover:bg-red-500/[0.14] font-heading text-[10px] uppercase tracking-eyebrow font-semibold text-red-300 transition-colors disabled:opacity-50"
        >
          Revoke
        </button>
      )}
    </div>
  );
}

// ── Reusable bits ──────────────────────────────────────────────────────────

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border border-white/[0.05] bg-steward-mid/30 px-3 py-2">
      <div className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">{label}</div>
      <div className="mt-0.5 font-body text-[12px] text-cream truncate" title={value}>{value}</div>
      {sub && <div className="font-mono text-[9px] text-cream-subtle mt-0.5">{sub}</div>}
    </div>
  );
}
