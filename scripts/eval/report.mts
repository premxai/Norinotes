/** Rewrites the markdown report from an existing results file, with no model calls: npx tsx scripts/eval/report.mts [results.json] [out.md] */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderReport, type EvalResults } from "./lib/report.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const input = path.resolve(process.argv[2] ?? path.join(here, "results/baseline.json"));
const output = path.resolve(process.argv[3] ?? path.join(here, "../../docs/eval/matching-baseline.md"));
writeFileSync(output, renderReport(JSON.parse(readFileSync(input, "utf8")) as EvalResults));
console.log("wrote " + output);
