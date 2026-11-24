import nodemailer from 'nodemailer';

export type MailMessage = { from: string; to: string; subject: string; text: string };
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export const FROM = 'SomaOS <no-reply@somaos.local>';

export function createSmtpMailer(url: string): Mailer {
  const transport = nodemailer.createTransport(url);
  return {
    async send(message) {
      await transport.sendMail(message);
    },
  };
}
