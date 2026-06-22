"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ListingImageUploader, {
  type ListingImage,
} from "@/components/listing-image-uploader";

/**
 * PropertyPhotosPanel — drag-and-drop photo uploader for a property.
 *
 * Thin wrapper around the existing ListingImageUploader. The shared
 * component already handles Supabase Storage upload + URL generation;
 * this wrapper persists changes to properties.images via PATCH so
 * the photos are available to the marketing engine (flyer, OM, social,
 * future generators).
 *
 * Image shape: { url, alt?, order } — `images` is a jsonb array, so
 * we re-serialize on every change. No image is the source of truth
 * unless it's also saved to the row.
 */
export function PropertyPhotosPanel({
  propertyId,
  initialImages,
}: {
  propertyId: string;
  initialImages: ListingImage[];
}) {
  const router = useRouter();
  const [images, setImages] = useState<ListingImage[]>(initialImages ?? []);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [, startTransition] = useTransition();

  async function persist(next: ListingImage[]) {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/properties/${propertyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: next }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${r.status}`);
      }
      setSavedAt(Date.now());
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function handleChange(next: ListingImage[]) {
    setImages(next);
    void persist(next);
  }

  return (
    <div className="space-y-3">
      <div className="font-body text-[11.5px] text-cream-dim leading-relaxed">
        Drop photos here for use in the flyer, OM, and social posts.
        First image becomes the cover/hero by default — reorder by
        dragging.
      </div>
      <ListingImageUploader value={images} onChange={handleChange} />
      <div className="flex items-center justify-between text-[10px] font-mono text-cream-subtle">
        <span>
          {images.length === 0
            ? "No photos yet."
            : `${images.length} photo${images.length === 1 ? "" : "s"}`}
        </span>
        <span>
          {saving
            ? "Saving…"
            : savedAt
            ? "Saved"
            : ""}
        </span>
      </div>
      {error && (
        <div className="rounded border border-red-400/30 bg-red-500/[0.08] px-3 py-2 font-body text-[11px] text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}
