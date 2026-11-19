import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [
    vue(),
    {
      name: "frontdeskwise-site-origin",
      transformIndexHtml(html) {
        const siteOrigin = (process.env.VITE_SITE_ORIGIN ?? "http://localhost:5174").replace(/\/$/, "");
        return html.replaceAll("https://frontdeskwise.invalid", siteOrigin);
      },
    },
  ],
  server: {
    port: 5174,
    proxy: {
      "/api": "http://localhost:8787",
      "/health": "http://localhost:8787",
    },
  },
});

