import 'server-only';
import bcrypt from 'bcryptjs';
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH } from '@/domain/constants';

/** Cost 12 is the current sensible default for an interactive login. */
const COST = 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, COST);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function hashPin(pin: string): Promise<string> {
  assertPinShape(pin);
  return bcrypt.hash(pin, COST);
}

/**
 * Always runs a bcrypt comparison, even when the child has no PIN set, so the
 * "no such profile" and "wrong PIN" paths take the same time (docs/03 §5).
 */
const DUMMY_HASH = '$2a$12$Mq9iRbW2xMt02OKkYnznT.diodEtzpn.pTPrsFa74RHyXKJaYe3ou';

export async function verifyPin(pin: string, hash: string | null): Promise<boolean> {
  if (!hash) {
    // A real hash, so the work done matches the success path exactly.
    await bcrypt.compare(pin, DUMMY_HASH);
    return false;
  }
  return bcrypt.compare(pin, hash);
}

export function assertPinShape(pin: string): void {
  if (!new RegExp(`^\\d{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`).test(pin)) {
    throw new Error(`A PIN must be ${PIN_MIN_LENGTH}–${PIN_MAX_LENGTH} digits.`);
  }
}
