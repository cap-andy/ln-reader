import bcrypt from "bcryptjs";
import crypto from "crypto";

const SALT_ROUNDS = 10;

export function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function newSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function newUserId() {
  return crypto.randomUUID();
}

/** Returns an error string, or null if the username is valid. */
export function validateUsername(username) {
  if (typeof username !== "string") return "Username is required.";
  const trimmed = username.trim();
  if (trimmed.length < 3 || trimmed.length > 32) {
    return "Username must be 3–32 characters.";
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    return "Username can only contain letters, numbers, - and _.";
  }
  return null;
}

/** Returns an error string, or null if the password is valid. */
export function validatePassword(password) {
  if (typeof password !== "string" || password.length < 6) {
    return "Password must be at least 6 characters.";
  }
  if (password.length > 200) {
    return "Password is too long.";
  }
  return null;
}
