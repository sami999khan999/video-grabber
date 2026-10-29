// Right-click menu, toolbar badge, notifications and auto-save.
// Chrome runs this as a service worker (load shared.js here); Firefox lists both files in the manifest.
if (typeof VG === "undefined" && typeof importScripts === "function") importScripts("shared.js");

const MENU = [
  { id: "best", title: "Best quality" },
  { id: "1080p", title: "Up to 1080p" },
  { id: "720p", title: "Up to 720p" },
  { id: "audio", title: "Audio only (M4A)" },
  { id: "audio-mp3", title: "Audio only (MP3)" },
];
const POLL_ALARM = "poll-jobs";

// Functions that read, change and write the same stored list take turns, or an update that
// arrives in between gets written away (live job updates and media requests come in bursts)
const makeSerial = () => {
  let turn = Promise.resolve();
  return (fn) => (...args) => {
    const result = turn.then(() => fn(...args));
    turn = result.catch(() => {});
    return result;
  };
};
const serial = makeSerial();
const serialMedia = makeSerial();

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "grab",
      title: "Grab with Video Grabber",
      contexts: ["page", "link", "video", "audio"],
    });
    for (const item of MENU) {
      chrome.contextMenus.create({ id: `grab:${item.id}`, parentId: "grab", title: item.title, contexts: ["page", "link", "video", "audio"] });
    }
  });
  chrome.action.setBadgeBackgroundColor({ color: "#ffd43b" });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!info.menuItemId.startsWith("grab:")) return;
  const formatId = info.menuItemId.slice(5);
  // A link wins over the page; a <video> src only when it's a real address (YouTube's are blob:)
  const src = info.srcUrl && /^https?:/.test(info.srcUrl) ? info.srcUrl : null;
  const url = info.linkUrl || src || info.pageUrl;
  const label = MENU.find((m) => m.id === formatId)?.title ?? formatId;
  try {
    if (VG.isYouTube(url)) await VG.freshYouTubeLogin();
    const cookies = await VG.cookieTextFor([url]);
    let items;
    let source;
    try {
      // Playlist links queue every video in them
      source = await VG.api("/info/", { method: "POST", body: { url, cookies } });
      items = source.kind === "playlist"
        ? source.entries.map((e) => ({ url: e.url, format_id: formatId, label, title: e.title, thumbnail: e.thumbnail, group: source.title }))
        : [{ url: source.webpage_url, format_id: formatId, label, title: source.title, thumbnail: source.thumbnail, cookies }];
    } catch (err) {
      // A site the server can't read: fall back to the video this tab was seen playing
      const [media] = err.offline || !tab ? [] : await VG.detectedMedia(tab.id);
      if (!media) throw err;
      source = { title: tab.title };
      items = [{
        url: media.url,
        format_id: formatId,
        label,
        title: tab.title,
        headers: media.headers,
        cookies: await VG.cookieTextFor([media.pageUrl, media.url]),
      }];
    }
    const { jobs } = await VG.api("/jobs/", { method: "POST", body: { items } });
    await track(jobs.map((j) => j.id));
    notify(
      "queued",
      source.kind === "playlist" ? `Queued ${items.length} videos` : "Queued",
      `${source.title || tab?.title || url} · ${label}`,
    );
  } catch (err) {
    notify("error", "Couldn't queue that", err.message);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message.type === "track") {
    track(message.ids).then(() => reply(true));
    return true;
  }
  if (message.type === "jobs") {
    // The popup has a live stream open and passes every update on
    handleJobs(message.jobs).then(() => reply(true));
    return true;
  }
  return false;
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== POLL_ALARM) return;
  try {
    const { jobs } = await VG.api("/jobs/");
    await handleJobs(jobs);
  } catch {
    // Server away for a moment: try again on the next tick
  }
});

/** Remember jobs this extension queued, so they can be saved and announced when they finish. */
const track = serial(async (ids) => {
  const { pending = {} } = await chrome.storage.local.get("pending");
  for (const id of ids) pending[id] = Date.now();
  await chrome.storage.local.set({ pending });
  // Chrome won't fire alarms more often than every 30 seconds
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.5 });
});

const handleJobs = serial(async (jobs) => {
  const settings = await VG.getSettings();
  const { pending = {} } = await chrome.storage.local.get("pending");
  const byId = new Map(jobs.map((j) => [j.id, j]));

  for (const id of Object.keys(pending)) {
    const job = byId.get(id);
    if (!job) {
      delete pending[id];
    } else if (job.status === "done") {
      delete pending[id];
      if (settings.autoSave) saveFile(job, settings.server);
      notify(`done:${id}`, "Ready", `${job.title || job.url}${job.notice ? `\n${job.notice}` : ""}`);
    } else if (job.status === "error") {
      delete pending[id];
      notify(`error:${id}`, "Download failed", `${job.title || job.url}\n${job.error || ""}`);
    } else if (job.status === "cancelled") {
      delete pending[id];
    }
  }
  await chrome.storage.local.set({ pending });

  const active = jobs.filter(VG.isActive).length;
  chrome.action.setBadgeText({ text: active ? String(active) : "" });
  if (!active && !Object.keys(pending).length) chrome.alarms.clear(POLL_ALARM);
});

function saveFile(job, server) {
  // The server names the file (Content-Disposition); the browser's download manager does the rest
  chrome.downloads.download({ url: `${server}/api/jobs/${job.id}/file/` });
}

async function notify(id, title, message) {
  const { notify: enabled } = await VG.getSettings();
  if (!enabled) return;
  chrome.notifications.create(id, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
    title,
    message: message.slice(0, 300),
  });
}

// --- videos playing on pages ---------------------------------------------------------
// The browser fetches the real file or stream a page plays. Remembering those per tab lets the
// popup offer them on sites the server can't read by itself. Only sites the user allowed are
// visible here (localhost always; every site once "Detect videos" is on in Settings).

const MANIFEST = /\.(m3u8|mpd)(?:$|[?#])/i;
const MEDIA_FILE = /\.(mp4|webm|m4v|mov|mkv|ogv|flv|mp3|m4a|ogg|opus|wav)(?:$|[?#])/i;
const MANIFEST_TYPE = /mpegurl|dash\+xml/i;
const MEDIA_TYPE = /^(video|audio)\//i;
// Pieces of a stream, not the stream itself
const SEGMENT = /\.(ts|m4s|aac|vtt)(?:$|[?#])|[?&](range|bytes)=\d|init\.mp4/i;
// YouTube's own servers (YouTube links work directly) and common ad hosts
const SKIP_HOST = /(^|\.)(googlevideo\.com|ytimg\.com|doubleclick\.net|googlesyndication\.com|imasdk\.googleapis\.com)$/i;
const MIN_FILE_BYTES = 512 * 1024; // smaller files are previews, sounds or ad snippets
const MAX_PER_TAB = 15;

const header = (headers, name) => headers?.find((h) => h.name.toLowerCase() === name)?.value || "";

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0 || details.statusCode >= 400) return;
    let url;
    try {
      url = new URL(details.url);
    } catch {
      return;
    }
    if (!/^https?:$/.test(url.protocol) || SKIP_HOST.test(url.hostname)) return;

    const type = header(details.responseHeaders, "content-type");
    const manifest = MANIFEST.test(url.pathname) || MANIFEST_TYPE.test(type);
    const file = !manifest && (MEDIA_FILE.test(url.pathname) || MEDIA_TYPE.test(type));
    if (!manifest && !file) return;
    if (!manifest && (SEGMENT.test(details.url) || /mp2t/i.test(type))) return;

    // A partial (206) answer gives the full size after the slash in Content-Range
    const range = header(details.responseHeaders, "content-range").match(/\/(\d+)$/);
    const size = Number(range?.[1] || header(details.responseHeaders, "content-length")) || null;
    if (file && size && size < MIN_FILE_BYTES) return;

    recordMedia(details, { manifest, type, size });
  },
  { urls: ["<all_urls>"], types: ["media", "xmlhttprequest", "other"] },
  ["responseHeaders"],
);

const recordMedia = serialMedia(async (details, { manifest, type, size }) => {
  const { server } = await VG.getSettings();
  if (details.url.startsWith(server)) return;

  let tab;
  try {
    tab = await chrome.tabs.get(details.tabId);
  } catch {
    return;
  }
  // The page that asked for it: Firefox says so; in Chrome a sub-frame only gives its origin
  const pageUrl = details.documentUrl || (details.frameId === 0 ? tab.url : null) || (details.initiator ? `${details.initiator}/` : tab.url);
  const origin = (() => {
    try {
      return new URL(pageUrl).origin;
    } catch {
      return null;
    }
  })();

  const kind = manifest ? (/mpd|dash/i.test(details.url + type) ? "dash" : "hls") : "file";
  const entry = {
    url: details.url,
    kind,
    ext: (details.url.match(/\.([a-z0-9]{2,5})(?:$|[?#])/i)?.[1] || "").toLowerCase(),
    size,
    pageUrl,
    title: tab.title || "",
    headers: { Referer: pageUrl, ...(origin ? { Origin: origin } : {}), "User-Agent": navigator.userAgent },
    seenAt: Date.now(),
  };

  const key = VG.mediaKey(details.tabId);
  const list = (await chrome.storage.session.get(key))[key] || [];
  // Same file with fresh tokens in the query counts once
  const id = details.url.split("?")[0];
  const rest = list.filter((m) => m.url.split("?")[0] !== id);
  await chrome.storage.session.set({ [key]: [entry, ...rest].slice(0, MAX_PER_TAB) });
});

const forgetTab = serialMedia((tabId) => chrome.storage.session.remove([VG.mediaKey(tabId), VG.pageKey(tabId)]));
chrome.tabs.onRemoved.addListener((tabId) => forgetTab(tabId));
chrome.tabs.onUpdated.addListener((tabId, change) => {
  // A new page in the tab: what the old one played no longer applies
  if (change.url) forgetTab(tabId);
});

// --- YouTube login sync ----------------------------------------------------------------
// With "Keep it up to date" on, the server's YouTube cookies follow this browser's login:
// every 6 hours, and shortly after YouTube changes a login cookie.

const SYNC_ALARM = "sync-youtube";
const SYNC_SOON_ALARM = "sync-youtube-soon";

async function scheduleYouTubeSync() {
  const { syncYouTube } = await VG.getSettings();
  if (syncYouTube) chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 360 });
  else {
    chrome.alarms.clear(SYNC_ALARM);
    chrome.alarms.clear(SYNC_SOON_ALARM);
  }
}

chrome.runtime.onStartup.addListener(scheduleYouTubeSync);
chrome.runtime.onInstalled.addListener(async () => {
  await scheduleYouTubeSync();
  // Hand the login over straight away instead of at the first alarm
  await VG.freshYouTubeLogin();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.syncYouTube) scheduleYouTubeSync();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== SYNC_ALARM && alarm.name !== SYNC_SOON_ALARM) return;
  if ((await VG.getSettings()).syncYouTube) await VG.syncYouTubeLogin();
});

chrome.cookies.onChanged.addListener(async ({ cookie }) => {
  if (!cookie.domain.endsWith("youtube.com") || !VG.YOUTUBE_LOGIN_COOKIES.includes(cookie.name)) return;
  if (!(await VG.getSettings()).syncYouTube) return;
  // Logging in or out changes several cookies at once: sync once, a minute later
  chrome.alarms.create(SYNC_SOON_ALARM, { delayInMinutes: 1 });
});

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message.type !== "sync-youtube") return false;
  VG.syncYouTubeLogin().then(reply);
  return true;
});
