/**
 * Live status checker for WAN Show and Notable People with adaptive polling
 *
 * Polling strategy:
 * - > 10 hours away: Check every 5 minutes
 * - 10 minutes - 10 hours away: Check every minute
 * - < 10 minutes away: Check every 30 seconds
 * - After thumbnail is updated: Check every 10 seconds (very imminent!)
 * - Once live: Check every 5 min just to verify still live
 *
 * Notable People: Checked on same interval, but only when close to WAN time
 * or when explicitly enabled (checked during every poll when within 24h of WAN)
 */

import { getNextWAN, getTimeUntil } from './timeUtils.js';
import { log, logDebug, logError } from './logger.js';
import { escapeHtml } from './security.js';

const ENDPOINTS = {
  whenplane: {
    aggregate: 'https://whenplane.com/api/aggregate',
    isThereWan: 'https://whenplane.com/api/isThereWan',
  },
};

const FETCH_TIMEOUT_MS = 10000; // 10 second timeout for API requests

const INTERVALS = {
  DEFAULT: 60 * 1000,      // 1 minute (baseline)
  CLOSE: 30 * 1000,        // 30 seconds (< 10 min to WAN)
  VERY_CLOSE: 10 * 1000,   // 10 seconds (thumbnail updated)
  LIVE: 5 * 60 * 1000,     // 5 minutes (when WAN is live)
};

const THRESHOLDS = {
  CLOSE: 10 * 60 * 1000,   // 10 minutes
};

export interface NotablePersonStatus {
  isLive: boolean;
  title?: string;
  name?: string;
  channel?: string;
  started?: string;
  game?: string;
}

export interface NotablePeopleResponse {
  [key: string]: NotablePersonStatus;
}

export interface AggregateResponse {
  twitch: TwitchResponse;
  youtube: YoutubeResponse;
  isThereWan: IsThereWanResponse;
  hasDone: boolean;
  floatplane: FloatplaneResponse;
  notablePeople: NotablePeopleResponse;
}

export interface YoutubeResponse {
  time: number;
  isLive: boolean;
  isWAN: boolean;
  started?: string;
  videoId?: string;
  forced: boolean;
  upcoming: boolean;
  scheduledStart?: string;
  title?: string;
  thumbnail?: string;
}

export interface FloatplaneResponse {
  isLive: boolean;
  isThumbnailNew: boolean;
  title: string;
  thumbnail: string;
  isWAN: boolean;
  fetched: number;
  description?: string;
}

export interface TwitchResponse {
  isLive: boolean;
  isWAN: boolean;
  started?: string;
  title?: string;
  timestamp?: number;
}

export interface IsThereWanResponse {
  timestamp?: number;
  text: string | null;
  image: string | null;
}

export interface LiveStatus {
  isLive: boolean;
  platforms: {
    youtube: boolean;
    floatplane: boolean;
    twitch: boolean;
  };
  details: {
    youtube?: YoutubeResponse;
    floatplane?: FloatplaneResponse;
    twitch?: TwitchResponse;
  };
  isWAN: boolean;
  title?: string;
  thumbnail?: string;
  started?: string;
  isThumbnailNew?: boolean;
}

export interface NotablePeopleStatus {
  people: NotablePeopleResponse;
  hasAnyLive: boolean;
}

let cache: {
  aggregate?: AggregateResponse;
  lastFetch: number;
} = { lastFetch: 0 };

const CACHE_TIME = 10 * 1000;

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

function validateAggregateResponse(data: unknown): data is AggregateResponse {
  if (!data || typeof data !== 'object') {
    return false;
  }
  
  const d = data as Record<string, unknown>;
  
  // Validate required fields exist and have correct types
  const hasYoutube = d.youtube !== undefined && d.youtube !== null && typeof d.youtube === 'object';
  const hasFloatplane = d.floatplane !== undefined && d.floatplane !== null && typeof d.floatplane === 'object';
  const hasTwitch = d.twitch !== undefined && d.twitch !== null && typeof d.twitch === 'object';
  const hasNotablePeople = d.notablePeople !== undefined && d.notablePeople !== null && typeof d.notablePeople === 'object';
  
  return hasYoutube && hasFloatplane && hasTwitch && hasNotablePeople;
}

export async function fetchAggregateStatus(
  fast = false
): Promise<AggregateResponse | null> {
  try {
    if (!fast && Date.now() - cache.lastFetch < CACHE_TIME && cache.aggregate) {
      return cache.aggregate;
    }

    const response = await fetchWithTimeout(
      `${ENDPOINTS.whenplane.aggregate}?fast=${fast}`,
      {
        headers: {
          'User-Agent': 'WhenPlane-Telegram-Bot (github.com/whenplane)',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    // Validate response structure
    if (!validateAggregateResponse(data)) {
      logError('Invalid aggregate response structure received');
      return cache.aggregate || null;
    }

    cache = {
      aggregate: data as AggregateResponse,
      lastFetch: Date.now(),
    };

    return data as AggregateResponse;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      logError('Aggregate API request timed out');
    } else {
      logError('Error fetching aggregate status:', error);
    }
    return cache.aggregate || null;
  }
}

export async function checkLiveStatus(fast = false): Promise<LiveStatus> {
  const aggregate = await fetchAggregateStatus(fast);

  if (!aggregate) {
    return {
      isLive: false,
      platforms: { youtube: false, floatplane: false, twitch: false },
      details: {},
      isWAN: false,
      isThumbnailNew: false,
    };
  }

  const { youtube, floatplane, twitch } = aggregate;
  const isLive = youtube.isLive || floatplane.isLive || twitch.isLive;
  const isWAN = youtube.isWAN || floatplane.isWAN || twitch.isWAN;
  const isThumbnailNew = floatplane.isThumbnailNew || false;

  let title: string | undefined;
  let thumbnail: string | undefined;
  let started: string | undefined;

  if (youtube.isLive && youtube.isWAN) {
    title = youtube.title;
    thumbnail = youtube.thumbnail;
    started = youtube.started;
  } else if (floatplane.isLive && floatplane.isWAN) {
    title = floatplane.title;
    thumbnail = floatplane.thumbnail;
  } else if (twitch.isLive && twitch.isWAN) {
    title = twitch.title;
    started = twitch.started;
  }

  return {
    isLive,
    platforms: {
      youtube: youtube.isLive,
      floatplane: floatplane.isLive,
      twitch: twitch.isLive,
    },
    details: {
      youtube,
      floatplane,
      twitch,
    },
    isWAN,
    title,
    thumbnail,
    started,
    isThumbnailNew,
  };
}

export async function checkNotablePeopleStatus(
  fast = false
): Promise<NotablePeopleStatus> {
  const aggregate = await fetchAggregateStatus(fast);

  if (!aggregate) {
    return { people: {}, hasAnyLive: false };
  }

  const people = aggregate.notablePeople || {};
  const hasAnyLive = Object.values(people).some((p) => p.isLive);

  return { people, hasAnyLive };
}

export async function getDetailedStatus(): Promise<string> {
  const [liveStatus, isThereWan] = await Promise.all([
    checkLiveStatus(),
    fetchIsThereWan(),
  ]);

  if (isThereWan?.text) {
    return `📢 <b>Update from WhenPlane</b>\n\n${escapeHtml(isThereWan.text)}`;
  }

  let message = '📊 <b>WAN Show Status</b>\n\n';

  const ytStatus = liveStatus.platforms.youtube ? '🟢 LIVE' : '⚪ Offline';
  const fpStatus = liveStatus.platforms.floatplane ? '🟢 LIVE' : '⚪ Offline';
  const twStatus = liveStatus.platforms.twitch ? '🟢 LIVE' : '⚪ Offline';

  message += '<b>Platform Status:</b>\n';
  message += `• <a href="https://youtube.com/@LinusTechTips">YouTube</a>: ${ytStatus}\n`;
  message += `• <a href="https://floatplane.com/channel/linustechtips">Floatplane</a>: ${fpStatus}\n`;
  message += `• <a href="https://twitch.tv/linustech">Twitch</a>: ${twStatus}\n\n`;

  if (liveStatus.isLive && liveStatus.isWAN) {
    message += '🔴 <b>WAN Show is LIVE NOW!</b>\n';
    if (liveStatus.title) {
      message += `\n📺 ${escapeHtml(liveStatus.title)}\n`;
    }
  } else if (liveStatus.isLive && !liveStatus.isWAN) {
    message += '🟡 <b>LTT is streaming (not WAN)</b>\n';
    if (liveStatus.title) {
      message += `\n📺 ${escapeHtml(liveStatus.title)}\n`;
    }
  } else {
    const nextWan = getNextWAN(undefined, false);
    const timeUntil = getTimeUntil(nextWan);

    if (timeUntil.late) {
      message += `⏰ WAN was supposed to start ${timeUntil.string} ago\n`;
    } else {
      message += `⏰ Next WAN in ${timeUntil.string}\n`;
    }

    if (liveStatus.isThumbnailNew) {
      message += '\n📸 <b>New thumbnail detected!</b> Getting close...\n';
    }
  }

  return message;
}

export async function getDetailedNotablePeopleStatus(): Promise<string> {
  const notableStatus = await checkNotablePeopleStatus();

  if (!notableStatus.hasAnyLive) {
    return '🌟 <b>Notable People</b>\n\nNo one is currently streaming.\n\nCheck back later or enable notifications with /settings';
  }

  let message = '🌟 <b>Notable People Live</b>\n\n';

  for (const [person, status] of Object.entries(notableStatus.people)) {
    if (status.isLive) {
      const displayName = escapeHtml(status.name || person);
      const channel = escapeHtml(status.channel || person);
      message += `🔴 <b>${displayName}</b>\n`;
      if (status.title) {
        message += `📺 ${escapeHtml(status.title)}\n`;
      }
      if (status.game) {
        message += `🎮 ${escapeHtml(status.game)}\n`;
      }
      message += `▶️ <a href="https://twitch.tv/${channel}">twitch.tv/${channel}</a>\n\n`;
    }
  }

  return message.trim();
}

function validateIsThereWanResponse(data: unknown): data is IsThereWanResponse {
  if (!data || typeof data !== 'object') {
    return false;
  }
  
  const d = data as Record<string, unknown>;
  
  // text and image can be null or string
  const hasValidText = d.text === null || typeof d.text === 'string';
  const hasValidImage = d.image === null || typeof d.image === 'string';
  
  return hasValidText && hasValidImage;
}

export async function fetchIsThereWan(): Promise<IsThereWanResponse | null> {
  try {
    const response = await fetchWithTimeout(ENDPOINTS.whenplane.isThereWan, {
      headers: {
        'User-Agent': 'WhenPlane-Telegram-Bot (github.com/whenplane)',
      },
    });
    if (!response.ok) return null;
    
    const data = await response.json();
    
    if (!validateIsThereWanResponse(data)) {
      logError('Invalid is-there-wan response structure received');
      return null;
    }
    
    return data as IsThereWanResponse;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      logError('is-there-wan API request timed out');
    } else {
      logError('Error fetching is-there-wan:', error);
    }
    return null;
  }
}

export interface StatusChangeCallbacks {
  onWanStatusChange: (
    newStatus: LiveStatus,
    oldStatus: LiveStatus | null
  ) => void;
  onNotablePeopleChange: (
    newStatus: NotablePeopleStatus,
    oldStatus: NotablePeopleStatus | null
  ) => void;
  onThumbnailUploaded: (
    newStatus: LiveStatus,
    oldStatus: LiveStatus | null
  ) => void;
}

export interface LiveChecker {
  isRunning: boolean;
  lastStatus: LiveStatus | null;
  lastNotableStatus: NotablePeopleStatus | null;
  checkTimeout: ReturnType<typeof setTimeout> | null;
  callbacks: StatusChangeCallbacks | null;
  lastThumbnailNew: boolean;
}

export function createLiveChecker(): LiveChecker {
  return {
    isRunning: false,
    lastStatus: null,
    lastNotableStatus: null,
    checkTimeout: null,
    callbacks: null,
    lastThumbnailNew: false,
  };
}

function shouldCheckNotablePeople(): boolean {
  // Always check notable people - no time restriction
  return true;
}

function calculateInterval(status: LiveStatus | null): number {
  if (status?.isLive && status?.isWAN) {
    logDebug('WAN is live - checking every 5 minutes');
    return INTERVALS.LIVE;
  }

  if (status?.isThumbnailNew) {
    logDebug('New thumbnail detected - checking every 10 seconds');
    return INTERVALS.VERY_CLOSE;
  }

  const nextWan = getNextWAN(undefined, false);
  const timeUntil = getTimeUntil(nextWan);
  const distanceMs = timeUntil.distance;

  if (timeUntil.late) {
    logDebug('WAN is late - checking every 30 seconds');
    return INTERVALS.CLOSE;
  }

  if (distanceMs < THRESHOLDS.CLOSE) {
    logDebug('< 10 minutes until WAN - checking every 30 seconds');
    return INTERVALS.CLOSE;
  }

  // Default: check every minute
  logDebug('Checking every minute');
  return INTERVALS.DEFAULT;
}

function scheduleNextCheck(checker: LiveChecker): void {
  if (!checker.isRunning) return;

  const interval = calculateInterval(checker.lastStatus);

  checker.checkTimeout = setTimeout(async () => {
    if (!checker.isRunning) return;

    const newStatus = await checkLiveStatus();
    const oldStatus = checker.lastStatus;

    const wentLive = newStatus.isLive && (!oldStatus || !oldStatus.isLive);
    const wanStarted = newStatus.isWAN && (!oldStatus || !oldStatus.isWAN);

    if (wentLive || wanStarted) {
      log(`WAN status change: wentLive=${wentLive}, wanStarted=${wanStarted}`);
      checker.callbacks?.onWanStatusChange(newStatus, oldStatus);
    }

    const thumbnailNewlyUploaded = newStatus.isThumbnailNew && 
      (!oldStatus || !oldStatus.isThumbnailNew) &&
      !newStatus.isLive;

    if (thumbnailNewlyUploaded) {
      log('📸 Thumbnail uploaded - WAN might start soon!');
      checker.callbacks?.onThumbnailUploaded(newStatus, oldStatus);
    }

    checker.lastStatus = newStatus;
    checker.lastThumbnailNew = newStatus.isThumbnailNew || false;

    if (shouldCheckNotablePeople()) {
      const newNotable = await checkNotablePeopleStatus();
      const oldNotable = checker.lastNotableStatus;

      const notableWentLive =
        newNotable.hasAnyLive &&
        (!oldNotable ||
          Object.entries(newNotable.people).some(
            ([name, status]) =>
              status.isLive && !oldNotable.people[name]?.isLive
          ));

      if (notableWentLive) {
        log('Notable People status change detected');
        checker.callbacks?.onNotablePeopleChange(newNotable, oldNotable);
      }

      checker.lastNotableStatus = newNotable;
    }

    scheduleNextCheck(checker);
  }, interval);
}

export function startLiveChecker(
  checker: LiveChecker,
  callbacks: StatusChangeCallbacks
): void {
  if (checker.isRunning) return;

  checker.isRunning = true;
  checker.callbacks = callbacks;

  log('Starting adaptive live checker...');
  log('Strategy: 1min (default) → 30sec (<10min) → 10sec (thumbnail) → 5min (live)');
  log('Notable People: Checked on every poll');

  Promise.all([checkLiveStatus(), checkNotablePeopleStatus()]).then(
    ([status, notableStatus]) => {
      checker.lastStatus = status;
      checker.lastNotableStatus = notableStatus;
      log(
        `Initial status: WAN=${status.isLive ? 'LIVE' : 'Offline'}, Notable=${notableStatus.hasAnyLive ? 'LIVE' : 'Offline'}`
      );
      scheduleNextCheck(checker);
    }
  );
}

export function stopLiveChecker(checker: LiveChecker): void {
  if (checker.checkTimeout) {
    clearTimeout(checker.checkTimeout);
    checker.checkTimeout = null;
  }
  checker.isRunning = false;
  checker.callbacks = null;
  log('Stopped live checker');
}
