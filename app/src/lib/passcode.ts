import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

export function hashPasscode(passcode: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(passcode, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPasscode(passcode: string, stored: string): boolean {
  const [salt, derivedHex] = stored.split(":");
  if (!salt || !derivedHex) return false;
  const derived = scryptSync(passcode, salt, 64);
  const expected = Buffer.from(derivedHex, "hex");
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export function generatePasscode(): string {
  // Six digits, easy to read out loud / type on a phone.
  return String(Math.floor(100000 + Math.random() * 900000));
}
