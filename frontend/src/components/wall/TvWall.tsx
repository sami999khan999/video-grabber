"use client";

import { Check, Music2, Play, TriangleAlert } from "lucide-react";
import { ago, byPriority, formatBytes, formatDuration, isActive, Job, StationStatus } from "@/lib/api";

type Filler = "static" | "bars" | "off" | { text: string; bg: string; color?: string; icon?: "play" | "music" };
/** A set that reads out the station instead of showing a download; its filler is the idle look */
type Gauge = "speed" | "eta" | "ready" | "login" | "lost";

interface Slot {
  id: string;
  kind: "tv" | "speaker";
  /** Position and size in % of the wall */
  x: number;
  y: number;
  w: number;
  h: number;
  rot?: number;
  z: number;
  body?: string;
  filler?: Filler;
  gauge?: Gauge;
  cones?: "two" | "big-small";
}

// A hand-placed pile: back row on top, the big set in front. Percent of a 16:11 box.
const SLOTS: Slot[] = [
  // Top row
  { id: "t8", kind: "tv", x: 13, y: 9, w: 16, h: 25, rot: 3, z: 1, body: "#cdbb92", filler: "off", gauge: "lost" },
  { id: "t9", kind: "tv", x: 30, y: 1, w: 16, h: 25, rot: -2, z: 1, body: "#d6d8dd", filler: { text: "REC", bg: "#ff3d3d", color: "#fff" }, gauge: "speed" },
  { id: "s6", kind: "speaker", x: 46, y: 9, w: 8, h: 25, z: 1, cones: "big-small" },
  { id: "t10", kind: "tv", x: 54, y: 7, w: 17, h: 27, rot: 1, z: 1, body: "#3a3e45", filler: "static" },
  { id: "t11", kind: "tv", x: 71, y: 19, w: 15, h: 25, rot: 4, z: 1, body: "#d6d8dd", filler: { text: "", bg: "#b6f400", icon: "play" }, gauge: "ready" },
  // Middle row
  { id: "t4", kind: "tv", x: 2, y: 33, w: 18, h: 26, rot: -3, z: 2, body: "#3a3e45", filler: { text: "", bg: "#22d3c5", icon: "music" }, gauge: "login" },
  { id: "s4", kind: "speaker", x: 20, y: 37, w: 9, h: 29, z: 2, cones: "two" },
  { id: "t5", kind: "tv", x: 29, y: 25, w: 18, h: 35, rot: -1, z: 2, body: "#d6d8dd", filler: "static" },
  { id: "t6", kind: "tv", x: 47, y: 33, w: 17, h: 27, rot: 2, z: 2, body: "#5fb7b0", filler: { text: "HD", bg: "#ffd43b" }, gauge: "eta" },
  { id: "s5", kind: "speaker", x: 64, y: 31, w: 10, h: 31, z: 2, cones: "two" },
  { id: "t7", kind: "tv", x: 74, y: 43, w: 18, h: 27, rot: -2, z: 2, body: "#cdbb92", filler: "bars" },
  // Bottom row
  { id: "s1", kind: "speaker", x: 0, y: 57, w: 12, h: 43, z: 3, cones: "two" },
  { id: "t1", kind: "tv", x: 12, y: 66, w: 17, h: 34, rot: -2, z: 3, body: "#cdbb92", filler: "bars" },
  { id: "main", kind: "tv", x: 28, y: 58, w: 31, h: 42, z: 4, body: "#e3e4e8" },
  { id: "s2", kind: "speaker", x: 59, y: 61, w: 11, h: 39, z: 3, cones: "big-small" },
  { id: "t2", kind: "tv", x: 70, y: 70, w: 15, h: 30, rot: 2, z: 3, body: "#3a3e45", filler: "static" },
  { id: "t3", kind: "tv", x: 85, y: 69, w: 15, h: 31, rot: 3, z: 3, body: "#d6d8dd", filler: { text: "VG", bg: "#ff5fa2" } },
];

// The static and colour-bar sets show downloads, most visible first; the last one counts the rest
const JOB_ORDER = ["t5", "t1", "t2", "t7", "t10"];

interface TvWallProps {
  jobs: Job[];
  /** What's tuned in, shown on the big set */
  image?: string;
  title?: string;
  tuning: boolean;
  live: boolean;
  status?: StationStatus;
  /** Bytes per second all downloads together pull */
  speed: number;
  onPickJob: (job: Job) => void;
  onOpen: (view: "queue" | "saved" | "auth") => void;
}

export function TvWall({ jobs, image, title, tuning, live, status, speed, onPickJob, onOpen }: TvWallProps) {
  // Live downloads get the most visible sets
  const ordered = [...jobs].sort(byPriority);
  const shown = ordered.slice(0, JOB_ORDER.length);
  const overflow = ordered.length - shown.length;
  const jobBySlot = new Map(shown.map((job, i) => [JOB_ORDER[i], job]));
  const receiving = jobs.filter((j) => j.status === "downloading").length;

  return (
    <div className={`pp-wall ${live ? "pp-live" : ""}`} aria-label="Download wall">
      {SLOTS.map((slot) => (
        <div
          key={slot.id}
          className="pp-unit"
          style={{
            left: `${slot.x}%`,
            top: `${slot.y}%`,
            width: `${slot.w}%`,
            height: `${slot.h}%`,
            zIndex: slot.z,
            transform: slot.rot ? `rotate(${slot.rot}deg)` : undefined,
          }}
        >
          <div className="pp-bob h-full w-full" style={{ animationDelay: `${(slot.x % 7) * -0.13}s` }}>
            {slot.kind === "speaker" ? (
              <Speaker cones={slot.cones} />
            ) : slot.gauge ? (
              <GaugeTv slot={slot} gauge={slot.gauge} jobs={jobs} status={status} speed={speed} onOpen={onOpen} />
            ) : slot.id === "main" ? (
              <MainTv image={image} title={title} tuning={tuning} />
            ) : (
              <SmallTv
                slot={slot}
                job={jobBySlot.get(slot.id)}
                extra={slot.id === JOB_ORDER[JOB_ORDER.length - 1] && overflow > 0 ? overflow : 0}
                onPickJob={onPickJob}
              />
            )}
          </div>
        </div>
      ))}

      {/* Round badge: how many are coming in right now */}
      <div
        className="pp-badge absolute z-10 h-[17%] w-auto aspect-square rotate-[-10deg] flex-col"
        style={{ left: "1%", top: "6%" }}
        aria-label={`${receiving} downloading`}
      >
        <span className="text-[clamp(14px,3.2vw,40px)] leading-none">{receiving}</span>
        <span className="text-[clamp(7px,0.8vw,11px)] font-black uppercase tracking-wider">live</span>
      </div>
    </div>
  );
}

function Speaker({ cones }: { cones?: Slot["cones"] }) {
  return (
    <div className="pp-speaker" aria-hidden>
      {cones === "big-small" ? (
        <>
          <div className="pp-cone is-small" />
          <div className="pp-cone" />
        </>
      ) : (
        <>
          <div className="pp-cone" />
          <div className="pp-cone" />
        </>
      )}
    </div>
  );
}

function TvBody({
  body,
  children,
  led,
  onClick,
  label,
}: {
  body?: string;
  children: React.ReactNode;
  led?: { color: string; blink?: boolean };
  onClick?: () => void;
  label?: string;
}) {
  const inner = (
    <>
      <div className="pp-tv-screen">{children}</div>
      <div className="pp-tv-foot">
        <span className={`pp-tv-led ${led ? "is-on" : ""} ${led?.blink ? "is-blink" : ""}`} style={led ? { ["--led" as string]: led.color } : undefined} />
        <span className="flex h-full items-center gap-[6%]">
          <span className="pp-tv-knob" />
          <span className="pp-tv-knob" />
        </span>
      </div>
    </>
  );
  const style = { ["--body" as string]: body };
  return onClick ? (
    <button className="pp-tv" style={style} onClick={onClick} aria-label={label} title={label}>
      {inner}
    </button>
  ) : (
    <div className="pp-tv" style={style} aria-hidden>
      {inner}
    </div>
  );
}

interface Reading {
  value: string;
  caption?: string;
  bg: string;
  led: { color: string; blink?: boolean };
  view?: "queue" | "saved" | "auth";
}

/** What a gauge set shows right now; null when there is nothing to report (it shows its filler) */
function readGauge(gauge: Gauge, jobs: Job[], speed: number, status?: StationStatus): Reading | null {
  const downloading = jobs.filter((j) => j.status === "downloading");
  switch (gauge) {
    case "speed": {
      return speed > 0 ? { value: `${formatBytes(speed)}/s`, caption: "incoming", bg: "#ff3d3d", led: { color: "#ff3d3d", blink: true } } : null;
    }
    case "eta": {
      // Downloads run side by side, so the queue is done when the slowest one is
      const etas = downloading.map((j) => j.eta).filter((eta): eta is number => eta != null);
      return etas.length ? { value: formatDuration(Math.max(...etas)), caption: "left", bg: "#ffd43b", led: { color: "#ffd43b" } } : null;
    }
    case "ready": {
      const ready = jobs.filter((j) => j.status === "done").length;
      return ready ? { value: `${ready}`, caption: "ready", bg: "#b6f400", led: { color: "#b6f400" }, view: "saved" } : null;
    }
    case "lost": {
      const lost = jobs.filter((j) => j.status === "error").length;
      return lost ? { value: `${lost}`, caption: "lost", bg: "#ff3d3d", led: { color: "#ff3d3d", blink: true }, view: "queue" } : null;
    }
    case "login": {
      if (!status) return null;
      if (!status.cookies) return { value: "No login", caption: "YouTube", bg: "#ff5fa2", led: { color: "#ff3d3d" }, view: "auth" };
      const since = status.cookies_detail?.updated_at;
      return { value: "Logged in", caption: since ? ago(since) : "YouTube", bg: "#22d3c5", led: { color: "#b6f400" }, view: "auth" };
    }
  }
}

function GaugeTv({
  slot,
  gauge,
  jobs,
  status,
  speed,
  onOpen,
}: {
  slot: Slot;
  gauge: Gauge;
  jobs: Job[];
  status?: StationStatus;
  speed: number;
  onOpen: (view: "queue" | "saved" | "auth") => void;
}) {
  const reading = readGauge(gauge, jobs, speed, status);
  if (!reading) {
    return (
      <TvBody body={slot.body}>
        <FillerScreen filler={slot.filler} />
      </TvBody>
    );
  }
  const { view } = reading;
  const label = [reading.value, reading.caption].filter(Boolean).join(" ");
  return (
    <TvBody body={slot.body} led={reading.led} onClick={view ? () => onOpen(view) : undefined} label={label}>
      <div className="pp-screen-fill flex flex-col items-center justify-center gap-[8%] px-[8%]" style={{ background: reading.bg }}>
        <span className="pp-screen-big max-w-full truncate -rotate-3 rounded-[0.2em] border-[3px] border-[#08090b] bg-white px-[0.3em] text-[clamp(9px,16cqh,40px)] text-[#08090b] shadow-[4px_4px_0_#08090b]">
          {reading.value}
        </span>
        {reading.caption && <span className="pp-screen-small max-w-full truncate uppercase text-[#08090b]">{reading.caption}</span>}
      </div>
    </TvBody>
  );
}

function FillerScreen({ filler }: { filler?: Filler }) {
  if (!filler || filler === "static") return <div className="pp-screen-fill pp-static" />;
  if (filler === "bars") return <div className="pp-screen-fill pp-bars" />;
  if (filler === "off") return <div className="pp-screen-fill pp-off" />;
  const Icon = filler.icon === "play" ? Play : filler.icon === "music" ? Music2 : null;
  return (
    <div className="pp-screen-fill flex items-center justify-center" style={{ background: filler.bg }}>
      {Icon ? (
        <Icon className="h-[45%] w-[45%]" strokeWidth={3} color="#08090b" fill={filler.icon === "play" ? "#08090b" : "none"} />
      ) : (
        <span className="pp-screen-big -rotate-6 rounded-[0.2em] border-[3px] border-[#08090b] bg-white px-[0.3em] italic shadow-[4px_4px_0_#08090b]" style={{ color: filler.color === "#fff" ? "#ff3d3d" : "#08090b" }}>
          {filler.text}
        </span>
      )}
    </div>
  );
}

const JOB_LOOK: Record<Job["status"], { tag: string; tone: string; led: string; blink?: boolean }> = {
  queued: { tag: "Standby", tone: "is-dark", led: "#8f99a6" },
  starting: { tag: "Tuning", tone: "is-teal", led: "#22d3c5", blink: true },
  downloading: { tag: "Live", tone: "is-yellow", led: "#ffd43b", blink: true },
  processing: { tag: "Mixing", tone: "is-pink", led: "#9b6bff", blink: true },
  merging: { tag: "Mixing", tone: "is-pink", led: "#9b6bff", blink: true },
  paused: { tag: "Paused", tone: "is-teal", led: "#22d3c5" },
  done: { tag: "Ready", tone: "is-lime", led: "#b6f400" },
  error: { tag: "Lost", tone: "is-red", led: "#ff3d3d" },
  cancelled: { tag: "Dropped", tone: "is-dark", led: "#59616c" },
};

function SmallTv({
  slot,
  job,
  extra,
  onPickJob,
}: {
  slot: Slot;
  job?: Job;
  extra: number;
  onPickJob: (job: Job) => void;
}) {
  if (!job) {
    return (
      <TvBody body={slot.body}>
        <FillerScreen filler={slot.filler} />
      </TvBody>
    );
  }

  const look = JOB_LOOK[job.status];
  const active = isActive(job);
  const showPicture = job.thumbnail && job.status !== "error" && job.status !== "cancelled";
  const waiting = job.status === "queued" || job.status === "paused";

  return (
    <TvBody
      body={slot.body}
      led={{ color: look.led, blink: look.blink }}
      onClick={() => onPickJob(job)}
      label={`${job.title || job.url}: ${look.tag}${active ? ` ${Math.floor(job.progress)}%` : ""}`}
    >
      <div key={job.id} className="pp-switch pp-screen-fill">
        {showPicture ? (
          <div
            className="pp-screen-fill pp-thumb"
            style={{
              backgroundImage: `url("${job.thumbnail}")`,
              filter: waiting ? "grayscale(1) brightness(0.55)" : undefined,
            }}
          />
        ) : (
          <div className={`pp-screen-fill ${job.status === "cancelled" ? "pp-off" : "pp-static opacity-60"}`} />
        )}
        <div className="pp-screen-fill bg-gradient-to-t from-black/85 via-black/10 to-black/30" />

        <div className="absolute inset-[6%] z-2 flex flex-col justify-between">
          <div className="flex items-start justify-between gap-1">
            <span className={`pp-sticker ${look.tone} !px-[0.5em] !py-0 !text-[clamp(7px,8cqh,13px)] !shadow-[2px_2px_0_#08090b]`}>{look.tag}</span>
            {job.status === "done" && <Check className="h-[22cqh] w-[22cqh] rounded-full border-2 border-black bg-[var(--lime)] p-[2%] text-black" strokeWidth={4} />}
            {job.status === "error" && <TriangleAlert className="h-[22cqh] w-[22cqh] text-[var(--red)] drop-shadow-[0_2px_0_#000]" strokeWidth={3} />}
          </div>

          {active && job.status !== "queued" && (
            <div className="pp-screen-big text-center text-white drop-shadow-[0_3px_0_#000]">{Math.floor(job.progress)}%</div>
          )}

          <div>
            <div className="pp-screen-small mb-[3%] truncate text-white drop-shadow-[0_1px_0_#000]">{job.title || job.url}</div>
            {job.status !== "error" && job.status !== "cancelled" && (
              <div className={`pp-screen-bar ${job.status === "done" ? "is-done" : ""} ${job.status === "merging" || job.status === "processing" ? "is-merging" : ""}`}>
                <span style={{ width: `${job.status === "merging" || job.status === "processing" ? 100 : job.progress}%` }} />
              </div>
            )}
          </div>
        </div>

        {extra > 0 && (
          <div className="absolute inset-0 z-3 flex items-center justify-center bg-black/70">
            <span className="pp-screen-big text-[var(--yellow)]">+{extra}</span>
          </div>
        )}
      </div>
    </TvBody>
  );
}

function MainTv({ image, title, tuning }: { image?: string; title?: string; tuning: boolean }) {
  return (
    <TvBody body="#e3e4e8" led={{ color: tuning ? "#22d3c5" : image ? "#ff3d3d" : "#59616c", blink: tuning }}>
      {tuning ? (
        <>
          <div className="pp-screen-fill pp-static" />
          <div className="pp-screen-fill flex items-center justify-center">
            <span className="pp-sticker is-teal !text-[clamp(10px,10cqh,22px)]">Tuning…</span>
          </div>
        </>
      ) : image ? (
        <div key={image} className="pp-switch pp-screen-fill">
          <div className="pp-screen-fill pp-thumb" style={{ backgroundImage: `url("${image}")` }} />
          <div className="pp-screen-fill bg-gradient-to-t from-black/70 via-transparent to-transparent" />
          <span className="pp-sticker is-yellow absolute left-[5%] top-[6%] z-2 !text-[clamp(8px,7cqh,14px)]">On air</span>
          {title && (
            <div className="pp-screen-small absolute bottom-[6%] left-[5%] right-[5%] z-2 truncate text-white drop-shadow-[0_2px_0_#000]">{title}</div>
          )}
        </div>
      ) : title ? (
        <>
          <div className="pp-screen-fill pp-bars" />
          <div className="pp-screen-fill flex flex-col items-center justify-center gap-[6%] px-[8%]">
            <span className="pp-sticker is-yellow !text-[clamp(8px,7cqh,14px)]">Tuned in</span>
            <span className="pp-sticker max-w-full truncate !rotate-2 !text-[clamp(9px,9cqh,20px)]">{title}</span>
          </div>
        </>
      ) : (
        <>
          <div className="pp-screen-fill pp-static" />
          <div className="pp-screen-fill flex flex-col items-center justify-center gap-[6%]">
            <span className="pp-sticker !text-[clamp(10px,11cqh,26px)]">No signal</span>
            <span className="pp-sticker is-dark !rotate-3 !text-[clamp(7px,6cqh,13px)]">Paste a link below</span>
          </div>
        </>
      )}
    </TvBody>
  );
}
