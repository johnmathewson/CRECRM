/**
 * Geocoder — converts street addresses to lat/lng coordinates.
 * Uses US Census Geocoder (free, no API key) with Google Maps as optional upgrade.
 */

export interface GeocodedAddress {
  lat: number;
  lng: number;
  formattedAddress: string;
  city: string;
  state: string;
  zip: string;
  county: string;
}

/**
 * Geocode an address using the US Census Bureau geocoder (free, no key needed).
 * Falls back to Google Maps if GOOGLE_MAPS_API_KEY is set.
 */
export async function geocodeAddress(address: string): Promise<GeocodedAddress | null> {
  // Try Google Maps first if key is available
  const googleKey = process.env.GOOGLE_MAPS_API_KEY;
  if (googleKey) {
    const result = await geocodeGoogle(address, googleKey);
    if (result) return result;
  }

  // Fall back to Census geocoder
  return geocodeCensus(address);
}

async function geocodeCensus(address: string): Promise<GeocodedAddress | null> {
  try {
    const url = `https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&vintage=Current_Current&format=json`;

    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const data = await response.json();

    const matches = data?.result?.addressMatches;
    if (!matches?.length) return null;

    const match = matches[0];
    const coords = match.coordinates;
    const components = match.addressComponents || {};
    const geographies = match.geographies || {};
    const county = geographies?.Counties?.[0]?.BASENAME || "";

    return {
      lat: coords.y,
      lng: coords.x,
      formattedAddress: match.matchedAddress || address,
      city: components.city || "",
      state: components.state || "",
      zip: components.zip || "",
      county,
    };
  } catch (err) {
    console.error("Census geocoding failed:", err);
    return null;
  }
}

async function geocodeGoogle(address: string, apiKey: string): Promise<GeocodedAddress | null> {
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const data = await response.json();

    if (data.status !== "OK" || !data.results?.length) return null;

    const result = data.results[0];
    const { lat, lng } = result.geometry.location;

    const getComponent = (type: string): string => {
      const comp = result.address_components?.find((c: any) => c.types.includes(type));
      return comp?.short_name || comp?.long_name || "";
    };

    return {
      lat,
      lng,
      formattedAddress: result.formatted_address,
      city: getComponent("locality") || getComponent("sublocality"),
      state: getComponent("administrative_area_level_1"),
      zip: getComponent("postal_code"),
      county: getComponent("administrative_area_level_2"),
    };
  } catch (err) {
    console.error("Google geocoding failed:", err);
    return null;
  }
}
