"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

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

    // Land directly in CRE OS — root / is just a redirect to here anyway,
    // and going to /cre-os first avoids a flash of the redirect bounce.
    router.push("/cre-os");
    router.refresh();
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(160deg, #0A1615 0%, #0D1F1E 30%, #142827 60%, #0B1918 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "-apple-system, 'SF Pro Display', 'Inter', system-ui, sans-serif",
        color: "#F0EDE4",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Ambient orbs */}
      <div style={{ position: "fixed", top: "-15%", right: "-10%", width: "55vw", height: "55vw", borderRadius: "50%", background: "radial-gradient(circle, rgba(224,122,95,0.12) 0%, rgba(224,122,95,0.04) 40%, transparent 70%)", pointerEvents: "none" }} />
      <div style={{ position: "fixed", bottom: "-20%", left: "-15%", width: "65vw", height: "65vw", borderRadius: "50%", background: "radial-gradient(circle, rgba(78,205,196,0.10) 0%, rgba(78,205,196,0.03) 40%, transparent 70%)", pointerEvents: "none" }} />

      <div
        style={{
          width: 400,
          background: "rgba(255,255,255,0.04)",
          backdropFilter: "blur(24px) saturate(1.4)",
          WebkitBackdropFilter: "blur(24px) saturate(1.4)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderTopColor: "rgba(255,255,255,0.14)",
          borderRadius: 6,
          boxShadow: "0 8px 32px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05)",
          padding: "40px 36px",
          position: "relative",
          zIndex: 1,
        }}
      >
        {/* Logo */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 32 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 6,
              background: "linear-gradient(135deg, #E07A5F, #E07A5FBB)",
              boxShadow: "0 4px 20px rgba(224,122,95,0.4)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 800,
              fontSize: 22,
              color: "white",
              marginBottom: 16,
            }}
          >
            S
          </div>
          <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: 2, color: "#F0EDE4" }}>
            STEWARDSHIP
          </span>
          <span style={{ fontSize: 11, color: "rgba(240,237,228,0.4)", marginTop: 4 }}>
            CRE Intelligence Platform
          </span>
        </div>

        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 10.5, color: "rgba(240,237,228,0.45)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 500, marginBottom: 6 }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="john@johnmathewson.co"
              required
              style={{
                width: "100%",
                padding: "10px 14px",
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 4,
                color: "#F0EDE4",
                fontSize: 13,
                outline: "none",
                fontFamily: "inherit",
                boxSizing: "border-box",
              }}
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: "block", fontSize: 10.5, color: "rgba(240,237,228,0.45)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 500, marginBottom: 6 }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              style={{
                width: "100%",
                padding: "10px 14px",
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 4,
                color: "#F0EDE4",
                fontSize: 13,
                outline: "none",
                fontFamily: "inherit",
                boxSizing: "border-box",
              }}
            />
          </div>

          {error && (
            <div style={{
              padding: "8px 12px",
              marginBottom: 16,
              borderRadius: 4,
              background: "rgba(231,76,60,0.15)",
              border: "1px solid rgba(231,76,60,0.2)",
              color: "#E74C3C",
              fontSize: 12,
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "11px 0",
              borderRadius: 5,
              border: "none",
              cursor: loading ? "not-allowed" : "pointer",
              fontSize: 13,
              fontWeight: 600,
              color: "white",
              fontFamily: "inherit",
              background: loading
                ? "rgba(224,122,95,0.5)"
                : "linear-gradient(135deg, #E07A5F, #E07A5FCC)",
              boxShadow: "0 3px 16px rgba(224,122,95,0.35)",
              transition: "all 0.2s ease",
            }}
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <div style={{ textAlign: "center", marginTop: 20, fontSize: 10, color: "rgba(240,237,228,0.25)" }}>
          Stewardship Asset Group — eXp Commercial
        </div>
      </div>
    </div>
  );
}
