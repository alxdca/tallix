import { describe, expect, test } from 'vitest';
import { getJwtSecret, isStrongJwtSecret, validateJwtSecretAtStartup, type RuntimeEnv } from '../src/config/security.js';

function createEnv(overrides: RuntimeEnv): RuntimeEnv {
  return overrides;
}

describe('JWT secret security validation', () => {
  test('throws when JWT_SECRET is missing', () => {
    expect(() => getJwtSecret(createEnv({ NODE_ENV: 'development' }))).toThrow(/JWT_SECRET is required/);
  });

  test('startup validation fails when JWT_SECRET is missing', () => {
    expect(() => validateJwtSecretAtStartup(createEnv({ NODE_ENV: 'production' }))).toThrow(/JWT_SECRET is required/);
  });

  test('allows weak secret in local development', () => {
    expect(() => validateJwtSecretAtStartup(createEnv({ NODE_ENV: 'development', JWT_SECRET: 'dev-secret' }))).not.toThrow();
  });

  test('rejects weak JWT_SECRET in production', () => {
    expect(() => validateJwtSecretAtStartup(createEnv({ NODE_ENV: 'production', JWT_SECRET: 'short-secret' }))).toThrow(
      /JWT_SECRET is too weak/
    );
  });

  test('rejects known placeholder JWT_SECRET in production', () => {
    expect(() =>
      validateJwtSecretAtStartup(
        createEnv({
          NODE_ENV: 'production',
          JWT_SECRET: 'REPLACE_WITH_AT_LEAST_32_CHAR_RANDOM_SECRET',
        })
      )
    ).toThrow(/JWT_SECRET is too weak/);
  });

  test('accepts strong JWT_SECRET in production', () => {
    expect(() =>
      validateJwtSecretAtStartup(
        createEnv({
          NODE_ENV: 'production',
          JWT_SECRET: 'e8f848ad03bc5d607fd7858fc67ec54a5f03f9f2d4507115',
        })
      )
    ).not.toThrow();
  });

  test('requires at least 32 characters for strong production secret', () => {
    expect(isStrongJwtSecret('1234567890123456789012345678901')).toBe(false);
    expect(isStrongJwtSecret('12345678901234567890123456789012')).toBe(true);
  });
});
