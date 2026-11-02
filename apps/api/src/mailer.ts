/** Outgoing email for account links. The provider is chosen later; until then the console implementation is used. */
export type Mail = { to: string; subject: string; text: string; html?: string };

export interface Mailer {
  send(mail: Mail): Promise<void>;
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
