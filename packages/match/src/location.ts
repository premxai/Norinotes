/**
 * Location text to place. Job systems write locations every way there is: "2 Locations", "NYC - 1211 Ave of the
 * Americas", "California - San Francisco", "US-CA-San Francisco", "Europe Remote - Parking", "Remote - Philippines",
 * "Zürich, Switzerland | remote, Germany". `parseLocation` turns that into cities, US states, countries (ISO-like codes,
 * "US", "GB", "DE") and supranational regions ("EU", "LATAM", ...), plus whether the job is remote, hybrid or on site.
 * It is deterministic, table driven and never guesses beyond its tables: text it does not know leaves the place unknown.
 *
 * `placeAllowed` answers the question the matcher needs: may a user who can work in these countries take this job? A
 * remote job limited to other countries or regions ("Europe Remote", "Remote - Philippines", "EMEA") is not allowed for
 * a US-based user and a "Remote - US" job is not allowed for a UK-based one; an unrestricted "Remote" is allowed for
 * everyone, and so is a job whose place cannot be read.
 */

export type RemoteMode = "remote" | "hybrid" | "onsite" | "unknown";

export type ParsedLocation = {
  /** City names as written in the tables (lower case), for example "san francisco". */
  cities: string[];
  /** US state codes ("CA"). */
  states: string[];
  /** Country codes ("US", "GB", "DE"), from countries, states and cities named. */
  countries: string[];
  /** Supranational scopes: "EU" (Europe, EMEA, DACH...), "LATAM", "APAC", "MENA", "AFRICA", "NA" (North America), "GLOBAL". */
  regions: string[];
  remote: RemoteMode;
  /** "2 Locations", "Multiple locations": the job is in several places that are not named. */
  multiple: boolean;
  /** True when nothing in the text was recognised. */
  unknown: boolean;
};

// ---- tables -----------------------------------------------------------------------------------------------------------

const US_STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY",
  louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO",
  montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA",
  washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC", "washington dc": "DC", "washington d c": "DC",
};
const STATE_CODES = new Set(Object.values(US_STATES));

/** Country names and common aliases to codes. Kept to what job feeds actually write. */
const COUNTRIES: Record<string, string> = {
  "united states": "US", "united states of america": "US", usa: "US", "u s a": "US", "u s": "US", america: "US",
  "united kingdom": "GB", uk: "GB", "u k": "GB", "great britain": "GB", britain: "GB", england: "GB", scotland: "GB", wales: "GB", "northern ireland": "GB",
  canada: "CA", mexico: "MX", brazil: "BR", brasil: "BR", argentina: "AR", chile: "CL", colombia: "CO", peru: "PE", uruguay: "UY", "costa rica": "CR",
  germany: "DE", deutschland: "DE", france: "FR", spain: "ES", portugal: "PT", italy: "IT", netherlands: "NL", "the netherlands": "NL", holland: "NL",
  belgium: "BE", switzerland: "CH", austria: "AT", ireland: "IE", poland: "PL", sweden: "SE", norway: "NO", denmark: "DK", finland: "FI",
  "czech republic": "CZ", czechia: "CZ", romania: "RO", hungary: "HU", greece: "GR", ukraine: "UA", bulgaria: "BG", serbia: "RS", croatia: "HR",
  estonia: "EE", latvia: "LV", lithuania: "LT", slovakia: "SK", slovenia: "SI", luxembourg: "LU", iceland: "IS", turkey: "TR", turkiye: "TR",
  israel: "IL", "united arab emirates": "AE", uae: "AE", "saudi arabia": "SA", qatar: "QA", egypt: "EG", jordan: "JO", morocco: "MA",
  "south africa": "ZA", nigeria: "NG", kenya: "KE", ghana: "GH",
  india: "IN", pakistan: "PK", bangladesh: "BD", "sri lanka": "LK", china: "CN", "hong kong": "HK", taiwan: "TW", japan: "JP",
  korea: "KR", "south korea": "KR", "republic of korea": "KR", singapore: "SG", malaysia: "MY", indonesia: "ID", philippines: "PH",
  thailand: "TH", vietnam: "VN", "viet nam": "VN", australia: "AU", "new zealand": "NZ",
};

/** Two-letter codes accepted as countries when written as a token on their own (US states win over countries). */
const COUNTRY_CODE_TOKENS: Record<string, string> = {
  us: "US", usa: "US", uk: "GB", gb: "GB", uae: "AE", mx: "MX", br: "BR", fr: "FR", es: "ES", nl: "NL", ie: "IE", pl: "PL", se: "SE",
  ch: "CH", at: "AT", au: "AU", nz: "NZ", jp: "JP", sg: "SG", kr: "KR", tw: "TW", ph: "PH", cn: "CN", hk: "HK", pt: "PT", it: "IT",
};

/** Supranational scopes. "americas" and "north america" include the US. */
const REGIONS: Record<string, string> = {
  europe: "EU", eu: "EU", emea: "EU", "european union": "EU", dach: "EU", nordics: "EU", benelux: "EU", eea: "EU", cet: "EU", cest: "EU",
  latam: "LATAM", "latin america": "LATAM", "south america": "LATAM", "central america": "LATAM",
  apac: "APAC", "asia pacific": "APAC", asia: "APAC", "southeast asia": "APAC", anz: "APAC", oceania: "APAC",
  mena: "MENA", "middle east": "MENA", gcc: "MENA", africa: "AFRICA",
  "north america": "NA", americas: "NA", amer: "NA", noram: "NA",
  worldwide: "GLOBAL", global: "GLOBAL", anywhere: "GLOBAL", international: "GLOBAL", "any location": "GLOBAL",
};

/** Countries inside each region (enough to decide; a region not listed here is treated as "not the user's"). */
const REGION_COUNTRIES: Record<string, readonly string[]> = {
  EU: ["GB", "DE", "FR", "ES", "PT", "IT", "NL", "BE", "CH", "AT", "IE", "PL", "SE", "NO", "DK", "FI", "CZ", "RO", "HU", "GR", "UA", "BG", "RS", "HR", "EE", "LV", "LT", "SK", "SI", "LU", "IS", "TR"],
  LATAM: ["MX", "BR", "AR", "CL", "CO", "PE", "UY", "CR"],
  APAC: ["IN", "PK", "BD", "LK", "CN", "HK", "TW", "JP", "KR", "SG", "MY", "ID", "PH", "TH", "VN", "AU", "NZ"],
  MENA: ["IL", "AE", "SA", "QA", "EG", "JO", "MA", "TR"],
  AFRICA: ["ZA", "NG", "KE", "GH", "EG", "MA"],
  NA: ["US", "CA", "MX"],
};

/** Cities job feeds name without a country. US cities carry their state. */
const CITIES: Record<string, { country: string; state?: string }> = {
  "new york": { country: "US", state: "NY" }, "new york city": { country: "US", state: "NY" }, nyc: { country: "US", state: "NY" }, brooklyn: { country: "US", state: "NY" },
  manhattan: { country: "US", state: "NY" }, "san francisco": { country: "US", state: "CA" }, "sf bay area": { country: "US", state: "CA" }, "bay area": { country: "US", state: "CA" },
  "los angeles": { country: "US", state: "CA" }, "san jose": { country: "US", state: "CA" }, "san diego": { country: "US", state: "CA" }, "san mateo": { country: "US", state: "CA" },
  "palo alto": { country: "US", state: "CA" }, "menlo park": { country: "US", state: "CA" }, "mountain view": { country: "US", state: "CA" }, sunnyvale: { country: "US", state: "CA" },
  "redwood city": { country: "US", state: "CA" }, "santa clara": { country: "US", state: "CA" }, oakland: { country: "US", state: "CA" }, berkeley: { country: "US", state: "CA" },
  irvine: { country: "US", state: "CA" }, "santa monica": { country: "US", state: "CA" }, seattle: { country: "US", state: "WA" }, bellevue: { country: "US", state: "WA" },
  redmond: { country: "US", state: "WA" }, austin: { country: "US", state: "TX" }, dallas: { country: "US", state: "TX" }, houston: { country: "US", state: "TX" },
  "san antonio": { country: "US", state: "TX" }, boston: { country: "US", state: "MA" }, chicago: { country: "US", state: "IL" }, denver: { country: "US", state: "CO" },
  boulder: { country: "US", state: "CO" }, atlanta: { country: "US", state: "GA" }, miami: { country: "US", state: "FL" }, orlando: { country: "US", state: "FL" },
  tampa: { country: "US", state: "FL" }, philadelphia: { country: "US", state: "PA" }, pittsburgh: { country: "US", state: "PA" }, phoenix: { country: "US", state: "AZ" },
  portland: { country: "US", state: "OR" }, eugene: { country: "US", state: "OR" }, minneapolis: { country: "US", state: "MN" }, "saint cloud": { country: "US", state: "MN" },
  "st cloud": { country: "US", state: "MN" }, "salt lake city": { country: "US", state: "UT" }, raleigh: { country: "US", state: "NC" }, charlotte: { country: "US", state: "NC" },
  nashville: { country: "US", state: "TN" }, detroit: { country: "US", state: "MI" }, "ann arbor": { country: "US", state: "MI" }, columbus: { country: "US", state: "OH" },
  "st louis": { country: "US", state: "MO" }, "saint louis": { country: "US", state: "MO" }, "kansas city": { country: "US", state: "MO" }, baltimore: { country: "US", state: "MD" },
  "jersey city": { country: "US", state: "NJ" }, "las vegas": { country: "US", state: "NV" },
  london: { country: "GB" }, manchester: { country: "GB" }, edinburgh: { country: "GB" }, belfast: { country: "GB" },
  toronto: { country: "CA" }, vancouver: { country: "CA" }, montreal: { country: "CA" }, ottawa: { country: "CA" }, calgary: { country: "CA" },
  berlin: { country: "DE" }, munich: { country: "DE" }, hamburg: { country: "DE" }, frankfurt: { country: "DE" }, paris: { country: "FR" },
  amsterdam: { country: "NL" }, dublin: { country: "IE" }, zurich: { country: "CH" }, geneva: { country: "CH" }, madrid: { country: "ES" },
  barcelona: { country: "ES" }, lisbon: { country: "PT" }, warsaw: { country: "PL" }, krakow: { country: "PL" }, prague: { country: "CZ" },
  stockholm: { country: "SE" }, copenhagen: { country: "DK" }, oslo: { country: "NO" }, helsinki: { country: "FI" }, vienna: { country: "AT" },
  brussels: { country: "BE" }, budapest: { country: "HU" }, bucharest: { country: "RO" }, kyiv: { country: "UA" }, istanbul: { country: "TR" },
  "tel aviv": { country: "IL" }, dubai: { country: "AE" }, "abu dhabi": { country: "AE" }, riyadh: { country: "SA" }, cairo: { country: "EG" }, amman: { country: "JO" },
  bangalore: { country: "IN" }, bengaluru: { country: "IN" }, hyderabad: { country: "IN" }, mumbai: { country: "IN" }, pune: { country: "IN" },
  delhi: { country: "IN" }, "new delhi": { country: "IN" }, gurgaon: { country: "IN" }, gurugram: { country: "IN" }, chennai: { country: "IN" }, noida: { country: "IN" },
  tokyo: { country: "JP" }, osaka: { country: "JP" }, seoul: { country: "KR" }, taipei: { country: "TW" }, shanghai: { country: "CN" }, beijing: { country: "CN" },
  shenzhen: { country: "CN" }, "kuala lumpur": { country: "MY" }, jakarta: { country: "ID" }, denpasar: { country: "ID" }, bangkok: { country: "TH" },
  manila: { country: "PH" }, "metro manila": { country: "PH" }, "ho chi minh city": { country: "VN" }, hanoi: { country: "VN" }, sydney: { country: "AU" },
  melbourne: { country: "AU" }, auckland: { country: "NZ" }, "sao paulo": { country: "BR" }, "rio de janeiro": { country: "BR" }, "mexico city": { country: "MX" },
  "buenos aires": { country: "AR" }, bogota: { country: "CO" }, santiago: { country: "CL" }, lima: { country: "PE" }, "cape town": { country: "ZA" },
  johannesburg: { country: "ZA" }, lagos: { country: "NG" }, nairobi: { country: "KE" },
};

/** Longest names first, so "new york city" wins over "new york" and "south africa" over "africa". */
const byLength = (o: Record<string, unknown>) => Object.keys(o).sort((a, b) => b.length - a.length);
const COUNTRY_NAMES = byLength(COUNTRIES).filter((k) => k.length > 2);
const REGION_NAMES = byLength(REGIONS).filter((k) => k.length > 3);
const CITY_NAMES = byLength(CITIES);
const STATE_NAMES = byLength(US_STATES);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (name: string) => new RegExp(`(?:^|[^a-z0-9])${escape(name)}(?![a-z0-9])`);
const RE_CACHE = new Map<string, RegExp>();
const has = (text: string, name: string) => {
  let re = RE_CACHE.get(name);
  if (!re) { re = wordRe(name); RE_CACHE.set(name, re); }
  return re.test(text);
};

/** Lower case, accents removed, "." dropped ("U.S." -> "us"), everything else but letters, digits, "|", ",", "-" and "(" ")" a space. */
function clean(text: string): string {
  return text
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b([a-z])\.(?=[a-z]\.)/g, "$1 ")
    .replace(/\./g, "")
    .replace(/[–—]/g, "-")
    .replace(/[^a-z0-9|,;/()\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const REMOTE = /\b(?:remote|work from home|wfh|home office|home based|homebased|telecommute|telework|virtual|distributed|anywhere)\b/;
const HYBRID = /\bhybrid\b/;
const ONSITE = /\b(?:on site|onsite|on-site|in office|in-office)\b/;
const MULTIPLE = /\b(?:\d+|multiple|several|various)\s+locations?\b/;

/** Remove a matched name from the text so it is not read twice ("new york" the city, then "new york" the state). */
const strip = (text: string, name: string) => text.replace(new RegExp(`(^|[^a-z0-9])${escape(name)}(?![a-z0-9])`, "g"), "$1 ");

const PARSE_CACHE = new Map<string, ParsedLocation>();
const PARSE_CACHE_MAX = 50_000;

/** Parsed place of a location text (cached; the result is shared, do not change it). */
export function parseLocation(raw: string | null | undefined, remoteFlag = false): ParsedLocation {
  const key = `${remoteFlag ? 1 : 0}|${raw ?? ""}`;
  const hit = PARSE_CACHE.get(key);
  if (hit) return hit;
  if (PARSE_CACHE.size >= PARSE_CACHE_MAX) PARSE_CACHE.clear();
  const parsed = parseLocationUncached(raw, remoteFlag);
  PARSE_CACHE.set(key, parsed);
  return parsed;
}

function parseLocationUncached(raw: string | null | undefined, remoteFlag: boolean): ParsedLocation {
  const out: ParsedLocation = { cities: [], states: [], countries: [], regions: [], remote: "unknown", multiple: false, unknown: true };
  const add = (list: string[], v: string) => { if (!list.includes(v)) list.push(v); };
  let text = clean(raw ?? "");
  if (REMOTE.test(text) || remoteFlag) out.remote = "remote";
  else if (HYBRID.test(text)) out.remote = "hybrid";
  else if (ONSITE.test(text)) out.remote = "onsite";
  if (MULTIPLE.test(text)) out.multiple = true;
  if (!text) return out;

  // "US-CA-San Francisco", "US-Remote", "US PA Home Office": a leading country code and state code.
  text = text.replace(/^([a-z]{2,3})-([a-z]{2})-/, "$1, $2, ").replace(/^([a-z]{2,3})-(?=[a-z])/, "$1, ");

  for (const name of CITY_NAMES) {
    if (!has(text, name)) continue;
    const c = CITIES[name]!;
    add(out.cities, name);
    add(out.countries, c.country);
    if (c.state) add(out.states, c.state);
    text = strip(text, name);
  }
  // States before countries, so "New Mexico" is a state and not Mexico.
  for (const name of STATE_NAMES) {
    if (!has(text, name)) continue;
    add(out.states, US_STATES[name]!);
    add(out.countries, "US");
    text = strip(text, name);
  }
  for (const name of COUNTRY_NAMES) {
    if (!has(text, name)) continue;
    add(out.countries, COUNTRIES[name]!);
    text = strip(text, name);
  }
  for (const name of REGION_NAMES) {
    if (!has(text, name)) continue;
    add(out.regions, REGIONS[name]!);
    text = strip(text, name);
  }
  // Short codes count only when written in capitals ("San Francisco, CA", "Remote, UK", "US-CA-...", "EMEA"), so the
  // words "or", "in", "at" and "me" are never read as Oregon, India, Austria or Maine.
  const original = (raw ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\./g, "");
  for (const token of original.split(/[\s,;|/()\-–—]+/).filter(Boolean)) {
    const lower = token.toLowerCase();
    if (lower === "usa" || lower === "uae") { add(out.countries, lower === "usa" ? "US" : "AE"); continue; }
    if (!/^[A-Z]{2,4}$/.test(token)) continue;
    if (token.length === 2 && STATE_CODES.has(token)) { add(out.states, token); add(out.countries, "US"); continue; }
    const country = COUNTRY_CODE_TOKENS[lower];
    if (country) { add(out.countries, country); continue; }
    const region = REGIONS[lower];
    if (region) add(out.regions, region);
  }
  out.unknown = out.cities.length === 0 && out.states.length === 0 && out.countries.length === 0 && out.regions.length === 0;
  return out;
}

/** "San Francisco, CA" -> "US". The country of a free-text place, or null when it names none or several. */
export function countryOf(raw: string | null | undefined): string | null {
  const p = parseLocation(raw);
  return p.countries.length === 1 ? p.countries[0]! : null;
}

/**
 * May someone who can work in `allowed` (country codes) take a job at `place`? Countries named decide; failing that,
 * regions; a place that names neither (plain "Remote", "2 Locations") is allowed. An empty `allowed` allows everything.
 */
export function placeAllowed(place: ParsedLocation, allowed: ReadonlySet<string>): boolean {
  if (allowed.size === 0) return true;
  if (place.countries.length > 0) return place.countries.some((c) => allowed.has(c));
  if (place.regions.length > 0) {
    return place.regions.some((r) => r === "GLOBAL" || (REGION_COUNTRIES[r] ?? []).some((c) => allowed.has(c)));
  }
  return true;
}

const REGION_LABELS: Record<string, string> = { EU: "Europe", NA: "North America", LATAM: "Latin America", APAC: "Asia Pacific", MENA: "the Middle East", AFRICA: "Africa", GLOBAL: "anywhere" };
const titleCase = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
/** First name listed for each code in the table: "US" -> "United States", "GB" -> "United Kingdom". */
const COUNTRY_LABELS: Record<string, string> = {};
for (const [name, code] of Object.entries(COUNTRIES)) if (!(code in COUNTRY_LABELS) && name.length > 3) COUNTRY_LABELS[code] = titleCase(name);

/** Readable name of where a place is limited to, for a gate reason. */
export function placeLabel(place: ParsedLocation): string {
  const names = [...place.countries.map((c) => COUNTRY_LABELS[c] ?? c), ...place.regions.map((r) => REGION_LABELS[r] ?? r)];
  return names.slice(0, 3).join(", ") + (names.length > 3 ? " and more" : "");
}

/** For the fit: 1 when the place is clear (or an unrestricted remote job), 0.92 when it cannot be read ("2 Locations", no text). */
export function placeFactor(raw: string | null | undefined, remoteFlag = false): number {
  const p = parseLocation(raw, remoteFlag);
  if (p.multiple && p.countries.length === 0) return 0.92;
  if (p.unknown && p.remote !== "remote") return 0.92;
  return 1;
}
