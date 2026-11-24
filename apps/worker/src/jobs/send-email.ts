import { z } from 'zod';
import type { Mailer } from '../mailer';
import { FROM } from '../mailer';

const payloadSchema = z.object({ to: z.email(), subject: z.string().min(1).max(200), text: z.string().max(20_000) });

export async function sendEmail(payload: unknown, mailer: Mailer): Promise<void> {
  const p = payloadSchema.parse(payload);
  await mailer.send({ from: FROM, to: p.to, subject: p.subject, text: p.text });
}
