import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { budgets, users } from '../db/schema';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRES_IN = '7d';
const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000001';
const DEFAULT_USER_EMAIL = 'default@tallix.local';

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  language: string;
  country: string | null;
}

export interface LoginResult {
  user: AuthUser;
  token: string;
}

export async function getSetupStatus(): Promise<{ needsSetup: boolean }> {
  const existingUsers = await db.select({ id: users.id, email: users.email }).from(users);
  if (existingUsers.length === 0) {
    return { needsSetup: true };
  }

  const onlyDefaultUser =
    existingUsers.length === 1 &&
    existingUsers[0].id === DEFAULT_USER_ID &&
    existingUsers[0].email === DEFAULT_USER_EMAIL;

  return { needsSetup: onlyDefaultUser };
}

async function ensureDefaultBudget(userId: string): Promise<void> {
  const existingBudget = await db.query.budgets.findFirst();
  if (existingBudget) return;

  await db.insert(budgets).values({
    userId,
    name: 'Mon Budget',
    description: 'Budget par défaut',
  });
}

export async function login(email: string, password: string): Promise<LoginResult> {
  const user = await db.query.users.findFirst({
    where: eq(users.email, email.toLowerCase()),
  });

  if (!user) {
    throw new Error('Invalid email or password');
  }

  if (user.id === DEFAULT_USER_ID && user.email === DEFAULT_USER_EMAIL) {
    throw new Error('Initial setup required');
  }

  const validPassword = await bcrypt.compare(password, user.passwordHash);
  if (!validPassword) {
    throw new Error('Invalid email or password');
  }

  const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      language: user.language,
      country: user.country,
    },
    token,
  };
}

export async function register(email: string, password: string, name?: string): Promise<LoginResult> {
  const normalizedEmail = email.toLowerCase();
  const existingUsers = await db.select({ id: users.id, email: users.email }).from(users);
  const hasOnlyDefaultUser =
    existingUsers.length === 1 &&
    existingUsers[0].id === DEFAULT_USER_ID &&
    existingUsers[0].email === DEFAULT_USER_EMAIL;

  if (!hasOnlyDefaultUser) {
    // Check if user already exists
    const existingUser = await db.query.users.findFirst({
      where: eq(users.email, normalizedEmail),
    });

    if (existingUser) {
      throw new Error('Email already registered');
    }
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, 10);

  let newUser: typeof users.$inferSelect;

  if (hasOnlyDefaultUser) {
    // Claim the placeholder user instead of creating a new row
    const [updatedUser] = await db
      .update(users)
      .set({
        email: normalizedEmail,
        passwordHash,
        name: name || null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, DEFAULT_USER_ID))
      .returning();
    newUser = updatedUser;
  } else {
    // Create user
    const [createdUser] = await db
      .insert(users)
      .values({
        email: normalizedEmail,
        passwordHash,
        name: name || null,
      })
      .returning();
    newUser = createdUser;
  }

  await ensureDefaultBudget(newUser.id);

  const token = jwt.sign({ userId: newUser.id, email: newUser.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

  return {
    user: {
      id: newUser.id,
      email: newUser.email,
      name: newUser.name,
      language: newUser.language,
      country: newUser.country,
    },
    token,
  };
}

export function verifyToken(token: string): { userId: string; email: string } {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; email: string };
    return decoded;
  } catch {
    throw new Error('Invalid token');
  }
}

export async function getUserById(userId: string): Promise<AuthUser | null> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    language: user.language,
    country: user.country,
  };
}

export async function updateUser(
  userId: string,
  updates: { name?: string; language?: string; country?: string }
): Promise<AuthUser> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) {
    throw new Error('User not found');
  }

  const [updatedUser] = await db
    .update(users)
    .set({
      ...(updates.name !== undefined && { name: updates.name || null }),
      ...(updates.language !== undefined && { language: updates.language }),
      ...(updates.country !== undefined && { country: updates.country || null }),
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .returning();

  return {
    id: updatedUser.id,
    email: updatedUser.email,
    name: updatedUser.name,
    language: updatedUser.language,
    country: updatedUser.country,
  };
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) {
    throw new Error('User not found');
  }

  const validPassword = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!validPassword) {
    throw new Error('Invalid current password');
  }

  const newPasswordHash = await bcrypt.hash(newPassword, 10);

  await db.update(users).set({ passwordHash: newPasswordHash, updatedAt: new Date() }).where(eq(users.id, userId));
}
