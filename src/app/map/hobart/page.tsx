import dynamic from "next/dynamic";

// maplibre touches `window` at import time — client-only.
const HobartDowntownMap = dynamic(
  () => import("@/components/parcel-map/hobart-downtown-map"),
  { ssr: false, loading: () => <div className="h-full w-full bg-ink-900" /> }
);

export default function HobartMapPage() {
  return <HobartDowntownMap />;
}
