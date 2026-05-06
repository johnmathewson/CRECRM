"use client";

/**
 * Sparkline — minimal SVG line chart for KPI tiles. Pure visual, no axes.
 * Coral by default; pass `tone="teal"` for the data accent.
 */
export function Sparkline({
  values,
  tone = "coral",
  height = 28,
  className = "",
}: {
  values: number[];
  tone?: "coral" | "teal" | "muted";
  height?: number;
  className?: string;
}) {
  if (!values?.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 100; // viewBox width
  const h = height;
  const stepX = w / (values.length - 1 || 1);
  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const polyline = points.join(" ");
  const area = `${0},${h} ${polyline} ${w},${h}`;

  const stroke = {
    coral: "#E07A5F",
    teal: "#4ECDC4",
    muted: "#818181",
  }[tone];
  const fillId = `spark-fill-${tone}`;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={`w-full h-full ${className}`}
      aria-hidden
    >
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${fillId})`} />
      <polyline
        points={polyline}
        fill="none"
        stroke={stroke}
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
