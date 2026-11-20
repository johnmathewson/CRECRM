"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * First-run screen for an invited map viewer: they arrive signed in from
 * /auth/invite and pick the password they will use at /login from then on.
 */
export default function SetPasswordPage() {
  const supabase = createClient();
  const [email, setEmail] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => { setEmail(data.user?.email ?? null); setChecked(true); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (pw.length < 10) return setError("Use at least 10 characters.");
    if (pw !== pw2) return setError("The two passwords don't match.");
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (err) return setError(err.message);
    window.location.href = "/map/hobart";
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 text-slate-900" style={{ fontFamily: "var(--font-archivo), system-ui, sans-serif" }}>
      <div className="w-full max-w-[400px] rounded-[12px] bg-white p-6 shadow-xl ring-1 ring-slate-900/5">
        <div className="mb-4 flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-[6px] bg-blue-600 text-[12px] font-extrabold text-white">H</span>
          <div className="text-[15px] font-bold">Hobart Parcel Map</div>
        </div>
        {!checked ? (
          <p className="text-[14px] text-slate-500">Checking your invite…</p>
        ) : !email ? (
          <>
            <h1 className="text-[18px] font-bold">This invite link has expired</h1>
            <p className="mt-2 text-[14px] text-slate-600">Invite links work for 14 days. If you already set a password, sign in instead; otherwise ask John for a fresh link.</p>
            <a href="/login?next=/map/hobart" className="mt-4 block rounded-[8px] bg-blue-600 px-4 py-2.5 text-center text-[14px] font-semibold text-white hover:bg-blue-700">Sign in</a>
          </>
        ) : (
          <form onSubmit={submit}>
            <h1 className="text-[18px] font-bold">Choose a password</h1>
            <p className="mt-1 text-[13px] text-slate-500">For <span className="font-semibold text-slate-700">{email}</span>. You&apos;ll use it at map.stewardshipcre.com/login.</p>
            <label className="mt-4 block text-[12px] font-semibold text-slate-600">New password
              <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} className="mt-1 h-10 w-full rounded-[8px] border border-slate-200 bg-slate-50 px-3 text-[14px] focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
            </label>
            <label className="mt-3 block text-[12px] font-semibold text-slate-600">Again
              <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} className="mt-1 h-10 w-full rounded-[8px] border border-slate-200 bg-slate-50 px-3 text-[14px] focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
            </label>
            {error && <p className="mt-3 text-[13px] font-semibold text-red-600">{error}</p>}
            <button type="submit" disabled={busy} className="mt-4 h-11 w-full rounded-[8px] bg-blue-600 text-[14px] font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{busy ? "Saving…" : "Save and open the map"}</button>
          </form>
        )}
      </div>
    </main>
  );
}
