import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "Insurwreck Starter",
  description: "Claims dashboard + AI document generator starter for the Insurwreck hackathon.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gradient-to-b from-white to-neutral-100 text-neutral-900 dark:from-neutral-950 dark:to-neutral-900 dark:text-neutral-100">
        <Nav />
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>
      </body>
    </html>
  );
}
