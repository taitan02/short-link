import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';

const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

// 62^7 ≈ 3.5e12 codes: at 100M links a random insert collides ~0.003% of the time,
// which the bounded retry in LinksService absorbs.
export const GENERATED_CODE_LENGTH = 7;

// Superset of generated codes; also what a custom alias must match. Codes are case-sensitive.
export const SHORT_CODE_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;

// Top-level paths the app serves itself, or may serve later. Compared case-insensitively so
// "API" or "Docs" can't be registered to look like an official page.
const RESERVED_CODES = new Set([
  'admin',
  'api',
  'app',
  'assets',
  'auth',
  'dashboard',
  'docs',
  'docs-json',
  'docs-yaml',
  'health',
  'login',
  'logout',
  'metrics',
  'register',
  'settings',
  'signup',
  'static',
  'status',
  'www',
]);

export function isReservedCode(code: string): boolean {
  return RESERVED_CODES.has(code.toLowerCase());
}

export function isValidShortCode(code: string): boolean {
  return SHORT_CODE_PATTERN.test(code);
}

// Injectable so tests can force collisions deterministically.
@Injectable()
export class ShortCodeGenerator {
  generate(): string {
    let code = '';
    // randomInt is CSPRNG-backed and unbiased, unlike randomBytes % 62.
    for (let i = 0; i < GENERATED_CODE_LENGTH; i++) {
      code += BASE62_ALPHABET.charAt(randomInt(BASE62_ALPHABET.length));
    }
    return code;
  }
}
