/**
 * Name of the httpOnly cookie apps/api sets on sign-in. The proxy only checks that it is present (the API validates it).
 * Override with SESSION_COOKIE_NAME if the API uses another name.
 */
export const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME || "norinote_session";
