const MIN_PROD_JWT_SECRET_LENGTH = 32;
const LOCAL_NODE_ENVS = new Set(['development', 'test']);
const KNOWN_WEAK_JWT_SECRETS = new Set([
  'dev-secret-change-in-production',
  'change_me_in_production',
  'change-me-in-production',
  'change_me',
  'change-me',
  'changeme',
  'jwt_secret',
  'secret',
  'password',
  'default',
  'replace_with_a_secure_jwt_secret',
  'replace_with_at_least_32_char_random_secret',
]);

export interface RuntimeEnv {
  [key: string]: string | undefined;
  JWT_SECRET?: string;
  NODE_ENV?: string;
}

export function isLocalDevelopmentEnvironment(nodeEnv: string | undefined): boolean {
  return nodeEnv !== undefined && LOCAL_NODE_ENVS.has(nodeEnv);
}

export function getJwtSecret(env: RuntimeEnv = process.env): string {
  const secret = env.JWT_SECRET?.trim();
  if (!secret) {
    throw new Error('JWT_SECRET is required and must be set in environment variables.');
  }
  return secret;
}

export function isStrongJwtSecret(secret: string): boolean {
  const normalizedSecret = secret.trim();
  if (normalizedSecret.length < MIN_PROD_JWT_SECRET_LENGTH) {
    return false;
  }
  return !KNOWN_WEAK_JWT_SECRETS.has(normalizedSecret.toLowerCase());
}

export function validateJwtSecretAtStartup(env: RuntimeEnv = process.env): void {
  const secret = getJwtSecret(env);
  if (isLocalDevelopmentEnvironment(env.NODE_ENV)) {
    return;
  }

  if (!isStrongJwtSecret(secret)) {
    const nodeEnv = env.NODE_ENV ?? 'unset';
    throw new Error(
      `JWT_SECRET is too weak for NODE_ENV=${nodeEnv}. Use a random secret with at least ${MIN_PROD_JWT_SECRET_LENGTH} characters.`
    );
  }
}
