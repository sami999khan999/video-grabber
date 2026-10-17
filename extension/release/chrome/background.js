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

// track() and handleJobs() both read, change and write the pending list; live updates arrive
// several times a second, so they take turns or a newly queued job can be written away
let turn = Promise.resolve();
const serial = (fn) => (...args) => {
  const result = turn.then(() => fn(...args));
  turn = result.catch(() => {});
  return result;
};

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
    // Playlist links queue every video in them
    const source = await VG.api("/info/", { method: "POST", body: { url } });
    const items = source.kind === "playlist"
      ? source.entries.map((e) => ({ url: e.url, format_id: formatId, label, title: e.title, thumbnail: e.thumbnail, group: source.title }))
      : [{ url: source.webpage_url, format_id: formatId, label, title: source.title, thumbnail: source.thumbnail }];
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
