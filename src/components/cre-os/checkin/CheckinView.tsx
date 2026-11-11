"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/cre-os/AppShell";
import type { Checkin, CheckinItem } from "@/lib/cre-os/checkin-queries";
import { hasChanges, type CheckinSuggestions } from "@/lib/cre-os/checkin-suggestions";
import { getStageConfig } from "@/lib/cre-os/stage-config";

const fmtMoney = (n: number | null) => {
  if (n === null || !Number.isFinite(n) || n <= 0) return null;
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(0) + "K";
  return "$" + n.toLocaleString();
};

function fmtDate(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/**
 * CheckinView — tonight's deal check-in. One card per question: the
 * agent's read of the deal, the question, one-tap answers and a box for a
 * sentence (the phone keyboard's mic dictates into it). Logging an answer
 * writes it to the deal's timeline and returns suggested updates, which
 * John applies or skips. Nothing on the deal changes until he taps Apply.
 */
export function CheckinView({ checkin, today }: { checkin: Checkin | null; today: string }) {
  const router = useRouter();
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);

  // While a build is running, refresh until tonight's check-in shows up.
  useEffect(() => {
    if (!building) return;
    if (checkin && checkin.date === today) { setBuilding(false); return; }
    const started = Date.now();
    const t = setInterval(() => {
      if (Date.now() - started > 4 * 60_000) {
        setBuilding(false);
        setBuildError("Still working after 4 minutes. Refresh in a bit, or check back at 8:45.");
        clearInterval(t);
        return;
      }
      router.refresh();
    }, 6000);
    return () => clearInterval(t);
  }, [building, checkin, today, router]);

  async function buildNow() {
    setBuildError(null);
    setBuilding(true);
    try {
      const r = await fetch("/api/agents/deal-checkin/run", { method: "POST" });
      if (!r.ok && r.status !== 202) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
    } catch (err) {
      setBuilding(false);
      setBuildError(err instanceof Error ? err.message : String(err));
    }
  }

  const items = checkin?.items ?? [];
  const done = items.filter((i) => i.answeredAt).length;
  const isTonight = checkin?.date === today;

  return (
    <AppShell>
      <div className="max-w-2xl space-y-5">
        <header>
          <div className="font-heading text-[11px] font-bold uppercase tracking-eyebrow text-cream-muted">
            {checkin ? fmtDate(checkin.date) : "Nightly at 8:45 PM"}
          </div>
          <h1 className="mt-1 font-display text-[30px] font-extrabold text-cream leading-none">Deal check-in</h1>
          <p className="mt-2 font-body text-[14px] text-cream-muted">
            {checkin
              ? `Reviewed ${checkin.dealsReviewed} open deal${checkin.dealsReviewed === 1 ? "" : "s"}. ${items.length === 0 ? "Nothing needed you." : `${done} of ${items.length} answered.`}`
              : "Every night the deal agent reads your open deals and the emails and texts around them, then asks you only what it can't see."}
          </p>
        </header>

        {(!checkin || !isTonight) && (
          <div className="border border-white/[0.08] bg-steward-surface px-4 py-3">
            <p className="font-body text-[13px] text-cream-dim">
              {checkin ? "Tonight's check-in hasn't been built yet — it runs at 8:45 PM." : "No check-in yet — the first one runs tonight at 8:45 PM."}
            </p>
            <button
              onClick={buildNow}
              disabled={building}
              className="mt-2 px-3.5 py-2 bg-copper-600 hover:bg-copper-700 font-heading text-[12px] font-semibold text-white disabled:opacity-60"
            >
              {building ? "Reading your deals… (about a minute)" : "Build tonight's check-in now"}
            </button>
            {buildError && <p className="mt-2 font-body text-[12px] text-red-300">{buildError}</p>}
          </div>
        )}

        {items.length > 0 && done === items.length && (
          <div className="border-l-[3px] border-teal-400 bg-steward-surface px-4 py-3">
            <p className="font-body text-[14px] text-cream">All caught up. Every answer is on its deal&apos;s timeline.</p>
          </div>
        )}

        <div className="space-y-4">
          {items.map((item) => (
            <CheckinCard key={item.id} item={item} />
          ))}
        </div>
      </div>
    </AppShell>
  );
}

function CheckinCard({ item }: { item: CheckinItem }) {
  const router = useRouter();
  const [choice, setChoice] = useState<string | null>(item.answerChoice);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answered, setAnswered] = useState(Boolean(item.answeredAt));
  const [suggestions, setSuggestions] = useState<CheckinSuggestions | null>(item.suggestions);
  const [resolved, setResolved] = useState<"applied" | "skipped" | null>(
    item.appliedAt ? "applied" : item.skippedAt ? "skipped" : null
  );

  const d = item.deal;
  const meta = [getStageConfig(d.stage).label, fmtMoney(d.price), d.city].filter(Boolean).join(" · ");

  async function submit() {
    if (!choice && !text.trim()) {
      setError("Tap an answer or type one.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/deal-checkins/items/${item.id}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ choice, text: text.trim() || undefined }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setAnswered(true);
      setSuggestions(j.suggestions ?? null);
      if (!hasChanges(j.suggestions)) setResolved("skipped");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`border bg-steward-surface ${answered ? "border-white/[0.06]" : "border-coral-400/40"}`}>
      <div className="px-4 pt-3 pb-2 border-b border-white/[0.05]">
        <div className="flex items-start justify-between gap-3">
          <Link href={`/cre-os/pipeline/${d.id}`} className="min-w-0 font-heading text-[14px] font-semibold text-cream hover:text-coral-400 leading-snug">
            {d.name}
          </Link>
          {answered && (
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-eyebrow text-teal-400">Logged</span>
          )}
        </div>
        <div className="mt-0.5 font-mono text-[10px] text-cream-subtle">{meta}</div>
      </div>

      <div className="px-4 py-3 space-y-3">
        {item.statusSummary && (
          <p className="font-body text-[13px] leading-[1.5] text-cream-dim">{item.statusSummary}</p>
        )}
        {item.whyNow && !answered && (
          <p className="font-mono text-[10px] uppercase tracking-eyebrow text-coral-400">{item.whyNow}</p>
        )}
        <p className="font-heading text-[16px] font-semibold leading-snug text-cream">{item.question}</p>

        {!answered ? (
          <>
            <div className="flex flex-wrap gap-2">
              {item.quickAnswers.map((a) => (
                <button
                  key={a}
                  type="button"
                  disabled={busy}
                  onClick={() => setChoice(choice === a ? null : a)}
                  className={`px-3 py-2 border font-body text-[13px] transition-colors ${
                    choice === a
                      ? "border-coral-400 bg-coral-400/[0.12] text-coral-400"
                      : "border-white/[0.10] bg-white/[0.02] text-cream hover:bg-white/[0.05]"
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={busy}
              rows={2}
              placeholder="Or say it in a sentence — who, what, when"
              className="w-full px-3 py-2 bg-white/[0.02] border border-white/[0.10] focus:border-coral-400/60 focus:outline-none font-body text-base lg:text-[13px] text-cream placeholder:text-cream-subtle resize-y"
            />
            {error && <p className="font-body text-[12px] text-red-300">{error}</p>}
            <button
              onClick={submit}
              disabled={busy || (!choice && !text.trim())}
              className="w-full sm:w-auto px-4 py-2.5 bg-copper-600 hover:bg-copper-700 font-heading text-[13px] font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Logging…" : "Log it"}
            </button>
          </>
        ) : (
          <>
            <p className="font-body text-[13px] text-cream">
              <span className="text-cream-subtle">You: </span>
              {[item.answerChoice ?? choice, item.answerText ?? (text.trim() || null)].filter(Boolean).join(" — ")}
            </p>
            {suggestions && hasChanges(suggestions) && !resolved && (
              <SuggestionPanel
                item={item}
                suggestions={suggestions}
                onDone={(r) => { setResolved(r); router.refresh(); }}
              />
            )}
            {resolved === "applied" && (
              <p className="font-mono text-[10px] uppercase tracking-eyebrow text-teal-400">Deal updated</p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

type SuggestionKey = "stage" | "probability_pct" | "expected_close" | "next_step" | "close_outcome";

function SuggestionPanel({
  item,
  suggestions: s,
  onDone,
}: {
  item: CheckinItem;
  suggestions: CheckinSuggestions;
  onDone: (r: "applied" | "skipped") => void;
}) {
  const rows: Array<{ key: SuggestionKey; label: string; value: string; defaultOn: boolean }> = [];
  if (s.stage) rows.push({ key: "stage", label: "Move stage", value: `${getStageConfig(item.deal.stage).label} → ${getStageConfig(s.stage).label}`, defaultOn: true });
  if (s.probability_pct !== undefined) rows.push({ key: "probability_pct", label: "Probability", value: `${item.deal.probabilityPct ?? "—"}% → ${s.probability_pct}%`, defaultOn: true });
  if (s.expected_close) rows.push({ key: "expected_close", label: "Target close", value: `${item.deal.expectedClose ?? "not set"} → ${s.expected_close}`, defaultOn: true });
  if (s.next_step) rows.push({ key: "next_step", label: "Next step", value: `${s.next_step}${s.next_step_due ? ` (by ${s.next_step_due})` : ""}`, defaultOn: true });
  // Closing a deal out is never pre-checked — it's the one change that's hard to undo.
  if (s.close_outcome) rows.push({ key: "close_outcome", label: "Close out", value: `Mark ${s.close_outcome}${s.close_reason ? ` — ${s.close_reason}` : ""}`, defaultOn: false });

  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(rows.map((r) => [r.key, r.defaultOn])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(url: string, method: string, body: unknown) {
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || `HTTP ${r.status}`);
    }
  }

  async function apply() {
    setBusy(true);
    setError(null);
    const dealId = item.deal.id;
    const applied: Record<string, unknown> = {};
    try {
      // Field edits first, then the stage move, then a close-out — the same
      // routes the deal page uses, so commission math and the property's
      // status stay in sync.
      const patch: Record<string, unknown> = {};
      if (on.probability_pct && s.probability_pct !== undefined) patch.probability_pct = s.probability_pct;
      if (on.expected_close && s.expected_close) patch.expected_close = s.expected_close;
      if (on.next_step && s.next_step) {
        patch.next_step = s.next_step;
        patch.next_step_due = s.next_step_due ?? null;
      }
      if (Object.keys(patch).length) {
        await call(`/api/deals/${dealId}`, "PATCH", patch);
        Object.assign(applied, patch);
      }
      if (on.stage && s.stage) {
        await call(`/api/deals/${dealId}/advance`, "POST", { stage: s.stage, sync_property: true, notes: "From deal check-in" });
        applied.stage = s.stage;
      }
      if (on.close_outcome && s.close_outcome) {
        await call(`/api/deals/${dealId}/close`, "POST", {
          outcome: s.close_outcome,
          reason: s.close_reason ?? null,
          actual_close: s.close_outcome === "won" ? new Date().toISOString().slice(0, 10) : null,
        });
        applied.close_outcome = s.close_outcome;
      }
      await call(`/api/deal-checkins/items/${item.id}/resolve`, "POST", { applied });
      onDone("applied");
    } catch (err) {
      setError(`${err instanceof Error ? err.message : String(err)}${Object.keys(applied).length ? " (some changes were already saved)" : ""}`);
    } finally {
      setBusy(false);
    }
  }

  async function skip() {
    setBusy(true);
    try {
      await call(`/api/deal-checkins/items/${item.id}/resolve`, "POST", { skipped: true });
      onDone("skipped");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-coral-400/30 bg-coral-400/[0.04] px-3 py-3 space-y-2">
      <div className="font-mono text-[10px] uppercase tracking-eyebrow text-coral-400">Update the deal?</div>
      {rows.map((r) => (
        <label key={r.key} className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={!!on[r.key]}
            disabled={busy}
            onChange={(e) => setOn((o) => ({ ...o, [r.key]: e.target.checked }))}
            className="mt-1 h-4 w-4 accent-[#B4552F]"
          />
          <span className="min-w-0">
            <span className="block font-heading text-[12px] font-semibold text-cream">{r.label}</span>
            <span className="block font-body text-[13px] text-cream-dim break-words">{r.value}</span>
          </span>
        </label>
      ))}
      {error && <p className="font-body text-[12px] text-red-300">{error}</p>}
      <div className="flex gap-2 pt-1">
        <button
          onClick={apply}
          disabled={busy || !Object.values(on).some(Boolean)}
          className="flex-1 sm:flex-none px-4 py-2 bg-copper-600 hover:bg-copper-700 font-heading text-[12px] font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : "Apply"}
        </button>
        <button
          onClick={skip}
          disabled={busy}
          className="flex-1 sm:flex-none px-4 py-2 border border-white/[0.10] bg-white/[0.02] font-heading text-[12px] font-semibold text-cream-dim hover:text-cream"
        >
          Leave the deal as is
        </button>
      </div>
    </div>
  );
}
