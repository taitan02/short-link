import {
  GENERATED_CODE_LENGTH,
  ShortCodeGenerator,
  isReservedCode,
  isValidShortCode,
} from './short-code';

describe('ShortCodeGenerator', () => {
  const generator = new ShortCodeGenerator();

  it('produces fixed-length Base62 codes', () => {
    for (let i = 0; i < 1_000; i++) {
      expect(generator.generate()).toMatch(new RegExp(`^[0-9A-Za-z]{${GENERATED_CODE_LENGTH}}$`));
    }
  });

  it('does not repeat across a large sample', () => {
    const codes = new Set(Array.from({ length: 50_000 }, () => generator.generate()));
    expect(codes.size).toBe(50_000);
  });

  it('uses the whole alphabet (no modulo bias toward a subset)', () => {
    const seen = new Set(Array.from({ length: 2_000 }, () => generator.generate()).join(''));
    expect(seen.size).toBe(62);
  });
});

describe('isValidShortCode', () => {
  it.each(['abc', 'aB91xK', 'summer-sale_2026', 'a'.repeat(32)])('accepts %s', (code) => {
    expect(isValidShortCode(code)).toBe(true);
  });

  it.each(['ab', 'a'.repeat(33), 'has space', 'dot.ted', 'slash/ed', 'ünï', ''])(
    'rejects %s',
    (code) => {
      expect(isValidShortCode(code)).toBe(false);
    },
  );
});

describe('isReservedCode', () => {
  it.each(['api', 'API', 'Docs', 'health', 'admin'])('treats %s as reserved', (code) => {
    expect(isReservedCode(code)).toBe(true);
  });

  it('allows ordinary codes', () => {
    expect(isReservedCode('aB91xK')).toBe(false);
  });
});
