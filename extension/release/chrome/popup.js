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
  bolt: ["M13 2 3 14h9l-1 8 10-12h-9l1-8z"],
  pause: ["M8 5v14", "M16 5v14"],
  play: ["M7 4v16l13-8z"],
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
  $("speed-limit").addEventListener("change", (e) => setSpeedLimit(Number(e.target.value)));
  $("link-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const link = $("link").value.trim();
    if (link) {
      showTab("page");
      tune(link);
    }
  });
  $("tab-page").addEventListener("click", () => showTab("page"));
  $("tab-jobs").addEventListener("click", () => showTab("jobs"));
  state.scrollbars = [GlassScroll.attach($("page-panel")), GlassScroll.attach($("jobs-panel"))];

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
    const parallel = status.max_parallel ? `${status.max_parallel} parallel` : "all at once";
    $("link-dot").title = `Connected · ${parallel} · ${status.cookies ? "cookies on" : "no cookies"}`;
    // Servers older than the speed limit don't send it
    if (status.speed_limit_kbps != null) renderSpeedLimit(status.speed_limit_kbps);
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
    if (VG.isYouTube(media ? media.pageUrl : url)) await VG.freshYouTubeLogin();
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
    setTimeout(() => showTab("jobs"), 600);
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

/** Small picture beside the kind, title and details: the list below gets the room. */
function sourceHead(source, kind, tone, meta) {
  return h(
    "div",
    { class: "src-head" },
    h("div", { class: "src-thumb", style: `background-image:${safeImage(source.thumbnail)}` }),
    h(
      "div",
      { class: "src-text" },
      h("span", { class: `sticker ${tone}` }, kind),
      h("h1", { class: "title", title: source.title }, source.title),
      h("p", { class: "meta" }, meta.filter(Boolean).join(" · ")),
    ),
  );
}

function renderVideo(box, source) {
  box.append(sourceHead(source, "Single video", "yellow", [source.uploader, source.duration ? VG.formatDuration(source.duration) : ""]));

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
            h("span", { class: "chip-top" }, h("b", {}, f.quality), f.filesize ? h("small", { class: "size" }, `~${VG.formatBytes(f.filesize)}`) : ""),
            h("small", {}, [f.note, f.ext.toUpperCase()].filter(Boolean).join(" · ")),
          ),
        ),
      ),
    );
  };
  bank("Video + sound", source.formats.filter((f) => f.type === "video"));
  bank("Audio only", source.formats.filter((f) => f.type === "audio"));
}

function renderPlaylist(box, source) {
  const url = source.webpage_url || "";
  const [kind, tone] = /[?&]list=RD/.test(url) ? ["Mix", "pink"] : /youtube\.com\/(feed\/|$)/.test(url) ? ["Feed", "lime"] : ["Playlist", "teal"];
  const count = `${source.entries.length}${source.next_start ? "+" : ""} videos`;
  const allOn = source.entries.every((e) => state.selectedEntries.has(e.id));

  box.append(
    sourceHead(source, kind, tone, [source.uploader, count]),
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
      "div",
      { class: "list-tools" },
      h(
        "button",
        {
          class: "btn ghost",
          onclick: () => {
            state.selectedEntries = allOn ? new Set() : new Set(source.entries.map((e) => e.id));
            redrawSource();
          },
        },
        allOn ? "Select none" : "Select all",
      ),
      h("span", { id: "selected-count", class: "meta" }),
      // box.append would print a missing button as the text "undefined"
      source.current
        ? h(
            "button",
            {
              class: "btn ghost",
              title: "Grab only the video that was playing, with the full choice of qualities",
              onclick: () => tune(`https://www.youtube.com/watch?v=${source.current}`),
            },
            "Only the playing one",
          )
        : "",
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
            h("span", { class: "num" }, i + 1),
            h("div", { class: "mini", style: `background-image:${safeImage(entry.thumbnail)}` }),
            h(
              "span",
              { class: "entry-text" },
              h("span", { class: "entry-title" }, entry.title),
              h(
                "small",
                {},
                entry.id === source.current ? h("b", { class: "now" }, "Now playing") : "",
                [entry.duration ? VG.formatDuration(entry.duration) : "", entry.uploader].filter(Boolean).join(" · "),
              ),
            ),
            h("div", { class: "check" }),
          ),
        ),
      ),
    ),
    // History, feeds and Mixes come 100 at a time
    source.next_start
      ? h("button", { class: "btn load-more", onclick: (e) => loadMore(e.currentTarget) }, "Load more", h("span", { class: "count" }, `${source.entries.length} shown`))
      : "",
  );
}

/** Draw the current source again, keeping the place in the panel. */
function redrawSource() {
  const panel = $("page-panel");
  const scrolled = panel.scrollTop;
  renderSource({ source: state.source });
  panel.scrollTop = scrolled;
  updateGrab();
}

/** Fetch the next page of an endless list and add it below, selected like the rest. */
async function loadMore(button) {
  const source = state.source;
  button.disabled = true;
  button.firstChild.textContent = "Loading…";
  try {
    const more = await VG.api("/info/", { method: "POST", body: { url: source.webpage_url, start: source.next_start, ...state.sourceExtra } });
    if (state.source !== source) return; // tuned to something else meanwhile
    const known = new Set(source.entries.map((e) => e.id));
    const added = more.entries.filter((e) => !known.has(e.id));
    source.entries.push(...added);
    added.forEach((e) => state.selectedEntries.add(e.id));
    source.next_start = more.next_start;
    redrawSource();
  } catch (err) {
    button.disabled = false;
    button.firstChild.textContent = "Load more";
    button.title = err.message;
  }
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
  const counter = $("selected-count");
  if (counter && state.source?.kind === "playlist") counter.textContent = `${state.selectedEntries.size} selected`;
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
    // Show them coming in
    setTimeout(() => {
      updateGrab();
      showTab("jobs");
    }, 600);
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
  paused: ["Paused", "teal"],
  done: ["Ready", "lime"],
  error: ["Lost", "red"],
  cancelled: ["Dropped", "dark"],
};

/** "page" (what this tab offers) or "jobs" (the downloads). */
// --- speed limit ---------------------------------------------------------------

// KB/s for all downloads together; 0 is no limit
const SPEED_LIMITS = [0, 256, 512, 1024, 2048, 5120, 10240, 20480, 51200];
const formatLimit = (kbps) => (kbps < 1024 ? `${kbps} KB/s` : `${+(kbps / 1024).toFixed(1)} MB/s`);

function renderSpeedLimit(kbps) {
  // A limit set elsewhere that isn't one of the choices still shows
  const choices = [...new Set([...SPEED_LIMITS, kbps])].sort((a, b) => a - b);
  $("speed-limit").replaceChildren(
    ...choices.map((n) => h("option", { value: String(n) }, n ? `Max ${formatLimit(n)}` : "No speed limit")),
  );
  $("speed-limit").value = String(kbps);
  $("speed-wrap").classList.toggle("on", kbps > 0);
  $("speed-wrap").hidden = false;
}

async function setSpeedLimit(kbps) {
  $("speed-limit").disabled = true;
  try {
    const { speed_limit_kbps } = await VG.api("/settings/", { method: "POST", body: { speed_limit_kbps: kbps } });
    renderSpeedLimit(speed_limit_kbps);
    $("speed-wrap").title = "The most all downloads together may use";
  } catch (err) {
    // Back to what the server has, with the reason on hover
    $("speed-wrap").title = err.message;
    checkServer();
  } finally {
    $("speed-limit").disabled = false;
  }
}

function showTab(name) {
  const jobs = name === "jobs";
  $("tab-page").setAttribute("aria-selected", String(!jobs));
  $("tab-jobs").setAttribute("aria-selected", String(jobs));
  $("page-panel").hidden = jobs;
  $("jobs-panel").hidden = !jobs;
  // Grabbing is about this page; the downloads have their own buttons
  $("grab-bar").hidden = jobs;
  state.scrollbars?.forEach((s) => s.update());
}

function renderJobs() {
  const list = $("jobs");
  const jobs = state.jobs.filter((j) => !state.removing.has(j.id)).sort(VG.byPriority).slice(0, 30);
  const active = jobs.filter(VG.isActive).length;
  $("jobs-count").hidden = !jobs.length;
  // Running ones when there are any, otherwise everything listed
  $("jobs-count").textContent = active || jobs.length;
  $("jobs-count").classList.toggle("live", active > 0);
  $("clear").disabled = state.offline || !jobs.some((j) => !VG.isActive(j));
  $("clear-all").disabled = state.offline || !jobs.length;
  if (state.offline) {
    list.replaceChildren(h("li", { class: "empty" }, "Server offline. Downloads show up here once it's back."));
    return;
  }
  if (!jobs.length) {
    list.replaceChildren(h("li", { class: "empty" }, "Nothing downloading. Pick something on This page and hit Grab."));
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
            ? job.stage || "waiting for a slot"
            : job.status === "paused"
              ? "picks up where it stopped"
              : "";

  const button = (title, iconName, onclick, extra = {}) =>
    h("button", { class: "icon-btn", title, "aria-label": title, onclick, ...extra }, icon(ICONS[iconName]));

  return h(
    "li",
    { class: "job" },
    h("div", { class: "mini", style: `background-image:${safeImage(job.thumbnail)}` }),
    h("div", { class: "job-title", title: job.title || job.url }, job.title || job.url),
    h(
      "div",
      { class: "job-actions" },
      (VG.canPause(job) || job.status === "paused") &&
        button(
          job.status === "paused" ? "Resume" : "Pause",
          job.status === "paused" ? "play" : "pause",
          () => run(VG.api(`/jobs/${job.id}/${job.status === "paused" ? "resume" : "pause"}/`, { method: "POST" })),
          { class: `icon-btn ${job.status === "paused" ? "on" : ""}` },
        ),
      VG.canPause(job) &&
        button(
          job.priority ? "Stop prioritizing" : "Prioritize: download this one first, slow the others down",
          "bolt",
          () => run(VG.api(`/jobs/${job.id}/priority/`, { method: "POST", body: { on: !job.priority } })),
          { class: `icon-btn ${job.priority ? "on" : ""}`, "aria-pressed": String(!!job.priority) },
        ),
      job.status === "done" && button("Save file", "save", () => chrome.downloads.download({ url: `${state.server}/api/jobs/${job.id}/file/` })),
      (job.status === "error" || job.status === "cancelled") &&
        button("Retry", "retry", () =>
          run(VG.api(`/jobs/${job.id}/retry/`, { method: "POST" }).then((j) => chrome.runtime.sendMessage({ type: "track", ids: [j.id] }))),
        ),
      button(active ? "Stop and remove" : "Remove", "cancel", () => removeJobs([job], VG.api(`/jobs/${job.id}/`, { method: "DELETE" }))),
    ),
    h(
      "div",
      { class: "job-line" },
      h("span", { class: `sticker ${tone}` }, tag),
      h("span", {}, job.label),
      h("span", { class: "info" }, info),
    ),
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
