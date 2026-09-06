import { defineConfig } from "vite";
export default defineConfig({
  base: "/my-game/",
  build: { target: "es2022", chunkSizeWarningLimit: 700 },
  server: { port: 5173 },
});
