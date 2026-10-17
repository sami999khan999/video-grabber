"use client";

import { Archive, KeyRound, ListVideo, Link2 } from "lucide-react";

export type View = "tune" | "queue" | "saved" | "auth";

const ITEMS: { id: View; label: string; icon: typeof Link2; bg: string; tone: string }[] = [
  { id: "tune", label: "Tune in", icon: Link2, bg: "linear-gradient(160deg,#ffe680,#ff8a1f)", tone: "is-yellow" },
  { id: "queue", label: "On air", icon: ListVideo, bg: "linear-gradient(160deg,#7af0e6,#1a8f9b)", tone: "is-teal" },
  { id: "saved", label: "Saved", icon: Archive, bg: "linear-gradient(160deg,#e3ff7a,#5f9f00)", tone: "is-lime" },
  { id: "auth", label: "Cookies", icon: KeyRound, bg: "linear-gradient(160deg,#ffa3c8,#d63a7c)", tone: "is-pink" },
];

interface SideRailProps {
  view: View;
  onView: (view: View) => void;
  counts: Partial<Record<View, number>>;
}

/** Big square tabs with tilted sticker names (a row on small screens). */
export function SideRail({ view, onView, counts }: SideRailProps) {
  return (
    <nav aria-label="Sections">
      <div role="tablist" aria-orientation="vertical" className="flex gap-5 lg:flex-col lg:gap-7">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const count = counts[item.id];
          return (
            <button
              key={item.id}
              role="tab"
              aria-selected={view === item.id}
              onClick={() => onView(item.id)}
              className="pp-rail-item shrink-0"
              style={{ background: item.bg }}
            >
              <Icon size={28} strokeWidth={2.75} color="#08090b" />
              <span className={`pp-sticker ${view === item.id ? item.tone : ""} absolute -bottom-3 left-1/2 -translate-x-1/2 !text-[10px]`}>
                {item.label}
              </span>
              {!!count && (
                <span className="absolute -right-2 -top-2 flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-[var(--ink)] bg-[var(--red)] px-1 text-[11px] font-black text-white">
                  {count > 99 ? "99+" : count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
