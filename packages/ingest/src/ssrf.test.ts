import { afterEach, describe, expect, it, vi } from "vitest";
import { publicLookup, routeFetch } from "./__fixtures__/helpers.js";
import { assertPublicUrl, isPrivateAddress, safeFetch, UnsafeUrlError } from "./ssrf.js";

afterEach(() => { vi.unstubAllEnvs(); });

describe("isPrivateAddress", () => {
  it("flags internal ranges and passes public ones", () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:2800:220:1:248:1893:25c8:1946"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
});

describe("assertPublicUrl", () => {
  it("refuses loopback, private, internal names and odd schemes", async () => {
    for (const url of [
      "http://localhost:3000/x", "http://127.0.0.1/", "http://[::1]/", "http://169.254.169.254/latest/meta-data",
      "http://10.1.2.3/job", "http://intranet/job", "http://db.internal/job", "file:///etc/passwd", "ftp://example.com/a",
    ]) {
      await expect(assertPublicUrl(url, { lookup: publicLookup }), url).rejects.toBeInstanceOf(UnsafeUrlError);
    }
    await expect(assertPublicUrl("not a url")).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("refuses a public-looking name that resolves to a private address, or does not resolve", async () => {
    await expect(assertPublicUrl("https://sneaky.example.com/", { lookup: async () => ["10.0.0.9"] })).rejects.toThrow(/not a public website/);
    await expect(assertPublicUrl("https://sneaky.example.com/", { lookup: async () => ["93.184.216.34", "127.0.0.1"] })).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(assertPublicUrl("https://nowhere.example.com/", { lookup: async () => [] })).rejects.toThrow(/Could not find/);
  });

  it("accepts public hosts, and ALLOW_PRIVATE_FETCH=1 turns the guard off", async () => {
    expect((await assertPublicUrl("https://boards.greenhouse.io/acme", { lookup: publicLookup })).hostname).toBe("boards.greenhouse.io");
    vi.stubEnv("ALLOW_PRIVATE_FETCH", "1");
    expect((await assertPublicUrl("http://localhost:3000/x")).hostname).toBe("localhost");
  });
});

describe("safeFetch", () => {
  it("checks every redirect hop", async () => {
    const f = routeFetch({
      "https://a.example.com/": () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } }),
    });
    await expect(safeFetch("https://a.example.com/start", {}, { fetch: f, lookup: publicLookup })).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("follows safe redirects and stops after the limit", async () => {
    const ok = routeFetch({
      "https://a.example.com/": () => new Response(null, { status: 301, headers: { location: "https://b.example.com/done" } }),
      "https://b.example.com/": () => new Response("hi"),
    });
    expect(await (await safeFetch("https://a.example.com/x", {}, { fetch: ok, lookup: publicLookup })).text()).toBe("hi");

    const loop = routeFetch({ "https://a.example.com/": () => new Response(null, { status: 302, headers: { location: "https://a.example.com/again" } }) });
    await expect(safeFetch("https://a.example.com/x", {}, { fetch: loop, lookup: publicLookup, maxRedirects: 2 })).rejects.toThrow(/Too many redirects/);
  });
});
