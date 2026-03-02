import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifySignature } from "../verify.js";

const SECRET = "test-secret";

function sign(body: string): string {
  return "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");
}

describe("verifySignature", () => {
  it("accepts valid signature", () => {
    const body = Buffer.from('{"action":"opened"}');
    expect(verifySignature(body, sign(body.toString()), SECRET)).toBe(true);
  });

  it("rejects wrong secret", () => {
    const body = Buffer.from('{"action":"opened"}');
    expect(verifySignature(body, sign("wrong"), SECRET)).toBe(false);
  });

  it("rejects missing signature", () => {
    expect(verifySignature(Buffer.from("{}"), undefined, SECRET)).toBe(false);
  });

  it("rejects signature without sha256= prefix", () => {
    const body = Buffer.from("{}");
    const hex = createHmac("sha256", SECRET).update(body).digest("hex");
    expect(verifySignature(body, hex, SECRET)).toBe(false);
  });
});
