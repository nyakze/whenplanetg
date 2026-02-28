import { Telegraf, Markup } from 'telegraf';
import { message } from 'telegraf/filters';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import {
  getNextWAN,
  getClosestWan,
  getTimeUntil,
  timeString,
  colonTimeString,
} from './timeUtils.js';
import {
  checkLiveStatus,
  getDetailedStatus,
  getDetailedNotablePeopleStatus,
  createLiveChecker,
  startLiveChecker,
  stopLiveChecker,
  type LiveStatus,
  type LiveChecker,
  type NotablePeopleStatus,
} from './liveChecker.js';
import {
  loadSubscriptions,
  saveSubscriptions,
  migrateLegacySubscribers,
  getSubscribersByType,
  formatPreferenceStatus,
  type SubscriptionsMap,
  type UserPreferences,
} from './subscriptionManager.js';
import { log, logDebug, logError, VERBOSE } from './logger.js';
import { escapeHtml, isValidUserId, truncateMessage } from './security.js';

dotenv.config();

const ADMIN_USER_IDS = process.env.ADMIN_USER_ID?.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id)) || [];

const RATE_LIMIT_MS = 5000;
const ADMIN_RATE_LIMIT_MS = 2000; // 2 seconds for admin commands (admins are trusted)
const userRateLimits = new Map<number, number>();
const adminRateLimits = new Map<number, number>();

function isAdmin(userId: number): boolean {
  return ADMIN_USER_IDS.includes(userId);
}

function checkAdminRateLimit(userId: number): boolean {
  const now = Date.now();
  const lastUse = adminRateLimits.get(userId);
  if (lastUse && now - lastUse < ADMIN_RATE_LIMIT_MS) {
    return false;
  }
  adminRateLimits.set(userId, now);
  return true;
}

function checkRateLimit(userId: number): boolean {
  const now = Date.now();
  const lastUse = userRateLimits.get(userId);
  if (lastUse && now - lastUse < RATE_LIMIT_MS) {
    return false;
  }
  userRateLimits.set(userId, now);
  return true;
}

function getRemainingCooldown(userId: number): number {
  const lastUse = userRateLimits.get(userId);
  if (!lastUse) return 0;
  const remaining = RATE_LIMIT_MS - (Date.now() - lastUse);
  return Math.max(0, Math.ceil(remaining / 1000));
}

function getProjectRoot(): string {
  const currentFile = path.dirname(new URL(import.meta.url).pathname);
  return path.resolve(currentFile, '..');
}

const LEGACY_FILE = path.join(getProjectRoot(), 'subscribers.json');

function migrateIfNeeded(): SubscriptionsMap {
  if (fs.existsSync(LEGACY_FILE)) {
    try {
      const data = fs.readFileSync(LEGACY_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      
      // Validate that the data is an array of numbers
      if (!Array.isArray(parsed)) {
        throw new Error('Legacy data is not an array');
      }
      
      const ids = parsed.filter((id: unknown): id is number => 
        typeof id === 'number' && Number.isInteger(id) && id > 0
      );
      
      if (ids.length !== parsed.length) {
        logError(`Filtered out ${parsed.length - ids.length} invalid entries during migration`);
      }
      
      const subs = migrateLegacySubscribers(new Set(ids));
      saveSubscriptions(subs);
      fs.unlinkSync(LEGACY_FILE);
      log(`🔄 Migrated ${ids.length} legacy subscribers to new format`);
      return subs;
    } catch (err) {
      logError('Migration failed:', err);
    }
  }
  return loadSubscriptions();
}

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  logError('Error: BOT_TOKEN environment variable is required');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const subscribers = migrateIfNeeded();
const liveChecker = createLiveChecker();
let wasYoutubeLiveForWan = false;

function getSettingsKeyboard(prefs: UserPreferences) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        prefs.wan ? '🔔 WAN: ON' : '🔕 WAN: OFF',
        'toggle_wan'
      ),
      Markup.button.callback(
        prefs.notablePeople ? '🔔 Notable: ON' : '🔕 Notable: OFF',
        'toggle_notable'
      ),
    ],
  ]);
}

function getWelcomeMessage(prefs: UserPreferences, isNew: boolean): string {
  const subscriptionText = prefs.wan
    ? '✅ You\'re subscribed for WAN Show notifications!'
    : '⚠️ WAN notifications are disabled';

  return `
🎉 ${isNew ? 'Welcome' : 'Welcome back'} to WhenPlane Bot! 🎉

I track the WAN Show and notify you when it goes <b>actually live</b>.

⚠️ <b>WAN is never on time!</b> Record shows:
• Earliest: 6h 12m early (9/20/2025) 😱
• Latest: 5h 38m late (8/26/2023) 😅

That's why I monitor YouTube, Floatplane, and Twitch with adaptive checking.

${subscriptionText}

Quick commands:
/next - When is WAN supposed to be?
/status - Are they live right now?
/notable - Check notable people
/settings - Manage notifications
  `;
}

bot.command('start', async (ctx) => {
  const userId = ctx.from.id;
  const isNew = !subscribers.has(userId);

  if (isNew) {
    subscribers.set(userId, {
      preferences: { wan: true, notablePeople: false },
      joinedAt: new Date().toISOString(),
    });
    saveSubscriptions(subscribers);
    log(`New subscriber: ${userId} (total: ${subscribers.size})`);
  }

  const data = subscribers.get(userId)!;
  await ctx.reply(
    getWelcomeMessage(data.preferences, isNew),
    { parse_mode: 'HTML', ...getSettingsKeyboard(data.preferences) }
  );
});

bot.command('help', async (ctx) => {
  const userId = ctx.from.id;
  const data = subscribers.get(userId);
  const prefs = data?.preferences ?? { wan: false, notablePeople: false };

  const helpMessage = `
📱 <b>WhenPlane Bot Commands</b>

<b>Info:</b>
/next - Countdown to next scheduled WAN
/status - Real-time live status check
/live - Quick yes/no live check
/notable - Check notable people status

<b>Notifications:</b>
/settings - Toggle notification preferences
Current: ${formatPreferenceStatus(prefs)}

<b>What are "Notable People"?</b>
Other LTT-related creators who might go live (opt-in, off by default).

<b>About:</b>
Since WAN Show is never on time, I monitor all platforms 24/7. You'll get notified the moment they actually go live!
  `;

  await ctx.reply(helpMessage, {
    parse_mode: 'HTML',
    ...getSettingsKeyboard(prefs),
  });
});

bot.command('settings', async (ctx) => {
  const userId = ctx.from.id;

  if (!subscribers.has(userId)) {
    subscribers.set(userId, {
      preferences: { wan: true, notablePeople: false },
      joinedAt: new Date().toISOString(),
    });
    saveSubscriptions(subscribers);
  }

  const data = subscribers.get(userId)!;
  const prefs = data.preferences;

  const message = `
⚙️ <b>Notification Settings</b>

${formatPreferenceStatus(prefs)}

<b>WAN Show</b> (default: ON)
The main Friday show with Linus and Luke.

<b>Notable People</b> (default: OFF)
Other LTT-related creators (opt-in):
• TQ, Sarah, Andy, Madison, etc.
• Guest appearances
• Special events

Tap buttons below to toggle:
  `;

  await ctx.reply(message, {
    parse_mode: 'HTML',
    ...getSettingsKeyboard(prefs),
  });
});

bot.action('toggle_wan', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;

  const data = subscribers.get(userId);
  if (!data) {
    await ctx.answerCbQuery('❌ Not subscribed');
    return;
  }

  data.preferences.wan = !data.preferences.wan;
  saveSubscriptions(subscribers);

  const status = data.preferences.wan ? 'enabled' : 'disabled';
  await ctx.answerCbQuery(`WAN notifications ${status}`);

  const message = `
⚙️ <b>Notification Settings</b>

${formatPreferenceStatus(data.preferences)}

WAN notifications are now <b>${status}</b>.
  `;

  await ctx.editMessageText(message, {
    parse_mode: 'HTML',
    ...getSettingsKeyboard(data.preferences),
  });
});

bot.action('toggle_notable', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;

  const data = subscribers.get(userId);
  if (!data) {
    await ctx.answerCbQuery('❌ Not subscribed');
    return;
  }

  data.preferences.notablePeople = !data.preferences.notablePeople;
  saveSubscriptions(subscribers);

  const status = data.preferences.notablePeople ? 'enabled' : 'disabled';
  await ctx.answerCbQuery(`Notable People notifications ${status}`);

  const message = `
⚙️ <b>Notification Settings</b>

${formatPreferenceStatus(data.preferences)}

Notable People notifications are now <b>${status}</b>.

${data.preferences.notablePeople ? '📋 You\'ll now get notified when LTT-related creators go live!' : ''}
  `;

  await ctx.editMessageText(message, {
    parse_mode: 'HTML',
    ...getSettingsKeyboard(data.preferences),
  });
});

bot.command('next', async (ctx) => {
  try {
    const nextWan = getNextWAN(undefined, false);
    const timeUntil = getTimeUntil(nextWan);
    const isLate = timeUntil.late;

    const dateStr = nextWan.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const timeStr = nextWan.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });

    let message: string;

    if (isLate) {
      message = `
🔴 WAN was supposed to start:
📅 ${dateStr}
🕐 ${timeStr}

⏰ Currently <b>${timeUntil.string}</b> "late" (but who's counting?)

They'll be live when they're live 😅
      `;
    } else {
      message = `
📅 Next WAN Show scheduled:
${dateStr}
🕐 ${timeStr}

⏰ In: <b>${timeUntil.string}</b>

💡 Pro tip: This is just a suggestion. Use /status to see if they're actually live!
      `;
    }

    await ctx.reply(message.trim(), { parse_mode: 'HTML' });
  } catch (error) {
    logError('Error in /next command:', error);
    await ctx.reply('❌ Could not calculate next WAN time. Try again?');
  }
});

bot.command('status', async (ctx) => {
  const userId = ctx.from.id;
  if (!checkRateLimit(userId)) {
    await ctx.reply(`⏱️ Please wait ${getRemainingCooldown(userId)}s before checking again.`);
    return;
  }

  try {
    const checkingMsg = await ctx.reply('🔍 Checking all platforms...');
    const statusMessage = await getDetailedStatus();

    await ctx.deleteMessage(checkingMsg.message_id);
    await ctx.reply(statusMessage, { parse_mode: 'HTML' });
  } catch (error) {
    logError('Error in /status command:', error);
    await ctx.reply('❌ Could not check status. Try again?');
  }
});

bot.command('live', async (ctx) => {
  const userId = ctx.from.id;
  if (!checkRateLimit(userId)) {
    await ctx.reply(`⏱️ Please wait ${getRemainingCooldown(userId)}s before checking again.`);
    return;
  }

  try {
    const status = await checkLiveStatus();

    if (status.isLive && status.isWAN) {
      let message = '🔴 <b>WAN Show is LIVE NOW!</b> 🔴\n\n';
      if (status.title) {
        message += `📺 ${status.title}\n\n`;
      }
      message += 'Watch here:\n';
      message += '▶️ <a href="https://youtube.com/@LinusTechTips">YouTube</a>\n';
      message += '▶️ <a href="https://www.floatplane.com/live/linustechtips">Floatplane</a>\n';
      message += '▶️ <a href="https://twitch.tv/linustech">Twitch</a>\n';

      await ctx.reply(message, { parse_mode: 'HTML' });
    } else if (status.isLive) {
      await ctx.reply(
        '🟡 LTT is streaming, but it\'s not WAN Show.\n\nUse /status for details.'
      );
    } else {
      const nextWan = getNextWAN(undefined, false);
      const timeUntil = getTimeUntil(nextWan);

      await ctx.reply(
        `⏰ Not live yet. Next WAN in ${timeUntil.string} (±45min typical, ±6h extreme!)`
      );
    }
  } catch (error) {
    logError('Error in /live command:', error);
    await ctx.reply('❌ Could not check. Try again?');
  }
});

bot.command('notable', async (ctx) => {
  const userId = ctx.from.id;
  if (!checkRateLimit(userId)) {
    await ctx.reply(`⏱️ Please wait ${getRemainingCooldown(userId)}s before checking again.`);
    return;
  }

  try {
    const checkingMsg = await ctx.reply('🔍 Checking notable people...');
    const message = await getDetailedNotablePeopleStatus();

    await ctx.deleteMessage(checkingMsg.message_id);
    await ctx.reply(message, { parse_mode: 'HTML' });
  } catch (error) {
    logError('Error in /notable command:', error);
    await ctx.reply('❌ Could not check notable people. Try again?');
  }
});

bot.command('subscribe', async (ctx) => {
  const userId = ctx.from.id;

  if (!subscribers.has(userId)) {
    subscribers.set(userId, {
      preferences: { wan: true, notablePeople: false },
      joinedAt: new Date().toISOString(),
    });
    saveSubscriptions(subscribers);
    log(`Manual subscribe: ${userId} (total: ${subscribers.size})`);
  }

  const data = subscribers.get(userId)!;
  await ctx.reply(
    `
✅ <b>Subscribed!</b>

You'll get notified when WAN goes live.

${formatPreferenceStatus(data.preferences)}

Want more notifications? Use /settings to enable Notable People alerts!
    `,
    { parse_mode: 'HTML', ...getSettingsKeyboard(data.preferences) }
  );
});

bot.command('unsubscribe', async (ctx) => {
  const userId = ctx.from.id;

  if (subscribers.has(userId)) {
    subscribers.delete(userId);
    saveSubscriptions(subscribers);
    log(`Unsubscribed: ${userId} (total: ${subscribers.size})`);
  }

  await ctx.reply(`
👋 <b>Unsubscribed</b>

You won't receive any notifications.

Use /subscribe if you change your mind!
  `, { parse_mode: 'HTML' });
});

bot.command('testnotif', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply('❌ This command is restricted to bot administrators.');
    return;
  }

  if (!checkAdminRateLimit(ctx.from.id)) {
    await ctx.reply('⏱️ Admin commands are rate limited. Please wait.');
    return;
  }

  try {
    const [status, notableInfo] = await Promise.all([
      checkLiveStatus(),
      getDetailedNotablePeopleStatus(),
    ]);

    const testThumbnailUrl = status.thumbnail || 'https://via.placeholder.com/1280x720.png?text=WAN+Show+Thumbnail';
    const testLateness = getWanLateness();
    const testTitle = status.title || 'WAN Show - Episode 123';

    await ctx.reply(`
🔔 <b>TEST: WAN Show is LIVE!</b> 🔔

This is what the notification looks like:

🔴 <b>WAN Show is NOW LIVE!</b> 🔴

Started ${testLateness}
📺 ${testTitle}

Watch now:
• <a href="https://www.youtube.com/@LinusTechTips">YouTube</a>
• <a href="https://www.floatplane.com/live/linustechtips">Floatplane</a>
• <a href="https://www.twitch.tv/linustech">Twitch</a>

Enjoy the show! 🎉
  `, { parse_mode: 'HTML' });

    await ctx.reply(`
📸 <b>TEST: Thumbnail Notification</b> 📸

This is what the thumbnail notification looks like:

📸 <b>WAN Show thumbnail uploaded!</b> 📸

The thumbnail is up - showtime is getting close!

🕐 Scheduled: ${getTimeUntil(getClosestWan(new Date())).string}

Keep your eyes on /live!
${testThumbnailUrl}
  `, { parse_mode: 'HTML' });

  } catch (err) {
    logError('Failed to fetch test data:', err);
    await ctx.reply('❌ Failed to fetch live data for test. Using placeholder data instead.');
    
    const testThumbnailUrl = 'https://via.placeholder.com/1280x720.png?text=WAN+Show+Thumbnail';
    const testLateness = getWanLateness();
    
    await ctx.reply(`
🔔 <b>TEST: WAN Show is LIVE!</b> 🔔

This is what the notification looks like:

🔴 <b>WAN Show is NOW LIVE!</b> 🔴

Started ${testLateness}
📺 WAN Show - Episode 123

Watch now:
• <a href="https://www.youtube.com/@LinusTechTips">YouTube</a>
• <a href="https://www.floatplane.com/live/linustechtips">Floatplane</a>
• <a href="https://www.twitch.tv/linustech">Twitch</a>

Enjoy the show! 🎉
  `, { parse_mode: 'HTML' });

    await ctx.reply(`
📸 <b>TEST: Thumbnail Notification</b> 📸

This is what the thumbnail notification looks like:

📸 <b>WAN Show thumbnail uploaded!</b> 📸

The thumbnail is up - showtime is getting close!

🕐 Scheduled: ${getTimeUntil(getClosestWan(new Date())).string}

Keep your eyes on /live!
${testThumbnailUrl}
  `, { parse_mode: 'HTML' });
  }
});

bot.command('debug', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply('❌ This command is restricted to bot administrators.');
    return;
  }

  if (!checkAdminRateLimit(ctx.from.id)) {
    await ctx.reply('⏱️ Admin commands are rate limited. Please wait.');
    return;
  }

  const [status, notableInfo] = await Promise.all([
    checkLiveStatus(),
    getDetailedNotablePeopleStatus(),
  ]);

  const debugInfo = `
🛠️ <b>Debug</b>

Subscribers: ${subscribers.size}
Live Checker: ${liveChecker.isRunning ? '✅' : '❌'}

Current Status:
• isLive: ${status.isLive ? '✅' : '❌'}
• isWAN: ${status.isWAN ? '✅' : '❌'}
• YouTube: ${status.platforms.youtube ? '🟢 Live' : '⚪ Offline'}
• Floatplane: ${status.platforms.floatplane ? '🟢 Live' : '⚪ Offline'}
• Twitch: ${status.platforms.twitch ? '🟢 Live' : '⚪ Offline'}
• Thumbnail New: ${status.isThumbnailNew ? '✅ Yes' : '❌ No'}

Notable People:
${notableInfo || '  No data available'}
  `;

  await ctx.reply(debugInfo, { parse_mode: 'HTML' });
});

bot.on(message('text'), async (ctx) => {
  const text = ctx.message.text.toLowerCase();

  if (text.includes('when') && text.includes('wan')) {
    await ctx.reply('Use /next to see the scheduled time (but it\'s never accurate 😅)');
  } else if (text.includes('live') || text.includes('now')) {
    await ctx.reply('Use /live for a quick check or /status for full details!');
  } else if (text.includes('late')) {
    await ctx.reply('WAN is rarely on time - could be early or late! Use /status to check');
  } else if (text.includes('setting') || text.includes('notification')) {
    await ctx.reply('Use /settings to manage your notification preferences!');
  }
});

bot.catch((err, ctx) => {
  logError(`Error for ${ctx.updateType}:`, err);
});

function sendNotification(
  userIds: number[],
  message: string,
  type: string
): void {
  for (const userId of userIds) {
    bot.telegram
      .sendMessage(userId, message, { parse_mode: 'HTML' })
      .catch((err) => {
        logError(`Failed to notify ${userId}:`, err);
        if (err.response?.error_code === 403) {
          subscribers.delete(userId);
          saveSubscriptions(subscribers);
          log(`Removed dead subscriber: ${userId}`);
        }
      });
  }
}

function getWanLateness(): string {
  const scheduledWAN = getClosestWan(new Date());
  const now = new Date();
  const diff = now.getTime() - scheduledWAN.getTime();
  const diffAbs = Math.abs(diff);
  const hours = Math.floor(diffAbs / (1000 * 60 * 60));
  const minutes = Math.floor((diffAbs % (1000 * 60 * 60)) / (1000 * 60));

  const prefix = diff < 0 ? 'early' : 'late';
  if (hours > 0) {
    return `${hours}h ${minutes}m ${prefix}`;
  }
  return `${minutes}m ${prefix}`;
}

function handleWanStatusChange(newStatus: LiveStatus, oldStatus: LiveStatus | null): void {
  const youtubeJustWan = newStatus.isLive && newStatus.isWAN && newStatus.platforms.youtube && (!oldStatus || !oldStatus.platforms.youtube);
  const preShowJustStarted = newStatus.isLive && newStatus.isWAN && (newStatus.platforms.floatplane || newStatus.platforms.twitch) && (!oldStatus || !oldStatus.isLive);

  if (youtubeJustWan && !wasYoutubeLiveForWan) {
    log('📺 WAN Show is on YouTube! Sending notification...');
    wasYoutubeLiveForWan = true;

    const safeTitle = newStatus.title ? escapeHtml(newStatus.title) : '';
    const lateness = getWanLateness();
    const videoId = newStatus.details.youtube?.videoId;
    const youtubeLink = videoId
      ? `https://www.youtube.com/watch?v=${videoId}`
      : 'https://www.youtube.com/@LinusTechTips';
    const message = `
🔴 <b>WAN Show is NOW LIVE!</b> 🔴

Started ${lateness}
${safeTitle ? `📺 ${safeTitle}\n` : ''}
Watch now:
• <a href="${youtubeLink}">YouTube</a>
• <a href="https://www.floatplane.com/live/linustechtips">Floatplane</a>
• <a href="https://www.twitch.tv/linustech">Twitch</a>

Enjoy the show! 🎉
    `;

    const wanSubscribers = getSubscribersByType(subscribers, 'wan');
    sendNotification(wanSubscribers, truncateMessage(message), 'WAN');
    log(`YouTube notification sent to ${wanSubscribers.length} WAN subscribers`);
  }

  if (preShowJustStarted) {
    log('📡 Pre-show is LIVE (Floatplane/Twitch)! Notifying subscribers...');

    let platform = newStatus.platforms.floatplane ? 'Floatplane' : 'Twitch';
    const safeTitle = newStatus.title ? escapeHtml(newStatus.title) : '';
    const message = `
📡 <b>Pre-show is LIVE!</b> 📡

Detected on ${platform}
${safeTitle ? `📺 ${safeTitle}\n` : ''}
Watch now:
• <a href="https://www.floatplane.com/live/linustechtips">Floatplane</a>
• <a href="https://www.twitch.tv/linustech">Twitch</a>

YouTube coming soon! 🎉
    `;

    const wanSubscribers = getSubscribersByType(subscribers, 'wan');
    sendNotification(wanSubscribers, truncateMessage(message), 'WAN-pre');
    log(`Pre-show notification sent to ${wanSubscribers.length} WAN subscribers`);
  }

  if (newStatus.platforms.youtube) {
    wasYoutubeLiveForWan = true;
  } else {
    wasYoutubeLiveForWan = false;
  }
}

function handleThumbnailUploaded(newStatus: LiveStatus, oldStatus: LiveStatus | null): void {
  if (newStatus.isLive) return;

  log('📸 Thumbnail uploaded - notifying subscribers...');

  const nextWan = getClosestWan(new Date());
  const timeUntil = getTimeUntil(nextWan);

  const thumbnailUrl = newStatus.thumbnail;
  const caption = `
📸 <b>WAN Show thumbnail uploaded!</b> 📸

The thumbnail is up - showtime is getting close!

⏰ Scheduled: ${timeUntil.string}${timeUntil.late ? ' (late)' : ''}

Keep your eyes on /live!
${thumbnailUrl ? `\n${thumbnailUrl}` : ''}
  `.trim();

  const wanSubscribers = getSubscribersByType(subscribers, 'wan');

  for (const userId of wanSubscribers) {
    bot.telegram.sendMessage(userId, caption, { parse_mode: 'HTML' }).catch((err) => {
      logError(`Failed to notify ${userId}:`, err);
      if (err.response?.error_code === 403) {
        subscribers.delete(userId);
        saveSubscriptions(subscribers);
        log(`Removed dead subscriber: ${userId}`);
      }
    });
  }
  log(`Thumbnail notification sent to ${wanSubscribers.length} WAN subscribers`);
}

function handleNotablePeopleChange(
  newStatus: NotablePeopleStatus,
  oldStatus: NotablePeopleStatus | null
): void {
  const wentLive: string[] = [];

  for (const [person, status] of Object.entries(newStatus.people)) {
    if (status.isLive && (!oldStatus || !oldStatus.people[person]?.isLive)) {
      wentLive.push(person);
    }
  }

  if (wentLive.length === 0) return;

  const displayNames = wentLive.map(
    (p) => newStatus.people[p].name || p
  );
  log(`🌟 ${displayNames.join(', ')} went live`);

  for (const person of wentLive) {
    const status = newStatus.people[person];
    const displayName = escapeHtml(status.name || person);
    const channel = escapeHtml(status.channel || person);
    const safeTitle = status.title ? escapeHtml(status.title) : '';
    const safeGame = status.game ? escapeHtml(status.game) : '';
    const message = `
🌟 <b>${displayName} is LIVE!</b>

${safeTitle ? `📺 ${safeTitle}\n` : ''}${safeGame ? `🎮 ${safeGame}\n` : ''}
▶️ <a href="https://twitch.tv/${channel}">twitch.tv/${channel}</a>
    `;

    const notableSubscribers = getSubscribersByType(subscribers, 'notablePeople');
    sendNotification(notableSubscribers, truncateMessage(message), 'NotablePeople');
    log(`Notified ${notableSubscribers.length} subscribers about ${displayName}`);
  }
}

process.once('SIGINT', () => {
  log('🛑 Shutting down...');
  stopLiveChecker(liveChecker);
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  log('🛑 Shutting down...');
  stopLiveChecker(liveChecker);
  bot.stop('SIGTERM');
});

async function main() {
  log('🚀 Starting WhenPlane Telegram Bot...');

  startLiveChecker(liveChecker, {
    onWanStatusChange: handleWanStatusChange,
    onNotablePeopleChange: handleNotablePeopleChange,
    onThumbnailUploaded: handleThumbnailUploaded,
  });

  await bot.launch();

  log('✅ Bot is running!');
  log(`📊 Adaptive polling active`);
  log(`👥 Subscribers: ${subscribers.size}`);
}

main().catch((err) => {
  logError('Failed to start:', err);
  process.exit(1);
});

export { bot, subscribers, liveChecker };
