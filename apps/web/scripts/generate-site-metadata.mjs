import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const siteOrigin = (process.env.VITE_SITE_ORIGIN || "http://localhost:5174").replace(/\/$/, "");
const publicDirectory = resolve(process.cwd(), "public");
await mkdir(publicDirectory, { recursive: true });

await writeFile(resolve(publicDirectory, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${siteOrigin}/sitemap.xml\n`, "utf8");
await writeFile(resolve(publicDirectory, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${siteOrigin}/</loc></url>\n</urlset>\n`, "utf8");
