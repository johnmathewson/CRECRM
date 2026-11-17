"use client";

import { useState } from "react";
import type { ParcelProps } from "./parcel-card";

/**
 * Registration gate + "Ask about this parcel" forms for the parcel map.
 * Plain useState forms, inline validation, fetch to /api/map/*.
 */

const SMS_CONSENT =
  "I agree to receive text messages from Stewardship CRE about this inquiry and related properties. Message and data rates may apply. Reply STOP to opt out.";

const ROLES: [string, string][] = [
  ["developer", "Developer"], ["investor", "Investor"], ["contractor", "Contractor"],
  ["broker", "Broker / agent"], ["owner", "Property owner"], ["lender", "Lender"], ["other", "Other"],
];

const input = "h-10 w-full rounded-[8px] border border-slate-300 bg-white px-3 text-[14px] text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20";
const label = "mb-1 block text-[12px] font-semibold text-slate-600";

function Modal({ title, sub, onClose, children }: { title: string; sub?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-40 flex items-end justify-center bg-slate-900/40 p-0 md:items-center md:p-6" onClick={onClose}>
      <div className="w-full max-w-[440px] rounded-t-[14px] bg-white p-5 shadow-2xl md:rounded-[14px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[18px] font-bold leading-tight text-slate-900">{title}</h3>
            {sub && <p className="mt-1 text-[13px] text-slate-600">{sub}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] text-slate-400 hover:bg-slate-100 hover:text-slate-800">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function RegisterModal({ parcel, onClose, onDone }: { parcel: ParcelProps | null; onClose: () => void; onDone: (name: string) => void }) {
  const [f, setF] = useState({ name: "", email: "", phone: "", company: "", role: "investor", sms: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (f.name.trim().length < 2) return setErr("Please enter your name.");
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) return setErr("Please enter a valid email.");
    if (f.phone.replace(/\D/g, "").length < 10) return setErr("Please enter a valid mobile number.");
    setBusy(true);
    try {
      const r = await fetch("/api/map/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: f.name, email: f.email, phone: f.phone, company: f.company, role: f.role, sms_consent: f.sms, pid: parcel?.pid ?? null, address: parcel?.address ?? null }),
      });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(out.error || "Registration failed.");
      onDone(out.name || f.name);
    } catch (e: any) {
      setErr(e.message || "Registration failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Unlock owner & value data" sub="Free. Owner, mailing address, assessed values, sales history and permits on every parcel. One broker, no spam." onClose={onClose}>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <div>
          <label className={label}>Full name</label>
          <input className={input} value={f.name} onChange={set("name")} autoComplete="name" placeholder="Jane Smith" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={label}>Email</label>
            <input className={input} type="email" value={f.email} onChange={set("email")} autoComplete="email" placeholder="jane@company.com" />
          </div>
          <div>
            <label className={label}>Mobile</label>
            <input className={input} type="tel" value={f.phone} onChange={set("phone")} autoComplete="tel" placeholder="(219) 555-0100" />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={label}>Company <span className="font-normal text-slate-400">(optional)</span></label>
            <input className={input} value={f.company} onChange={set("company")} autoComplete="organization" />
          </div>
          <div>
            <label className={label}>I am a</label>
            <select className={input} value={f.role} onChange={set("role")}>
              {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>
        <label className="flex cursor-pointer items-start gap-2 text-[12px] leading-snug text-slate-600">
          <input type="checkbox" checked={f.sms} onChange={set("sms")} className="mt-0.5 h-4 w-4 accent-blue-600" />
          {SMS_CONSENT}
        </label>
        {err && <div className="rounded-[8px] bg-red-50 px-3 py-2 text-[13px] font-semibold text-red-700">{err}</div>}
        <button disabled={busy} className="w-full rounded-[8px] bg-blue-600 px-4 py-3 text-[14px] font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
          {busy ? "Saving…" : "Unlock the map"}
        </button>
        <p className="text-center text-[11px] text-slate-400">Public records from the City of Hobart and Lake County. Registration creates a contact with Stewardship CRE.</p>
      </form>
    </Modal>
  );
}

export function AskModal({ parcel, onClose, onDone }: { parcel: ParcelProps; onClose: () => void; onDone: () => void }) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (msg.trim().length < 5) return setErr("Tell me what you'd like to know.");
    setBusy(true);
    try {
      const r = await fetch("/api/map/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pid: parcel.pid, address: parcel.address, zoning: parcel.zoning, acres: parcel.acres, owner: parcel.owner, message: msg }),
      });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(out.error || "Could not send.");
      onDone();
    } catch (e: any) {
      setErr(e.message || "Could not send.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Ask about this parcel" sub={`${parcel.address || parcel.pid} · goes straight to John Mathewson, Stewardship CRE`} onClose={onClose}>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <textarea
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          rows={5}
          placeholder="Is this owner open to selling? What would it take to assemble the corner? Any history on this lot?"
          className="w-full rounded-[8px] border border-slate-300 px-3 py-2 text-[14px] text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
        {err && <div className="rounded-[8px] bg-red-50 px-3 py-2 text-[13px] font-semibold text-red-700">{err}</div>}
        <button disabled={busy} className="w-full rounded-[8px] bg-blue-600 px-4 py-3 text-[14px] font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
          {busy ? "Sending…" : "Send to John"}
        </button>
      </form>
    </Modal>
  );
}
