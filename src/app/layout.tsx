import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "antd/dist/reset.css";
import "./globals.css";
import { Providers } from "@/components/providers";

const sans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "MOAD Admin Assistant",
  description: "Natural-language admin actions for campaigns, cargo partners, and settlements.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={sans.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
