// In production the frontend is served by the backend, so the API is on the same origin.
// `next dev` runs on :3000, so it talks to the Django dev server directly.
export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ??
  (process.env.NODE_ENV === "development" ? "http://127.0.0.1:8000/api" : "/api");

export interface VideoFormat {
  format_id: string;
  ext: string;
  quality: string;
  /** Extra detail: "4K · 60fps · HDR", "AAC · original", "192 kbps · converted" */
  note: string;
  height: number;
  filesize: number | null;
  type: "video" | "audio";
}

export interface VideoInfo {
  kind: "video";
  title: string;
  duration: number;
  thumbnail: string;
  uploader: string;
  webpage_url: string;
  formats: VideoFormat[];
}

export interface PlaylistEntry {
  id: string;
  url: string;
  title: string;
  duration: number;
  thumbnail: string;
  uploader: string;
}

export interface PlaylistInfo {
  kind: "playlist";
  title: string;
  thumbnail: string;
  uploader: string;
  webpage_url: string;
  entries: PlaylistEntry[];
}

export type SourceInfo = VideoInfo | PlaylistInfo;

export type JobStatus =
  | "queued"
  | "starting"
  | "downloading"
  | "processing"
  | "merging"
  | "done"
  | "error"
  | "cancelled";

export interface Job {
  id: string;
  url: string;
  format_id: string;
  label: string;
  title: string;
  thumbnail: string;
  group: string | null;
  status: JobStatus;
  stage: string;
  progress: number;
  downloaded_bytes: number;
  total_bytes: number | null;
  speed: number | null;
  eta: number | null;
  stream: string;
  filename: string | null;
  filesize: number | null;
  error: string | null;
  /** E.g. the file came out below the chosen quality */
  notice: string | null;
  created_at: number;
  finished_at: number | null;
}

export interface NewJob {
  url: string;
  format_id: string;
  label?: string;
  title?: string;
  thumbnail?: string;
  group?: string;
}

export interface StationStatus {
  max_parallel: number;
  /** Where the cookies come from: uploaded from the page, a mounted file, or none */
  cookies: "upload" | "file" | null;
  /** For uploaded cookies: synced by the browser extension or uploaded as a file, and when */
  cookies_detail: { origin: "file" | "extension"; updated_at: number; count: number | null } | null;
}

export const ACTIVE_STATUSES: JobStatus[] = ["queued", "starting", "downloading", "processing", "merging"];
export const isActive = (job: Job) => ACTIVE_STATUSES.includes(job.status);

// Live downloads first, then mixing, waiting and finished; newest first within each group
const STATUS_RANK: Record<JobStatus, number> = {
  downloading: 0,
  merging: 1,
  processing: 1,
  starting: 2,
  queued: 3,
  error: 4,
  done: 5,
  cancelled: 6,
};
export const byPriority = (a: Job, b: Job) =>
  STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.created_at - a.created_at;

// Views return { error: "..." }; the DRF exception handler returns { error: { details: "..." } }
const readError = async (res: Response, fallback: string): Promise<string> => {
  try {
    const data = await res.json();
    if (typeof data.error === "string") return data.error;
    return data.error?.details || fallback;
  } catch {
    return fallback;
  }
};

const request = async <T>(path: string, init: RequestInit, fallback: string): Promise<T> => {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  if (!res.ok) throw new Error(await readError(res, fallback));
  return res.status === 204 ? (undefined as T) : res.json();
};

export const videoApi = {
  status: () => request<StationStatus>("/status/", { method: "GET" }, "Station offline."),

  fetchInfo: (url: string) =>
    request<SourceInfo>(
      "/info/",
      { method: "POST", body: JSON.stringify({ url: url.trim() }) },
      "Failed to fetch video info.",
    ),

  queue: (items: NewJob[]) =>
    request<{ jobs: Job[] }>(
      "/jobs/",
      { method: "POST", body: JSON.stringify({ items }) },
      "Failed to queue the download.",
    ),

  cancel: (id: string) => request<Job>(`/jobs/${id}/cancel/`, { method: "POST" }, "Failed to cancel."),
  retry: (id: string) => request<Job>(`/jobs/${id}/retry/`, { method: "POST" }, "Failed to retry."),
  remove: (id: string) => request<void>(`/jobs/${id}/`, { method: "DELETE" }, "Failed to remove."),
  clear: (all = false) =>
    request<{ removed: number }>(
      "/jobs/clear/",
      { method: "POST", body: JSON.stringify({ all }) },
      "Failed to clear.",
    ),

  uploadCookies: async (file: File) => {
    const body = new FormData();
    body.append("file", file);
    // No JSON content type here: the browser sets the multipart boundary itself
    const res = await fetch(`${API_BASE}/cookies/`, { method: "POST", body });
    if (!res.ok) throw new Error(await readError(res, "Failed to upload cookies."));
    return (await res.json()) as { cookies: StationStatus["cookies"]; count: number };
  },
  deleteCookies: () =>
    request<{ cookies: StationStatus["cookies"] }>("/cookies/", { method: "DELETE" }, "Failed to remove cookies."),

  fileUrl: (id: string) => `${API_BASE}/jobs/${id}/file/`,
  streamUrl: () => `${API_BASE}/jobs/stream/`,
};

// Hands the finished file to the browser's own download manager (nothing is held in memory)
export const saveJobFile = (job: Job) => {
  const a = document.createElement("a");
  a.href = videoApi.fileUrl(job.id);
  a.download = job.filename || "";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
};

export const formatBytes = (bytes: number | null | undefined) => {
  if (!bytes) return "--";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
};

export const formatDuration = (seconds: number | null | undefined) => {
  if (!seconds && seconds !== 0) return "--:--";
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h ? m.toString().padStart(2, "0") : m.toString();
  return `${h ? `${h}:` : ""}${mm}:${s.toString().padStart(2, "0")}`;
};

/** How long ago a unix time (seconds) was, e.g. "5 min ago" */
export const ago = (seconds: number) => {
  const minutes = Math.round((Date.now() / 1000 - seconds) / 60);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
};
