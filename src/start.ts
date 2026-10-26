import { createStart } from "@tanstack/react-start";

// Client-rendered only. The build is a static SPA (see vite.config.ts), so there are no
// server functions or request middleware: the backend is Supabase.
export const startInstance = createStart(() => ({
  defaultSsr: false,
}));
