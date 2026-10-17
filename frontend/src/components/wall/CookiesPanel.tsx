"use client";

import { useRef, useState } from "react";
import { FileUp, Loader2, Trash2 } from "lucide-react";
import { StationStatus, videoApi } from "@/lib/api";

interface CookiesPanelProps {
  cookies: StationStatus["cookies"] | undefined;
  onChanged: () => void;
}

/** Explains the "confirm you're not a bot" block and takes a cookies.txt upload. */
export function CookiesPanel({ cookies, onChanged }: CookiesPanelProps) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await videoApi.uploadCookies(file);
      setMessage({ ok: true, text: `Loaded ${result.count} cookies. Try your link again.` });
      onChanged();
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await videoApi.deleteCookies();
      setMessage({ ok: true, text: "Uploaded cookies removed." });
      onChanged();
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    // Scrolls inside the side panel when the window is short
    <div className="pp-scroll -mr-2 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pr-2">
      <div>
        <span className="pp-sticker is-pink">Backstage pass</span>
        <h2 className="pp-gold mt-3 text-3xl sm:text-4xl">YouTube cookies</h2>
      </div>

      <div className="flex items-center gap-3">
        <span
          className={`pp-sticker !rotate-0 ${cookies ? "is-lime" : "is-dark"}`}
        >
          {cookies === "upload" ? "Uploaded cookies in use" : cookies === "file" ? "Mounted cookies file in use" : "No cookies"}
        </span>
      </div>

      <div className="flex flex-wrap gap-3">
        <input
          ref={input}
          type="file"
          accept=".txt,text/plain"
          className="sr-only"
          id="cookies-file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload(file);
          }}
        />
        <button className="pp-btn is-yellow" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <FileUp size={16} strokeWidth={2.75} />}
          Upload cookies.txt
        </button>
        {cookies === "upload" && (
          <button className="pp-btn" disabled={busy} onClick={remove}>
            <Trash2 size={15} strokeWidth={2.75} /> Remove
          </button>
        )}
      </div>

      {message && (
        <p
          role="status"
          className={`rounded-xl border-2 px-3 py-2 text-[13px] font-semibold ${
            message.ok ? "border-[var(--lime)]/50 bg-[var(--lime)]/10 text-[#e4ff9e]" : "border-[var(--red)]/50 bg-[var(--red)]/10 text-[#ffc2c2]"
          }`}
        >
          {message.text}
        </p>
      )}

      <p className="text-[14px] font-medium leading-relaxed text-[#c9d2dc]">
        YouTube sometimes refuses servers with <b className="text-white">&quot;Sign in to confirm you&apos;re not a bot&quot;</b>.
        That&apos;s about this machine&apos;s IP address (lots of requests, a VPN, or a data center), not
        the link. Cookies from a browser that is logged in to YouTube get past it.
      </p>

      <ol className="space-y-2.5 text-[13px] font-semibold">
        {[
          "Log in to YouTube in your browser (a spare account is safest).",
          'Install a cookie exporter such as "Get cookies.txt LOCALLY" and export youtube.com as cookies.txt.',
          "Upload that file here. It stays on this server (in the data volume) until you remove it.",
        ].map((text, i) => (
          <li key={i} className="flex items-start gap-3">
            <span className="pp-badge h-7 w-7 shrink-0 text-[13px]">{i + 1}</span>
            <span className="pt-1">{text}</span>
          </li>
        ))}
      </ol>

      <p className="text-[12px] font-semibold text-[var(--muted)]">
        Anyone who can open this page can use the account behind these cookies, so keep the app private.
      </p>
    </div>
  );
}
