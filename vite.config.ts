import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Output is plain files in dist/client: one prerendered index.html plus hashed assets. Nothing
// runs on a server at request time; every URL resolves to index.html (firebase.json) and the
// router takes over in the browser.
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
