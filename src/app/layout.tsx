import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { PwaRegister } from "@/components/pwa-register";

// Inter (SIL Open Font License, see ./fonts/Inter-OFL-LICENSE.txt), bundled with the app on purpose.
// Loading it from Google Fonts meant every build downloaded it, so a slow or blocked network could fail a deploy.
const inter = localFont({
  src: "./fonts/inter-latin-wght-normal.woff2",
  variable: "--font-inter",
  weight: "100 900", // one variable file covers every weight
  display: "swap",
});

export const metadata: Metadata = {
  title: "ActionBrain",
  description: "Never lose a commitment again.",
  applicationName: "ActionBrain",
  // iPhone / iPad "Add to Home Screen"
  appleWebApp: { capable: true, title: "ActionBrain", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/icon.png", type: "image/png", sizes: "64x64" }], // from src/app/icon.png
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#4f46e5", // colors the browser / phone status bar
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full">
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
