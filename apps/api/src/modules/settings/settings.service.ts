import {
  defaultPlatformSettings,
  diffSettings,
  mergeSettings,
  platformSettingsSchema,
  type PlatformSettings,
} from '@relaxgo/shared';
import { PlatformSettingsModel } from '../../models/settings.model';
import { audit, type Actor } from '../../lib/audit';
import { ApiError } from '../../lib/errors';

const CACHE_TTL_MS = 10_000;
let cache: { value: PlatformSettings; version: number; at: number } | null = null;

/** Read the live configuration (cached briefly; every business rule flows from here). */
export async function getSettings(): Promise<PlatformSettings> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  let doc = await PlatformSettingsModel.findOne({ key: 'global' });
  if (!doc) {
    doc = await PlatformSettingsModel.create({ key: 'global', data: defaultPlatformSettings(), version: 1 });
  }
  // Parse on read: tolerates additive schema evolution by filling new defaults.
  const value = platformSettingsSchema.parse(
    Object.assign({}, defaultPlatformSettings(), doc.data as Partial<PlatformSettings>),
  );
  cache = { value, version: doc.version, at: Date.now() };
  return value;
}

export async function getSettingsWithVersion(): Promise<{ settings: PlatformSettings; version: number }> {
  const settings = await getSettings();
  return { settings, version: cache!.version };
}

/**
 * Apply a partial patch (deep-merged, arrays replaced), re-validate against the schema,
 * bump the version and audit every changed path with old → new (spec §69).
 */
export async function updateSettings(patch: unknown, actor: Actor, reason?: string): Promise<{ settings: PlatformSettings; version: number; changes: number }> {
  const current = await getSettings();
  let next: PlatformSettings;
  try {
    next = mergeSettings(current, patch);
  } catch (err) {
    throw ApiError.unprocessable(`Invalid settings: ${err instanceof Error ? err.message.slice(0, 300) : 'validation failed'}`);
  }
  const changes = diffSettings(current, next);
  if (!changes.length) {
    const { version } = await getSettingsWithVersion();
    return { settings: current, version, changes: 0 };
  }
  const doc = await PlatformSettingsModel.findOneAndUpdate(
    { key: 'global' },
    { $set: { data: next, updatedBy: actor.kind === 'admin' ? actor.id : undefined }, $inc: { version: 1 } },
    { returnDocument: 'after', upsert: true },
  );
  await audit({
    actor,
    action: 'settings.update',
    target: { kind: 'platform_settings', id: 'global' },
    before: Object.fromEntries(changes.map((c) => [c.path, c.from])),
    after: Object.fromEntries(changes.map((c) => [c.path, c.to])),
    reason,
  });
  cache = null;
  return { settings: next, version: doc!.version, changes: changes.length };
}

/** Test/boot helper. */
export function invalidateSettingsCache(): void {
  cache = null;
}
