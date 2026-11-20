import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isMapViewer, mapViewerAllowed } from "@/lib/auth-role";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set({ name, value })
          );
          response = NextResponse.next({ request: { headers: request.headers } });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set({ name, value, ...(options as any) })
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Public routes — exempt from auth redirect:
  //   /login, /auth/*  : the auth flow itself
  //   /print/*         : seller-net PDF print pages, opened both from CRE OS
  //                      (admin, logged-in) and from owner-portal magic links
  //                      (no CRM session). The URL embeds opaque IDs (property
  //                      slug + offer UUID) and the page only surfaces data
  //                      scoped to those IDs — same share-by-link contract as
  //                      the magic links themselves. Lives outside /cre-os/
  //                      so it doesn't inherit the app shell's viewport lock.
  const isPrintRoute = request.nextUrl.pathname.startsWith("/print/");
  //   /map/*           : public parcel map (Hobart). Public-tier data only;
  //                      owner / value / sales tiers are gated inside the
  //                      page by registration, not by the CRM session.
  //   /data/*          : static public GIS extracts under /public/data that the
  //                      map fetches (parcels, zoning, buildings).
  const isMapRoute =
    request.nextUrl.pathname.startsWith("/map/") ||
    request.nextUrl.pathname.startsWith("/data/");

  // Public map domain (map.stewardshipcre.com → this same Netlify site as a
  // domain alias). On that host the map is the whole site: "/" and "/hobart"
  // serve /map/hobart without changing the URL, map/data/login/auth routes
  // work as usual (/api/* never reaches middleware), and anything else — the
  // CRM — bounces to the CRM origin so the public domain never shows it.
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(":")[0].toLowerCase();
  const mapHost = (process.env.MAP_PUBLIC_HOST ?? "map.stewardshipcre.com").toLowerCase();
  if (host && host === mapHost) {
    const p = request.nextUrl.pathname;
    if (p === "/" || p === "/hobart") {
      const url = request.nextUrl.clone();
      url.pathname = "/map/hobart";
      return NextResponse.rewrite(url);
    }
    if (!isMapRoute && !p.startsWith("/login") && !p.startsWith("/auth") && !p.startsWith("/api/")) {
      return NextResponse.redirect(new URL(p + request.nextUrl.search, process.env.CRM_ORIGIN ?? "https://crm.stewardshipcre.com"));
    }
  }

  // Map viewers (partners with a login, role in app_metadata) get the public
  // map with every tier unlocked and nothing else: CRM pages bounce to the
  // map, CRM API calls get 403. See src/lib/auth-role.ts.
  const path = request.nextUrl.pathname;
  const isApi = path.startsWith("/api/");
  if (user && isMapViewer(user) && !mapViewerAllowed(path)) {
    if (isApi) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const url = request.nextUrl.clone();
    url.pathname = "/map/hobart";
    url.search = "";
    return NextResponse.redirect(url);
  }
  // API routes handle their own auth; middleware only gates map viewers above.
  if (isApi) return response;

  if (
    !user &&
    !request.nextUrl.pathname.startsWith("/login") &&
    !request.nextUrl.pathname.startsWith("/auth") &&
    !isPrintRoute &&
    !isMapRoute
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // If logged in and on /login, redirect to CRE OS Command Center.
  // (Root / is itself a redirect to /cre-os now, but jumping straight there
  // avoids a double bounce.)
  if (user && request.nextUrl.pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    const next = request.nextUrl.searchParams.get("next") ?? "";
    const wanted = /^\/(?!\/)[\w\-./]*$/.test(next) ? next : null;
    url.pathname = isMapViewer(user) ? (wanted && mapViewerAllowed(wanted) ? wanted : "/map/hobart") : (wanted ?? "/cre-os");
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - (api routes DO pass through now: they handle their own auth, but
     *   middleware fences map viewers off the CRM API — see above)
     * - .netlify/functions/* (Netlify Functions handle their own auth;
     *   without this exclusion, background functions get redirected
     *   to /login and never execute)
     */
    "/((?!_next/static|_next/image|favicon.ico|\\.netlify).*)",
  ],
};
