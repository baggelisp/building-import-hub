import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Static SPA build for Firebase Hosting. There is no runtime server: TanStack Start
// prerenders a single HTML shell at build time and Firebase rewrites every route to it.
// All backend logic lives in Supabase (Postgres + RLS, Auth, Edge Functions).
export default defineConfig({
  server: { port: 8080 },
  resolve: { tsconfigPaths: true },
  plugins: [
    tailwindcss(),
    tanstackStart({
      spa: {
        enabled: true,
        prerender: { outputPath: "/index.html", crawlLinks: false },
      },
    }),
    viteReact(),
  ],
});
