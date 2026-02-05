import { eq } from 'drizzle-orm';
import { db, settings } from '../db/index.js';

// Get all settings as a key-value map
export async function getAllSettings(): Promise<Record<string, string | null>> {
  const allSettings = await db.query.settings.findMany();
  return allSettings.reduce(
    (acc, s) => {
      acc[s.key] = s.value;
      return acc;
    },
    {} as Record<string, string | null>
  );
}

// Get a specific setting by key
export async function getSetting(key: string): Promise<{ key: string; value: string | null } | null> {
  const setting = await db.query.settings.findFirst({
    where: eq(settings.key, key),
  });

  if (!setting) return null;

  return { key: setting.key, value: setting.value };
}

// Update or create a setting
// Uses upsert pattern to avoid race conditions under concurrent requests
export async function upsertSetting(
  key: string,
  value: string | null
): Promise<{ key: string; value: string | null; created: boolean }> {
  // Try to insert, on conflict (unique key) update the existing row
  const [result] = await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: settings.key,
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

// Delete a setting
export async function deleteSetting(key: string) {
  await db.delete(settings).where(eq(settings.key, key));
}
