import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadDotEnv } from "./env.js";

describe("loadDotEnv", () => {
  const file = (body: string) => {
    const dir = mkdtempSync(path.join(tmpdir(), "norinote-env-"));
    const p = path.join(dir, ".env");
    writeFileSync(p, body);
    return p;
  };

  it("sets values from the file over the shell, skipping comments and empty values", () => {
    const env: NodeJS.ProcessEnv = { OPENAI_API_KEY: "stale-shell-key", KEEP: "shell" };
    const set = loadDotEnv(file("# comment\nOPENAI_API_KEY=\"from-file\"\nKEEP=\nPORT=4000\nbad line\n"), env);
    expect(env.OPENAI_API_KEY).toBe("from-file");
    expect(env.KEEP).toBe("shell");
    expect(env.PORT).toBe("4000");
    expect(set).toEqual(["OPENAI_API_KEY", "PORT"]);
  });

  it("does nothing when there is no file", () => {
    const env: NodeJS.ProcessEnv = {};
    expect(loadDotEnv(path.join(tmpdir(), "no-such-dir-norinote", ".env"), env)).toEqual([]);
    expect(env).toEqual({});
  });
});
