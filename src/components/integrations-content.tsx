"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
// note: ChromeExtensionCard reuses C palette from outer scope

interface GmailStatus {
  connected: boolean;
  email?: string;
  scopes?: string[];
  granted_at?: string;
  last_polled_at?: string;
  poll_error?: string;
}

const C = {
  coral: "#E07A5F",
  teal: "#4ECDC4",
  amber: "#F2C94C",
  red: "#E74C3C",
  green: "#6BCB77",
  cream: "#F0EDE4",
  charSubtle: "rgba(240,237,228,0.55)",
  charMuted: "rgba(240,237,228,0.75)",
};

function fmtTime(iso?: string) {
  if (!iso) return "never";
  const date = new Date(iso);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function timeAgo(iso?: string) {
  if (!iso) return null;
  const ts = new Date(iso).getTime();
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return null;
}

export default function IntegrationsContent() {
  return (
    <Suspense fallback={null}>
      <IntegrationsContentInner />
    </Suspense>
  );
}

function IntegrationsContentInner() {
  const searchParams = useSearchParams();
  const callbackStatus = searchParams.get("status");
  const callbackMsg = searchParams.get("msg");

  const [gmail, setGmail] = useState<GmailStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/integrations/google/status");
      const data = await res.json();
      setGmail(data);
    } catch (e: any) {
      setActionMsg(`Status check failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Surface callback status from query string once
  useEffect(() => {
    if (callbackStatus === "connected") {
      setActionMsg(`Connected ${callbackMsg ? `as ${callbackMsg}` : ""}`);
    } else if (callbackStatus === "error") {
      setActionMsg(`Connect failed: ${callbackMsg || "unknown error"}`);
    }
  }, [callbackStatus, callbackMsg]);

  function connect() {
    window.location.href = `/api/auth/google/connect?email=${encodeURIComponent("inquiries@stewardshipcre.com")}`;
  }

  async function disconnect() {
    if (!confirm("Disconnect Gmail? The agent won't be able to send or read inbound until you reconnect.")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/integrations/google/disconnect", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setActionMsg("Disconnected");
      await load();
    } catch (e: any) {
      setActionMsg(`Disconnect failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function pollNow() {
    setBusy(true);
    setActionMsg(null);
    try {
      const res = await fetch("/api/cron/poll-gmail", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          setActionMsg("Manual poll requires CRON_SECRET set on the server. Polling will run automatically every minute via Netlify's scheduled function once deployed.");
        } else {
          setActionMsg(`Poll failed: ${body.poll?.error || `HTTP ${res.status}`}`);
        }
      } else {
        const newCount = body.poll?.new_messages || 0;
        const drained = body.acks?.drained || 0;
        setActionMsg(
          `Poll OK — ${newCount} new message${newCount === 1 ? "" : "s"} ingested, ${drained} auto-ack${drained === 1 ? "" : "s"} sent`
        );
      }
      await load();
    } catch (e: any) {
      setActionMsg(`Poll failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/agent"
          className="text-[11px] tracking-[0.1em] uppercase font-medium no-underline"
          style={{ color: C.charSubtle }}
        >
          ← Back to agent
        </Link>
        <h1 className="text-[24px] font-semibold mt-2 mb-1" style={{ color: C.cream }}>
          Integrations
        </h1>
        <p className="text-[12.5px]" style={{ color: C.charMuted }}>
          External services the agent uses to receive and send mail. Connect once;
          disconnect any time.
        </p>
      </div>

      {actionMsg && (
        <div
          className="mb-5 px-4 py-3 rounded text-[12px]"
          style={{
            background: actionMsg.toLowerCase().includes("fail") ? "rgba(231,76,60,0.08)" : "rgba(78,205,196,0.08)",
            border: `1px solid ${actionMsg.toLowerCase().includes("fail") ? "rgba(231,76,60,0.25)" : "rgba(78,205,196,0.25)"}`,
            color: C.cream,
          }}
        >
          {actionMsg}
        </div>
      )}

      {/* Gmail card */}
      <div className="glass" style={{ padding: 22, marginBottom: 16 }}>
        <div className="flex items-start gap-4 mb-4">
          <div className="text-[32px]">📨</div>
          <div className="flex-1">
            <div className="flex items-baseline gap-3 flex-wrap mb-1">
              <h2 className="text-[16px] font-semibold m-0" style={{ color: C.cream }}>
                Gmail / Google Workspace
              </h2>
              {loading ? (
                <span className="text-[10px]" style={{ color: C.charSubtle }}>checking…</span>
              ) : gmail?.connected ? (
                <span
                  className="text-[10px] font-bold tracking-wider uppercase py-[2px] px-2 rounded"
                  style={{ background: "rgba(107,203,119,0.18)", color: C.green }}
                >
                  Connected
                </span>
              ) : (
                <span
                  className="text-[10px] font-bold tracking-wider uppercase py-[2px] px-2 rounded"
                  style={{ background: "rgba(255,255,255,0.06)", color: C.charSubtle }}
                >
                  Not connected
                </span>
              )}
            </div>
            <p className="text-[12px]" style={{ color: C.charMuted }}>
              The agent reads inbound at <strong>inquiries@stewardshipcre.com</strong>, drafts replies for your review, and sends from the same mailbox once you approve. Polling cadence: every 60 seconds.
            </p>
          </div>
        </div>

        {gmail?.connected && (
          <div
            className="grid gap-y-2 gap-x-6 mb-4 text-[11.5px]"
            style={{ gridTemplateColumns: "auto 1fr", color: C.charMuted }}
          >
            <span style={{ color: C.charSubtle }}>Mailbox:</span>
            <span style={{ color: C.cream, fontFamily: "monospace" }}>{gmail.email}</span>

            <span style={{ color: C.charSubtle }}>Granted:</span>
            <span>{fmtTime(gmail.granted_at)}</span>

            <span style={{ color: C.charSubtle }}>Last poll:</span>
            <span>
              {fmtTime(gmail.last_polled_at)}
              {timeAgo(gmail.last_polled_at) && (
                <span style={{ color: C.charSubtle }}> · {timeAgo(gmail.last_polled_at)}</span>
              )}
            </span>

            {gmail.scopes && (
              <>
                <span style={{ color: C.charSubtle }}>Scopes:</span>
                <span style={{ fontFamily: "monospace", fontSize: 10.5 }}>
                  {gmail.scopes.map(s => s.replace("https://www.googleapis.com/auth/", "")).join(", ")}
                </span>
              </>
            )}

            {gmail.poll_error && (
              <>
                <span style={{ color: C.red }}>Last error:</span>
                <span style={{ color: C.red }}>{gmail.poll_error}</span>
              </>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          {gmail?.connected ? (
            <>
              <button
                onClick={pollNow}
                disabled={busy}
                className="text-[11.5px] font-semibold py-2 px-4 rounded tracking-wider uppercase"
                style={{
                  border: "1px solid rgba(78,205,196,0.4)",
                  background: "rgba(78,205,196,0.1)",
                  color: C.teal,
                  cursor: busy ? "wait" : "pointer",
                  opacity: busy ? 0.6 : 1,
                }}
              >
                Run poll now
              </button>
              <button
                onClick={connect}
                disabled={busy}
                className="text-[11.5px] font-semibold py-2 px-4 rounded tracking-wider uppercase"
                style={{
                  border: "1px solid rgba(255,255,255,0.1)",
                  background: "transparent",
                  color: C.charMuted,
                  cursor: "pointer",
                }}
              >
                Reconnect
              </button>
              <button
                onClick={disconnect}
                disabled={busy}
                className="text-[11.5px] font-semibold py-2 px-4 rounded tracking-wider uppercase"
                style={{
                  border: "1px solid rgba(231,76,60,0.4)",
                  background: "transparent",
                  color: C.red,
                  cursor: busy ? "wait" : "pointer",
                }}
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              onClick={connect}
              disabled={busy || loading}
              className="text-[11.5px] font-semibold py-2.5 px-5 rounded tracking-wider uppercase"
              style={{
                border: "1px solid rgba(224,122,95,0.5)",
                background: "rgba(224,122,95,0.15)",
                color: C.coral,
                cursor: busy ? "wait" : "pointer",
              }}
            >
              Connect Gmail
            </button>
          )}
        </div>
      </div>

      {/* Chrome extension card */}
      <ChromeExtensionCard />

      {/* Twilio placeholder */}
      <div className="glass" style={{ padding: 22, marginBottom: 16, opacity: 0.5 }}>
        <div className="flex items-start gap-4">
          <div className="text-[32px]">💬</div>
          <div className="flex-1">
            <div className="flex items-baseline gap-3 flex-wrap mb-1">
              <h2 className="text-[16px] font-semibold m-0" style={{ color: C.cream }}>
                Twilio (SMS + voice)
              </h2>
              <span
                className="text-[10px] font-bold tracking-wider uppercase py-[2px] px-2 rounded"
                style={{ background: "rgba(255,255,255,0.06)", color: C.charSubtle }}
              >
                Slice E
              </span>
            </div>
            <p className="text-[12px]" style={{ color: C.charMuted }}>
              SMS inbound (Twilio webhook) and voicemail transcription (Twilio recording → transcription → email format). Both produce drafts only — never auto-sent.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Chrome extension card ──────────────────────────────────────────────────

interface ApiKeyRow {
  id: string;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

function ChromeExtensionCard() {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showKey, setShowKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/extension/api-keys");
      const data = await res.json();
      setKeys(data.keys || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/extension/api-keys", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate");
      setShowKey(data.api_key);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this key? The extension that uses it will stop working until you generate a new one.")) return;
    await fetch(`/api/extension/api-keys/${id}`, { method: "DELETE" });
    await load();
  }

  const activeKeys = keys.filter(k => !k.revoked_at);

  return (
    <div className="glass" style={{ padding: 22, marginBottom: 16 }}>
      <div className="flex items-start gap-4 mb-4">
        <div className="text-[32px]">🧩</div>
        <div className="flex-1">
          <div className="flex items-baseline gap-3 flex-wrap mb-1">
            <h2 className="text-[16px] font-semibold m-0" style={{ color: C.cream }}>
              Stewardship Chrome Extension
            </h2>
            <span
              className="text-[10px] font-bold tracking-wider uppercase py-[2px] px-2 rounded"
              style={{
                background: activeKeys.length > 0 ? "rgba(107,203,119,0.18)" : "rgba(255,255,255,0.06)",
                color: activeKeys.length > 0 ? C.green : C.charSubtle,
              }}
            >
              {loading ? "checking…" : activeKeys.length > 0 ? `${activeKeys.length} active key${activeKeys.length > 1 ? "s" : ""}` : "No keys"}
            </span>
          </div>
          <p className="text-[12px]" style={{ color: C.charMuted }}>
            Pulls listing performance metrics from CREXi + LoopNet so the owner dashboard has real numbers. Generate one key per browser. Auto-syncs every 6 hours when Chrome is open on those tabs.
          </p>
        </div>
      </div>

      {showKey && (
        <div
          className="mb-4 p-3 rounded"
          style={{ background: "rgba(242,201,76,0.07)", border: "1px solid rgba(242,201,76,0.3)" }}
        >
          <div className="text-[10px] font-bold tracking-wider uppercase mb-1.5" style={{ color: C.amber }}>
            Save this key now — it won't be shown again
          </div>
          <div
            className="text-[11px] font-mono p-2.5 rounded mb-2 break-all select-all"
            style={{ background: "rgba(0,0,0,0.4)", color: C.cream }}
          >
            {showKey}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => navigator.clipboard.writeText(showKey)}
              className="text-[10.5px] py-1 px-2 rounded"
              style={{ border: "1px solid rgba(78,205,196,0.4)", background: "rgba(78,205,196,0.1)", color: C.teal, cursor: "pointer" }}
            >
              Copy to clipboard
            </button>
            <button
              onClick={() => setShowKey(null)}
              className="text-[10.5px] py-1 px-2 rounded"
              style={{ border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: C.charMuted, cursor: "pointer" }}
            >
              I've saved it — close
            </button>
          </div>
        </div>
      )}

      {error && <div className="text-[12px] mb-2" style={{ color: C.red }}>{error}</div>}

      {/* Key list */}
      {activeKeys.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {activeKeys.map(k => (
            <div
              key={k.id}
              className="flex items-center gap-3 px-3 py-2 rounded text-[11.5px]"
              style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.04)" }}
            >
              <div className="flex-1 min-w-0">
                <div style={{ color: C.cream }}>{k.label || "(unlabeled)"}</div>
                <div className="text-[10px] mt-0.5" style={{ color: C.charSubtle }}>
                  Created {new Date(k.created_at).toLocaleDateString()}
                  {k.last_used_at && (
                    <> · last used {new Date(k.last_used_at).toLocaleDateString()}</>
                  )}
                </div>
              </div>
              <button
                onClick={() => revoke(k.id)}
                className="text-[10px] py-1 px-2 rounded"
                style={{ border: "1px solid rgba(231,76,60,0.3)", color: C.red, background: "transparent", cursor: "pointer" }}
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={generate}
          disabled={busy}
          className="text-[11.5px] font-semibold py-2 px-4 rounded tracking-wider uppercase"
          style={{
            border: "1px solid rgba(78,205,196,0.4)",
            background: "rgba(78,205,196,0.1)",
            color: C.teal,
            cursor: busy ? "wait" : "pointer",
            opacity: busy ? 0.6 : 1,
          }}
        >
          Generate new API key
        </button>
        <a
          href="/extension-setup"
          className="text-[11.5px] font-semibold py-2 px-4 rounded tracking-wider uppercase no-underline"
          style={{
            border: "1px solid rgba(255,255,255,0.1)",
            background: "transparent",
            color: C.charMuted,
          }}
        >
          Install instructions →
        </a>
      </div>
    </div>
  );
}
