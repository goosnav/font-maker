/** UUID v4, including browsers where randomUUID is unavailable. */
export function createId(): string {
  const rng = globalThis.crypto;
  if (typeof rng?.randomUUID === "function") return rng.randomUUID();
  if (typeof rng?.getRandomValues !== "function")
    throw Error("This browser cannot create project IDs. Open the app in a current browser.");
  const bytes = rng.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
