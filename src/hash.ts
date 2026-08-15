import { createHash } from "node:crypto";

export function hashClientKey(key: string): string {
  if (typeof key !== "string" || key.length === 0) {
    throw new TypeError("key must be a non-empty string");
  }
  return createHash("sha256").update(key, "utf8").digest("hex");
}
