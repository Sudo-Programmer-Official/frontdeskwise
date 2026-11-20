import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const configuredOrigin = process.env.VITE_SITE_ORIGIN || (process.env.NODE_ENV === "production" ? "https://www.frontdeskwise.com" : "http://localhost:5174");
const siteOrigin = configuredOrigin.replace(/\/$/, "").replace(/^https:\/\/frontdeskwise\.com$/i, "https://www.frontdeskwise.com");
const publicDirectory = resolve(process.cwd(), "public");
const marketingPages = JSON.parse(await readFile(resolve(process.cwd(), "src/marketing-pages.json"), "utf8"));
const publicPaths = ["/", "/privacy", "/terms", ...marketingPages.map((page) => page.path)];
await mkdir(publicDirectory, { recursive: true });

await writeFile(resolve(publicDirectory, "robots.txt"), `User-agent: *\nAllow: /\nDisallow: /app/\nDisallow: /auth/\nDisallow: /demo/\nDisallow: /onboarding/\nDisallow: /platform/\nSitemap: ${siteOrigin}/sitemap.xml\n`, "utf8");
const sitemapUrls = publicPaths.map((path) => `  <url><loc>${siteOrigin}${path}</loc></url>`).join("\n");
await writeFile(resolve(publicDirectory, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrls}\n</urlset>\n`, "utf8");
