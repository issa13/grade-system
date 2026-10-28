import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/ui";
import { ConfigCheck } from "@/components/config-check";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  title: "نظام إدارة العلامات",
  description: "إدارة علامات الطلاب والحصص والصفوف",
  applicationName: "العلامات",
  appleWebApp: { capable: true, title: "العلامات", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#1f7a68",
  width: "device-width",
  initialScale: 1,
};

const themeScript = `try{var t=localStorage.getItem('theme')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark')}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <link rel="manifest" href={`${BASE}/manifest.webmanifest`} />
        <link rel="icon" href={`${BASE}/icons/icon-192.png`} type="image/png" />
        <link rel="apple-touch-icon" href={`${BASE}/icons/apple-touch-icon.png`} />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <ToastProvider><ConfigCheck>{children}</ConfigCheck></ToastProvider>
      </body>
    </html>
  );
}
