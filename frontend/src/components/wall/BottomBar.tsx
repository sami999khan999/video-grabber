"use client";

import { Link2, ListVideo, Loader2, Sparkles, Zap } from "lucide-react";

interface BottomBarProps {
  url: string;
  onUrl: (value: string) => void;
  onTune: () => void;
  tuning: boolean;
  grabCount: number;
  grabLabel: string;
  onGrab: () => void;
  grabbing: boolean;
  activeCount: number;
  onDetails: () => void;
}

/** Link field on the left, the big actions on the right (like a shop's x1 / x10 buttons). */
export function BottomBar({ url, onUrl, onTune, tuning, grabCount, grabLabel, onGrab, grabbing, activeCount, onDetails }: BottomBarProps) {
  return (
    <div className="relative z-20 border-t-[2.5px] border-[var(--ink)] bg-[var(--ink)]/90 px-3 py-3 backdrop-blur sm:px-5">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-3 lg:flex-row lg:items-center">
        <form
          className="flex min-w-0 flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!tuning && url.trim()) onTune();
          }}
        >
          <div className="relative min-w-0 flex-1">
            <Link2 size={17} strokeWidth={2.75} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--yellow)]" />
            <label htmlFor="link" className="sr-only">Video or playlist link</label>
            <input
              id="link"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              className="pp-input"
              placeholder="Paste a video or playlist link…"
              value={url}
              onChange={(e) => onUrl(e.target.value)}
            />
          </div>
          <button type="submit" className="pp-btn" disabled={tuning || !url.trim()}>
            {tuning ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} strokeWidth={2.75} className="text-[var(--yellow)]" />}
            <span className="hidden sm:inline">{tuning ? "Tuning" : "Tune in"}</span>
          </button>
        </form>

        <div className="flex gap-2">
          <button className="pp-btn flex-1 lg:flex-none" onClick={onDetails}>
            <ListVideo size={16} strokeWidth={2.75} /> On air
            <span className="pp-count">{activeCount}</span>
          </button>
          <button className="pp-btn is-yellow flex-[2] lg:flex-none lg:min-w-[220px]" onClick={onGrab} disabled={grabbing || grabCount === 0}>
            {grabbing ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} strokeWidth={3} />}
            {grabLabel}
            <span className="pp-count">x{grabCount}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
