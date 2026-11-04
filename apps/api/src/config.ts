import path from "node:path";
import { DEV_SESSION_SECRET } from "@norinote/telegram";

/** API settings read from the environment. Everything has a default so `npm run dev:api` works with no setup. */
export type ApiConfig = {
  port: number;
  production: boolean;
  /** The only browser origin allowed to call the API with credentials. */
  webUrl: string;
  /** LANDING_URL: the marketing site, which hosts sign-in and sign-up. Also allowed as a browser origin, and the base of
   * the links in account emails when set. */
  landingUrl: string | null;
  /** Public URL of the API; also accepted as an Origin on unsafe requests. */
  apiUrl: string | null;
  cookieName: string;
  /** `secure` flag on the session cookie (production). */
  secureCookies: boolean;
  sessionDays: number;
  /** Trust X-Forwarded-For / Fly-Client-IP for rate limiting. Only set behind a proxy that overwrites them. */
  trustProxy: boolean;
  /** Domain of the per-user inbound addresses. Undefined in production until INBOUND_EMAIL_DOMAIN is set. */
  inboundEmailDomain: string | undefined;
  inboundWebhookSecret: string | undefined;
  artifactsDir: string;
  /** ALLOW_REAL_SUBMIT === "true". Without it applications are dry runs. */
  allowRealSubmit: boolean;
  telegramBotToken: string | undefined;
  telegramBotUsername: string | null;
  /** SESSION_SECRET: signs Telegram button data and derives the Telegram webhook secret. A fixed value in development. */
  sessionSecret: string | undefined;
  maxResumeBytes: number;
  /** RESEND_API_KEY and MAIL_FROM: both set means account emails are really sent. */
  resendApiKey: string | undefined;
  mailFrom: string | undefined;
  /** BRANDFETCH_CLIENT_ID: public id for company logos on job cards. Unset = no logo URLs (cards show a letter tile). */
  brandfetchClientId: string | undefined;
};

const clean = (v: string | undefined): string | undefined => v?.trim() || undefined;

export function loadConfig(env: Record<string, string | undefined> = process.env): ApiConfig {
  const production = env.NODE_ENV === "production";
  const port = Number.parseInt(env.PORT ?? "", 10);
  return {
    port: Number.isInteger(port) && port > 0 ? port : 4000,
    production,
    webUrl: (clean(env.WEB_URL) ?? "http://localhost:3000").replace(/\/+$/, ""),
    landingUrl: clean(env.LANDING_URL)?.replace(/\/+$/, "") ?? null,
    apiUrl: clean(env.API_URL)?.replace(/\/+$/, "") ?? null,
    cookieName: clean(env.SESSION_COOKIE_NAME) ?? "norinote_session",
    secureCookies: production,
    sessionDays: 30,
    trustProxy: env.TRUST_PROXY === "true",
    inboundEmailDomain: clean(env.INBOUND_EMAIL_DOMAIN) ?? (production ? undefined : "inbox.norinote.local"),
    inboundWebhookSecret: clean(env.INBOUND_WEBHOOK_SECRET),
    artifactsDir: path.resolve(clean(env.ARTIFACTS_DIR) ?? path.join("data", "artifacts")),
    allowRealSubmit: env.ALLOW_REAL_SUBMIT === "true",
    telegramBotToken: clean(env.TELEGRAM_BOT_TOKEN),
    telegramBotUsername: clean(env.TELEGRAM_BOT_USERNAME)?.replace(/^@/, "") ?? null,
    sessionSecret: clean(env.SESSION_SECRET) ?? (production ? undefined : DEV_SESSION_SECRET),
    maxResumeBytes: 10 * 1024 * 1024,
    resendApiKey: clean(env.RESEND_API_KEY),
    mailFrom: clean(env.MAIL_FROM),
    brandfetchClientId: clean(env.BRANDFETCH_CLIENT_ID),
  };
}
