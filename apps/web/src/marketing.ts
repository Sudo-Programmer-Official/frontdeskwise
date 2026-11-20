import rawPages from "./marketing-pages.json" with { type: "json" };

export type MarketingPageType = "commercial" | "hub" | "industry" | "use-case" | "integration" | "resource" | "tool";

export interface MarketingSection {
  heading: string;
  body: string;
  bullets?: string[];
}

export interface MarketingChild {
  key: string;
  title: string;
  description: string;
  path: string;
}

export interface MarketingFaq {
  question: string;
  answer: string;
}

export interface MarketingPage {
  key: string;
  path: string;
  type: MarketingPageType;
  eyebrow: string;
  title: string;
  description: string;
  intro: string;
  primaryCta: string;
  secondaryCta: string;
  sections?: MarketingSection[];
  faqs?: MarketingFaq[];
  children?: MarketingChild[];
  related?: string[];
  customerQuestions?: string[];
  captures?: string[];
  flow?: string[];
  workflow?: string[];
  handoff?: string;
  integrations?: string[];
  articleSections?: Array<{ heading: string; body: string }>;
  tool?: boolean;
}

export const marketingPages = rawPages as MarketingPage[];
export const marketingPagesByKey = new Map(marketingPages.map((page) => [page.key, page]));
export const marketingPagesByPath = new Map(marketingPages.map((page) => [page.path, page]));

export function getMarketingPage(key: string): MarketingPage | undefined {
  return marketingPagesByKey.get(key);
}

export function getMarketingPageByPath(path: string): MarketingPage | undefined {
  return marketingPagesByPath.get(path.replace(/\/$/, "") || "/");
}

export function marketingHref(key: string): string {
  return getMarketingPage(key)?.path ?? "/";
}

export const marketingRoutePaths = marketingPages.map((page) => page.path);
