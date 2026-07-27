import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StoryLab — Multi-model YouTube Script Studio",
  description: "Research a subject and generate independent Did You Know scripts with GPT, Claude, and Kimi.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
