import { validateEnv } from './env';

function captureError(fn: () => unknown): Error {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }
  throw new Error('Expected function to throw');
}

describe('validateEnv', () => {
  it('applies defaults when optional variables are missing', () => {
    expect(validateEnv({})).toEqual({ NODE_ENV: 'development', LOG_LEVEL: 'info', PORT: 3000 });
  });

  it('coerces PORT from string', () => {
    expect(validateEnv({ PORT: '8080' }).PORT).toBe(8080);
  });

  it.each([['abc'], ['0'], ['70000'], ['3000.5']])('rejects invalid PORT %s', (port) => {
    expect(() => validateEnv({ PORT: port })).toThrow(/PORT/);
  });

  it('rejects unknown NODE_ENV', () => {
    expect(() => validateEnv({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('does not echo rejected values in the error message', () => {
    const error = captureError(() => validateEnv({ LOG_LEVEL: 'super-secret-value' }));
    expect(error.message).toMatch(/LOG_LEVEL/);
    expect(error.message).not.toContain('super-secret-value');
  });
});
