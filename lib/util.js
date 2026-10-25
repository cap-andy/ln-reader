/** Deterministic, filesystem-safe key for a string (URL, id, title, ...). */
export function hashKey(input) {
  return Buffer.from(String(input))
    .toString("base64url")
    .slice(0, 180);
}
