import { randomInt } from 'node:crypto';
import {
  FAMILY_CODE_ALPHABET,
  FAMILY_CODE_LENGTH,
  FAMILY_CODE_LEGACY_MIN_LENGTH,
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
 * Could this be somebody's family code, for the purpose of looking it up?
 *
 * Deliberately looser than what a family may choose today: a code saved under
 * an older, shorter rule must still get its children in. Tightening what can
 * be *set* is a policy change; tightening what can be *typed* would be a
 * lockout, and the child would have no idea why.
 */
export function isValidFamilyCodeShape(input: string): boolean {
  const normalised = normaliseFamilyCode(input);
  return (
    normalised.length >= FAMILY_CODE_LEGACY_MIN_LENGTH &&
    normalised.length <= FAMILY_CODE_MAX_LENGTH
  );
}

/**
 * May a family set this as their code?
 *
 * Eight characters minimum: this code is the only thing between a stranger
 * and a list of children's nicknames, and a short one is guessable. Any
 * letter or digit is allowed — the restricted alphabet exists to keep a
 * *generated* code readable, not to veto somebody's own family name.
 */
export function isChoosableFamilyCodeShape(input: string): boolean {
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
