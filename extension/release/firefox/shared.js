// Helpers shared by the popup, the options page and the background script.
// A classic script (no modules) so Chrome's service worker and Firefox's event page can both load it.

/* eslint-disable no-unused-vars */
var VG = (() => {
  const DEFAULTS = {
    server: "http://localhost:7845",
    autoSave: true,
    notify: true,
  };

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

  const ACTIVE = ["queued", "starting", "downloading", "processing", "merging"];
  const isActive = (job) => ACTIVE.includes(job.status);

  const RANK = { downloading: 0, merging: 1, processing: 1, starting: 2, queued: 3, error: 4, done: 5, cancelled: 6 };
  const byPriority = (a, b) => RANK[a.status] - RANK[b.status] || b.created_at - a.created_at;

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

  return {
    runCommand,
    DEFAULTS, getSettings, normalizeServer, hasAccess, requestAccess, api,
    isActive, byPriority, formatBytes, formatDuration, PRESETS,
  };
})();
