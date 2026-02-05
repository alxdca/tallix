import { and, eq } from 'drizzle-orm';
import { settings } from '../db/schema.js';
import type { DbClient } from '../db/index.js';

// Get all settings for a user as a key-value map
export async function getAllSettings(tx: DbClient, userId: string): Promise<Record<string, string | null>> {
  const allSettings = await tx.query.settings.findMany({
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
export async function getSetting(tx: DbClient, userId: string, key: string): Promise<{ key: string; value: string | null } | null> {
  const setting = await tx.query.settings.findFirst({
    where: and(eq(settings.userId, userId), eq(settings.key, key)),
  });

  if (!setting) return null;

  return { key: setting.key, value: setting.value };
}

// Update or create a setting for a user
export async function upsertSetting(
  tx: DbClient,
  userId: string,
  key: string,
  value: string | null
): Promise<{ key: string; value: string | null; created: boolean }> {
  const [result] = await tx
    .insert(settings)
    .values({ userId, key, value })
    .onConflictDoUpdate({
      target: [settings.userId, settings.key],
      set: { value, updatedAt: new Date() },
    })
    .returning();

  const wasCreated =
    result.createdAt.getTime() === result.updatedAt.getTime() ||
    Math.abs(result.createdAt.getTime() - result.updatedAt.getTime()) < 1000;

  return { key: result.key, value: result.value, created: wasCreated };
}

// Delete a setting for a user
export async function deleteSetting(tx: DbClient, userId: string, key: string) {
  await tx.delete(settings).where(and(eq(settings.userId, userId), eq(settings.key, key)));
}
