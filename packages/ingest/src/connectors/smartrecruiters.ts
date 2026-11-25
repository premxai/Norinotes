import { placeholder } from "./stubs.js";

/**
 * SmartRecruiters is not collected: its robots.txt (api.smartrecruiters.com and the careers hosts) disallows every path
 * for our User-Agent. A placeholder (`ready: false`) keeps it out of polling, seed imports and pasted links.
 */
export const smartrecruiters = placeholder("smartrecruiters");
