"use client";

import { CheckCheck, Gauge, Home, KeyRound, Radio, Tv } from "lucide-react";
import { formatBytes, formatLimit } from "@/lib/api";

interface TopBarProps {
  connected: boolean;
  receiving: number;
  saved: number;
  speed: number;
  /** KB/s, 0 for none */
  speedLimit?: number;
  cookies: "upload" | "file" | null | undefined;
  onHome: () => void;
  onAuth: () => void;
}

export function TopBar({ connected, receiving, saved, speed, speedLimit, cookies, onHome, onAuth }: TopBarProps) {
  return (
    <header className="relative z-20 flex items-center justify-between gap-3 border-b-[2.5px] border-[var(--ink)] bg-[var(--ink)]/90 px-3 py-2.5 backdrop-blur sm:px-5">
      <div className="flex min-w-0 items-center gap-2.5">
        <button
          onClick={onHome}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-[2.5px] border-[var(--red)] bg-[var(--ink-2)] text-[var(--red)] shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.1)]"
          aria-label="Back to the start"
          title="Back to the start"
        >
          <Radio size={18} strokeWidth={2.75} />
        </button>
        <span className="pp-pill !pl-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10">
            <Home size={13} strokeWidth={2.75} />
          </span>
          <span className="truncate text-[15px] font-black italic tracking-tight">Video Grabber</span>
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span className="pp-pill hidden md:inline-flex" title="Downloading now">
          <Tv size={15} className="text-[var(--yellow)]" strokeWidth={2.75} />
          <span className="tabular-nums">{receiving.toString().padStart(2, "0")}</span>
        </span>
        <span className="pp-pill hidden md:inline-flex" title="Finished files">
          <CheckCheck size={15} className="text-[var(--lime)]" strokeWidth={2.75} />
          <span className="tabular-nums">{saved.toString().padStart(2, "0")}</span>
        </span>
        <span className="pp-pill hidden sm:inline-flex" title={speedLimit ? `Total download speed (limited to ${formatLimit(speedLimit)})` : "Total download speed"}>
          <Gauge size={15} className={speedLimit ? "text-[var(--yellow)]" : "text-[var(--teal)]"} strokeWidth={2.75} />
          <span className="tabular-nums">{speed ? `${formatBytes(speed)}/s` : "0 B/s"}</span>
          {!!speedLimit && <span className="text-[var(--muted)] tabular-nums">/ {formatLimit(speedLimit)}</span>}
        </span>
        <button className="pp-pill hover:brightness-125" onClick={onAuth} title="YouTube cookies">
          <KeyRound size={15} className={cookies ? "text-[var(--lime)]" : "text-[var(--muted)]"} strokeWidth={2.75} />
          <span className="hidden sm:inline">{cookies ? "Cookies on" : "No cookies"}</span>
        </button>
        <span className="pp-pill !px-3" title={connected ? "Live updates connected" : "Reconnecting"}>
          <span className={`h-2.5 w-2.5 rounded-full ${connected ? "bg-[var(--lime)] shadow-[0_0_8px_var(--lime)]" : "pp-blink bg-[var(--red)]"}`} />
          <span className="hidden lg:inline">{connected ? "Live" : "Offline"}</span>
        </span>
      </div>
    </header>
  );
}
