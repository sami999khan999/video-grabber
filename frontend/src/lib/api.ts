const API_BASE = "http://127.0.0.1:8000/api";

export interface VideoInfo {
  title: string;
  duration: number;
  thumbnail: string;
  webpage_url: string;
  formats: {
    format_id: string;
    ext: string;
    resolution: string;
    filesize: number;
    url: string;
  }[];
}

export const videoApi = {
  fetchInfo: async (url: string): Promise<VideoInfo> => {
    const res = await fetch(`${API_BASE}/info/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url.trim() }),
    });
    
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to fetch video info.");
    }
    
    return data;
  },

  downloadVideo: async (url: string, formatId: string): Promise<Blob> => {
    const res = await fetch(`${API_BASE}/download/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, format_id: formatId }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Failed to download video.");
    }

    return await res.blob();
  },
};
