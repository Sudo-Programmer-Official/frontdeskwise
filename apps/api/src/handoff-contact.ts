export type HandoffContact = {
  name: string | null;
  email: string | null;
  phone: string | null;
};

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_PATTERN = /(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}\b/;
const NAME_PATTERN = /\b(?:my name is|i am|i'm|this is)\s+([A-Z][A-Za-z'’]{1,40}(?:\s+[A-Z][A-Za-z'’]{1,40})?)/i;

function normalizedEmail(value: string | null | undefined): string | null {
  const candidate = value?.trim().toLowerCase() ?? "";
  return candidate && EMAIL_PATTERN.test(candidate) ? candidate.slice(0, 240) : null;
}

function normalizedPhone(value: string | null | undefined): string | null {
  const candidate = value?.trim() ?? "";
  const digits = candidate.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15 ? candidate.slice(0, 80) : null;
}

function normalizedName(value: string | null | undefined): string | null {
  const candidate = value?.trim().replace(/\s+/g, " ") ?? "";
  return candidate ? candidate.slice(0, 160) : null;
}

export function emptyHandoffContact(): HandoffContact {
  return { name: null, email: null, phone: null };
}

export function mergeHandoffContacts(...contacts: Array<Partial<HandoffContact> | null | undefined>): HandoffContact {
  const merged = emptyHandoffContact();
  for (const contact of contacts) {
    if (!contact) continue;
    merged.name = normalizedName(contact.name) ?? merged.name;
    merged.email = normalizedEmail(contact.email) ?? merged.email;
    merged.phone = normalizedPhone(contact.phone) ?? merged.phone;
  }
  return merged;
}

export function extractHandoffContact(text: string): HandoffContact {
  const email = text.match(EMAIL_PATTERN)?.[0] ?? null;
  const phone = text.match(PHONE_PATTERN)?.[0] ?? null;
  const name = text.match(NAME_PATTERN)?.[1]?.replace(/[,.!?;:]+$/, "") ?? null;
  return mergeHandoffContacts({ name, email, phone });
}

export function hasHandoffContactChannel(contact: Partial<HandoffContact> | null | undefined): boolean {
  return Boolean(contact?.email || contact?.phone);
}

