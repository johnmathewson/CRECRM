const DEFAULT_CRM = "https://stewardship-crm.netlify.app";

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
