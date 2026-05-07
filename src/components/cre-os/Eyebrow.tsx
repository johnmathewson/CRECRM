"use client";

/**
 * Eyebrow — small uppercase label above a section, in coral. The signature
 * editorial accent across the CRE OS UI. Numbered eyebrows ("01 PIPELINE")
 * give the page a Bloomberg-section feel.
 */
export function Eyebrow({
  children,
  num,
  tone = "coral",
  className = "",
}: {
  children: React.ReactNode;
  num?: number;
  tone?: "coral" | "teal" | "muted" | "amber";
  className?: string;
}) {
  const colorClass =
    tone === "coral" ? "text-coral-400"
    : tone === "teal" ? "text-teal-400"
    : tone === "amber" ? "text-amber"
    : "text-cream-muted";
  return (
    <div
      className={`font-heading text-[10px] font-semibold uppercase tracking-eyebrow ${colorClass} ${className}`}
    >
      {num !== undefined && (
        <span className="font-mono mr-3 opacity-70">
          {String(num).padStart(2, "0")}
        </span>
      )}
      {children}
    </div>
  );
}
