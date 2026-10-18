"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { BottomBar } from "@/components/wall/BottomBar";
import { CookiesPanel } from "@/components/wall/CookiesPanel";
import { JobsPanel } from "@/components/wall/JobsPanel";
import { SideRail, View } from "@/components/wall/SideRail";
import { TopBar } from "@/components/wall/TopBar";
import { PRESETS, TunePanel } from "@/components/wall/TunePanel";
import { TvWall } from "@/components/wall/TvWall";
import { useJobs } from "@/hooks/use-jobs";
import { isActive, Job, NewJob, SourceInfo, videoApi } from "@/lib/api";

const AUTO_SAVE_KEY = "video-grabber:auto-save";
const AUTO_SAVE_EVENT = "video-grabber:auto-save";

/** Auto-save preference, remembered per browser (on by default, and when storage is blocked). */
function useAutoSave(): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(
    (onChange) => {
      window.addEventListener(AUTO_SAVE_EVENT, onChange);
      window.addEventListener("storage", onChange);
      return () => {
        window.removeEventListener(AUTO_SAVE_EVENT, onChange);
        window.removeEventListener("storage", onChange);
      };
    },
    () => {
      try {
        return localStorage.getItem(AUTO_SAVE_KEY) !== "0";
      } catch {
        return true;
      }
    },
    () => true,
  );

  const set = (next: boolean) => {
    try {
      localStorage.setItem(AUTO_SAVE_KEY, next ? "1" : "0");
    } catch {
      // storage blocked: nothing to remember it in
    }
    window.dispatchEvent(new Event(AUTO_SAVE_EVENT));
  };

  return [value, set];
}

const isBotBlock = (message?: string | null) => !!message && /cookies/i.test(message) && /bot|sign/i.test(message);

export default function Home() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>("tune");
  const [url, setUrl] = useState("");
  const [source, setSource] = useState<SourceInfo | null>(null);
  const [selectedFormats, setSelectedFormats] = useState<Set<string>>(new Set());
  const [selectedEntries, setSelectedEntries] = useState<Set<string>>(new Set());
  const [preset, setPreset] = useState("best");
  const [actionError, setActionError] = useState<string | null>(null);
  const [autoSave, changeAutoSave] = useAutoSave();

  const { jobs: serverJobs, connected, track } = useJobs(autoSave);
  // Newest first
  const jobs = useMemo(() => [...serverJobs].sort((a, b) => b.created_at - a.created_at), [serverJobs]);
  const { data: status } = useQuery({ queryKey: ["status"], queryFn: videoApi.status });

  const tune = useMutation({
    mutationFn: (link: string) => videoApi.fetchInfo(link),
    onSuccess: (info, link) => {
      setUrl((current) => current || link);
      setSource(info);
      setView("tune");
      setActionError(null);
      if (info.kind === "video") {
        setSelectedFormats(new Set(info.formats.length ? [info.formats[0].format_id] : []));
      } else {
        setSelectedEntries(new Set(info.entries.map((e) => e.id)));
      }
    },
  });

  // /?url=... (from the browser extension) opens straight on that link
  const { mutate: tuneLink } = tune;
  useEffect(() => {
    const link = new URLSearchParams(window.location.search).get("url");
    if (!link) return;
    window.history.replaceState(null, "", window.location.pathname);
    tuneLink(link);
  }, [tuneLink]);

  const queue = useMutation({
    mutationFn: (items: NewJob[]) => videoApi.queue(items),
    onSuccess: ({ jobs: created }) => {
      track(created.map((j) => j.id));
      setActionError(null);
    },
    onError: (err: Error) => setActionError(err.message),
  });

  const run = (action: Promise<Job | void | { removed: number }>, trackResult = false) => {
    action
      .then((result) => {
        if (trackResult && result && "id" in result) track([result.id]);
        setActionError(null);
      })
      .catch((err: Error) => setActionError(err.message));
  };

  const toggle = (set: (fn: (s: Set<string>) => Set<string>) => void) => (id: string) =>
    set((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // What the big yellow button would queue right now
  const grab = useMemo((): { items: NewJob[]; label: string } => {
    if (source?.kind === "video") {
      const items = source.formats
        .filter((f) => selectedFormats.has(f.format_id))
        .map((f) => ({
          url: source.webpage_url,
          format_id: f.format_id,
          label: f.format_id === "best" ? "best" : `${f.quality} ${f.ext}`,
          title: source.title,
          thumbnail: source.thumbnail,
        }));
      return { items, label: "Grab" };
    }
    if (source?.kind === "playlist") {
      const label = PRESETS.find((p) => p.id === preset)?.label ?? preset;
      const items = source.entries
        .filter((e) => selectedEntries.has(e.id))
        .map((e) => ({ url: e.url, format_id: preset, label, title: e.title, thumbnail: e.thumbnail, group: source.title }));
      return { items, label: `Grab ${label}` };
    }
    return { items: [], label: "Grab" };
  }, [source, selectedFormats, selectedEntries, preset]);

  const active = jobs.filter(isActive);
  const live = active.length > 0;
  const speed = jobs.reduce((sum, j) => sum + (j.status === "downloading" && j.speed ? j.speed : 0), 0);
  const saved = jobs.filter((j) => j.status === "done").length;
  const failed = jobs.filter((j) => j.status === "error").length;
  const tuneError = tune.error?.message;

  const reset = () => {
    setSource(null);
    setUrl("");
    setView("tune");
    tune.reset();
  };

  return (
    <div className="relative flex min-h-dvh flex-col lg:h-dvh">
      <div className="pp-stage" />
      <div className="pp-watermark" aria-hidden>ON AIR</div>

      <TopBar
        connected={connected}
        receiving={jobs.filter((j) => j.status === "downloading").length}
        saved={saved}
        speed={speed}
        cookies={status?.cookies}
        onHome={reset}
        onAuth={() => setView("auth")}
      />

      <main className="relative z-10 mx-auto grid w-full max-w-[1600px] flex-1 gap-6 px-3 py-5 sm:px-5 lg:min-h-0 lg:grid-cols-[80px_minmax(0,1.35fr)_minmax(360px,1fr)] lg:gap-8 lg:py-6">
        <div className="order-2 overflow-x-auto pb-4 lg:order-none lg:overflow-visible lg:pb-0 lg:pt-4">
          <SideRail
            view={view}
            onView={setView}
            counts={{ queue: active.length + failed, saved }}
          />
        </div>

        <section className="order-1 flex min-h-0 items-center lg:order-none" aria-label="TV wall">
          <div className="w-full">
            <TvWall
              jobs={jobs}
              image={source?.thumbnail}
              title={source?.title}
              tuning={tune.isPending}
              live={live}
              status={status}
              onPickJob={(job) => setView(job.status === "done" ? "saved" : "queue")}
              onOpen={setView}
            />
          </div>
        </section>

        <aside className="pp-card order-3 flex min-h-[420px] flex-col overflow-hidden lg:order-none lg:min-h-0">
          <div className="pp-stripes h-2 shrink-0 border-b-[2.5px] border-[var(--ink)]" />
          <div className="flex min-h-0 flex-1 flex-col p-5 sm:p-6">
            {(tuneError || actionError) && view !== "auth" && (
              <div role="alert" className="mb-4 rounded-xl border-2 border-[var(--red)]/60 bg-[var(--red)]/10 px-3 py-2 text-[13px] font-semibold text-[#ffc2c2] [overflow-wrap:anywhere]">
                {tuneError || actionError}
                {isBotBlock(tuneError || actionError) && (
                  <button className="ml-2 font-black text-[var(--yellow)] underline underline-offset-2" onClick={() => setView("auth")}>
                    Add cookies
                  </button>
                )}
              </div>
            )}

            {view === "tune" && (
              <TunePanel
                source={source}
                selectedFormats={selectedFormats}
                onToggleFormat={toggle(setSelectedFormats)}
                selectedEntries={selectedEntries}
                onToggleEntry={toggle(setSelectedEntries)}
                onToggleAllEntries={() =>
                  source?.kind === "playlist" &&
                  setSelectedEntries((s) => (s.size === source.entries.length ? new Set() : new Set(source.entries.map((e) => e.id))))
                }
                preset={preset}
                onPreset={setPreset}
              />
            )}
            {(view === "queue" || view === "saved") && (
              <JobsPanel
                mode={view}
                jobs={jobs}
                autoSave={autoSave}
                onAutoSave={changeAutoSave}
                onCancel={(job) => run(videoApi.cancel(job.id))}
                onRetry={(job) => run(videoApi.retry(job.id), true)}
                onRemove={(job) => run(videoApi.remove(job.id))}
                onClear={() => run(videoApi.clearFinished())}
                onOpenCookies={() => setView("auth")}
              />
            )}
            {view === "auth" && (
              <CookiesPanel cookies={status?.cookies} detail={status?.cookies_detail} onChanged={() => queryClient.invalidateQueries({ queryKey: ["status"] })} />
            )}
          </div>
        </aside>
      </main>

      <BottomBar
        url={url}
        onUrl={setUrl}
        onTune={() => tune.mutate(url)}
        tuning={tune.isPending}
        grabCount={grab.items.length}
        grabLabel={grab.label}
        onGrab={() => {
          queue.mutate(grab.items);
          setView("queue");
        }}
        grabbing={queue.isPending}
        activeCount={active.length}
        onDetails={() => setView("queue")}
      />
    </div>
  );
}
