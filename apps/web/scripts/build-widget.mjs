import { build } from "vite";

// The public entrypoint must stay tiny. The conversation shell is a separate
// IIFE so it is only downloaded after an explicit open/proactive interaction.
await build({
  configFile: false,
  publicDir: false,
  build: {
    emptyOutDir: false,
    lib: {
      entry: "src/widget-loader.ts",
      formats: ["iife"],
      name: "FrontDeskWiseWidgetLoader",
      fileName: () => "widget.js",
    },
    minify: "esbuild",
    outDir: "public",
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});

await build({
  configFile: false,
  publicDir: false,
  build: {
    emptyOutDir: false,
    lib: {
      entry: "src/widget-embed.ts",
      formats: ["iife"],
      name: "FrontDeskWiseWidgetShell",
      fileName: () => "widget-shell.js",
    },
    minify: "esbuild",
    outDir: "public",
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
