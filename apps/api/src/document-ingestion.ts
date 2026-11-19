import { createRequire } from "node:module";
import { extname } from "node:path";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse") as (buffer: Buffer) => Promise<{ text?: string; numpages?: number }>;
const mammoth = require("mammoth") as { extractRawText(input: { buffer: Buffer }): Promise<{ value?: string }> };
const xlsx = require("xlsx") as {
  read(buffer: Buffer, options: { type: "buffer" }): { SheetNames: string[]; Sheets: Record<string, unknown> };
  utils: { sheet_to_csv(sheet: unknown, options?: Record<string, unknown>): string };
};

export type ExtractedDocument = {
  text: string;
  pageCount: number | null;
  parser: "pdf" | "text" | "docx" | "spreadsheet";
};

function normaliseText(value: string): string {
  return value
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractDocumentText(buffer: Buffer, contentType: string, fileName: string): Promise<ExtractedDocument> {
  const extension = extname(fileName).toLowerCase();
  if (contentType === "application/pdf" || extension === ".pdf") {
    const parsed = await pdfParse(buffer);
    return { text: normaliseText(parsed.text ?? ""), pageCount: parsed.numpages ?? null, parser: "pdf" };
  }
  if (contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || extension === ".docx") {
    const parsed = await mammoth.extractRawText({ buffer });
    return { text: normaliseText(parsed.value ?? ""), pageCount: null, parser: "docx" };
  }
  if (contentType === "application/vnd.ms-excel"
      || contentType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      || extension === ".xls"
      || extension === ".xlsx") {
    const workbook = xlsx.read(buffer, { type: "buffer" });
    const text = workbook.SheetNames.map((sheetName) => {
      const sheetText = xlsx.utils.sheet_to_csv(workbook.Sheets[sheetName], { blankrows: false });
      return `Sheet: ${sheetName}\n${sheetText}`;
    }).join("\n\n");
    return { text: normaliseText(text), pageCount: workbook.SheetNames.length, parser: "spreadsheet" };
  }
  if (contentType === "application/msword" || extension === ".doc") {
    throw new Error("Legacy .doc files are not supported yet. Save the document as .docx and upload it again.");
  }
  return { text: normaliseText(buffer.toString("utf8")), pageCount: null, parser: "text" };
}

export function chunkDocumentText(text: string, maxCharacters = 3_600, overlapCharacters = 360): string[] {
  const normalised = normaliseText(text);
  if (!normalised) return [];
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < normalised.length) {
    let end = Math.min(normalised.length, cursor + maxCharacters);
    if (end < normalised.length) {
      const boundary = normalised.lastIndexOf("\n\n", end);
      const whitespace = normalised.lastIndexOf(" ", end);
      if (boundary > cursor + Math.floor(maxCharacters * 0.55)) end = boundary;
      else if (whitespace > cursor + Math.floor(maxCharacters * 0.55)) end = whitespace;
    }
    const chunk = normalised.slice(cursor, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= normalised.length) break;
    cursor = Math.max(cursor + 1, end - overlapCharacters);
  }
  return chunks;
}
