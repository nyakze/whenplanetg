import * as fs from 'fs';
import * as path from 'path';
import { log, logError } from './logger.js';

export interface UserPreferences {
  wan: boolean;
  notablePeople: boolean;
}

export interface SubscriptionData {
  preferences: UserPreferences;
  joinedAt: string;
}

export type SubscriptionsMap = Map<number, SubscriptionData>;

function getProjectRoot(): string {
  const currentFile = path.dirname(new URL(import.meta.url).pathname);
  // If running from dist/, go up one level. If from src/, go up one level too.
  // Both should end up at project root
  return path.resolve(currentFile, '..');
}

const SUBSCRIBERS_FILE = path.join(getProjectRoot(), 'subscriptions.json');

const DEFAULT_PREFERENCES: UserPreferences = {
  wan: true,
  notablePeople: false,
};

export function loadSubscriptions(): SubscriptionsMap {
  try {
    if (fs.existsSync(SUBSCRIBERS_FILE)) {
      const data = fs.readFileSync(SUBSCRIBERS_FILE, 'utf-8');
      const parsed = JSON.parse(data) as Record<string, SubscriptionData>;
      const map = new Map<number, SubscriptionData>();

      for (const [key, value] of Object.entries(parsed)) {
        const userId = parseInt(key, 10);
        if (!isNaN(userId)) {
          map.set(userId, {
            preferences: {
              wan: value.preferences?.wan ?? true,
              notablePeople: value.preferences?.notablePeople ?? false,
            },
            joinedAt: value.joinedAt || new Date().toISOString(),
          });
        }
      }

      log(`📂 Loaded ${map.size} subscribers from file`);
      return map;
    }
  } catch (err) {
    logError('Error loading subscribers:', err);
  }
  return new Map();
}

export function saveSubscriptions(subs: SubscriptionsMap): void {
  try {
    const obj: Record<string, SubscriptionData> = {};
    for (const [userId, data] of subs) {
      obj[userId.toString()] = data;
    }
    fs.writeFileSync(SUBSCRIBERS_FILE, JSON.stringify(obj, null, 2), { mode: 0o600 });
  } catch (err) {
    logError('Error saving subscribers:', err);
  }
}

export function migrateLegacySubscribers(legacyIds: Set<number>): SubscriptionsMap {
  const subs = new Map<number, SubscriptionData>();
  const now = new Date().toISOString();

  for (const userId of legacyIds) {
    subs.set(userId, {
      preferences: { ...DEFAULT_PREFERENCES },
      joinedAt: now,
    });
  }

  return subs;
}

export function getDefaultPreferences(): UserPreferences {
  return { ...DEFAULT_PREFERENCES };
}

export function wantsNotifications(
  subs: SubscriptionsMap,
  userId: number,
  type: keyof UserPreferences
): boolean {
  const data = subs.get(userId);
  return data?.preferences[type] ?? false;
}

export function getSubscribersByType(
  subs: SubscriptionsMap,
  type: keyof UserPreferences
): number[] {
  const result: number[] = [];
  for (const [userId, data] of subs) {
    if (data.preferences[type]) {
      result.push(userId);
    }
  }
  return result;
}

export function formatPreferenceStatus(pref: UserPreferences): string {
  const wan = pref.wan ? '🟢' : '⚪';
  const notable = pref.notablePeople ? '🟢' : '⚪';
  return `${wan} WAN Show | ${notable} Notable People`;
}
