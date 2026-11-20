const DEFAULT_CRM = "https://crm.stewardshipcre.com";

const els = {
  crm: document.getElementById("crm"),
  key: document.getElementById("key"),
  save: document.getElementById("save"),
  test: document.getElementById("test"),
  status: document.getElementById("status"),
};

function setStatus(msg, kind = "") {
  els.status.textContent = msg;
  els.status.className = `status ${kind}`;
}

async function load() {
  const cfg = await chrome.storage.local.get(["crmUrl", "apiKey"]);
  els.crm.value = cfg.crmUrl || DEFAULT_CRM;
  els.key.value = cfg.apiKey || "";
}

async function save() {
  const crmUrl = els.crm.value.trim().replace(/\/+$/, "") || DEFAULT_CRM;
  const apiKey = els.key.value.trim();
  if (!apiKey) {
    setStatus("API key is required.", "err");
    return;
  }
  await chrome.storage.local.set({ crmUrl, apiKey });
  setStatus("Saved. Try Test connection.", "ok");
}

async function test() {
  const cfg = await chrome.storage.local.get(["crmUrl", "apiKey"]);
  const crmUrl = (cfg.crmUrl || DEFAULT_CRM).replace(/\/+$/, "");
  const apiKey = cfg.apiKey;
  if (!apiKey) {
    setStatus("Save your API key first.", "err");
    return;
  }
  setStatus("Testing…");
  try {
    const res = await fetch(`${crmUrl}/api/extension/pending`, {
      method: "GET",
      headers: { "x-extension-key": apiKey },
    });
    if (res.status === 401) {
      setStatus("Authenticated failed (401). Check the API key.", "err");
      return;
    }
    if (!res.ok) {
      setStatus(`Server returned ${res.status}.`, "err");
      return;
    }
    const data = await res.json();
    setStatus(`Connected ✓ (${(data.pending || []).length} pending sync request${(data.pending || []).length === 1 ? "" : "s"})`, "ok");
  } catch (err) {
    setStatus(`Network error: ${err.message}`, "err");
  }
}

els.save.addEventListener("click", save);
els.test.addEventListener("click", test);
load();


// ── Listing watch ──────────────────────────────────────────────────────────
const DEFAULT_LISTING_URLS = [
  "https://www.crexi.com/search?address_value=Hobart%252C%2520IN&searchType=Sales&mapCenter=41.51444,-87.26867&mapZoom=12",
  "https://www.crexi.com/search?address_value=Hobart%252C%2520IN&searchType=Lease&mapCenter=41.51444,-87.26867&mapZoom=12",
  "https://www.loopnet.com/search/commercial-real-estate/hobart-in/for-sale/",
  "https://www.loopnet.com/search/commercial-real-estate/hobart-in/for-lease/",
];
const lw = {
  enabled: document.getElementById("lwEnabled"),
  city: document.getElementById("lwCity"),
  urls: document.getElementById("lwUrls"),
  save: document.getElementById("lwSave"),
  run: document.getElementById("lwRun"),
  status: document.getElementById("lwStatus"),
  log: document.getElementById("lwLog"),
};
async function lwLoad() {
  const cfg = await chrome.storage.local.get(["listingWatchEnabled", "listingWatchUrls", "listingsCity", "listingWatchLog"]);
  lw.enabled.checked = cfg.listingWatchEnabled !== false;
  lw.city.value = cfg.listingsCity || "Hobart";
  lw.urls.value = (cfg.listingWatchUrls && cfg.listingWatchUrls.length ? cfg.listingWatchUrls : DEFAULT_LISTING_URLS).join("\n");
  const log = cfg.listingWatchLog || {};
  lw.log.textContent = Object.entries(log).map(([u, r]) => `${new Date(r.at).toLocaleString()}  ${r.ok ? "ok" : "FAIL"}  ${r.source || ""} ${r.kind || ""}  captured=${r.captured ?? "?"} written=${r.body?.written ?? "?"} matched=${r.body?.matched ?? "?"} expired=${r.body?.expired ?? "?"} ${r.error || ""}\n  ${u}`).join("\n") || "No runs yet.";
}
async function lwSave() {
  const urls = lw.urls.value.split("\n").map((s) => s.trim()).filter((s) => /^https:\/\/(www\.)?(crexi|loopnet)\.com\//.test(s));
  await chrome.storage.local.set({ listingWatchEnabled: lw.enabled.checked, listingWatchUrls: urls, listingsCity: lw.city.value.trim() || "Hobart" });
  lw.status.textContent = `Saved ${urls.length} search URL${urls.length === 1 ? "" : "s"}.`; lw.status.className = "status ok";
}
async function lwRun() {
  await lwSave();
  lw.status.textContent = "Running… tabs open in the background; results appear below in a minute or two."; lw.status.className = "status";
  chrome.runtime.sendMessage({ type: "stw-listings-run-now" }, () => {});
  setTimeout(lwLoad, 45_000); setTimeout(lwLoad, 120_000);
}
if (lw.save) { lw.save.addEventListener("click", lwSave); lw.run.addEventListener("click", lwRun); lwLoad(); }
