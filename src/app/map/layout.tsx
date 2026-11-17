import type { Metadata } from "next";

/**
 * /map/* layout — public parcel map shell. Full-viewport, no app sidebar.
 * Deliberately NOT the Stewardship Ink/Copper chrome: the map is a reading
 * instrument for outside developers/contractors/investors, so it uses a
 * neutral light UI and the planning-convention zoning palette (see
 * components/parcel-map/map-theme.ts). Archivo is still the face.
 */
export const metadata: Metadata = {
  title: "Hobart Parcel Map · Stewardship CRE",
  description:
    "Interactive 3D parcel map of Hobart, Indiana — zoning, land use, lot size, building heights. Owner, value and sales tiers for registered developers, contractors and investors.",
};

export default function MapLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-[100dvh] w-screen overflow-hidden bg-slate-100 text-slate-900">
      {children}
    </div>
  );
}
