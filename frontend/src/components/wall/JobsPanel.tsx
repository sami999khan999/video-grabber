"use client";

import { Download, ListX, RotateCcw, Trash2, TriangleAlert, X, Zap } from "lucide-react";
import { byPriority, formatBytes, formatDuration, isActive, Job, saveJobFile } from "@/lib/api";

const LOOK: Record<Job["status"], { text: string; tone: string }> = {
  queued: { text: "Standby", tone: "is-dark" },
  starting: { text: "Tuning", tone: "is-teal" },
  downloading: { text: "Live", tone: "is-yellow" },
  processing: { text: "Mixing", tone: "is-pink" },
  merging: { text: "Mixing", tone: "is-pink" },
  done: { text: "Ready", tone: "is-lime" },
  error: { text: "Lost", tone: "is-red" },
  cancelled: { text: "Dropped", tone: "is-dark" },
};

interface JobsPanelProps {
  mode: "queue" | "saved";
  jobs: Job[];
  autoSave: boolean;
  onAutoSave: (value: boolean) => void;
  onRetry: (job: Job) => void;
  onPrioritize: (job: Job) => void;
  onRemove: (job: Job) => void;
  onClear: () => void;
  onRemoveAll: () => void;
  onOpenCookies: () => void;
}

export function JobsPanel({ mode, jobs, autoSave, onAutoSave, onRetry, onPrioritize, onRemove, onClear, onRemoveAll, onOpenCookies }: JobsPanelProps) {
  const list = (mode === "saved" ? jobs.filter((j) => j.status === "done") : jobs.filter((j) => j.status !== "done")).sort(byPriority);
  const finished = jobs.filter((j) => !isActive(j)).length;

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div>
        <span className={`pp-sticker ${mode === "saved" ? "is-lime" : "is-teal"}`}>
          {mode === "saved" ? "Saved files" : "On air"}
        </span>
        <h2 className="pp-gold mt-3 text-3xl sm:text-4xl">{mode === "saved" ? "Ready to take home" : "Coming in"}</h2>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[13px] font-bold">
          <button
            role="switch"
            aria-checked={autoSave}
            aria-label="Save files automatically when they finish"
            className="pp-toggle"
            onClick={() => onAutoSave(!autoSave)}
          />
          Auto-save when done
        </label>
        <div className="ml-auto flex gap-2">
          <button className="pp-btn is-small" onClick={onClear} disabled={finished === 0}>
            <Trash2 size={14} strokeWidth={2.75} /> Clear finished
          </button>
          <button className="pp-btn is-small" onClick={onRemoveAll} disabled={jobs.length === 0} title="Stop and remove every download">
            <ListX size={14} strokeWidth={2.75} /> Remove all
          </button>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border-[2.5px] border-dashed border-white/15 p-8 text-center">
          <span className="pp-sticker is-dark">{mode === "saved" ? "Nothing saved yet" : "Dead air"}</span>
          <span className="text-[13px] font-semibold text-[var(--muted)]">
            {mode === "saved" ? "Finished downloads show up here for a few hours." : "Tune in a link and grab something."}
          </span>
        </div>
      ) : (
        <ul className="pp-scroll -mr-2 min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-2">
          {list.map((job) => (
            <JobRow key={job.id} job={job} onRetry={onRetry} onPrioritize={onPrioritize} onRemove={onRemove} onOpenCookies={onOpenCookies} />
          ))}
        </ul>
      )}
    </div>
  );
}

function JobRow({
  job,
  onRetry,
  onPrioritize,
  onRemove,
  onOpenCookies,
}: {
  job: Job;
  onRetry: (job: Job) => void;
  onPrioritize: (job: Job) => void;
  onRemove: (job: Job) => void;
  onOpenCookies: () => void;
}) {
  const look = LOOK[job.status];
  const active = isActive(job);
  const mixing = job.status === "merging" || job.status === "processing";
  const botBlock = job.status === "error" && /cookies/i.test(job.error || "");

  const detail =
    job.status === "done"
      ? `${formatBytes(job.filesize)} · ${job.filename ?? ""}`
      : job.status === "downloading"
        ? [
            job.total_bytes ? `${formatBytes(job.downloaded_bytes)} / ${formatBytes(job.total_bytes)}` : formatBytes(job.downloaded_bytes),
            job.speed ? `${formatBytes(job.speed)}/s` : "",
            job.eta != null ? `eta ${formatDuration(job.eta)}` : "",
            job.stream ? `stream ${job.stream}` : "",
          ]
            .filter(Boolean)
            .join(" · ")
        : mixing
          ? "Joining video and sound"
          : job.status === "queued"
            ? job.stage || "Waiting for a free slot"
            : "";

  return (
    <li className="rounded-2xl border-[2.5px] border-[var(--ink)] bg-[linear-gradient(180deg,#1d232b,#12161b)] p-2.5 shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.06)]">
      <div className="flex items-start gap-3">
        <span
          className="hidden h-14 w-24 shrink-0 rounded-xl border-2 border-[var(--ink)] bg-[#0a0c0f] bg-cover bg-center sm:block"
          style={job.thumbnail ? { backgroundImage: `url("${job.thumbnail}")` } : undefined}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-[14px] font-bold" title={job.title || job.url}>{job.title || job.url}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className={`pp-sticker ${look.tone} !rotate-0 !px-1.5 !py-0 !text-[10px] !shadow-none`}>{look.text}</span>
                {job.priority && <span className="pp-sticker is-yellow !rotate-0 !px-1.5 !py-0 !text-[10px] !shadow-none">Priority</span>}
                <span className="rounded-md bg-white/10 px-1.5 text-[11px] font-bold uppercase">{job.label}</span>
                {job.group && <span className="truncate text-[11px] font-semibold text-[var(--muted)]">{job.group}</span>}
              </div>
            </div>
            <div className="flex shrink-0 gap-1.5">
              {job.status === "done" && (
                <button className="pp-btn is-icon is-yellow" onClick={() => saveJobFile(job)} aria-label="Save file" title="Save file">
                  <Download size={15} strokeWidth={3} />
                </button>
              )}
              {active && !mixing && (
                <button
                  className={`pp-btn is-icon ${job.priority ? "is-yellow" : ""}`}
                  onClick={() => onPrioritize(job)}
                  aria-label={job.priority ? "Stop prioritizing" : "Prioritize"}
                  aria-pressed={job.priority}
                  title={job.priority ? "Stop prioritizing" : "Prioritize: download this one first, slow the others down"}
                >
                  <Zap size={15} strokeWidth={2.75} />
                </button>
              )}
              {(job.status === "error" || job.status === "cancelled") && (
                <button className="pp-btn is-icon" onClick={() => onRetry(job)} aria-label="Retry" title="Retry">
                  <RotateCcw size={15} strokeWidth={2.75} />
                </button>
              )}
              <button className="pp-btn is-icon" onClick={() => onRemove(job)} aria-label="Remove" title={active ? "Stop and remove" : "Remove"}>
                <X size={15} strokeWidth={2.75} />
              </button>
            </div>
          </div>

          {job.status === "error" ? (
            <div className="mt-2 flex items-start gap-2 rounded-xl border-2 border-[var(--red)]/50 bg-[var(--red)]/10 px-2.5 py-1.5 text-[12px] font-semibold text-[#ffc2c2]">
              <TriangleAlert size={14} className="mt-0.5 shrink-0 text-[var(--red)]" strokeWidth={2.75} />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-3 [overflow-wrap:anywhere]">{job.error}</span>
                {botBlock && (
                  <button className="mt-1 font-black text-[var(--yellow)] underline underline-offset-2" onClick={onOpenCookies}>
                    Add cookies
                  </button>
                )}
              </span>
            </div>
          ) : job.status !== "cancelled" ? (
            <div className="mt-2 flex items-center gap-2">
              <div className={`pp-screen-bar is-row flex-1 ${job.status === "done" ? "is-done" : ""} ${mixing ? "is-merging" : ""}`}>
                <span style={{ width: `${mixing ? 100 : job.progress}%` }} />
              </div>
              <span className="w-11 shrink-0 text-right text-[13px] font-black tabular-nums">{Math.floor(job.progress)}%</span>
            </div>
          ) : null}

          {detail && <div className="mt-1 truncate text-[11px] font-semibold tabular-nums text-[var(--muted)]">{detail}</div>}
          {job.notice && (
            <div className="mt-1.5 flex items-start gap-1.5 text-[11px] font-bold text-[var(--yellow)]">
              <TriangleAlert size={12} className="mt-px shrink-0" strokeWidth={3} />
              {job.notice}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
