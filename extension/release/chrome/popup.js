// Popup: shows the qualities for the current tab, queues downloads, and lists live progress.
// Titles and thumbnails come from websites, so everything is built with text nodes (no innerHTML).

const $ = (id) => document.getElementById(id);

/** Tiny element builder: h("div", { class: "x" }, child, "text") */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key === "class") el.className = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

const icon = (paths) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d);
    svg.append(p);
  }
  return svg;
};
const ICONS = {
  save: ["M12 3v12", "m7 10 5 5 5-5", "M5 21h14"],
  cancel: ["M18 6 6 18", "M6 6l12 12"],
  retry: ["M3 12a9 9 0 1 0 3-6.7L3 8", "M3 3v5h5"],
};

// Only show pictures that come from a real web address
const safeImage = (url) => (url && /^https?:\/\//.test(url) ? `url("${url.replace(/["\\]/g, "")}")` : "");

const state = {
  server: "",
  autoSave: true,
  tabUrl: "",
  source: null,
  selectedFormats: new Set(),
  selectedEntries: new Set(),
  preset: "best",
  jobs: [],
  stream: null,
  // Server not answering: the popup shows the "off air" card and reconnects on its own
  offline: false,
  // Last link tuned in, so it can be looked up again once the server is back
  lastUrl: "",
  tabId: null,
  tabTitle: "",
  // What the background script saw this tab play
  detected: [],
  // Headers and login that go with the current source (for a detected stream)
  sourceExtra: {},
  allSites: false,
  // Jobs removed here that the server may still be listing
  removing: new Set(),
};

// --- start-up ------------------------------------------------------------------

async function init() {
  const settings = await VG.getSettings();
  state.server = settings.server;
  state.autoSave = settings.autoSave;
  $("server-label").textContent = new URL(state.server).host;

  $("open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());
  $("open-station").addEventListener("click", openStation);
  $("grab").addEventListener("click", grab);
  $("clear").addEventListener("click", () =>
    removeJobs(state.jobs.filter((j) => !VG.isActive(j)), VG.api("/jobs/clear/", { method: "POST" })),
  );
  $("clear-all").addEventListener("click", () =>
    removeJobs(state.jobs, VG.api("/jobs/clear/", { method: "POST", body: { all: true } })),
  );
  $("link-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const link = $("link").value.trim();
    if (link) tune(link);
  });

  if (!(await VG.hasAccess(state.server))) {
    $("access").hidden = false;
    $("access-server").textContent = state.server;
    $("source").hidden = true;
    $("grant").addEventListener("click", async () => {
      if (await VG.requestAccess(state.server)) location.reload();
    });
    return;
  }

  checkServer();
  connectJobs();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.tabUrl = tab?.url || "";
  state.tabId = tab?.id ?? null;
  state.tabTitle = tab?.title || "";
  state.allSites = await VG.hasAllSites();
  if (state.tabId != null) {
    state.detected = await VG.detectedMedia(state.tabId);
    renderDetected();
    // Keep the list current while the popup is open
    chrome.storage.onChanged.addListener((changes, area) => {
      const change = changes[VG.mediaKey(state.tabId)];
      if (area !== "session" || !change) return;
      state.detected = change.newValue || [];
      renderDetected();
    });
  }
  const isWebPage = /^https?:\/\//.test(state.tabUrl) && !state.tabUrl.startsWith(state.server);
  if (isWebPage) tune(state.tabUrl, { pageTune: true });
  else renderSource({ placeholder: "Open a video or playlist page, or paste a link below." });
}

async function checkServer() {
  try {
    const status = await VG.api("/status/");
    $("link-dot").className = "dot ok";
    $("link-dot").title = `Connected · ${status.max_parallel} parallel · ${status.cookies ? "cookies on" : "no cookies"}`;
  } catch (err) {
    $("link-dot").className = "dot bad";
    $("link-dot").title = err.message;
    if (err.offline) setOffline(true);
    else renderSource({ error: err.message });
  }
}

function setOffline(on) {
  if (state.offline === on) return;
  state.offline = on;
  if (on) {
    state.source = null;
    renderOffline();
  }
  renderJobs();
  updateGrab();
}

/** Back on air: check the server again and look the last link up again. */
async function reconnect() {
  state.offline = false;
  renderSource({ placeholder: "Reconnecting…" });
  await checkServer();
  if (state.offline) return;
  renderJobs();
  if (state.lastUrl) tune(state.lastUrl);
  else renderSource({ placeholder: "Open a video or playlist page, or paste a link below." });
}

function renderOffline() {
  const box = $("source");
  box.replaceChildren(
    h(
      "div",
      { class: "offline" },
      h("div", { class: "off-tv" }, h("img", { src: "icons/icon-128.png", alt: "" }), h("span", { class: "sticker red" }, "Off air")),
      h("h1", { class: "title" }, "The server is off"),
      h("p", { class: "meta" }, `Nothing answers at ${state.server}. Start the container and this popup reconnects by itself.`),
      h("pre", {}, "docker compose up -d"),
      h("p", { class: "meta" }, "in the project folder, or:"),
      h("pre", {}, VG.runCommand(state.server)),
      h(
        "div",
        { class: "offline-actions" },
        h("button", { class: "btn yellow small", onclick: reconnect }, "Try again"),
        h("button", { class: "btn small", onclick: () => chrome.runtime.openOptionsPage() }, "Settings"),
      ),
    ),
  );
}

function openStation() {
  const link = state.source?.webpage_url || "";
  chrome.tabs.create({ url: link ? `${state.server}/?url=${encodeURIComponent(link)}` : state.server });
}

// --- tune in --------------------------------------------------------------------

/**
 * Look a link up on the server. `media` is a stream this tab was seen playing: it carries the
 * page's headers, and its title (yt-dlp only sees a file name there).
 */
async function tune(url, { media = null, pageTune = false } = {}) {
  state.lastUrl = url;
  if (state.offline) return;
  state.source = null;
  updateGrab();
  renderSource({ loading: url });
  try {
    const cookies = await VG.cookieTextFor(media ? [media.pageUrl, media.url] : [url]);
    state.sourceExtra = { ...(media ? { headers: media.headers } : {}), ...(cookies ? { cookies } : {}) };
    const source = await VG.api("/info/", { method: "POST", body: { url, ...state.sourceExtra } });
    if (media && source.kind === "video") {
      source.title = media.title || source.title;
      source.webpage_url = media.url;
    }
    state.source = source;
    if (source.kind === "video") {
      state.selectedFormats = new Set(source.formats.length ? [source.formats[0].format_id] : []);
    } else {
      state.selectedEntries = new Set(source.entries.map((e) => e.id));
    }
    renderSource({ source });
  } catch (err) {
    if (err.offline) setOffline(true);
    else if (pageTune && state.detected.length)
      // Not a dead end: the video this page plays is right below
      renderSource({ placeholder: "This site isn't supported directly, but the video it plays is below. Grab it from there." });
    else
      renderSource({
        error: err.message,
        hint: pageTune ? detectHint() : null,
        settings: pageTune && !state.allSites && !state.detected.length,
      });
  }
  updateGrab();
}

/** Fix YouTube's bot check: send this browser's login to the server, then try the link again. */
async function sendYouTubeLogin(button) {
  if (!(await VG.hasYouTube())) {
    // The permission prompt needs a full page; Settings has the button for it
    chrome.tabs.create({ url: chrome.runtime.getURL("options.html#youtube") });
    return;
  }
  button.disabled = true;
  button.textContent = "Sending…";
  const result = await chrome.runtime.sendMessage({ type: "sync-youtube" });
  if (!result.ok) {
    renderSource({ error: result.error });
    return;
  }
  if (state.lastUrl) tune(state.lastUrl, { pageTune: state.lastUrl === state.tabUrl });
}

/** What to try when the page itself isn't supported. */
function detectHint() {
  if (state.detected.length) return "This page's own link didn't work, but the video it plays is listed below. Grab it from there.";
  if (!state.allSites) return "Turn on \"Detect videos on any site\" in Settings, play the video for a moment, then open this popup again.";
  return "Play the video for a few seconds, then open this popup again: the stream it plays will show up here.";
}

const KIND = { hls: "HLS stream", dash: "DASH stream", file: "Video file" };

function renderDetected() {
  const box = $("detected");
  box.hidden = state.detected.length === 0;
  if (box.hidden) return;
  box.replaceChildren(
    h("div", { class: "section-head" }, h("span", { class: "sticker lime" }, "Playing on this page"), h("span", { class: "meta" }, `${state.detected.length} found`)),
    h(
      "ul",
      { class: "media-list" },
      state.detected.map((m) => {
        const where = (() => {
          try {
            const u = new URL(m.url);
            return `${u.hostname}${u.pathname}`;
          } catch {
            return m.url;
          }
        })();
        return h(
          "li",
          { class: "media" },
          h(
            "div",
            { class: "media-info" },
            h("b", {}, `${KIND[m.kind]}${m.ext && m.kind === "file" ? ` · ${m.ext.toUpperCase()}` : ""}${m.size ? ` · ${VG.formatBytes(m.size)}` : ""}`),
            h("small", { title: m.url }, where),
          ),
          m.kind !== "file" && h("button", { class: "btn ghost", title: "List the qualities in this stream", onclick: () => tune(m.url, { media: m }) }, "Qualities"),
          h("button", { class: "btn small yellow", onclick: (e) => grabMedia(m, e.currentTarget) }, "Grab"),
        );
      }),
    ),
  );
}

async function grabMedia(media, button) {
  button.disabled = true;
  try {
    const cookies = await VG.cookieTextFor([media.pageUrl, media.url]);
    const item = { url: media.url, format_id: "best", label: KIND[media.kind], title: media.title || state.tabTitle, headers: media.headers };
    if (cookies) item.cookies = cookies;
    const { jobs } = await VG.api("/jobs/", { method: "POST", body: { items: [item] } });
    await chrome.runtime.sendMessage({ type: "track", ids: jobs.map((j) => j.id) });
    button.textContent = "Queued!";
  } catch (err) {
    if (err.offline) setOffline(true);
    else renderSource({ error: err.message });
    button.disabled = false;
  }
}

function renderSource({ loading, error, hint, settings, placeholder, source }) {
  const box = $("source");
  box.replaceChildren();

  if (loading) {
    box.append(h("div", { class: "placeholder" }, h("span", { class: "spinner" }), "Reading the page…"));
    return;
  }
  if (placeholder) {
    box.append(h("div", { class: "placeholder" }, placeholder));
    return;
  }
  if (error) {
    const cookies = /cookies/i.test(error) && /bot|sign/i.test(error);
    box.append(
      ...[
        h("div", { class: "error" }, error),
        cookies && h("p", { class: "meta" }, "The server needs your YouTube login. The extension can send it from this browser:"),
        cookies && h("button", { class: "btn small yellow", onclick: (e) => sendYouTubeLogin(e.currentTarget) }, "Send my YouTube login"),
        hint && h("p", { class: "meta" }, hint),
        settings && h("button", { class: "btn small yellow", onclick: () => chrome.runtime.openOptionsPage() }, "Open Settings"),
      ].filter(Boolean),
    );
    return;
  }

  if (source.kind === "video") renderVideo(box, source);
  else renderPlaylist(box, source);
}

function renderVideo(box, source) {
  const meta = [source.uploader, source.duration ? VG.formatDuration(source.duration) : "", `${source.formats.length} formats`]
    .filter(Boolean)
    .join(" · ");
  box.append(
    h("div", { class: "thumb", style: `background-image:${safeImage(source.thumbnail)}` }, h("span", { class: "sticker yellow" }, "Single video")),
    h("h1", { class: "title", title: source.title }, source.title),
    h("p", { class: "meta" }, meta),
  );

  const bank = (label, formats) => {
    if (!formats.length) return;
    box.append(h("div", { class: "group-label" }, label));
    box.append(
      h(
        "div",
        { class: "chips" },
        formats.map((f) =>
          h(
            "button",
            {
              class: "chip",
              "aria-pressed": String(state.selectedFormats.has(f.format_id)),
              title: [f.quality, f.note, f.ext.toUpperCase()].filter(Boolean).join(" · "),
              onclick: (e) => {
                const on = !state.selectedFormats.has(f.format_id);
                if (on) state.selectedFormats.add(f.format_id);
                else state.selectedFormats.delete(f.format_id);
                e.currentTarget.setAttribute("aria-pressed", String(on));
                updateGrab();
              },
            },
            h("b", {}, f.quality),
            h("small", {}, f.note || f.ext.toUpperCase()),
            h("small", {}, `${f.ext.toUpperCase()} · ${f.filesize ? `~${VG.formatBytes(f.filesize)}` : "size ?"}`),
          ),
        ),
      ),
    );
  };
  bank("Video + sound", source.formats.filter((f) => f.type === "video"));
  bank("Audio only", source.formats.filter((f) => f.type === "audio"));
}

function renderPlaylist(box, source) {
  box.append(
    h("div", { class: "thumb", style: `background-image:${safeImage(source.thumbnail)}` }, h("span", { class: "sticker teal" }, "Playlist")),
    h("h1", { class: "title", title: source.title }, source.title),
    h("p", { class: "meta" }, [source.uploader, `${source.entries.length} videos`].filter(Boolean).join(" · ")),
    h("div", { class: "group-label" }, "Quality for every video"),
    h(
      "div",
      { class: "chips presets", role: "radiogroup", "aria-label": "Quality for every video" },
      VG.PRESETS.map((p) =>
        h(
          "button",
          {
            class: "chip",
            role: "radio",
            "aria-checked": String(state.preset === p.id),
            onclick: () => {
              state.preset = p.id;
              for (const el of box.querySelectorAll(".presets .chip")) el.setAttribute("aria-checked", String(el.textContent === p.label));
              updateGrab();
            },
          },
          p.label,
        ),
      ),
    ),
    h(
      "ul",
      { class: "entries" },
      source.entries.map((entry, i) =>
        h(
          "li",
          {},
          h(
            "button",
            {
              class: "entry",
              role: "checkbox",
              "aria-checked": String(state.selectedEntries.has(entry.id)),
              title: entry.title,
              onclick: (e) => {
                const on = !state.selectedEntries.has(entry.id);
                if (on) state.selectedEntries.add(entry.id);
                else state.selectedEntries.delete(entry.id);
                e.currentTarget.setAttribute("aria-checked", String(on));
                updateGrab();
              },
            },
            h("div", { class: "mini", style: `background-image:${safeImage(entry.thumbnail)}` }),
            h("span", {}, `${i + 1}. ${entry.title}`),
            h("div", { class: "check" }),
          ),
        ),
      ),
    ),
  );
}

// --- grab ---------------------------------------------------------------------

function pendingItems() {
  const source = state.source;
  if (!source) return [];
  if (source.kind === "video") {
    return source.formats
      .filter((f) => state.selectedFormats.has(f.format_id))
      .map((f) => ({
        url: source.webpage_url,
        format_id: f.format_id,
        label: f.format_id === "best" ? "best" : `${f.quality} ${f.ext}`,
        title: source.title,
        thumbnail: source.thumbnail,
        ...state.sourceExtra,
      }));
  }
  const label = VG.PRESETS.find((p) => p.id === state.preset)?.label ?? state.preset;
  return source.entries
    .filter((e) => state.selectedEntries.has(e.id))
    .map((e) => ({ url: e.url, format_id: state.preset, label, title: e.title, thumbnail: e.thumbnail, group: source.title }));
}

function updateGrab() {
  const items = state.offline ? [] : pendingItems();
  $("grab").disabled = items.length === 0;
  $("grab-count").textContent = `x${items.length}`;
  $("grab-label").textContent =
    state.source?.kind === "playlist" ? `Grab ${VG.PRESETS.find((p) => p.id === state.preset)?.label}` : "Grab";
}

async function grab() {
  const items = pendingItems();
  if (!items.length) return;
  $("grab").disabled = true;
  try {
    const { jobs } = await VG.api("/jobs/", { method: "POST", body: { items } });
    await chrome.runtime.sendMessage({ type: "track", ids: jobs.map((j) => j.id) });
    $("grab-label").textContent = "Queued!";
    setTimeout(updateGrab, 1200);
  } catch (err) {
    renderSource({ error: err.message });
    updateGrab();
  }
}

// --- live jobs -------------------------------------------------------------------

function connectJobs() {
  const stream = new EventSource(`${state.server}/api/jobs/stream/`);
  state.stream = stream;
  // EventSource keeps retrying while the server is down; its first success means it's back
  stream.onopen = () => {
    $("link-dot").className = "dot ok";
    if (state.offline) reconnect();
  };
  stream.onerror = () => {
    $("link-dot").className = "dot bad";
    if (stream.readyState !== EventSource.OPEN) setOffline(true);
  };
  stream.onmessage = (event) => {
    state.jobs = JSON.parse(event.data).jobs;
    renderJobs();
    // The background script saves and announces finished downloads
    chrome.runtime.sendMessage({ type: "jobs", jobs: state.jobs }).catch(() => {});
  };
}

const LOOK = {
  queued: ["Standby", "dark"],
  starting: ["Tuning", "teal"],
  downloading: ["Live", "yellow"],
  processing: ["Mixing", "pink"],
  merging: ["Mixing", "pink"],
  done: ["Ready", "lime"],
  error: ["Lost", "red"],
  cancelled: ["Dropped", "dark"],
};

function renderJobs() {
  const list = $("jobs");
  const jobs = state.jobs.filter((j) => !state.removing.has(j.id)).sort(VG.byPriority).slice(0, 30);
  $("clear").disabled = state.offline || !jobs.some((j) => !VG.isActive(j));
  $("clear-all").disabled = state.offline || !jobs.length;
  if (state.offline) {
    list.replaceChildren(h("li", { class: "empty" }, "Server offline. Downloads show up here once it's back."));
    return;
  }
  if (!jobs.length) {
    list.replaceChildren(h("li", { class: "empty" }, "Dead air. Grab something!"));
    return;
  }
  list.replaceChildren(...jobs.map(jobRow));
}

function jobRow(job) {
  const [tag, tone] = LOOK[job.status];
  const active = VG.isActive(job);
  const mixing = job.status === "merging" || job.status === "processing";
  const info =
    job.status === "downloading"
      ? [job.speed ? `${VG.formatBytes(job.speed)}/s` : "", job.eta != null ? `eta ${VG.formatDuration(job.eta)}` : "", job.stream ? `stream ${job.stream}` : ""]
          .filter(Boolean)
          .join(" · ")
      : job.status === "done"
        ? VG.formatBytes(job.filesize)
        : mixing
          ? job.stage
          : job.status === "queued"
            ? "waiting for a slot"
            : "";

  const button = (title, iconName, onclick) =>
    h("button", { class: "icon-btn", title, "aria-label": title, onclick }, icon(ICONS[iconName]));

  return h(
    "li",
    { class: "job" },
    h("div", { class: "mini", style: `background-image:${safeImage(job.thumbnail)}` }),
    h("div", { class: "job-title", title: job.title || job.url }, job.title || job.url),
    h(
      "div",
      { class: "job-actions" },
      job.status === "done" && button("Save file", "save", () => chrome.downloads.download({ url: `${state.server}/api/jobs/${job.id}/file/` })),
      (job.status === "error" || job.status === "cancelled") &&
        button("Retry", "retry", () =>
          run(VG.api(`/jobs/${job.id}/retry/`, { method: "POST" }).then((j) => chrome.runtime.sendMessage({ type: "track", ids: [j.id] }))),
        ),
      button(active ? "Stop and remove" : "Remove", "cancel", () => removeJobs([job], VG.api(`/jobs/${job.id}/`, { method: "DELETE" }))),
    ),
    h("div", { class: "job-line" }, h("span", { class: `sticker ${tone}` }, tag), h("span", {}, job.label), h("span", { class: "info" }, info)),
    job.status === "error"
      ? h("div", { class: "error" }, job.error || "Failed")
      : job.status !== "cancelled" &&
          h(
            "div",
            { class: "progress" },
            h("div", { class: `meter ${job.status === "done" ? "done" : ""} ${mixing ? "mixing" : ""}` }, h("span", { style: `width:${mixing ? 100 : job.progress}%` })),
            h("span", { class: "pct" }, `${Math.floor(job.progress)}%`),
          ),
    job.notice && h("div", { class: "notice" }, job.notice),
  );
}

function run(promise) {
  promise.catch((err) => renderSource({ error: err.message }));
}

// Hide the jobs right away; they come back only if the server refuses
function removeJobs(jobs, promise) {
  const ids = jobs.map((j) => j.id);
  ids.forEach((id) => state.removing.add(id));
  renderJobs();
  promise.catch((err) => {
    ids.forEach((id) => state.removing.delete(id));
    renderJobs();
    renderSource({ error: err.message });
  });
}

init();
