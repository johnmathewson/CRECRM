"use client";

import { useState, useRef } from "react";

const QUICK_ACTIONS = [
  { label: "What should I focus on today?", icon: "🎯" },
  { label: "Draft a follow-up email to Kelpesh Patel", icon: "✉️" },
  { label: "Show me deals closing this quarter", icon: "📅" },
  { label: "Run a comp analysis for Liberty Square", icon: "📊" },
  { label: "Who hasn't been contacted in 30 days?", icon: "📞" },
];

interface AiResponse {
  text: string;
  actions: string[];
}

export default function AiBar() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<AiResponse | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async () => {
    if (!query.trim() || loading) return;
    setLoading(true);
    setResponse(null);

    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: query }),
      });
      const data = await res.json();
      setResponse({
        text: data.response || data.error || "No response from assistant.",
        actions: data.actions || [],
      });
    } catch {
      // Fallback: simulated response for demo when API isn't configured yet
      setResponse({
        text: `Based on your pipeline, your hottest deal is Mosley Motel at 75% probability ($49,500 weighted). Liberty Square has the highest upside at $137,500 weighted but sits at 50%. I'd recommend scheduling tours for both Portage deals — they're still in Lead stage and need momentum. Want me to draft outreach for those?`,
        actions: ["Draft emails", "Schedule tasks", "Show details"],
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass-ai mb-5 overflow-hidden">
      {/* Input row */}
      <div className="flex items-center gap-3 px-[18px] py-3.5">
        <div
          className="w-[34px] h-[34px] flex-shrink-0 flex items-center justify-center text-base"
          style={{
            borderRadius: 5,
            background: "linear-gradient(135deg, rgba(224,122,95,0.12), rgba(224,122,95,0.05))",
            border: "1px solid rgba(224,122,95,0.18)",
          }}
        >
          {loading ? "⏳" : "✦"}
        </div>

        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder="Ask your assistant anything — 'What should I focus on today?' or 'Draft an LOI for Liberty Square'..."
          className="flex-1 bg-transparent border-none outline-none text-cream text-sm font-sans"
        />

        <button
          onClick={handleSubmit}
          disabled={!query.trim() || loading}
          className="px-4 py-1.5 text-xs font-semibold text-white border-none cursor-pointer transition-all duration-200 disabled:opacity-40 disabled:cursor-default"
          style={{
            borderRadius: 5,
            background: query.trim()
              ? "linear-gradient(135deg, #E07A5F, #E07A5FCC)"
              : "rgba(255,255,255,0.06)",
            boxShadow: query.trim()
              ? "0 2px 12px rgba(224,122,95,0.35)"
              : "none",
          }}
        >
          Send
        </button>
      </div>

      {/* Quick actions — visible when focused and no response */}
      {!response && !loading && (
        <div
          className="px-[18px] pb-3.5 peer-focus:block"
          style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}
        >
          <div className="text-[10px] text-cream-subtle uppercase tracking-widest font-medium mb-2 mt-2.5">
            Quick actions
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {QUICK_ACTIONS.map((a) => (
              <button
                key={a.label}
                onClick={() => setQuery(a.label)}
                className="glass-inner px-3 py-1.5 text-[11.5px] text-cream-muted font-normal flex items-center gap-1.5 cursor-pointer transition-all duration-150 hover:bg-[rgba(255,255,255,0.05)] font-sans"
              >
                <span>{a.icon}</span> {a.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div
          className="px-[18px] pb-3.5"
          style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}
        >
          <div className="glass-inner flex items-center gap-2.5 px-3.5 py-3">
            <div
              className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{
                background: "#E07A5F",
                boxShadow: "0 0 8px rgba(224,122,95,0.4)",
              }}
            />
            <span className="text-[12.5px] text-cream-muted italic">
              Analyzing your pipeline and recent activity...
            </span>
          </div>
        </div>
      )}

      {/* Response */}
      {response && !loading && (
        <div
          className="px-[18px] pb-3.5"
          style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}
        >
          <div
            className="glass-inner px-4 py-3.5"
            style={{
              background: "rgba(224,122,95,0.04)",
              borderColor: "rgba(224,122,95,0.10)",
            }}
          >
            <div className="text-[12.5px] leading-relaxed text-cream mb-2.5">
              {response.text}
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {response.actions.map((a, i) => (
                <button
                  key={a}
                  className="px-3 py-1 text-[11px] font-semibold cursor-pointer font-sans"
                  style={{
                    borderRadius: 4,
                    background:
                      i === 0
                        ? "rgba(224,122,95,0.22)"
                        : "rgba(255,255,255,0.04)",
                    color: i === 0 ? "#E07A5F" : "rgba(240,237,228,0.5)",
                    border: `1px solid ${i === 0 ? "rgba(224,122,95,0.20)" : "rgba(255,255,255,0.06)"}`,
                  }}
                >
                  {a}
                </button>
              ))}
              <button
                onClick={() => {
                  setResponse(null);
                  setQuery("");
                }}
                className="ml-auto px-3 py-1 text-[11px] cursor-pointer font-sans"
                style={{
                  borderRadius: 4,
                  border: "1px solid rgba(255,255,255,0.06)",
                  background: "rgba(255,255,255,0.03)",
                  color: "rgba(240,237,228,0.3)",
                }}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
