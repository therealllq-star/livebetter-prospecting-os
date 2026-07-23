import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Prospecting OS",
    short_name: "Prospecting OS",
    description: "Luxury minimalist prospecting CRM for Singapore real estate advisors",
    start_url: "/",
    display: "standalone",
    background_color: "#fcfaef",
    theme_color: "#fcfaef",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}