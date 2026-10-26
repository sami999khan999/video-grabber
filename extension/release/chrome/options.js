const $ = (id) => document.getElementById(id);

// Results appear next to the button that was pressed, so there's no scrolling to find them
const show = (ok, text) => {
  const box = document.createElement("div");
  box.className = ok ? "ok" : "error";
  box.textContent = text;
  $("server-result").replaceChildren(box);
};

const showSaved = (ok, text) => {
  $("save-result").className = ok ? "ok-text" : "bad-text";
  $("save-result").textContent = text;
};

/** Busy state on a button while something runs; its label comes back afterwards. */
async function busy(button, label, work) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = label;
  try {
    return await work();
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

// The start command follows the address typed in
const showCommand = () => {
  try {
    $("run-command").textContent = VG.runCommand(VG.normalizeServer($("server").value));
  } catch {
    $("run-command").textContent = VG.runCommand(VG.DEFAULTS.server);
  }
};

$("server").addEventListener("input", showCommand);
for (const chip of document.querySelectorAll("[data-server]")) {
  chip.addEventListener("click", () => {
    $("server").value = chip.dataset.server;
    showCommand();
  });
}

async function load() {
  const settings = await VG.getSettings();
  $("server").value = settings.server;
  showCommand();
  $("autoSave").checked = settings.autoSave;
  $("notify").checked = settings.notify;
}

/** Ask for access to the address (needs the click), then check the server answers. */
async function test(server) {
  if (!(await VG.hasAccess(server)) && !(await VG.requestAccess(server))) {
    throw new Error(`The browser wasn't allowed to talk to ${server}.`);
  }
  let res;
  try {
    res = await fetch(`${server}/api/status/`);
  } catch {
    throw new Error(`Nothing answered at ${server}. Is the container running, and is the port right?`);
  }
  if (!res.ok) throw new Error(`${server} answered ${res.status}. Is that a Video Grabber server?`);
  const status = await res.json();
  const parallel = status.max_parallel ? `${status.max_parallel} downloads at a time` : "all downloads at once";
  return `Connected: ${parallel}, ${status.cookies ? "cookies on" : "no cookies"}.`;
}

$("test").addEventListener("click", (e) =>
  busy(e.currentTarget, "Testing…", async () => {
    $("server-result").replaceChildren();
    try {
      show(true, await test(VG.normalizeServer($("server").value)));
    } catch (err) {
      show(false, err.message);
    }
  }),
);

$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  const button = e.submitter || e.currentTarget.querySelector('[type="submit"]');
  return busy(button, "Saving…", async () => {
    showSaved(true, "");
    try {
      const server = VG.normalizeServer($("server").value);
      const message = await test(server);
      await chrome.storage.local.set({ server, autoSave: $("autoSave").checked, notify: $("notify").checked });
      $("server").value = server;
      showSaved(true, "✓ Saved");
      show(true, message);
    } catch (err) {
      showSaved(false, "Not saved");
      show(false, err.message);
    }
  });
});

// --- any website -------------------------------------------------------------------

const showAny = (ok, text) => {
  const box = document.createElement("div");
  box.className = ok ? "ok" : "error";
  box.textContent = text;
  $("any-result").replaceChildren(box);
};

$("detect").addEventListener("change", async (e) => {
  if (e.target.checked) {
    // Has to happen right in the click, or the browser won't ask
    const granted = await VG.requestAllSites();
    e.target.checked = granted;
    showAny(granted, granted
      ? "On. Play a video, then open the popup: what the page plays shows up under \"Playing on this page\"."
      : "The browser wasn't allowed to see other sites, so detection stays off.");
  } else {
    await chrome.permissions.remove(VG.ALL_SITES);
    showAny(true, "Off. The extension no longer sees what other sites load.");
  }
});

$("sendCookies").addEventListener("change", async (e) => {
  await chrome.storage.local.set({ sendCookies: e.target.checked });
  const reach = await VG.hasAllSites();
  showAny(true, e.target.checked
    ? `On. Your login for a video's site goes with that download only.${reach ? "" : " Turn on detection too, so the extension can read logins for sites other than localhost."}`
    : "Off. Downloads go without your logins.");
});

async function loadAny() {
  $("detect").checked = await VG.hasAllSites();
  $("sendCookies").checked = (await VG.getSettings()).sendCookies;
}

// --- YouTube login ------------------------------------------------------------------

const showYouTube = (ok, text) => {
  const box = document.createElement("div");
  box.className = ok ? "ok" : "error";
  box.textContent = text;
  $("yt-result").replaceChildren(box);
};

async function showYouTubeStatus() {
  const { lastYouTubeSync: last } = await chrome.storage.local.get("lastYouTubeSync");
  let server = null;
  try {
    server = (await VG.api("/status/")).cookies_detail;
  } catch {
    // Server off: say what the extension knows
  }
  const parts = [];
  if (server?.origin === "extension") parts.push(`Server has your login from this extension, sent ${VG.timeAgo(server.updated_at * 1000)}.`);
  else if (server?.origin === "file") parts.push(`Server has an uploaded cookies.txt from ${VG.timeAgo(server.updated_at * 1000)}.`);
  else if (server === null) parts.push("Server has no YouTube login yet.");
  if (last && !last.ok) parts.push(`Last try ${VG.timeAgo(last.at)} failed: ${last.error}`);
  $("yt-status").textContent = parts.join(" ");
}

/** Ask for YouTube access (needs the click), then send the login. */
async function syncNow() {
  if (!(await VG.hasYouTube()) && !(await VG.requestYouTube())) {
    showYouTube(false, "The browser wasn't allowed to read YouTube's cookies, so nothing was sent.");
    return false;
  }
  const result = await chrome.runtime.sendMessage({ type: "sync-youtube" });
  showYouTube(result.ok, result.ok ? `Sent ${result.count} YouTube cookies to the server.` : result.error);
  showYouTubeStatus();
  return result.ok;
}

$("yt-sync").addEventListener("click", (e) => busy(e.currentTarget, "Sending…", syncNow));

$("syncYouTube").addEventListener("change", async (e) => {
  if (!e.target.checked) {
    await chrome.storage.local.set({ syncYouTube: false });
    showYouTube(true, "Automatic sync is off. The login already on the server stays until you remove it in the station.");
    return;
  }
  if (!(await VG.hasYouTube()) && !(await VG.requestYouTube())) {
    e.target.checked = false;
    showYouTube(false, "The browser wasn't allowed to read YouTube's cookies, so automatic sync stays off.");
    return;
  }
  await chrome.storage.local.set({ syncYouTube: true });
  await syncNow();
});

async function loadYouTube() {
  $("syncYouTube").checked = (await VG.getSettings()).syncYouTube;
  showYouTubeStatus();
}

load();
loadAny();
loadYouTube();
GlassScroll.attach($("page"));
