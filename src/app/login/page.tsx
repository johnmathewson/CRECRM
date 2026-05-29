"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning.";
  if (h < 17) return "Good afternoon.";
  return "Good evening.";
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    router.push("/cre-os");
    router.refresh();
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-16 select-none">

      {/* ── Wordmark ─────────────────────────────────────────────── */}
      <div className="text-center mb-10">
        {/* Logo mark */}
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl mb-5"
          style={{
            background: "linear-gradient(135deg, #E07A5F 0%, #C66648 100%)",
            boxShadow: "0 6px 28px rgba(224,122,95,0.50), inset 0 1px 0 rgba(255,255,255,0.20)",
          }}
        >
          <span className="font-display font-bold text-[22px] text-white leading-none">S</span>
        </div>

        {/* Brand name */}
        <div className="font-display font-semibold text-[22px] text-cream tracking-[0.12em] leading-none mb-2">
          STEWARDSHIP
        </div>

        {/* Platform subtitle */}
        <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-cream-subtle">
          CRE Intelligence Platform
        </div>

        {/* Divider */}
        <div className="mt-6 h-px w-40 mx-auto"
          style={{ background: "linear-gradient(to right, transparent, rgba(255,255,255,0.10), transparent)" }}
        />
      </div>

      {/* ── Login card ───────────────────────────────────────────── */}
      <div className="glass w-full max-w-[380px] px-8 py-8">

        {/* Greeting */}
        <div className="mb-7">
          <h2 className="font-heading font-semibold text-[20px] text-cream leading-tight">
            {greeting()}
          </h2>
          <p className="font-body text-[12.5px] text-cream-subtle mt-1.5">
            Sign in to your workspace.
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          {/* Email */}
          <div>
            <label className="block font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle mb-1.5">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="john@johnmathewson.co"
              required
              autoFocus
              style={{ fontSize: "13px" }}
              className="w-full px-3 py-2.5 rounded bg-white/[0.03] border border-white/[0.08] text-cream font-body placeholder:text-cream-subtle/30 focus:outline-none focus:border-coral-400/40 focus:ring-1 focus:ring-coral-400/20 transition-colors"
            />
          </div>

          {/* Password */}
          <div>
            <label className="block font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle mb-1.5">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              style={{ fontSize: "13px" }}
              className="w-full px-3 py-2.5 rounded bg-white/[0.03] border border-white/[0.08] text-cream font-body placeholder:text-cream-subtle/30 focus:outline-none focus:border-coral-400/40 focus:ring-1 focus:ring-coral-400/20 transition-colors"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="px-3 py-2.5 rounded border border-coral-400/25 bg-coral-400/[0.08] font-body text-[12px] text-coral-300 leading-snug">
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full mt-1 py-3 rounded-md font-heading font-semibold text-[12px] uppercase tracking-eyebrow text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: loading
                ? "rgba(224,122,95,0.45)"
                : "linear-gradient(135deg, #E07A5F 0%, #C66648 100%)",
              boxShadow: loading
                ? "none"
                : "0 4px 24px rgba(224,122,95,0.38), inset 0 1px 0 rgba(255,255,255,0.12)",
            }}
          >
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>
      </div>

      {/* ── Footer ───────────────────────────────────────────────── */}
      <div className="mt-8 text-center space-y-1">
        <div className="font-mono text-[8.5px] uppercase tracking-[0.20em] text-cream-subtle/25">
          Stewardship Asset Group · eXp Commercial
        </div>
      </div>

    </div>
  );
}
