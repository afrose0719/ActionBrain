import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { decrypt, encrypt } from "../src/lib/crypto.ts";

process.env.AI_KEY_ENCRYPTION_KEY = randomBytes(32).toString("base64");

test("round trip returns the original text", () => {
  const secret = "sk-test-1234567890abcdefghij";
  assert.equal(decrypt(encrypt(secret)), secret);
});

test("the stored value never contains the plain key", () => {
  const stored = encrypt("sk-test-1234567890abcdefghij");
  assert.equal(stored.includes("1234567890"), false);
});

test("the same text encrypts differently each time (random IV)", () => {
  assert.notEqual(encrypt("same"), encrypt("same"));
});

test("tampering is detected", () => {
  const stored = encrypt("sk-test-1234567890abcdefghij");
  const tampered = stored.slice(0, -4) + (stored.endsWith("AAAA") ? "BBBB" : "AAAA");
  assert.throws(() => decrypt(tampered));
});

test("a different server key cannot decrypt", () => {
  const stored = encrypt("secret");
  process.env.AI_KEY_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  assert.throws(() => decrypt(stored));
});

test("a missing or wrong-sized server key fails loudly", () => {
  process.env.AI_KEY_ENCRYPTION_KEY = "";
  assert.throws(() => encrypt("x"), /AI_KEY_ENCRYPTION_KEY/);
  process.env.AI_KEY_ENCRYPTION_KEY = Buffer.from("too short").toString("base64");
  assert.throws(() => encrypt("x"), /AI_KEY_ENCRYPTION_KEY/);
});
