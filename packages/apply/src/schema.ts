/**
 * Form schemas: the list of fields an application form asks, read before the click. Greenhouse publishes it without a key
 * (boards-api ...?questions=true); Lever and Ashby are read from the page in a warm browser context without filling.
 * Also: job URL parsing, the canonical job URL (one application per user and URL) and the recipe fingerprint.
 */
import { createHash } from "node:crypto";
import type { FieldType, SlotField } from "@norinote/answers";
import { getJson } from "@norinote/ingest";
import type { DiscoveredField } from "./form.js";
import { parseHttpUrl } from "./drivers/util.js";

export type AtsName = "greenhouse" | "lever" | "ashby" | "workday" | "smartrecruiters" | "workable" | "icims" | "unknown";

/** One field of a form schema. `key` is stable for the posting: the field's name or id, never a generated id. */
export type SchemaField = SlotField & { multiple?: boolean };

export type FormSchema = {
  ats: AtsName;
  companyToken: string;
  jobId: string;
  formUrl: string | null;
  source: "api" | "dom";
  fields: SchemaField[];
};

export type ParsedJobUrl = { ats: AtsName; token: string; jobId: string };

const GH_HOST = /^(boards|job-boards)(\.eu)?\.greenhouse\.io$/i;

/** Which job system, company token and posting id a URL points at. Unknown systems keep the host as token. */
export function parseJobUrl(url: string): ParsedJobUrl | null {
  const u = parseHttpUrl(url);
  if (!u) return null;
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);
  if (GH_HOST.test(host)) {
    if (/^\/embed\/job_app\/?$/i.test(u.pathname)) {
      const token = u.searchParams.get("for"), id = u.searchParams.get("token");
      return token && id ? { ats: "greenhouse", token, jobId: id } : null;
    }
    const m = /^\/([^/]+)\/jobs\/(\d+)/.exec(u.pathname);
    return m ? { ats: "greenhouse", token: m[1]!, jobId: m[2]! } : null;
  }
  if (/^jobs(\.eu)?\.lever\.co$/.test(host) && parts.length >= 2) return { ats: "lever", token: parts[0]!, jobId: parts[1]! };
  if (host === "jobs.ashbyhq.com" && parts.length >= 2) return { ats: "ashby", token: parts[0]!, jobId: parts[1]! };
  if (/\.myworkdayjobs\.com$|\.myworkdaysite\.com$|(^|\.)workday\.com$/.test(host)) return { ats: "workday", token: host.split(".")[0]!, jobId: parts.at(-1) ?? "" };
  if (/(^|\.)smartrecruiters\.com$/.test(host) && parts.length >= 2) return { ats: "smartrecruiters", token: parts[0]!, jobId: parts[1]! };
  if (/(^|\.)workable\.com$/.test(host)) return { ats: "workable", token: host === "apply.workable.com" ? (parts[0] ?? "") : host.split(".")[0]!, jobId: parts.find((p) => /^[0-9A-F]{6,}$/i.test(p)) ?? parts.at(-1) ?? "" };
  if (/(^|\.)icims\.com$/.test(host)) return { ats: "icims", token: host.split(".")[0]!, jobId: /\/jobs\/(\d+)/.exec(u.pathname)?.[1] ?? "" };
  const ghJid = u.searchParams.get("gh_jid");
  if (ghJid) return { ats: "greenhouse", token: "", jobId: ghJid };
  return null;
}

/**
 * The URL that identifies a posting, whatever link it was reached by: lower-case host, no query (except gh_jid), no hash,
 * no trailing /apply or /application, Greenhouse boards and embeds folded into job-boards.greenhouse.io/{token}/jobs/{id}.
 */
export function canonicalJobUrl(url: string): string {
  const p = parseJobUrl(url);
  if (p?.ats === "greenhouse" && p.token) return `https://job-boards.greenhouse.io/${p.token.toLowerCase()}/jobs/${p.jobId}`;
  if (p?.ats === "lever") return `https://jobs.lever.co/${p.token.toLowerCase()}/${p.jobId.toLowerCase()}`;
  if (p?.ats === "ashby") return `https://jobs.ashbyhq.com/${p.token.toLowerCase()}/${p.jobId.toLowerCase()}`;
  const u = parseHttpUrl(url);
  if (!u) return url.trim();
  const keep = u.searchParams.get("gh_jid");
  u.hash = "";
  u.search = keep ? `?gh_jid=${keep}` : "";
  u.hostname = u.hostname.toLowerCase();
  u.pathname = u.pathname.replace(/\/(apply|application)\/?$/i, "").replace(/\/+$/, "") || "/";
  return u.toString();
}

// ---- Greenhouse -------------------------------------------------------------------------------------------------------

type GhValue = { label: string; value: number | string };
type GhField = { name: string; type: string; values?: GhValue[] };
type GhQuestion = { label: string; required: boolean; description?: string | null; fields: GhField[] };
type GhDemographic = { id: number; label: string; required: boolean; type: string; answer_options?: { id: number; label: string; free_form?: boolean }[] };
export type GreenhouseJobJson = {
  id: number;
  questions?: GhQuestion[];
  location_questions?: GhQuestion[];
  compliance?: { type: string; questions?: GhQuestion[] }[] | null;
  data_compliance?: { type: string; requires_consent?: boolean; requires_processing_consent?: boolean; requires_retention_consent?: boolean; demographic_data_consent_applies?: boolean }[] | null;
  demographic_questions?: { questions?: GhDemographic[] } | null;
};

const GH_TYPES: Record<string, FieldType> = {
  input_text: "text", textarea: "textarea", input_file: "file", multi_value_single_select: "select", multi_value_multi_select: "multiselect", input_hidden: "text",
};

const clean = (s: string) => s.replace(/\s+/g, " ").replace(/\*/g, "").trim();

/** Fields of a Greenhouse posting from its public questions JSON. Alternatives (resume_text) and hidden fields are left out. */
export function greenhouseSchemaFromJson(json: GreenhouseJobJson, token: string, jobId: string): FormSchema {
  const fields: SchemaField[] = [];
  const add = (q: GhQuestion, section: SchemaField["section"]) => {
    for (const f of q.fields) {
      if (f.type === "input_hidden" || /_text$/.test(f.name) && q.fields.some((g) => g.type === "input_file")) continue;
      const type = GH_TYPES[f.type] ?? "text";
      const options = (f.values ?? []).map((v) => clean(v.label));
      fields.push({
        key: f.name, name: f.name, id: f.name, label: clean(q.label), type: type === "select" && options.length === 0 ? "text" : type,
        required: q.required, options, section, multiple: f.type === "multi_value_multi_select",
      });
    }
  };
  for (const q of json.questions ?? []) add(q, "main");
  for (const q of json.location_questions ?? []) {
    for (const f of q.fields) if (f.type !== "input_hidden") fields.push({ key: f.name, name: f.name, id: "candidate-location", label: clean(q.label), type: "location", required: q.required, options: [], section: "main" });
  }
  for (const c of json.compliance ?? []) for (const q of c.questions ?? []) add(q, "compliance");
  for (const d of json.demographic_questions?.questions ?? []) {
    fields.push({
      key: String(d.id), id: String(d.id), label: clean(d.label), required: d.required, section: "eeo",
      type: d.type === "multi_value_multi_select" ? "multiselect" : "select", multiple: d.type === "multi_value_multi_select",
      options: (d.answer_options ?? []).map((a) => clean(a.label)),
    });
  }
  const gdpr = (json.data_compliance ?? []).find((c) => c.type === "gdpr");
  if (gdpr?.requires_consent || gdpr?.requires_processing_consent) {
    fields.push({ key: "gdpr_processing_consent_given", name: "gdpr_processing_consent_given", label: "I consent to the processing of my personal data", type: "checkbox", required: true, options: [], section: "compliance" });
  }
  if (gdpr?.demographic_data_consent_applies && (json.demographic_questions?.questions?.length ?? 0) > 0) {
    fields.push({ key: "gdpr_demographic_data_consent_given", name: "gdpr_demographic_data_consent_given", label: "I consent to the collection and storage of my demographic data", type: "checkbox", required: true, options: [], section: "compliance" });
  }
  return { ats: "greenhouse", companyToken: token, jobId, formUrl: `https://job-boards.greenhouse.io/${token}/jobs/${jobId}`, source: "api", fields };
}

/** GET the public form schema of a Greenhouse posting (no key needed). Null when the posting is gone. */
export async function fetchGreenhouseSchema(token: string, jobId: string, opts: { fetch?: typeof fetch } = {}): Promise<FormSchema | null> {
  const json = await getJson<GreenhouseJobJson>(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs/${encodeURIComponent(jobId)}?questions=true`, opts.fetch ? { fetch: opts.fetch } : {});
  return json ? greenhouseSchemaFromJson(json, token, jobId) : null;
}

// ---- from the page ----------------------------------------------------------------------------------------------------

const KIND_TYPES: Record<DiscoveredField["kind"], FieldType> = {
  text: "text", email: "email", tel: "tel", textarea: "textarea", select: "select", radio: "radio", checkbox: "checkbox", file: "file", unknown: "text",
};

/** Turn discovered page fields into schema fields (Lever, Ashby, anything read from the DOM). */
export function schemaFieldsFromDom(fields: DiscoveredField[]): SchemaField[] {
  return fields.map((f) => {
    let type: FieldType = KIND_TYPES[f.kind];
    if (f.widget === "yesno") type = "boolean";
    else if (f.widget === "location") type = "location";
    else if (f.kind === "checkbox" && (f.options?.length ?? 0) > 1) type = "multiselect";
    else if (f.kind === "select" && f.multiple) type = "multiselect";
    return {
      key: f.key ?? f.name ?? f.id ?? f.label, name: f.name ?? null, id: f.id ?? null, label: f.label, type, required: f.required,
      options: f.widget === "yesno" ? ["Yes", "No"] : f.options ?? [], autocomplete: f.autocomplete ?? null, placeholder: f.placeholder ?? null,
      section: /^eeo\[|^surveysResponses/.test(f.name ?? "") ? "eeo" : "main",
    };
  });
}

// ---- fingerprint ------------------------------------------------------------------------------------------------------

const normLabel = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** hash(ats, company token, sorted normalised label|type|options). Same form, same fingerprint, whoever applies. */
export function formFingerprint(ats: string, companyToken: string, fields: Pick<SchemaField, "label" | "type" | "options">[]): string {
  const parts = fields.map((f) => `${normLabel(f.label)}|${f.type}|${[...f.options].map(normLabel).sort().join(",")}`).sort();
  return createHash("sha256").update(`${ats}\n${companyToken.toLowerCase()}\n${parts.join("\n")}`).digest("hex").slice(0, 32);
}
