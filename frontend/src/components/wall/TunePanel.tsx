"use client";

import { AudioLines, Clock, Film, ListVideo, User } from "lucide-react";
import { formatBytes, formatDuration, PlaylistInfo, SourceInfo, VideoInfo } from "@/lib/api";

// For playlists: a cap that applies to every video (each gets the best it has up to that)
export const PRESETS = [
  { id: "best", label: "Best" },
  { id: "2160p", label: "4K" },
  { id: "1440p", label: "1440p" },
  { id: "1080p", label: "1080p" },
  { id: "720p", label: "720p" },
  { id: "480p", label: "480p" },
  { id: "audio", label: "M4A", audio: true },
  { id: "audio-mp3", label: "MP3", audio: true },
];

interface TunePanelProps {
  source: SourceInfo | null;
  selectedFormats: Set<string>;
  onToggleFormat: (id: string) => void;
  selectedEntries: Set<string>;
  onToggleEntry: (id: string) => void;
  onToggleAllEntries: () => void;
  preset: string;
  onPreset: (id: string) => void;
  /** Look up just one video of the playlist instead */
  onTuneVideo: (url: string) => void;
  /** Fetch the next page of an endless list (history, feeds, Mixes) */
  onLoadMore: () => void;
  loadingMore: boolean;
}

export function TunePanel(props: TunePanelProps) {
  const { source } = props;
  if (!source) return <Idle />;
  if (source.kind === "video") return <VideoView info={source} {...props} />;
  return <PlaylistView info={source} {...props} />;
}

function Heading({ kicker, title, tone = "is-yellow" }: { kicker: string; title: string; tone?: string }) {
  return (
    <div>
      <span className={`pp-sticker ${tone}`}>{kicker}</span>
      <h2 className="pp-gold mt-3 line-clamp-2 text-3xl leading-[1.05] sm:text-4xl">{title}</h2>
    </div>
  );
}

function Idle() {
  const steps = [
    ["1", "Paste a video or playlist link in the bar below and hit Tune in."],
    ["2", "Pick resolutions, audio, or which playlist videos you want."],
    ["3", "Grab. Every download gets its own TV on the wall, with live progress."],
  ];
  return (
    <div className="flex flex-col gap-6">
      <Heading kicker="Now open" title="Video Grabber" />
      <p className="max-w-md text-[15px] font-medium leading-relaxed text-[#c9d2dc]">
        A wall of TVs for yt-dlp. YouTube and the other supported sites, several downloads at a
        time, whole playlists in one go.
      </p>
      <ol className="space-y-3">
        {steps.map(([n, text]) => (
          <li key={n} className="flex items-start gap-3">
            <span className="pp-badge h-9 w-9 shrink-0 text-base">{n}</span>
            <span className="pt-1.5 text-[14px] font-semibold text-[var(--paper)]">{text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Meta({ items }: { items: [typeof User, string][] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] font-semibold text-[#c9d2dc]">
      {items.map(([Icon, text]) => (
        <span key={text} className="flex items-center gap-1.5">
          <Icon size={14} strokeWidth={2.5} className="text-[var(--yellow)]" />
          {text}
        </span>
      ))}
    </div>
  );
}

function VideoView({ info, selectedFormats, onToggleFormat }: { info: VideoInfo } & TunePanelProps) {
  const videos = info.formats.filter((f) => f.type === "video");
  const audios = info.formats.filter((f) => f.type === "audio");
  const meta: [typeof User, string][] = [];
  if (info.uploader) meta.push([User, info.uploader]);
  if (info.duration) meta.push([Clock, formatDuration(info.duration)]);
  meta.push([Film, `${info.formats.length} formats`]);

  const bank = (title: string, list: VideoInfo["formats"], audio?: boolean) => (
    <div>
      <div className="mb-2 text-[12px] font-black uppercase tracking-wider text-[var(--muted)]">{title}</div>
      <div className="flex flex-wrap gap-2">
        {list.map((f) => (
          <button
            key={f.format_id}
            className="pp-chip"
            aria-pressed={selectedFormats.has(f.format_id)}
            onClick={() => onToggleFormat(f.format_id)}
          >
            <span className="flex items-center gap-1 text-[15px] font-black">
              {audio && <AudioLines size={13} strokeWidth={3} />}
              {f.quality}
            </span>
            {f.note && <span className="text-[11px] font-black opacity-90">{f.note}</span>}
            <span className="text-[11px] font-bold uppercase opacity-70">
              {f.ext} · {f.filesize ? `~${formatBytes(f.filesize)}` : "size ?"}
            </span>
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <Heading kicker="Single video" title={info.title} />
      <Meta items={meta} />
      <div className="pp-scroll -mr-2 min-h-0 flex-1 space-y-4 overflow-y-auto pr-2">
        {bank("Video + sound", videos)}
        {audios.length > 0 && bank("Audio only", audios, true)}
        {videos.length <= 2 && (
          <p className="rounded-xl border-2 border-white/10 bg-white/5 px-3 py-2 text-[12px] font-semibold text-[var(--muted)]">
            Only a few qualities came back. For YouTube that can mean the site is limiting this
            server; remove the cookies or try again later.
          </p>
        )}
      </div>
      <p className="text-[12px] font-semibold text-[var(--muted)]">Pick one or more, then Grab.</p>
    </div>
  );
}

function PlaylistView({
  info,
  selectedEntries,
  onToggleEntry,
  onToggleAllEntries,
  preset,
  onPreset,
  onTuneVideo,
  onLoadMore,
  loadingMore,
}: { info: PlaylistInfo } & TunePanelProps) {
  const meta: [typeof User, string][] = [];
  if (info.uploader) meta.push([User, info.uploader]);
  meta.push([ListVideo, `${info.entries.length}${info.next_start ? "+" : ""} videos`]);
  const allOn = selectedEntries.size === info.entries.length;

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <Heading kicker="Playlist" title={info.title} tone="is-teal" />
      <Meta items={meta} />
      {info.current && (
        <button
          className="pp-btn is-small self-start"
          onClick={() => onTuneVideo(`https://www.youtube.com/watch?v=${info.current}`)}
          title="Grab only the video that was playing, with the full choice of qualities"
        >
          <Film size={14} strokeWidth={2.75} /> Just the playing video
        </button>
      )}

      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Quality for every video" title="Each video gets the best it has, up to this">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            role="radio"
            aria-checked={preset === p.id}
            onClick={() => onPreset(p.id)}
            className="pp-chip !min-w-0 !px-3.5 !py-1.5 text-[14px] font-black"
          >
            {p.audio && <AudioLines size={13} strokeWidth={3} className="mr-1 inline" />}
            {p.label}
          </button>
        ))}
        <button className="pp-btn is-small ml-auto" onClick={onToggleAllEntries}>
          {allOn ? "None" : "All"}
        </button>
      </div>

      <ul className="pp-scroll -mr-2 min-h-0 flex-1 space-y-2 overflow-y-auto pr-2">
        {info.entries.map((entry, i) => {
          const on = selectedEntries.has(entry.id);
          return (
            <li key={entry.id}>
              <button
                role="checkbox"
                aria-checked={on}
                onClick={() => onToggleEntry(entry.id)}
                className={`flex w-full items-center gap-3 rounded-2xl border-[2.5px] border-[var(--ink)] p-2 text-left transition ${
                  on ? "bg-[#1d232b]" : "bg-[#0d1014] opacity-55"
                }`}
              >
                <span className="w-6 shrink-0 text-center text-[13px] font-black text-[var(--yellow)]">{i + 1}</span>
                <span
                  className="h-11 w-[72px] shrink-0 rounded-lg border-2 border-[var(--ink)] bg-[#0a0c0f] bg-cover bg-center"
                  style={entry.thumbnail ? { backgroundImage: `url("${entry.thumbnail}")` } : undefined}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2">
                    {entry.id === info.current && (
                      <span className="pp-sticker is-yellow shrink-0 !rotate-0 !px-1.5 !py-0 !text-[10px] !shadow-none">Now playing</span>
                    )}
                    <span className="truncate text-[14px] font-bold">{entry.title}</span>
                  </span>
                  <span className="block text-[12px] font-semibold text-[var(--muted)]">
                    {entry.duration ? formatDuration(entry.duration) : "--:--"}
                    {entry.uploader ? ` · ${entry.uploader}` : ""}
                  </span>
                </span>
                <span className="pp-toggle pointer-events-none" aria-checked={on} aria-hidden />
              </button>
            </li>
          );
        })}
        {info.next_start && (
          <li>
            <button className="pp-btn is-small w-full justify-center" onClick={onLoadMore} disabled={loadingMore}>
              {loadingMore ? "Loading…" : "Load more"}
              <span className="pp-count">{info.entries.length} shown</span>
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}
