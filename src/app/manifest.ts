import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MOAD Admin Assistant",
    short_name: "MOAD",
    description: "Ask about campaigns, cargo partners, settlements, Solo Pay, FAQs, and notices. A change waits until you confirm.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f7fb",
    theme_color: "#0c1424",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
