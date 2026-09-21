import { randomInt } from 'node:crypto';
import { FAMILY_CODE_ALPHABET, FAMILY_CODE_LENGTH } from '@/domain/constants';

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

export function isValidFamilyCodeShape(input: string): boolean {
  const normalised = normaliseFamilyCode(input);
  return (
    normalised.length === FAMILY_CODE_LENGTH &&
    [...normalised].every((ch) => FAMILY_CODE_ALPHABET.includes(ch))
  );
}
