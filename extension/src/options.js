const $ = (id) => document.getElementById(id);

const show = (ok, text) => {
  const box = document.createElement("div");
  box.className = ok ? "ok" : "error";
  box.textContent = text;
  $("result").replaceChildren(box);
};

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
  return `Connected: ${status.max_parallel} downloads at a time, ${status.cookies ? "cookies on" : "no cookies"}.`;
}

$("test").addEventListener("click", async () => {
  try {
    show(true, await test(VG.normalizeServer($("server").value)));
  } catch (err) {
    show(false, err.message);
  }
});

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const server = VG.normalizeServer($("server").value);
    const message = await test(server);
    await chrome.storage.local.set({ server, autoSave: $("autoSave").checked, notify: $("notify").checked });
    $("server").value = server;
    show(true, `Saved. ${message}`);
  } catch (err) {
    show(false, err.message);
  }
});

load();
