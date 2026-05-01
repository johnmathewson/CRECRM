"use client";

import { useState, useEffect } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  propertyId: string;
  propertyName: string;
  ownerContactId?: string | null;
  ownerName?: string | null;
}

const C = {
  coral: "#E07A5F",
  teal: "#4ECDC4",
  amber: "#F2C94C",
  green: "#6BCB77",
  red: "#E74C3C",
  cream: "#F0EDE4",
  charSubtle: "rgba(240,237,228,0.55)",
  charMuted: "rgba(240,237,228,0.75)",
};

export default function ShareWithOwnerModal({
  open,
  onClose,
  propertyId,
  propertyName,
  ownerContactId,
  ownerName,
}: Props) {
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<{ url: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [days, setDays] = useState(90);
  const [copied, setCopied] = useState(false);

  // Reset state when modal reopens
  useEffect(() => {
    if (open) {
      setGenerated(null);
      setError(null);
      setLabel(ownerName ? `${ownerName} — ${propertyName}` : `Owner — ${propertyName}`);
      setDays(90);
      setCopied(false);
    }
  }, [open, ownerName, propertyName]);

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/owner-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          property_ids: [propertyId],
          owner_contact_id: ownerContactId || null,
          label: label.trim() || undefined,
          expires_in_days: days,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate");
      setGenerated({ url: data.url, expiresAt: data.token.expires_at });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  }

  function copy() {
    if (!generated) return;
    navigator.clipboard.writeText(generated.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.65)",
        backdropFilter: "blur(6px)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="glass"
        style={{
          width: 480,
          maxWidth: "92vw",
          padding: "22px 24px",
          animation: "fadeIn 0.15s ease",
        }}
      >
        <div className="flex items-baseline justify-between mb-4">
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0, color: C.cream }}>
            Share with owner
          </h3>
          <button onClick={onClose} className="icon-btn" style={{ fontSize: 14 }}>
            ✕
          </button>
        </div>

        <div className="text-[12px] mb-4" style={{ color: C.charMuted }}>
          Generate a magic link the owner can use to view live performance for this listing.
          Anonymized — names and contact info are never shown.
        </div>

        <div className="text-[11px] mb-4 px-3 py-2 rounded" style={{ background: "rgba(255,255,255,0.025)", color: C.charSubtle }}>
          Listing: <span style={{ color: C.cream }}>{propertyName}</span>
        </div>

        {!generated ? (
          <>
            <Field label="Label (private; for your reference)">
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="form-input"
              />
            </Field>
            <Field label="Expires in">
              <select
                value={days}
                onChange={(e) => setDays(parseInt(e.target.value))}
                className="form-input"
              >
                <option value={30}>30 days</option>
                <option value={60}>60 days</option>
                <option value={90}>90 days</option>
                <option value={180}>180 days</option>
                <option value={365}>1 year</option>
              </select>
            </Field>

            {error && <div className="text-[12px] mt-2" style={{ color: C.red }}>{error}</div>}

            <div className="flex gap-2 mt-5">
              <button
                onClick={onClose}
                className="text-[11.5px] font-semibold py-2 px-4 rounded tracking-wider uppercase"
                style={{ border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: C.charMuted, cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                onClick={generate}
                disabled={generating}
                className="text-[11.5px] font-semibold py-2 px-4 rounded tracking-wider uppercase ml-auto"
                style={{
                  border: "1px solid rgba(224,122,95,0.5)",
                  background: "rgba(224,122,95,0.15)",
                  color: C.coral,
                  cursor: generating ? "wait" : "pointer",
                  opacity: generating ? 0.6 : 1,
                }}
              >
                {generating ? "Generating…" : "Generate link"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div
              className="text-[10px] font-bold tracking-wider uppercase mb-2"
              style={{ color: C.green }}
            >
              ✓ Link generated · expires {new Date(generated.expiresAt).toLocaleDateString()}
            </div>
            <div
              className="text-[11px] font-mono p-3 rounded mb-3 break-all select-all"
              style={{ background: "rgba(0,0,0,0.4)", color: C.cream }}
            >
              {generated.url}
            </div>
            <div className="text-[10.5px] mb-4" style={{ color: C.charSubtle }}>
              Send this link to the owner. They can bookmark it; no login required.
              You can revoke any time from Integrations → Owner links.
            </div>
            <div className="flex gap-2">
              <button
                onClick={copy}
                className="text-[11.5px] font-semibold py-2 px-4 rounded tracking-wider uppercase"
                style={{
                  border: "1px solid rgba(78,205,196,0.4)",
                  background: copied ? "rgba(78,205,196,0.2)" : "rgba(78,205,196,0.1)",
                  color: C.teal,
                  cursor: "pointer",
                }}
              >
                {copied ? "✓ Copied!" : "Copy link"}
              </button>
              <a
                href={`mailto:?subject=${encodeURIComponent(`Performance dashboard for ${propertyName}`)}&body=${encodeURIComponent(`Here's the live performance dashboard for ${propertyName}:\n\n${generated.url}\n\nBookmark it — updates every week.`)}`}
                className="text-[11.5px] font-semibold py-2 px-4 rounded tracking-wider uppercase no-underline"
                style={{ border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: C.charMuted }}
              >
                Email it
              </a>
              <button
                onClick={onClose}
                className="text-[11.5px] font-semibold py-2 px-4 rounded tracking-wider uppercase ml-auto"
                style={{ border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: C.charMuted, cursor: "pointer" }}
              >
                Done
              </button>
            </div>
          </>
        )}

        <style jsx>{`
          .form-input {
            width: 100%;
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid rgba(255, 255, 255, 0.08);
            color: ${C.cream};
            padding: 9px 11px;
            border-radius: 4px;
            font-size: 12.5px;
            outline: none;
            margin-bottom: 10px;
          }
          .form-input:focus {
            border-color: rgba(224, 122, 95, 0.4);
          }
        `}</style>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block mb-3">
      <span
        className="block mb-1.5"
        style={{
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "rgba(240,237,228,0.55)",
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
