import { build } from "vite";

await build({
  configFile: false,
  build: {
    emptyOutDir: false,
    lib: {
      entry: "src/widget-embed.ts",
      formats: ["iife"],
      name: "FrontDeskWiseWidget",
      fileName: () => "widget.js",
    },
    minify: false,
    outDir: "public",
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
