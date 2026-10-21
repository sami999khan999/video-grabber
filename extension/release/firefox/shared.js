// Helpers shared by the popup, the options page and the background script.
// A classic script (no modules) so Chrome's service worker and Firefox's event page can both load it.

/* eslint-disable no-unused-vars */
var VG = (() => {
  const DEFAULTS = {
    server: "http://localhost:7845",
    autoSave: true,
    notify: true,
    // Pass the user's login for the video's site along with a download (off unless they opt in)
    sendCookies: false,
    // Keep the server's YouTube cookies in step with this browser's login (off unless they opt in)
    syncYouTube: false,
  };

  // --- YouTube login -------------------------------------------------------------------

  // Only youtube.com is read for the YouTube login, nothing else
  const YOUTUBE = { origins: ["https://*.youtube.com/*"] };
  const hasYouTube = () => chrome.permissions.contains(YOUTUBE);
  const requestYouTube = () => chrome.permissions.request(YOUTUBE);
  // Present only while someone is logged in to YouTube in this browser
  const YOUTUBE_LOGIN_COOKIES = ["LOGIN_INFO", "SAPISID", "__Secure-3PAPISID", "__Secure-3PSID"];

  /**
   * Send this browser's YouTube login to the server, where it replaces the stored cookies
   * (the same slot a manual cookies.txt upload uses). Remembers how it went in lastYouTubeSync.
   */
  const syncYouTubeLogin = async () => {
    const record = async (result) => {
      await chrome.storage.local.set({ lastYouTubeSync: { ...result, at: Date.now() } });
      return result;
    };
    if (!(await hasYouTube())) {
      return record({ ok: false, error: "The extension isn't allowed to read YouTube's cookies yet. Turn it on in Settings." });
    }
    const cookies = await chrome.cookies.getAll({ domain: "youtube.com" });
    if (!cookies.some((c) => YOUTUBE_LOGIN_COOKIES.includes(c.name))) {
      return record({ ok: false, error: "You're not logged in to YouTube in this browser. Log in on youtube.com, then try again." });
    }
    try {
      const result = await api("/cookies/", { method: "POST", body: { content: toCookieText(cookies), origin: "extension" } });
      return record({ ok: true, count: result.count });
    } catch (err) {
      return record({ ok: false, error: err.message });
    }
  };

  // Seeing videos on any site needs the browser's OK for all sites (asked from Settings)
  const ALL_SITES = { origins: ["http://*/*", "https://*/*"] };
  const hasAllSites = () => chrome.permissions.contains(ALL_SITES);
  const requestAllSites = () => chrome.permissions.request(ALL_SITES);

  // Videos the background script saw a tab load, newest first
  const mediaKey = (tabId) => `media:${tabId}`;
  const detectedMedia = async (tabId) => (await chrome.storage.session.get(mediaKey(tabId)))[mediaKey(tabId)] || [];

  /**
   * The browser's cookies for these addresses as a Netscape cookies.txt, for one download.
   * Null when the user hasn't opted in, or there are none.
   */
  const cookieTextFor = async (urls) => {
    if (!(await getSettings()).sendCookies) return null;
    const found = new Map();
    for (const url of new Set(urls.filter((u) => /^https?:/.test(u)))) {
      let cookies = [];
      try {
        cookies = await chrome.cookies.getAll({ url });
      } catch {
        continue; // no permission for that site
      }
      for (const c of cookies) found.set(`${c.domain}|${c.path}|${c.name}`, c);
    }
    return found.size ? toCookieText([...found.values()]) : null;
  };

  /** Browser cookies as a Netscape cookies.txt, the format yt-dlp reads. */
  function toCookieText(cookies) {
    const lines = cookies.map((c) => {
      const domain = c.hostOnly ? c.domain.replace(/^\./, "") : c.domain.startsWith(".") ? c.domain : `.${c.domain}`;
      return [domain, c.hostOnly ? "FALSE" : "TRUE", c.path, c.secure ? "TRUE" : "FALSE", Math.floor(c.expirationDate || 0), c.name, c.value].join("\t");
    });
    return ["# Netscape HTTP Cookie File", ...lines, ""].join("\n");
  }

  const getSettings = async () => ({ ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) });

  const normalizeServer = (value) => {
    const url = new URL(value.trim());
    if (!/^https?:$/.test(url.protocol)) throw new Error("The server address must start with http:// or https://");
    return url.origin;
  };

  const originPattern = (server) => `${new URL(server).origin}/*`;

  // Firefox (and Chrome for servers other than localhost) needs the user to allow the address
  const hasAccess = (server) => chrome.permissions.contains({ origins: [originPattern(server)] });
  const requestAccess = (server) => chrome.permissions.request({ origins: [originPattern(server)] });

  const readError = async (res, fallback) => {
    try {
      const data = await res.json();
      if (typeof data.error === "string") return data.error;
      return data.error?.details || fallback;
    } catch {
      return fallback;
    }
  };

  /** Call the Video Grabber API on the configured server. */
  const api = async (path, { method = "GET", body } = {}) => {
    const { server } = await getSettings();
    let res;
    try {
      res = await fetch(`${server}/api${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      const err = new Error(`Can't reach the server at ${server}. Is the container running?`);
      err.offline = true;
      throw err;
    }
    if (!res.ok) throw new Error(await readError(res, `The server answered ${res.status}.`));
    return res.status === 204 ? null : res.json();
  };

  const ACTIVE = ["queued", "starting", "downloading", "processing", "merging", "paused"];
  const isActive = (job) => ACTIVE.includes(job.status);
  // Running or waiting, so it can still be paused (not while the file is being joined)
  const canPause = (job) => ["queued", "starting", "downloading"].includes(job.status);

  const RANK = { downloading: 0, merging: 1, processing: 1, starting: 2, queued: 3, paused: 3, error: 4, done: 5, cancelled: 6 };
  // The priority download on top, then by status, newest first
  const byPriority = (a, b) =>
    Number(!!b.priority) - Number(!!a.priority) || RANK[a.status] - RANK[b.status] || b.created_at - a.created_at;

  const formatBytes = (bytes) => {
    if (!bytes) return "--";
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
  };

  const formatDuration = (seconds) => {
    if (seconds == null) return "--:--";
    const total = Math.max(0, Math.floor(seconds));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(s).padStart(2, "0")}`;
  };

  // Playlists get one quality for every video (same choices as the web app)
  const PRESETS = [
    { id: "best", label: "Best" },
    { id: "2160p", label: "4K" },
    { id: "1440p", label: "1440p" },
    { id: "1080p", label: "1080p" },
    { id: "720p", label: "720p" },
    { id: "480p", label: "480p" },
    { id: "audio", label: "M4A" },
    { id: "audio-mp3", label: "MP3" },
  ];

  // The command that starts a server for the given address (host port = the one in the address)
  const runCommand = (server) => {
    const port = new URL(server).port || "7845";
    return `docker run -d -p ${port}:7845 -v video-grabber-data:/data sami999/video-grabber`;
  };

  // "3 min ago" style, for sync times
  const timeAgo = (ms) => {
    const minutes = Math.round((Date.now() - ms) / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
  };

  return {
    YOUTUBE, hasYouTube, requestYouTube, YOUTUBE_LOGIN_COOKIES, syncYouTubeLogin, timeAgo,
    ALL_SITES, hasAllSites, requestAllSites, mediaKey, detectedMedia, cookieTextFor,
    runCommand,
    DEFAULTS, getSettings, normalizeServer, hasAccess, requestAccess, api,
    isActive, canPause, byPriority, formatBytes, formatDuration, PRESETS,
  };
})();
