import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Sans_Thai } from "next/font/google";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Geist has no Thai glyphs, so Thai text would fall back to whatever Thai
// font the operating system happens to ship — and some Linux desktops ship
// none at all. Noto Sans Thai keeps the text identical everywhere.
const notoThai = Noto_Sans_Thai({
  variable: "--font-thai",
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "กิลด์ — เช็คชื่อ",
  description: "เครื่องมือกิลด์สำหรับ Ragnarok: New World",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: next-themes sets the theme class on <html>
    // before React hydrates, which would otherwise be flagged as a mismatch.
    <html
      lang="th"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${notoThai.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <SiteHeader />
          {children}
          {/*
            Once per app, not per page: the guild master writes to the database
            from several screens (event boards, the party tab), and a toast that
            only exists on one of them is a write that failed silently on the
            other. `richColors` so a failure reads as red at a glance — most
            of these writes are the last thing someone does before a match.
          */}
          <Toaster position="top-center" richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}