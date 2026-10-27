import type { Metadata } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/ui";
import { ConfigCheck } from "@/components/config-check";

export const metadata: Metadata = {
  title: "نظام إدارة العلامات",
  description: "إدارة علامات الطلاب والحصص والصفوف",
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
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <ToastProvider><ConfigCheck>{children}</ConfigCheck></ToastProvider>
      </body>
    </html>
  );
}
