import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: new URL("./index.html", import.meta.url).pathname,
        popover: new URL("./popover.html", import.meta.url).pathname,
        popoverWindow: new URL(
          "./popover-window.html",
          import.meta.url,
        ).pathname,
        selectionAction: new URL(
          "./selection-action.html",
          import.meta.url,
        ).pathname,
      },
    },
  },
});
