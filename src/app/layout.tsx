import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Analytics } from "@vercel/analytics/react";
import { Providers } from "./providers";
import { LandingTopbar } from "@/components/landing/LandingTopbar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Meridians",
  description: "A simulation engine for long-form reasoning. Extract, query, and generate world views — causally coherent knowledge structures over fate, world, and system.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="theme-astral dark" suppressHydrationWarning>
      <head>
        {/* No-FOUC theme bootstrap — applies the stored theme class to <html>
            before first paint so the page never flashes the default theme. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('meridians_theme');if(t!=='astral'&&t!=='dark'&&t!=='light')t='astral';var e=document.documentElement;e.classList.remove('theme-astral','theme-dark','theme-light','dark','light');e.classList.add('theme-'+t);e.classList.add(t==='light'?'light':'dark');e.style.colorScheme=t==='light'?'light':'dark';}catch(_){}})();`,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-bg-base text-text-primary`}
      >
        <Providers>
          <LandingTopbar />
          {children}
        </Providers>
        <Analytics />
      </body>
    </html>
  );
}
