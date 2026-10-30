"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Job, saveJobFile, videoApi } from "@/lib/api";

/**
 * Live job list from the server (Server-Sent Events). The browser reconnects by itself
 * if the stream drops. With `autoSave`, jobs this tab queued (see `track`) are handed to
 * the browser's download manager as soon as they finish.
 */
export function useJobs(autoSave: boolean) {
  const [jobs, setJobs] = useState<Job[]>([]);
  // Bytes per second all downloads together pull, as the server measures it
  const [speed, setSpeed] = useState(0);
  const [connected, setConnected] = useState(false);
  const pending = useRef(new Set<string>());
  const autoSaveRef = useRef(autoSave);

  useEffect(() => {
    autoSaveRef.current = autoSave;
  }, [autoSave]);

  const handle = useCallback((next: Job[]) => {
    for (const job of next) {
      if (!pending.current.has(job.id)) continue;
      if (job.status === "done") {
        pending.current.delete(job.id);
        if (autoSaveRef.current) saveJobFile(job);
      } else if (job.status === "error" || job.status === "cancelled") {
        pending.current.delete(job.id);
      }
    }
    setJobs(next);
  }, []);

  useEffect(() => {
    const source = new EventSource(videoApi.streamUrl());
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (event) => {
      setConnected(true);
      const data = JSON.parse(event.data);
      handle(data.jobs);
      setSpeed(data.speed ?? 0);
    };
    return () => source.close();
  }, [handle]);

  const track = useCallback((ids: string[]) => {
    ids.forEach((id) => pending.current.add(id));
  }, []);

  return { jobs, speed, connected, track };
}
