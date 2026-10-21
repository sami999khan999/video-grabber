"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Gauge } from "lucide-react";
import { formatBytes, formatLimit, SPEED_LIMITS } from "@/lib/api";

interface SpeedMenuProps {
  /** Bytes per second, all downloads together */
  speed: number;
  /** KB/s, 0 for none; undefined until the server has answered */
  limit?: number;
  onLimit: (kbps: number) => void;
}

/** The total speed in the top bar; it opens a menu to cap it. */
export function SpeedMenu({ speed, limit, onLimit }: SpeedMenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  // A limit set elsewhere (SPEED_LIMIT_KBPS or the API) that isn't one of the choices
  const choices = [...new Set([...SPEED_LIMITS, limit ?? 0])].sort((a, b) => a - b);

  useEffect(() => {
    if (!open) return;
    // The current choice takes focus, so the arrow keys start from it
    list.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const moveFocus = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(list.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  };

  const pick = (kbps: number) => {
    setOpen(false);
    if (kbps !== limit) onLimit(kbps);
  };

  return (
    <div ref={root} className="relative">
      <button
        className={`pp-pill hover:brightness-125 ${open ? "is-open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={limit === undefined}
        onClick={() => setOpen((o) => !o)}
        title={limit ? `Total download speed, limited to ${formatLimit(limit)}` : "Total download speed (click to limit it)"}
      >
        <Gauge size={15} className={limit ? "text-[var(--yellow)]" : "text-[var(--teal)]"} strokeWidth={2.75} />
        <span className="hidden tabular-nums sm:inline">{speed ? `${formatBytes(speed)}/s` : "0 B/s"}</span>
        {!!limit && <span className="hidden tabular-nums text-[var(--yellow)] sm:inline">/ {formatLimit(limit)}</span>}
        <ChevronDown size={14} strokeWidth={3} className={`text-[var(--muted)] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="pp-menu" onKeyDown={moveFocus}>
          <div className="pp-menu-head">Speed limit</div>
          <ul ref={list} role="listbox" aria-label="Speed limit for all downloads">
            {choices.map((kbps) => (
              <li key={kbps}>
                <button role="option" aria-selected={kbps === (limit ?? 0)} className="pp-menu-item" onClick={() => pick(kbps)}>
                  <span>{kbps ? formatLimit(kbps) : "No limit"}</span>
                  {kbps === (limit ?? 0) && <Check size={14} strokeWidth={3.25} />}
                </button>
              </li>
            ))}
          </ul>
          <p className="pp-menu-note">For all downloads together. Running ones follow straight away.</p>
        </div>
      )}
    </div>
  );
}
