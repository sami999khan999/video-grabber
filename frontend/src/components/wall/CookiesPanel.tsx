"use client";

import { useRef, useState } from "react";
import { FileUp, Loader2, Trash2 } from "lucide-react";
import { ago, StationStatus, videoApi } from "@/lib/api";

interface CookiesPanelProps {
  cookies: StationStatus["cookies"] | undefined;
  detail: StationStatus["cookies_detail"] | undefined;
  onChanged: () => void;
}

/** Explains the "confirm you're not a bot" block and takes a cookies.txt upload. */
export function CookiesPanel({ cookies, detail, onChanged }: CookiesPanelProps) {
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

      <div className="flex flex-wrap items-center gap-3">
        <span className={`pp-sticker !rotate-0 ${cookies ? "is-lime" : "is-dark"}`}>
          {detail?.origin === "extension"
            ? "Synced from your browser"
            : cookies === "upload"
              ? "Uploaded cookies in use"
              : cookies === "file"
                ? "Mounted cookies file in use"
                : "No cookies"}
        </span>
        {detail && (
          <span className="text-[12px] font-semibold text-[var(--muted)]">
            {detail.origin === "extension" ? "sent by the extension" : "uploaded"} {ago(detail.updated_at)}
            {detail.count ? ` · ${detail.count} cookies` : ""}
          </span>
        )}
      </div>

      <p className="text-[14px] font-medium leading-relaxed text-[#c9d2dc]">
        YouTube sometimes refuses servers with <b className="text-white">&quot;Sign in to confirm you&apos;re not a bot&quot;</b>.
        That&apos;s about this machine&apos;s IP address (lots of requests, a VPN, or a data center), not
        the link. Your YouTube login gets past it; the server only uses it when YouTube insists.
      </p>

      <div className="rounded-2xl border-[2.5px] border-[var(--ink)] bg-[var(--lime)]/10 p-4 shadow-[inset_0_0_0_1.5px_rgba(182,244,0,0.25)]">
        <div className="flex items-center gap-2">
          <span className="pp-sticker is-lime !text-[10px]">Automatic</span>
          <span className="text-[13px] font-black">with the browser extension</span>
        </div>
        <ol className="mt-3 space-y-2 text-[13px] font-semibold">
          {[
            "Install the Video Grabber extension (extension/release in the project).",
            "Open its Settings → YouTube login → Send my YouTube login now.",
            "Switch on \"Keep it up to date automatically\" and forget about it.",
          ].map((text, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="pp-badge h-6 w-6 shrink-0 text-[12px]">{i + 1}</span>
              <span className="pt-0.5">{text}</span>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-[12px] font-semibold text-[var(--muted)]">
          Only youtube.com cookies are read. The popup also offers it in one click when YouTube blocks a link.
        </p>
      </div>

      <div>
        <span className="pp-sticker is-dark !text-[10px]">Manual</span>
        <span className="ml-2 text-[13px] font-black">upload a cookies.txt</span>
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
          <button className="pp-btn" disabled={busy} onClick={remove} title="Forget the stored cookies (from the extension or an upload)">
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
