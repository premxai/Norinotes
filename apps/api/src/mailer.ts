/** Outgoing email for account links: Resend when RESEND_API_KEY is set, otherwise the console implementation. */
export type Mail = { to: string; subject: string; text: string; html?: string };

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

const RESEND_URL = "https://api.resend.com/emails";

/**
 * Sends through Resend's HTTP API. `from` must be on a domain verified in Resend (e.g. `Norinote <hello@norinote.xyz>`).
 * A failed send throws with the status only: the response may echo the body, which holds a one-time token.
 */
export function createResendMailer(opts: { apiKey: string; from: string; fetch?: typeof fetch; timeoutMs?: number }): Mailer {
  const doFetch = opts.fetch ?? fetch;
  return {
    async send(mail) {
      const res = await doFetch(RESEND_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: opts.from, to: [mail.to], subject: mail.subject, text: mail.text, ...(mail.html ? { html: mail.html } : {}) }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      });
      if (!res.ok) throw new Error(`Resend refused the message (HTTP ${res.status})`);
    },
  };
}

/** The mailer the config asks for: Resend when both its key and sender are set, otherwise the console. */
export function createMailer(config: { production: boolean; resendApiKey?: string | undefined; mailFrom?: string | undefined }, log?: (line: string) => void): Mailer {
  if (config.resendApiKey && config.mailFrom) return createResendMailer({ apiKey: config.resendApiKey, from: config.mailFrom });
  return createConsoleMailer({ production: config.production, ...(log ? { log } : {}) });
}

/**
 * Prints the message instead of sending it, so a developer can click the link. In production it prints only the
 * recipient and subject: the body holds a one-time token and must never reach the logs.
 */
export function createConsoleMailer(opts: { production?: boolean; log?: (line: string) => void } = {}): Mailer {
  const log = opts.log ?? ((line) => console.log(line));
  return {
    async send(mail) {
      if (opts.production) log(`[mail] not delivered (no mail provider configured): to=${mail.to} subject="${mail.subject}"`);
      else log(`[mail] not sent (console mailer): to=${mail.to} subject="${mail.subject}"\n${mail.text}`);
    },
  };
}

export function verificationEmail(link: string): Pick<Mail, "subject" | "text"> {
  return {
    subject: "Confirm your email for Norinote",
    text: `Confirm your email address to finish setting up Norinote:\n\n${link}\n\nThe link works for 3 days. If you did not create an account, ignore this message.`,
  };
}

export function resetEmail(link: string): Pick<Mail, "subject" | "text"> {
  return {
    subject: "Reset your Norinote password",
    text: `Someone asked to reset the password for this Norinote account. To choose a new one, open:\n\n${link}\n\nThe link works for one hour and only once. If this was not you, ignore this message; your password stays as it is.`,
  };
}
