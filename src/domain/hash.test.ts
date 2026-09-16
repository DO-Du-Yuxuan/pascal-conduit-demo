import { describe, expect, it } from "vitest";
import { sha256Bytes, sha256Text } from "./hash";

describe("portable SHA-256", () => {
  const digest = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c" + "1fa7425e73043362938b9824";

  it("keeps project revision fingerprints stable without Web Crypto", async () => {
    expect(await sha256Text("hello", null)).toBe(digest);
    expect(await sha256Bytes(new TextEncoder().encode("hello"), null)).toBe(digest);
  });

  it("uses the browser digest when one is available", async () => {
    const browserDigest = async (_algorithm: AlgorithmIdentifier, _data: BufferSource) => new TextEncoder().encode("hello").buffer;
    expect(await sha256Text("hello", browserDigest)).toBe("68656c6c6f");
  });
});
