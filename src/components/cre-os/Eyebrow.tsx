"use client";

/**
 * Eyebrow — small uppercase label above a section. Brand: Archivo 700,
 * uppercase, 0.16em tracking, Copper for the one accented eyebrow on a
 * screen, Ink for the rest. Numbered eyebrows ("01 PIPELINE") stay.
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
    : tone === "amber" ? "text-coral-400"
    : tone === "teal" ? "text-cream-muted"
    : "text-cream-muted";
  return (
    <div
      className={`font-heading text-[10px] font-bold uppercase tracking-eyebrow ${colorClass} ${className}`}
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
