/**
 * Netlify Background Function for the nightly deal check-in.
 *
 * Reads every open deal with Sonnet (30–120s for a dozen deals), writes
 * tonight's deal_checkins row + questions, and texts John the link.
 * Kicked by deal-checkin-nightly (cron) and POST /api/agents/deal-checkin/run
 * (the "Build tonight's check-in now" button). Filename suffix
 * `-background.mts` is what makes Netlify run it in background mode.
 *
 * Auth: x-cron-secret must match CRON_SECRET when that is set — this
 * spends API tokens and texts John, so it is not open to the internet.
 */

interface RunBody {
  force?: boolean;
  skipNotify?: boolean;
}

export default async function handler(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("x-cron-secret") !== secret) {
    console.warn("[deal-checkin-bg] rejected: bad or missing x-cron-secret");
    return new Response("Unauthorized", { status: 401 });
  }

  let body: RunBody = {};
  try {
    body = (await req.json()) as RunBody;
  } catch {
    // Empty body — defaults apply.
  }

  const startedAt = Date.now();
  try {
    const { runDealCheckin } = await import("../../src/lib/agents/deal-checkin");
    const r = await runDealCheckin({ force: !!body.force, skipNotify: !!body.skipNotify });
    console.log(
      `[deal-checkin-bg] date=${r.checkinDate} id=${r.checkinId} reviewed=${r.dealsReviewed} items=${r.items}` +
        ` notified=${r.notified} skipped=${r.skipped ?? "-"} errors=${r.errors.length} ms=${Date.now() - startedAt}`
    );
    if (r.errors.length) console.warn(`[deal-checkin-bg] errors: ${r.errors.slice(0, 5).join(" | ")}`);
    return new Response(JSON.stringify({ ok: true, ...r }), { status: 200, headers: { "content-type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[deal-checkin-bg] failed:", err);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers: { "content-type": "application/json" } });
  }
}
