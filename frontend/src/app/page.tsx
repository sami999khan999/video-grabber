"use client";

import { useState } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Loader2,
  Sparkles,
  Link as LinkIcon,
  Download,
  Info,
  Clock,
  ArrowLeft,
  Monitor,
} from "lucide-react";

import { CustomCursor } from "@/components/CustomCursor";
import { ParticleSystem } from "@/components/ParticleSystem";
import { useMutation } from "@tanstack/react-query";
import { videoApi, VideoInfo } from "@/lib/api";

export default function Home() {
  const [url, setUrl] = useState("");
  const [videoData, setVideoData] = useState<VideoInfo | null>(null);

  const {
    mutate: fetchVideoInfo,
    isPending: isFetchingInfo,
    error: infoError,
  } = useMutation({
    mutationFn: (videoUrl: string) => videoApi.fetchInfo(videoUrl),
    onSuccess: (data) => {
      setVideoData(data);
    },
  });

  const {
    mutate: downloadVideo,
    isPending: isDownloading,
    error: downloadError,
  } = useMutation({
    mutationFn: ({ url, formatId }: { url: string; formatId: string }) => 
        videoApi.downloadVideo(url, formatId),
    onSuccess: (blob, variables) => {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // Sanitize title for filename
      const safeTitle = (videoData?.title || "video").replace(/[^a-z0-9]/gi, '_').toLowerCase();
      a.download = `${safeTitle}-${variables.formatId}.mp4`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    },
  });

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !isFetchingInfo) fetchVideoInfo(url);
  };

  const reset = () => {
    setVideoData(null);
    setUrl("");
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatSize = (bytes: number) => {
    if (!bytes) return "Unknown size";
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  return (
    <main className="relative min-h-screen w-full flex items-center justify-center overflow-hidden bg-[#020205]">
      {/* Background Image Layer */}
      <div className="absolute inset-0 z-0">
        <Image
          src="/bg.png"
          alt="Background"
          fill
          className="object-cover opacity-40 mix-blend-screen grayscale-20 brightness-[0.6]"
          priority
        />
        <div className="absolute inset-0 bg-linear-to-b from-[#020205]/20 via-transparent to-[#020205]/60" />
      </div>

      {/* Custom Effects Layer */}
      <ParticleSystem />
      <CustomCursor />

      {/* Ambient Glow Orbs */}
      <div className="fixed top-[-10%] left-[-10%] w-[50vw] h-[50vw] bg-purple-900/15 blur-[120px] rounded-full pointer-events-none z-0" />
      <div className="fixed bottom-[-10%] right-[-10%] w-[40vw] h-[40vw] bg-indigo-900/15 blur-[120px] rounded-full pointer-events-none z-0" />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[60vw] h-[60vw] bg-violet-950/10 blur-[180px] rounded-full pointer-events-none z-0" />

      {/* Main 80/80 Centered Container */}
      <div className="relative z-10 w-[80vw] h-[80vh] flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.98, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ 
            duration: 1.5, 
            ease: [0.16, 1, 0.3, 1] 
          }}
          className="w-full h-full"
        >
          <Card className="relative w-full h-full overflow-hidden border-purple-500/30 bg-white/5 shadow-[0_0_80px_-20px_rgba(168,85,247,0.4)] backdrop-blur-2xl rounded-[2.5rem] border flex flex-col items-center justify-center p-12 group/card">
            
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-linear-to-r from-transparent via-purple-400 to-transparent opacity-80 shadow-[0_0_20px_rgba(168,85,247,1)]" />
            <div className="absolute inset-0 pointer-events-none bg-linear-to-br from-purple-500/5 via-transparent to-indigo-500/5" />
            
            <AnimatePresence mode="wait">
              {!videoData ? (
                <motion.div 
                  key="form"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="relative z-10 flex flex-col items-center text-center gap-16 w-full max-w-3xl px-8"
                >
                  <div className="space-y-6">
                    <motion.div>
                      <h1 className="text-7xl font-black tracking-tighter drop-shadow-[0_0_30px_rgba(255,255,255,0.3)] bg-clip-text text-transparent bg-linear-to-b from-white to-white/60">
                        VIDEO GRABBER
                      </h1>
                    </motion.div>
                    <div className="flex items-center justify-center gap-4">
                      <div className="h-px w-12 bg-purple-500/30" />
                      <p className="text-purple-300/40 text-sm font-bold uppercase tracking-[0.5em] whitespace-nowrap">
                        Premium Media Retrieval
                      </p>
                      <div className="h-px w-12 bg-purple-500/30" />
                    </div>
                  </div>

                  <div className="w-full space-y-10 mt-4">
                    <div className="relative group/input">
                      <div className="absolute left-7 top-1/2 -translate-y-1/2 text-purple-400/30 group-focus-within/input:text-purple-400 transition-all duration-500 scale-110">
                        <LinkIcon size={28} />
                      </div>
                      <Input
                        type="url"
                        placeholder="Paste your video source link..."
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="h-24 pl-20 text-2xl bg-white/2 border-purple-500/20 text-white placeholder:text-white/10 focus-visible:ring-0 focus-visible:border-purple-500/50 rounded-[2rem] transition-all duration-500 shadow-inner"
                      />
                    </div>

                    <motion.div whileHover={{ scale: 1.02, y: -2 }} whileTap={{ scale: 0.98 }}>
                      <Button
                        onClick={() => fetchVideoInfo(url)}
                        disabled={isFetchingInfo || !url.trim()}
                        className="w-full h-24 bg-linear-to-r from-purple-600 via-violet-600 to-indigo-700 hover:from-purple-500 hover:via-violet-500 hover:to-indigo-600 text-white font-black text-2xl rounded-[2rem] shadow-[0_25px_50px_-12px_rgba(139,92,246,0.5)] border border-white/10 transition-all duration-500 disabled:opacity-20 uppercase tracking-[0.2em]"
                      >
                        {isFetchingInfo ? <Loader2 className="h-10 w-10 animate-spin mr-3" /> : (
                          <div className="flex items-center justify-center gap-4">
                            <span>Grab Video</span>
                            <Sparkles size={28} className="text-purple-200 animate-pulse" />
                          </div>
                        )}
                      </Button>
                    </motion.div>
                  </div>

                  {(infoError || downloadError) && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full rounded-[1.5rem] bg-red-500/10 border border-red-500/20 p-8 text-lg text-red-200 shadow-2xl backdrop-blur-md">
                      {((infoError || downloadError) as Error).message}
                    </motion.div>
                  )}
                </motion.div>
              ) : (
                <motion.div 
                  key="results"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="relative z-10 w-full h-full flex flex-col gap-8 overflow-hidden"
                >
                  <div className="flex items-center gap-6">
                    <Button variant="ghost" onClick={reset} className="rounded-full w-14 h-14 bg-white/5 hover:bg-white/10 text-white">
                      <ArrowLeft size={24} />
                    </Button>
                    <div className="flex-1">
                      <h2 className="text-3xl font-black text-white line-clamp-1">{videoData.title}</h2>
                      <div className="flex items-center gap-4 text-xs font-medium text-white/40 uppercase tracking-widest mt-1">
                        {videoData.duration > 0 && (
                          <div className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5" />
                            <span>{formatDuration(videoData.duration)}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-1.5">
                          <Download className="w-3.5 h-3.5" />
                          <span>Available in {videoData.formats.length} {videoData.formats.length === 1 ? 'format' : 'formats'}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 flex-1 overflow-hidden">
                    <div className="relative aspect-video rounded-[2rem] overflow-hidden border border-white/10 shadow-2xl bg-white/5">
                      {videoData.thumbnail ? (
                        <Image 
                          src={videoData.thumbnail} 
                          alt={videoData.title} 
                          fill 
                          className="object-cover"
                          unoptimized
                        />
                      ) : (
                        <div className="w-full h-full bg-linear-to-br from-purple-500/20 to-violet-500/20 flex items-center justify-center">
                          <Monitor size={48} className="text-white/20" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-linear-to-t from-black/60 to-transparent" />
                    </div>

                    <div className="flex flex-col gap-4 overflow-y-auto pr-4 custom-scrollbar">
                      {videoData.formats.map((format, idx) => (
                        <motion.div 
                          key={format.format_id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: idx * 0.05 }}
                          className="flex items-center justify-between p-6 rounded-3xl bg-white/5 border border-white/5 hover:border-purple-500/30 hover:bg-white/10 transition-all group/item"
                        >
                          <div className="space-y-1">
                            <span className="text-lg font-black text-white">{format.resolution || 'Auto'}</span>
                            <div className="flex items-center gap-3 text-xs font-bold text-purple-300/40 uppercase tracking-widest">
                              <span className="px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-400">{format.ext}</span>
                              <span>{formatSize(format.filesize)}</span>
                            </div>
                          </div>
                          <Button
                            onClick={() => downloadVideo({ url: videoData.webpage_url, formatId: format.format_id })}
                            disabled={isDownloading}
                            className="rounded-2xl h-12 px-6 bg-linear-to-r from-purple-600 to-violet-600 hover:from-purple-500 hover:to-violet-500 text-white font-bold"
                          >
                            {isDownloading ? <Loader2 className="animate-spin" size={20} /> : <Download size={20} />}
                          </Button>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            
            <div className="absolute inset-0 opacity-[0.03] pointer-events-none mix-blend-overlay bg-[url('https://grainy-gradients.vercel.app/noise.svg')]" />
          </Card>
        </motion.div>
      </div>
      
      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(168, 85, 247, 0.2); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(168, 85, 247, 0.4); }
      `}</style>
    </main>
  );
}
