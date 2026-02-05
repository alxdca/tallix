import { and, eq } from 'drizzle-orm';
import { db, settings } from '../db/index.js';

// Get all settings for a user as a key-value map
export async function getAllSettings(userId: string): Promise<Record<string, string | null>> {
  const allSettings = await db.query.settings.findMany({
    where: eq(settings.userId, userId),
  });
  return allSettings.reduce(
    (acc, s) => {
      acc[s.key] = s.value;
      return acc;
    },
    {} as Record<string, string | null>
  );
}

// Get a specific setting by key for a user
export async function getSetting(userId: string, key: string): Promise<{ key: string; value: string | null } | null> {
  const setting = await db.query.settings.findFirst({
    where: and(eq(settings.userId, userId), eq(settings.key, key)),
  });

  if (!setting) return null;

  return { key: setting.key, value: setting.value };
}

// Update or create a setting for a user
// Uses upsert pattern to avoid race conditions under concurrent requests
export async function upsertSetting(
  userId: string,
  key: string,
  value: string | null
): Promise<{ key: string; value: string | null; created: boolean }> {
  // Try to insert, on conflict (unique userId + key) update the existing row
  const [result] = await db
    .insert(settings)
    .values({ userId, key, value })
    .onConflictDoUpdate({
      target: [settings.userId, settings.key],
      set: { value, updatedAt: new Date() },
    })
    .returning();

  // We can't easily determine if it was created or updated with upsert,
  // so we check if createdAt equals updatedAt (within a small window)
  const wasCreated =
    result.createdAt.getTime() === result.updatedAt.getTime() ||
    Math.abs(result.createdAt.getTime() - result.updatedAt.getTime()) < 1000;

  return { key: result.key, value: result.value, created: wasCreated };
}

// Delete a setting for a user
export async function deleteSetting(userId: string, key: string) {
  await db.delete(settings).where(and(eq(settings.userId, userId), eq(settings.key, key)));
}
