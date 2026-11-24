import { describe, expect, it } from 'vitest';
import type { Mailer, MailMessage } from '../../src/mailer';
import { sendEmail } from '../../src/jobs/send-email';

class FakeMailer implements Mailer {
  sent: MailMessage[] = [];
  async send(m: MailMessage) {
    this.sent.push(m);
  }
}

describe('sendEmail', () => {
  it('sends the payload through the mailer with the SomaOS sender', async () => {
    const mailer = new FakeMailer();
    await sendEmail({ to: 'pat@example.test', subject: 'Shift posted', text: 'Hello' }, mailer);
    expect(mailer.sent).toEqual([{ from: 'SomaOS <no-reply@somaos.local>', to: 'pat@example.test', subject: 'Shift posted', text: 'Hello' }]);
  });

  it('rejects malformed payloads', async () => {
    await expect(sendEmail({ to: 'nope', subject: 'x', text: 'y' }, new FakeMailer())).rejects.toThrow();
  });
});
