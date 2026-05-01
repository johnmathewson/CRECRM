# Stewardship CRE — Listing Sync (Chrome Extension)

Pulls weekly performance metrics from CREXi and LoopNet into the Stewardship CRM, where they feed the owner dashboard.

## Install (one-time, ~3 minutes)

1. Open Chrome → navigate to `chrome://extensions`
2. Toggle **Developer mode** ON (top-right corner)
3. Click **Load unpacked**
4. Select this `extension/` folder
5. The extension's icon appears in the toolbar (you may need to pin it)

## Configure (one-time, ~1 minute)

1. In your CRM at `https://stewardship-crm.netlify.app/settings/integrations`, scroll to **Stewardship Chrome Extension** card → **Generate new API key**
2. Copy the API key (it's only shown once)
3. Right-click the extension icon → **Options** (or click "Settings" in the popup)
4. Paste the API key, leave the CRM URL at the default
5. Click **Save**, then **Test connection** — should show "Connected ✓"

## How it works

- **Manual sync**: open a CREXi or LoopNet listing page, click the extension icon, click "Sync this listing"
- **Auto-sync**: when you have those tabs open, the extension auto-syncs every 6 hours per listing
- **On-demand sync**: when an owner views their dashboard, the CRM enqueues a sync request. The extension polls every 60s and fulfills any pending request whose listing URL matches an open tab

## Listing matching

For a sync to land in the right CRM property, that property needs the right URL saved:

- CREXi: paste the listing URL (e.g. `https://www.crexi.com/properties/12345/...`) into the property's `crexi_url` field
- LoopNet: paste the listing URL into the property's `loopnet_url` field

The extension extracts the numeric listing ID and the CRM matches against `crexi_listing_id` / `loopnet_listing_id` (or falls back to a substring match against the URL).

## Troubleshooting

**Popup says "Open a CREXi or LoopNet listing page":** the URL doesn't match the patterns the extension recognizes. Make sure you're on a listing detail or owner-dashboard page, not the homepage.

**Sync says "No property in CRM matches this listing":** the property exists but the CRM has no `crexi_url` / `loopnet_url` saved. Open the property in CRM → Edit listing details → paste the URL.

**Numbers all zero:** the DOM scraper couldn't find the labeled stats. CREXi/LoopNet may have changed their layout. Open `extension/content-crexi.js` (or `content-loopnet.js`), look at the `findMetricNear` selectors, and adjust.

**"Authenticated failed (401)":** the API key was revoked or never saved correctly. Generate a new one in CRM → paste in extension Options.
