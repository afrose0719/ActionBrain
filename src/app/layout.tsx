import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { PwaRegister } from "@/components/pwa-register";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
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
