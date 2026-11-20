import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [
    vue(),
    {
      name: "frontdeskwise-site-origin",
      transformIndexHtml(html) {
        const configuredOrigin = process.env.VITE_SITE_ORIGIN ?? (process.env.NODE_ENV === "production" ? "https://www.frontdeskwise.com" : "http://localhost:5174");
        const siteOrigin = configuredOrigin.replace(/\/$/, "");
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

