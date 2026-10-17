// Builds the ready-to-load extension folders from src/:
//   release/chrome   (Chrome, Edge, Brave, Opera: background service worker)
//   release/firefox  (Firefox 128+: background scripts, add-on id)
// Run with `node build.mjs` (no dependencies). The release folders are committed so anyone can
// load the extension without building it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, "src");
const release = path.join(root, "release");

const base = JSON.parse(fs.readFileSync(path.join(src, "manifest.base.json"), "utf8"));

const targets = {
  chrome: {
    ...base,
    background: { service_worker: "background.js" },
  },
  firefox: {
    ...base,
    background: { scripts: ["shared.js", "background.js"] },
    browser_specific_settings: {
      gecko: { id: "video-grabber@sami999", strict_min_version: "128.0" },
    },
  },
};

for (const [name, manifest] of Object.entries(targets)) {
  const out = path.join(release, name);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    if (entry === "manifest.base.json") continue;
    fs.cpSync(path.join(src, entry), path.join(out, entry), { recursive: true });
  }
  fs.writeFileSync(path.join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`built release/${name} (v${manifest.version})`);
}
