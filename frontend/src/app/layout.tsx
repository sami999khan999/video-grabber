import type { Metadata } from "next";
import { Playfair_Display, Rubik } from "next/font/google";
import "./globals.css";
import "./wall.css";

import Providers from "@/components/Providers";

const ui = Rubik({ subsets: ["latin"], variable: "--font-ui", weight: ["500", "600", "700", "800", "900"] });
const title = Playfair_Display({ subsets: ["latin"], variable: "--font-title", weight: ["900"], style: ["italic"] });

export const metadata: Metadata = {
  title: "Video Grabber",
  description:
    "Paste a video or playlist link and pull it down: live progress, parallel downloads.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${ui.variable} ${title.variable}`}>
      <body className="pp-ui antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
