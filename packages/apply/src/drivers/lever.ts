import type { Driver } from "../types.js";
import { fillFlow, submitFlow, type FlowOptions } from "../flow.js";
import { parseHttpUrl } from "./util.js";

const LEVER_HOST = /^jobs(\.eu)?\.lever\.co$/i;

/** `…/{company}/{id}` -> `…/{company}/{id}/apply`, or null when the URL is not a Lever posting. */
export function leverFormUrl(url: string): string | null {
  const u = parseHttpUrl(url);
  if (!u || !LEVER_HOST.test(u.hostname)) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const [company, id] = parts;
  u.pathname = `/${company}/${id}/apply`;
  u.hash = "";
  return u.toString();
}

const flow: FlowOptions = {
  name: "lever",
  preferredForms: ["#application-form", "form.application-form", "form[action*='lever']"],
  formUrl: leverFormUrl,
};

export const leverDriver: Driver = {
  name: "lever",
  detect: (url) => leverFormUrl(url) !== null,
  formUrl: leverFormUrl,
  fill: (page, ctx) => fillFlow(page, ctx, flow),
  submit: (page, ctx) => submitFlow(page, ctx, flow),
};
