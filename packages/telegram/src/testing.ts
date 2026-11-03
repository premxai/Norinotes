/**
 * A fake Telegram Bot API for tests: a `fetch` that records every call and answers like Telegram would. No network.
 */
export type FakeCall = { method: string; params: Record<string, unknown> };
type Failure = { method: string; error_code: number; description: string; retry_after?: number };

export function fakeBotApi() {
  const calls: FakeCall[] = [];
  const failures: Failure[] = [];
  let messageId = 1000;

  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = url.slice(url.lastIndexOf("/") + 1);
    const params = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    calls.push({ method, params });
    const i = failures.findIndex((f) => f.method === method);
    if (i >= 0) {
      const f = failures.splice(i, 1)[0]!;
      return new Response(JSON.stringify({ ok: false, error_code: f.error_code, description: f.description, ...(f.retry_after !== undefined ? { parameters: { retry_after: f.retry_after } } : {}) }), { status: f.error_code, headers: { "content-type": "application/json" } });
    }
    let result: unknown = true;
    if (method === "sendMessage") result = { message_id: ++messageId, date: Math.floor(Date.now() / 1000), chat: { id: Number(params.chat_id), type: "private" }, text: params.text };
    else if (method === "getMe") result = { id: 1, is_bot: true, username: "NorinoteBot" };
    else if (method === "getUpdates") result = [];
    return new Response(JSON.stringify({ ok: true, result }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  return {
    fetch: fetchFn,
    calls,
    /** The next call of `method` fails with this error (once). */
    failNext(method: string, error_code: number, description: string, retry_after?: number) {
      failures.push({ method, error_code, description, ...(retry_after !== undefined ? { retry_after } : {}) });
    },
    of: (method: string) => calls.filter((c) => c.method === method),
    sent: () => calls.filter((c) => c.method === "sendMessage").map((c) => c.params as { chat_id: number | string; text: string; reply_markup?: { inline_keyboard?: { text: string; callback_data?: string; url?: string }[][]; force_reply?: boolean } }),
    lastSent() { const s = this.sent(); return s[s.length - 1]; },
    clear() { calls.length = 0; },
  };
}
export type FakeBotApi = ReturnType<typeof fakeBotApi>;

let updateSeq = 1;
/** A private-chat text message update. */
export function textUpdate(chatId: number, text: string, extra: { replyTo?: number } = {}) {
  return {
    update_id: updateSeq++,
    message: {
      message_id: updateSeq * 7, date: Math.floor(Date.now() / 1000), chat: { id: chatId, type: "private" as const }, from: { id: chatId, first_name: "Ada" }, text,
      ...(extra.replyTo ? { reply_to_message: { message_id: extra.replyTo, date: 0, chat: { id: chatId, type: "private" as const } } } : {}),
    },
  };
}

/** A button press on message `messageId` in `chatId`. */
export function callbackUpdate(chatId: number, messageId: number, data: string, keyboard?: unknown) {
  return {
    update_id: updateSeq++,
    callback_query: {
      id: `cb${updateSeq}`, from: { id: chatId, first_name: "Ada" }, data,
      message: { message_id: messageId, date: 0, chat: { id: chatId, type: "private" as const }, ...(keyboard ? { reply_markup: keyboard } : {}) },
    },
  };
}
