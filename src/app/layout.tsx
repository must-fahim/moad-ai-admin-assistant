import type { Metadata } from "next";
import "antd/dist/reset.css";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "MOAD Admin Assistant",
  description: "Natural-language admin actions for campaigns, cargo partners, and settlements.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
