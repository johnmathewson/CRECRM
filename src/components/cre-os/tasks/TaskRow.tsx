"use client";

/**
 * TaskRow — interactive task display. Used wherever tasks render on a
 * workspace (Property Overview / Activity tabs, Contact / Deal panels,
 * Command Center "Today" — eventually). Replaces the previous read-only
 * checkbox-with-no-handler that appeared in those places.
 *
 * Click the checkbox → PATCH status='completed'. Click the row body to
 * not-yet-implemented expand-for-edit (placeholder for later); clicking
 * × deletes outright.
 *
 * The wrapping list re-fetches via router.refresh() so the workspace
 * reload picks up the new state.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/cre-os/StatusBadge";

interface Props {
  id: string;
  title: string;
  /** Pre-formatted "Today" / "Overdue · May 4" / "May 12" string — comes
   *  from the workspace loader (formatDueLabel / similar). */
  due: string;
  tone: "coral" | "amber" | "neutral";
  /** "pending" | "in_progress" | "completed" | "cancelled" — passed in
   *  so we can render strikethrough on completed without a fresh fetch. */
  status: string | null;
}

export function TaskRow({ id, title, due, tone, status }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [optimistic, setOptimistic] = useState<"completed" | "deleted" | null>(null);

  const isComplete = optimistic === "completed" || status === "completed";
  const isDeleted = optimistic === "deleted";

  if (isDeleted) return null;

  async function toggleComplete() {
    setBusy(true);
    setOptimistic(isComplete ? null : "completed");
    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: isComplete ? "pending" : "completed" }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      // Refresh to update the open-task counts in the rail and AI summary.
      router.refresh();
    } catch (err: any) {
      // Revert optimistic
      setOptimistic(null);
      alert(`Failed: ${err.message ?? err}`);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete this task?\n\n"${title}"`)) return;
    setBusy(true);
    setOptimistic("deleted");
    try {
      const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err: any) {
      setOptimistic(null);
      alert(`Delete failed: ${err.message ?? err}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`flex items-start gap-3 py-2 border-b border-white/[0.04] last:border-b-0 group transition-opacity ${
        isComplete ? "opacity-50" : ""
      } ${busy ? "pointer-events-none" : ""}`}
    >
      <input
        type="checkbox"
        checked={isComplete}
        onChange={toggleComplete}
        disabled={busy}
        className="mt-1 accent-coral-400 cursor-pointer"
        aria-label={isComplete ? "Mark task as pending" : "Mark task as complete"}
      />
      <div className="flex-1 min-w-0">
        <div
          className={`font-body text-[13px] text-cream ${isComplete ? "line-through" : ""}`}
        >
          {title}
        </div>
      </div>
      <StatusBadge tone={isComplete ? "teal" : tone} size="xs">
        {isComplete ? "Done" : due}
      </StatusBadge>
      <button
        onClick={remove}
        disabled={busy}
        className="font-mono text-[11px] text-cream-subtle hover:text-coral-400 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-30"
        aria-label="Delete task"
        title="Delete task"
      >
        ×
      </button>
    </div>
  );
}
