import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [
    vue(),
    {
      name: "frontdeskwise-site-origin",
      transformIndexHtml(html) {
        const configuredOrigin = process.env.VITE_SITE_ORIGIN ?? (process.env.NODE_ENV === "production" ? "https://www.frontdeskwise.com" : "http://localhost:5174");
        const siteOrigin = configuredOrigin.replace(/\/$/, "").replace(/^https:\/\/frontdeskwise\.com$/i, "https://www.frontdeskwise.com");
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
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/firebase/") || id.includes("/node_modules/@firebase/")) return "firebase";
          if (id.includes("/node_modules/@lucide/") || id.includes("/node_modules/simple-icons/")) return "icons";
          if (id.includes("/node_modules/mixpanel-browser/")) return "analytics";
          if (id.includes("/src/analytics/")) return "analytics";
          if (id.includes("/src/auth/firebase.")) return "auth";
          if (id.includes("/src/components/ui/")) return "ui";
          if (id.includes("/src/pwa.")) return "pwa";
          if (id.includes("/src/router/")) return "router";
          if (id.includes("/src/marketing.")) return "marketing-data";
          if (id.includes("/src/workflow-generator.")) return "workflow";
        },
      },
    },
  },
});

