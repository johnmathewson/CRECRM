import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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

  if (
    !user &&
    !request.nextUrl.pathname.startsWith("/login") &&
    !request.nextUrl.pathname.startsWith("/auth") &&
    !isPrintRoute
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
    url.pathname = "/cre-os";
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
     * - api routes (let them handle their own auth)
     * - .netlify/functions/* (Netlify Functions handle their own auth;
     *   without this exclusion, background functions get redirected
     *   to /login and never execute)
     */
    "/((?!_next/static|_next/image|favicon.ico|api|\\.netlify).*)",
  ],
};
