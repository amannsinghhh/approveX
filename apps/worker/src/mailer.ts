/**
 * Email notifications. With RESEND_API_KEY set, mails go out through Resend's
 * HTTP API (no SDK dependency); otherwise every send is logged — the
 * notification pipeline (claims, timestamps) behaves identically either way,
 * so flipping prod on is just an env var.
 */

export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
}

export function createMailer(): Mailer {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM ?? 'ApproveX <notifications@approvex.local>';

  if (!apiKey) {
    return {
      send: (to, subject) => {
        console.log(`[worker] mail (log-only): to=${to} subject="${subject}"`);
        return Promise.resolve();
      },
    };
  }

  return {
    async send(to, subject, text) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject, text }),
      });
      if (!res.ok) {
        console.error(`[worker] mail send failed (${res.status}): ${await res.text()}`);
      }
    },
  };
}
