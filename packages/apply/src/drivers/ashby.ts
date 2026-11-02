import type { Driver } from "../types.js";
import { fillFlow, submitFlow, type FlowOptions } from "../flow.js";
import { parseHttpUrl } from "./util.js";

/** `…/{company}/{id}` -> `…/{company}/{id}/application`, or null when the URL is not an Ashby posting. */
export function ashbyFormUrl(url: string): string | null {
  const u = parseHttpUrl(url);
  if (!u || !/^jobs\.ashbyhq\.com$/i.test(u.hostname)) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const [company, id] = parts;
  u.pathname = `/${company}/${id}/application`;
  u.hash = "";
  return u.toString();
}

const flow: FlowOptions = {
  name: "ashby",
  preferredForms: ["form[class*='application' i]", "form:has(input[name='_systemfield_email'])"],
  formUrl: ashbyFormUrl,
  // The form renders client-side; wait for the first field before discovery looks.
  beforeDiscover: async (page) => {
    await page.locator("input[name='_systemfield_email'], input[type=email]").first().waitFor({ timeout: 15_000 }).catch(() => {});
  },
};

export const ashbyDriver: Driver = {
  name: "ashby",
  detect: (url) => ashbyFormUrl(url) !== null,
  formUrl: ashbyFormUrl,
  fill: (page, ctx) => fillFlow(page, ctx, flow),
  submit: (page, ctx) => submitFlow(page, ctx, flow),
};
