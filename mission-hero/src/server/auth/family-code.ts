import { randomInt } from 'node:crypto';
import {
  FAMILY_CODE_ALPHABET,
  FAMILY_CODE_LENGTH,
  FAMILY_CODE_MAX_LENGTH,
  FAMILY_CODE_MIN_LENGTH,
} from '@/domain/constants';

/**
 * Family codes are read aloud and typed by children, so the alphabet excludes
 * characters that are easy to confuse (0/O, 1/I/L).
 */
export function generateFamilyCode(): string {
  let code = '';
  for (let i = 0; i < FAMILY_CODE_LENGTH; i += 1) {
    code += FAMILY_CODE_ALPHABET[randomInt(FAMILY_CODE_ALPHABET.length)];
  }
  return code;
}

/** Accepts what a child actually types: lower case, spaces, dashes. */
export function normaliseFamilyCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Is this typeable as a family code?
 *
 * Deliberately looser than what `generateFamilyCode` produces. A generated
 * code is 8 characters from a restricted alphabet because nobody chose it and
 * a child has to read it off a screen. A code a family picked for itself —
 * "MILLERS", "NAGELS1" — is theirs, and rejecting it for containing an L
 * would be the app being clever at their expense.
 */
export function isValidFamilyCodeShape(input: string): boolean {
  const normalised = normaliseFamilyCode(input);
  return normalised.length >= FAMILY_CODE_MIN_LENGTH && normalised.length <= FAMILY_CODE_MAX_LENGTH;
}

/** The stricter rule, for codes the app invents rather than accepts. */
export function isGeneratedCodeShape(input: string): boolean {
  const normalised = normaliseFamilyCode(input);
  return (
    normalised.length === FAMILY_CODE_LENGTH &&
    [...normalised].every((ch) => FAMILY_CODE_ALPHABET.includes(ch))
  );
}
