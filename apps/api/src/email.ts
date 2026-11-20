import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

function awsRegion(): string {
  return process.env.AWS_REGION?.trim() || process.env.FRONTDESKWISE_AWS_REGION?.trim() || "";
}

export function sesFromEmail(): string {
  return process.env.FRONTDESKWISE_SES_FROM_EMAIL?.trim() || "";
}

export function sesConfigured(): boolean {
  return Boolean(awsRegion() && sesFromEmail());
}

export type EmailMessage = {
  to: string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
};

export type EmailSendResult = {
  provider: "ses";
  providerMessageId: string | null;
};

export interface EmailProvider {
  send(message: EmailMessage): Promise<EmailSendResult>;
}

export function sesConfigurationMessage(): string {
  return "Email delivery is not configured. Set AWS_REGION and FRONTDESKWISE_SES_FROM_EMAIL.";
}

export function superAdminEmails(): string[] {
  return (process.env.FRONTDESKWISE_SUPER_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function client(): SESv2Client {
  if (!sesConfigured()) throw new Error(sesConfigurationMessage());
  return new SESv2Client({ region: awsRegion() });
}

export async function sendTransactionalEmail(input: EmailMessage): Promise<EmailSendResult> {
  const to = input.to.map((email) => email.trim().toLowerCase()).filter(Boolean);
  if (!to.length) return { provider: "ses", providerMessageId: null };
  const result = await client().send(new SendEmailCommand({
    FromEmailAddress: process.env.FRONTDESKWISE_SES_FROM_NAME?.trim()
      ? `${process.env.FRONTDESKWISE_SES_FROM_NAME.trim()} <${sesFromEmail()}>`
      : sesFromEmail(),
    Destination: { ToAddresses: to },
    ReplyToAddresses: input.replyTo?.trim() ? [input.replyTo.trim()] : undefined,
    Content: {
      Simple: {
        Subject: { Data: input.subject, Charset: "UTF-8" },
        Body: {
          Text: { Data: input.text, Charset: "UTF-8" },
          ...(input.html ? { Html: { Data: input.html, Charset: "UTF-8" } } : {}),
        },
      },
    },
  }));
  return { provider: "ses", providerMessageId: result.MessageId ?? null };
}

export const sesEmailProvider: EmailProvider = {
  send: sendTransactionalEmail,
};

export async function notifySuperAdmins(input: {
  subject: string;
  text: string;
  html?: string;
}): Promise<void> {
  const recipients = superAdminEmails();
  if (!recipients.length || !sesConfigured()) return;
  await sendTransactionalEmail({ ...input, to: recipients, replyTo: process.env.FRONTDESKWISE_SES_REPLY_TO });
}
