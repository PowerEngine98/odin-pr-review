import { sha1Hex } from "./sha1.js";

export function createHash(algorithm: string) {
  if (algorithm !== "sha1") throw new Error(`odin: ${algorithm} is not available in the browser`);
  let text = "";
  const hash = {
    update(chunk: string) {
      text += chunk;
      return hash;
    },
    digest() {
      return sha1Hex(text);
    },
  };
  return hash;
}

export function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}
