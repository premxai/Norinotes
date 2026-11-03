/**
 * A small typed client over the Telegram Bot API (https://core.telegram.org/bots/api), with fetch and nothing else.
 * Only the methods Norinote uses. Errors carry Telegram's `error_code`, `description` and, for 429, `retry_after`.
 */

export type InlineButton =
  | { text: string; callback_data: string }
  | { text: string; url: string };
export type InlineKeyboard = { inline_keyboard: InlineButton[][] };
export type ForceReply = { force_reply: true; input_field_placeholder?: string; selective?: boolean };
export type ReplyMarkup = InlineKeyboard | ForceReply;

export type TgUser = { id: number; is_bot?: boolean; first_name?: string; username?: string; language_code?: string };
export type TgChat = { id: number; type: "private" | "group" | "supergroup" | "channel"; username?: string; first_name?: string };
export type TgMessage = {
  message_id: number;
  date: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
  reply_to_message?: TgMessage;
  reply_markup?: InlineKeyboard;
};
export type TgCallbackQuery = { id: string; from: TgUser; message?: TgMessage; data?: string; chat_instance?: string };
export type TgUpdate = { update_id: number; message?: TgMessage; edited_message?: TgMessage; callback_query?: TgCallbackQuery };

export type SendMessageParams = {
  chat_id: number | string;
  text: string;
  parse_mode?: "HTML" | "MarkdownV2";
  reply_markup?: ReplyMarkup;
  link_preview_options?: { is_disabled: boolean };
  reply_parameters?: { message_id: number; allow_sending_without_reply?: boolean };
  disable_notification?: boolean;
};

export class TelegramApiError extends Error {
  constructor(
    readonly method: string,
    readonly status: number,
    readonly errorCode: number,
    readonly description: string,
    /** Seconds to wait, from `parameters.retry_after` (429 only). */
    readonly retryAfter: number | null,
  ) {
    super(`Telegram ${method} failed: ${errorCode} ${description}`);
    this.name = "TelegramApiError";
  }

  /** The user blocked the bot, deleted the chat, or the chat never existed: stop sending to it. */
  get chatGone(): boolean {
    return this.errorCode === 403 || (this.errorCode === 400 && /chat not found|user is deactivated/i.test(this.description));
  }
}

export type BotClientOptions = {
  token: string;
  /** Replaces the global fetch (tests use a fake Bot API). */
  fetch?: typeof fetch;
  /** Default https://api.telegram.org. */
  baseUrl?: string;
  /** Per request, default 15 s; getUpdates adds its own long-poll timeout. */
  timeoutMs?: number;
};

export type BotClient = {
  call<T>(method: string, params?: Record<string, unknown>, opts?: { timeoutMs?: number }): Promise<T>;
  getMe(): Promise<TgUser>;
  sendMessage(p: SendMessageParams): Promise<TgMessage>;
  editMessageReplyMarkup(p: { chat_id: number | string; message_id: number; reply_markup?: InlineKeyboard }): Promise<TgMessage | true>;
  answerCallbackQuery(p: { callback_query_id: string; text?: string; show_alert?: boolean }): Promise<true>;
  setWebhook(p: { url: string; secret_token?: string; allowed_updates?: string[]; drop_pending_updates?: boolean; max_connections?: number }): Promise<true>;
  deleteWebhook(p?: { drop_pending_updates?: boolean }): Promise<true>;
  getUpdates(p?: { offset?: number; timeout?: number; allowed_updates?: string[] }): Promise<TgUpdate[]>;
};

type ApiReply<T> = { ok: boolean; result?: T; error_code?: number; description?: string; parameters?: { retry_after?: number } };

export function createBotClient(opts: BotClientOptions): BotClient {
  const doFetch = opts.fetch ?? fetch;
  const base = (opts.baseUrl ?? "https://api.telegram.org").replace(/\/+$/, "");

  async function call<T>(method: string, params: Record<string, unknown> = {}, o: { timeoutMs?: number } = {}): Promise<T> {
    const res = await doFetch(`${base}/bot${opts.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(o.timeoutMs ?? opts.timeoutMs ?? 15_000),
    });
    let body: ApiReply<T>;
    try {
      body = (await res.json()) as ApiReply<T>;
    } catch {
      throw new TelegramApiError(method, res.status, res.status, `non-JSON reply (HTTP ${res.status})`, null);
    }
    if (!res.ok || !body.ok) {
      const retry = body.parameters?.retry_after;
      throw new TelegramApiError(method, res.status, body.error_code ?? res.status, body.description ?? "unknown error", typeof retry === "number" ? retry : null);
    }
    return body.result as T;
  }

  return {
    call,
    getMe: () => call<TgUser>("getMe"),
    sendMessage: (p) => call<TgMessage>("sendMessage", p),
    editMessageReplyMarkup: (p) => call<TgMessage | true>("editMessageReplyMarkup", p),
    answerCallbackQuery: (p) => call<true>("answerCallbackQuery", p),
    setWebhook: (p) => call<true>("setWebhook", p),
    deleteWebhook: (p = {}) => call<true>("deleteWebhook", p),
    getUpdates: (p = {}) => call<TgUpdate[]>("getUpdates", p, { timeoutMs: ((p.timeout ?? 0) + 10) * 1000 }),
  };
}
