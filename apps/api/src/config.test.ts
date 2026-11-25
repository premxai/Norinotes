import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("allows the local app on :3400 by default, and WEB_URL when it is set", () => {
    expect(loadConfig({}).webUrl).toBe("http://localhost:3400");
    expect(loadConfig({ WEB_URL: "https://norinote.xyz/" }).webUrl).toBe("https://norinote.xyz");
  });

  it("allows the local landing app on :3400 by default outside production, and LANDING_URL when it is set", () => {
    expect(loadConfig({}).landingUrl).toBe("http://localhost:3400");
    expect(loadConfig({ WEB_URL: "http://localhost:3000" }).landingUrl).toBe("http://localhost:3400");
    expect(loadConfig({ LANDING_URL: "https://norinote.xyz/" }).landingUrl).toBe("https://norinote.xyz");
    expect(loadConfig({ NODE_ENV: "production" }).landingUrl).toBeNull();
  });
});
