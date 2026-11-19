import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { Pool } from "pg";

const app = Fastify({ logger: true });
const port = Number(process.env.PORT ?? 8787);
const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
const MAX_HTML_BYTES = 1_000_000;
const CRAWL_TIMEOUT_MS = 8_000;

type AgentConfig = {
  assistantName: string;
  welcomeMessage: string;
  widgetColor: string;
  collectLeads: boolean;
  showBookingAction: boolean;
  fallbackMessage: string;
};

type Source = {
  id: string;
  url: string;
  title: string;
  contentHash: string;
  lastCrawledAt: string;
};

type KnowledgeChunk = {
  id: string;
  sourceId: string;
  content: string;
  contentHash: string;
};

type Message = {
  role: "user" | "assistant";
  content: string;
  grounded?: boolean;
  sourceUrl?: string;
  createdAt: string;
};

type Conversation = {
  id: string;
  sessionId: string;
  leadCaptured: boolean;
  actionTaken: string | null;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
};

type Lead = {
  id: string;
  conversationId: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  intent: string | null;
  status: "new" | "qualified" | "booked";
  createdAt: string;
};

type KnowledgeGap = {
  question: string;
  occurrenceCount: number;
  status: "open" | "resolved";
  approvedAnswer: string | null;
  lastSeenAt: string;
};

type Business = {
  id: string;
  name: string;
  slug: string;
  vertical: string;
  websiteUrl: string;
  location: string;
  sources: Source[];
  chunks: KnowledgeChunk[];
  conversations: Map<string, Conversation>;
  leads: Lead[];
  knowledgeGaps: Map<string, KnowledgeGap>;
  agentConfig: AgentConfig;
  createdAt: string;
};

const businesses = new Map<string, Business>();

const defaultConfig = (businessName: string): AgentConfig => ({
  assistantName: `${businessName} Assistant`,
  welcomeMessage: "Hi! 👋 I can answer questions from this business's website and help you get started.",
  widgetColor: "#0d6efd",
  collectLeads: true,
  showBookingAction: true,
  fallbackMessage: "I do not have enough information to answer that confidently. I can take your details and have the team follow up.",
});

function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function requiredString(value: unknown, field: string, maxLength = 500): string {
  if (typeof value !== "string" || !value.trim()) {
    throw httpError(400, `${field} is required`);
  }
  return value.trim().slice(0, maxLength);
}

function normaliseUrl(value: unknown): string {
  const raw = requiredString(value, "websiteUrl", 2_000);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw httpError(400, "websiteUrl must be a valid URL");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw httpError(400, "websiteUrl must use http or https");
  }
  if (url.username || url.password) {
    throw httpError(400, "websiteUrl cannot contain credentials");
  }

  const hostname = url.hostname.toLowerCase();
  const blockedHost = hostname === "localhost"
    || hostname === "::1"
    || hostname.startsWith("127.")
    || hostname.startsWith("10.")
    || hostname.startsWith("192.168.")
    || hostname.endsWith(".internal");
  if (blockedHost) {
    throw httpError(400, "websiteUrl must point to a public website");
  }

  url.hash = "";
  return url.toString();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function stripMarkup(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/[\u0000-\u001f]+/g, " "),
  ).replace(/\s+/g, " ").trim();
}

function extractTitle(html: string, fallback: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = match ? stripMarkup(match[1]) : "";
  return (title || fallback).slice(0, 240);
}

function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function readResponseText(response: Response): Promise<string> {
  if (!response.body) return response.text();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let total = 0;

  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > MAX_HTML_BYTES) {
      await reader.cancel();
      throw httpError(422, "The website is too large to crawl for a demo");
    }
    parts.push(decoder.decode(result.value, { stream: true }));
  }
  parts.push(decoder.decode());
  return parts.join("");
}

async function crawlWebsite(websiteUrl: string): Promise<{ title: string; text: string; hash: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CRAWL_TIMEOUT_MS);
  try {
    const response = await fetch(websiteUrl, {
      signal: controller.signal,
      headers: {
        "user-agent": "FrontDeskWise-DemoCrawler/0.1",
        accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!response.ok) {
      throw httpError(422, `The website returned HTTP ${response.status}`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      throw httpError(422, "The URL does not point to an HTML page");
    }

    const html = await readResponseText(response);
    const text = stripMarkup(html);
    if (text.length < 80) {
      throw httpError(422, "The website did not contain enough readable text to build a demo");
    }

    const hostname = new URL(websiteUrl).hostname.replace(/^www\./, "");
    return {
      title: extractTitle(html, hostname),
      text: text.slice(0, 50_000),
      hash: contentHash(text),
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw httpError(422, "The website took too long to respond");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function chunkText(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  for (let index = 0; index < words.length && chunks.length < 100; index += 110) {
    chunks.push(words.slice(index, index + 110).join(" "));
  }
  return chunks.filter((chunk) => chunk.length >= 40);
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 56) || "business-demo";
}

function businessNameFromTitle(title: string, websiteUrl: string): string {
  const candidate = title.split(/\s+[|–—-]\s+/)[0].trim();
  if (candidate && !/^home|welcome|index$/i.test(candidate)) return candidate.slice(0, 120);
  return new URL(websiteUrl).hostname.replace(/^www\./, "").split(".")[0].replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function makeBusiness(input: {
  name: string;
  slug: string;
  websiteUrl: string;
  title: string;
  text: string;
  hash: string;
  location?: string;
}): Business {
  const now = new Date().toISOString();
  const sourceId = randomUUID();
  const source: Source = {
    id: sourceId,
    url: input.websiteUrl,
    title: input.title,
    contentHash: input.hash,
    lastCrawledAt: now,
  };
  const chunks = chunkText(input.text).map((content) => ({
    id: randomUUID(),
    sourceId,
    content,
    contentHash: contentHash(content),
  }));

  return {
    id: randomUUID(),
    name: input.name,
    slug: input.slug,
    vertical: "local_business",
    websiteUrl: input.websiteUrl,
    location: input.location ?? "Demo workspace",
    sources: [source],
    chunks,
    conversations: new Map(),
    leads: [],
    knowledgeGaps: new Map(),
    agentConfig: defaultConfig(input.name),
    createdAt: now,
  };
}

function seedDefaultBusiness(): Business {
  const text = [
    "British Swim School Tampa Bay offers swim lessons for babies, toddlers, children, teens, and adults.",
    "Families can choose programs by age and swimming ability, including water safety, beginner lessons, and swim assessments.",
    "Visit the Tampa Bay locations page to find classes, schedules, and current enrollment availability.",
    "Parents can request information or start enrollment through the website. A team member can help match each swimmer to the right program.",
  ].join(" ");
  const business = makeBusiness({
    name: "British Swim School",
    slug: "british-swim-school-tampa-bay",
    websiteUrl: "https://britishswimschool.com/tampa-bay/",
    title: "British Swim School Tampa Bay",
    text,
    hash: contentHash(text),
    location: "Tampa Bay",
  });
  businesses.set(business.slug, business);
  return business;
}

function getBusiness(slug: unknown): Business {
  const value = requiredString(slug, "slug", 120);
  const business = businesses.get(value);
  if (!business) throw httpError(404, "Demo workspace not found");
  return business;
}

function workspacePayload(business: Business) {
  const leadCount = business.leads.length;
  const gapCount = [...business.knowledgeGaps.values()].filter((gap) => gap.status === "open").length;
  return {
    slug: business.slug,
    status: "sandbox",
    business: {
      id: business.id,
      name: business.name,
      location: business.location,
      vertical: business.vertical,
      websiteUrl: business.websiteUrl,
    },
    agent: business.agentConfig,
    knowledge: {
      sourceCount: business.sources.length,
      chunkCount: business.chunks.length,
      openGaps: gapCount,
    },
    stats: {
      conversations: business.conversations.size,
      leads: leadCount,
      bookingClicks: [...business.conversations.values()].filter((conversation) => conversation.actionTaken === "booking").length,
    },
  };
}

function tokenise(value: string): string[] {
  const stopWords = new Set(["a", "an", "and", "are", "can", "class", "classes", "do", "for", "how", "i", "in", "is", "it", "lesson", "lessons", "my", "offer", "offers", "of", "on", "or", "program", "programs", "school", "swim", "swimming", "the", "to", "we", "what", "when", "where", "you"]);
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((token) => token.length > 2 && !stopWords.has(token));
}

function rememberGap(business: Business, question: string): KnowledgeGap {
  const key = question.toLowerCase().replace(/\s+/g, " ").trim();
  const existing = business.knowledgeGaps.get(key);
  const now = new Date().toISOString();
  if (existing) {
    existing.occurrenceCount += 1;
    existing.lastSeenAt = now;
    return existing;
  }
  const gap: KnowledgeGap = { question, occurrenceCount: 1, status: "open", approvedAnswer: null, lastSeenAt: now };
  business.knowledgeGaps.set(key, gap);
  return gap;
}

function answerQuestion(business: Business, question: string) {
  const tokens = tokenise(question);
  const ranked = business.chunks.map((chunk) => {
    const lower = chunk.content.toLowerCase();
    const score = tokens.reduce((total, token) => total + (lower.includes(token) ? 1 : 0), 0);
    return { chunk, score };
  }).sort((left, right) => right.score - left.score);
  const match = ranked[0];

  if (!match || match.score === 0) {
    const gap = rememberGap(business, question);
    return {
      answer: business.agentConfig.fallbackMessage,
      grounded: false,
      citations: [],
      knowledgeGap: gap,
    };
  }

  const source = business.sources.find((item) => item.id === match.chunk.sourceId);
  const excerpt = match.chunk.content.length > 420 ? `${match.chunk.content.slice(0, 417).trim()}…` : match.chunk.content;
  return {
    answer: `Based on ${source?.title ?? "the business website"}: ${excerpt}`,
    grounded: true,
    citations: source ? [{ title: source.title, url: source.url }] : [],
    knowledgeGap: null,
  };
}

function maybeConversation(business: Business, conversationId: string): Conversation {
  const conversation = business.conversations.get(conversationId);
  if (!conversation) throw httpError(404, "Conversation not found");
  return conversation;
}

seedDefaultBusiness();

app.addHook("onRequest", async (request, reply) => {
  reply.header("Access-Control-Allow-Origin", process.env.WEB_ORIGIN ?? "*");
  reply.header("Access-Control-Allow-Headers", "content-type");
  reply.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (request.method === "OPTIONS") return reply.code(204).send();
});

app.get("/health", async () => ({
  ok: true,
  service: "frontdeskwise-api",
  databaseConfigured: Boolean(pool),
  storage: pool ? "memory-until-migration" : "memory",
}));

app.post("/api/v1/demos", async (request, reply) => {
  const body = asRecord(request.body);
  const websiteUrl = normaliseUrl(body.websiteUrl);
  const crawled = await crawlWebsite(websiteUrl);
  const name = businessNameFromTitle(crawled.title, websiteUrl);
  const baseSlug = slugify(name);
  let slug = baseSlug;
  while (businesses.has(slug)) slug = `${baseSlug}-${Math.random().toString(36).slice(2, 7)}`;

  const business = makeBusiness({ name, slug, websiteUrl, title: crawled.title, text: crawled.text, hash: crawled.hash });
  businesses.set(slug, business);
  return reply.code(201).send(workspacePayload(business));
});

app.get("/api/v1/demo/:slug", async (request) => {
  const params = request.params as { slug?: string };
  return workspacePayload(getBusiness(params.slug));
});

app.get("/api/v1/demo/:slug/knowledge-gaps", async (request) => {
  const params = request.params as { slug?: string };
  const business = getBusiness(params.slug);
  return { gaps: [...business.knowledgeGaps.values()].sort((left, right) => right.occurrenceCount - left.occurrenceCount) };
});

app.get("/api/v1/demo/:slug/leads", async (request) => {
  const params = request.params as { slug?: string };
  return { leads: getBusiness(params.slug).leads };
});

app.post("/api/v1/demo/:slug/conversations", async (request, reply) => {
  const params = request.params as { slug?: string };
  const business = getBusiness(params.slug);
  const body = asRecord(request.body);
  const now = new Date().toISOString();
  const conversation: Conversation = {
    id: randomUUID(),
    sessionId: typeof body.sessionId === "string" && body.sessionId.trim() ? body.sessionId.trim().slice(0, 160) : randomUUID(),
    leadCaptured: false,
    actionTaken: null,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
  business.conversations.set(conversation.id, conversation);
  return reply.code(201).send({ conversationId: conversation.id, sessionId: conversation.sessionId });
});

app.post("/api/v1/demo/:slug/conversations/:conversationId/messages", async (request) => {
  const params = request.params as { slug?: string; conversationId?: string };
  const business = getBusiness(params.slug);
  const conversation = maybeConversation(business, requiredString(params.conversationId, "conversationId", 120));
  const question = requiredString(asRecord(request.body).question, "question", 1_000);
  const result = answerQuestion(business, question);
  const now = new Date().toISOString();
  conversation.messages.push({ role: "user", content: question, createdAt: now });
  conversation.messages.push({ role: "assistant", content: result.answer, grounded: result.grounded, sourceUrl: result.citations[0]?.url, createdAt: now });
  conversation.updatedAt = now;
  return { conversationId: conversation.id, ...result };
});

app.post("/api/v1/demo/:slug/leads", async (request, reply) => {
  const params = request.params as { slug?: string };
  const business = getBusiness(params.slug);
  const body = asRecord(request.body);
  const conversationId = typeof body.conversationId === "string" && body.conversationId.trim() ? body.conversationId.trim() : null;
  const conversation = conversationId ? maybeConversation(business, conversationId) : null;
  const email = typeof body.email === "string" && body.email.trim() ? body.email.trim().slice(0, 240) : null;
  const phone = typeof body.phone === "string" && body.phone.trim() ? body.phone.trim().slice(0, 80) : null;
  if (!email && !phone) throw httpError(400, "email or phone is required");

  const lead: Lead = {
    id: randomUUID(),
    conversationId,
    name: typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 160) : null,
    email,
    phone,
    intent: typeof body.intent === "string" && body.intent.trim() ? body.intent.trim().slice(0, 240) : null,
    status: "new",
    createdAt: new Date().toISOString(),
  };
  business.leads.unshift(lead);
  if (conversation) {
    conversation.leadCaptured = true;
    conversation.actionTaken = "lead_capture";
    conversation.updatedAt = lead.createdAt;
  }
  return reply.code(201).send({ lead });
});

app.post("/api/v1/demo/:slug/actions/booking", async (request) => {
  const params = request.params as { slug?: string };
  const business = getBusiness(params.slug);
  const conversationId = requiredString(asRecord(request.body).conversationId, "conversationId", 120);
  const conversation = maybeConversation(business, conversationId);
  conversation.actionTaken = "booking";
  conversation.updatedAt = new Date().toISOString();
  return { ok: true, action: "booking", conversationId };
});

app.setErrorHandler((error, _request: FastifyRequest, reply: FastifyReply) => {
  const typedError = error as Error & { statusCode?: unknown };
  const statusCode = typeof typedError.statusCode === "number" ? typedError.statusCode : 500;
  if (statusCode >= 500) app.log.error(error);
  return reply.code(statusCode).send({ error: statusCode >= 500 ? "Internal server error" : typedError.message });
});

app.addHook("onClose", async () => {
  await pool?.end();
});

await app.listen({ host: "0.0.0.0", port });
