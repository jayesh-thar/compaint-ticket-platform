import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export interface SendEmailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailTransport {
  send(options: SendEmailOptions): Promise<void>;
}

// Strip CR/LF to prevent email header injection
const sanitizeHeader = (value: string): string => {
  return value.replace(/[\r\n]+/g, ' ').trim();
};

export class ConsoleEmailTransport implements EmailTransport {
  async send(options: SendEmailOptions): Promise<void> {
    const to = sanitizeHeader(options.to);
    const subject = sanitizeHeader(options.subject);

    logger.info(
      {
        to,
        subject,
        preview: options.text,
      },
      `[EMAIL - CONSOLE TRANSPORT] To: ${to} | Subject: ${subject}`
    );
  }
}

export class ResendEmailTransport implements EmailTransport {
  async send(options: SendEmailOptions): Promise<void> {
    const to = sanitizeHeader(options.to);
    const subject = sanitizeHeader(options.subject);

    if (!env.RESEND_API_KEY) {
      logger.warn('RESEND_API_KEY is not configured. Falling back to console logging.');
      console.log(`[EMAIL FALLBACK] To: ${to} | Subject: ${subject}\n${options.text}`);
      return;
    }

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: env.EMAIL_FROM,
          to: [to],
          subject,
          text: options.text,
          html: options.html,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Resend API error (${response.status}): ${errorText}`);
      }
    } catch (err) {
      logger.error({ err, to, subject }, 'Failed to send email via Resend');
      throw err;
    }
  }
}

export const emailTransport: EmailTransport =
  env.EMAIL_TRANSPORT === 'resend' ? new ResendEmailTransport() : new ConsoleEmailTransport();

// Email templates
export const sendVerificationEmail = async (toEmail: string, token: string) => {
  const verifyUrl = `${env.APP_ORIGIN}/verify-email#token=${token}`;
  await emailTransport.send({
    to: toEmail,
    subject: 'Verify your email address',
    text: `Welcome! Please verify your email address by opening the following link:\n\n${verifyUrl}\n\nThis link will expire in 24 hours.\n\nReplies to this email are not monitored.`,
  });
};

export const sendPasswordResetEmail = async (toEmail: string, token: string) => {
  const resetUrl = `${env.APP_ORIGIN}/reset-password#token=${token}`;
  await emailTransport.send({
    to: toEmail,
    subject: 'Reset your password',
    text: `A password reset was requested for your account. You can reset your password using the following link:\n\n${resetUrl}\n\nThis link is valid for 1 hour.\nIf you did not request this, you can safely ignore this email.\n\nReplies to this email are not monitored.`,
  });
};

export const sendAccountExistsNoticeEmail = async (toEmail: string) => {
  const forgotUrl = `${env.APP_ORIGIN}/forgot-password`;
  await emailTransport.send({
    to: toEmail,
    subject: 'Someone tried to register with your email address',
    text: `Someone attempted to create an account using your email address on the Complaint Portal.\n\nIf this was you, you can log in or reset your password here:\n${forgotUrl}\n\nIf you did not attempt to register, no action is required.\n\nReplies to this email are not monitored.`,
  });
};

export const sendInvitationEmail = async (toEmail: string, token: string, orgName: string, role: string) => {
  const inviteUrl = `${env.APP_ORIGIN}/invite#token=${token}`;
  await emailTransport.send({
    to: toEmail,
    subject: `You have been invited to join ${orgName}`,
    text: `You have been invited to join ${orgName} as ${role}.\n\nAccept your invitation by clicking the link below:\n\n${inviteUrl}\n\nThis invitation link is valid for 7 days.\n\nReplies to this email are not monitored.`,
  });
};
