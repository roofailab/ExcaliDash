import bcrypt from "bcrypt";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { validateApiKey } from "../apiKey";
import { config } from "../../config";

describe("validateApiKey", () => {
  const originalApiKeys = config.apiKeys;

  afterEach(() => {
    config.apiKeys = originalApiKeys;
  });

  it("returns true for a valid key matching a hash", async () => {
    const plainKey = "super-secret-key";
    const hash = await bcrypt.hash(plainKey, 10);
    config.apiKeys = [hash];

    expect(await validateApiKey(plainKey)).toBe(true);
  });

  it("returns false for an invalid key", async () => {
    const hash = await bcrypt.hash("correct-key", 10);
    config.apiKeys = [hash];

    expect(await validateApiKey("wrong-key")).toBe(false);
  });

  it("returns true if any hash in the list matches", async () => {
    const key1Hash = await bcrypt.hash("key-one", 10);
    const key2Hash = await bcrypt.hash("key-two", 10);
    config.apiKeys = [key1Hash, key2Hash];

    expect(await validateApiKey("key-two")).toBe(true);
  });

  it("returns false when config.apiKeys is empty", async () => {
    config.apiKeys = [];

    expect(await validateApiKey("any-key")).toBe(false);
  });
});
