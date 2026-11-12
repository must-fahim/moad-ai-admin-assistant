import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "antd/dist/reset.css";
import "./globals.css";
import { Providers } from "@/components/providers";

const sans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  display: "swap",
});

const title = "MOAD";
const description = "MOAD admin assistant for campaigns, cargo partners, settlements, Solo Pay, FAQs, and notices. Reads run immediately. A change waits until you confirm.";

export const metadata: Metadata = {
  title: { default: title, template: "%s · MOAD" },
  description,
  applicationName: "MOAD Admin Assistant",
  authors: [{ name: "MOAD" }],
  creator: "MOAD",
  keywords: ["MOAD", "admin assistant", "campaigns", "cargo partners", "settlements"],
  robots: { index: false, follow: false },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-icon", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    title: "MOAD Admin Assistant",
    description,
    siteName: "MOAD",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary",
    title: "MOAD Admin Assistant",
    description,
  },
};

export const viewport: Viewport = {
  themeColor: "#0c1424",
  width: "device-width",
  initialScale: 1,
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
