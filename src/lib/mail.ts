import 'server-only';
import nodemailer from 'nodemailer';

// Outgoing email (sign-in links). Any SMTP server works; free options:
// Brevo (300 emails/day), Gmail with an app password, or your host's SMTP.
// SMTP_URL=smtps://user:pass@smtp-relay.brevo.com:465
// Without SMTP_URL the message is printed to the server log instead, which
// is what you want on a development laptop.

let transport: ReturnType<typeof nodemailer.createTransport> | null = null;

export const isMailConfigured = Boolean(process.env.SMTP_URL);

export async function sendMail(message: { to: string; subject: string; text: string }): Promise<boolean> {
  if (!process.env.SMTP_URL) {
    console.info(`\n[mail · not sent, SMTP_URL unset] to ${message.to}\n${message.subject}\n\n${message.text}\n`);
    return false;
  }
  transport ??= nodemailer.createTransport(process.env.SMTP_URL);
  await transport.sendMail({
    from: process.env.MAIL_FROM ?? 'i12farm <no-reply@i12farm.local>',
    to: message.to,
    subject: message.subject,
    text: message.text,
  });
  return true;
}
