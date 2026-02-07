# AGENTS.md

Guidelines for AI agents working on the WhenPlane Telegram Bot codebase.

## Project Overview

A Node.js/TypeScript Telegram bot that monitors WAN Show live status across YouTube, Floatplane, and Twitch, notifying subscribers when it actually goes live. Also supports opt-in notifications for notable LTT-related streamers.

## Build Commands

```bash
# Compile TypeScript (required before running)
npm run build

# Start the compiled bot
npm start

# Start with verbose logging (shows debug messages)
npm run start:verbose
# or
node dist/index.js --verbose
# or
node dist/index.js -v

# Development mode (watch compilation)
npm run dev

# Development mode with verbose logging
npm run dev:verbose

# PM2 process management
npm run pm2:start
npm run pm2:restart
npm run pm2:stop
npm run pm2:logs
```

**Note:** No test framework or linter is currently configured.

## TypeScript Configuration

- **Target:** ES2022
- **Module:** ESNext (ES modules)
- **Strict mode:** Enabled
- **Output:** `dist/` directory
- **Source:** `src/` directory

## Code Style Guidelines

### Imports
- Use ES module syntax (`import`/`export`)
- Include `.js` extension on local imports (required for ES modules with TypeScript)
- Group imports: external libraries first, then local modules
- Example:
  ```typescript
  import { Telegraf } from 'telegraf';
  import { getNextWAN } from './timeUtils.js';
  ```

### Types
- Enable `strict: true` in tsconfig - all code must be type-safe
- Export interfaces that are used across modules
- Use explicit return types on functions
- Use `type` keyword for type aliases
- Example:
  ```typescript
  export interface LiveStatus {
    isLive: boolean;
    platforms: { youtube: boolean; floatplane: boolean; twitch: boolean };
  }
  ```

### Naming Conventions
- **Variables/functions:** camelCase (`getNextWAN`, `checkLiveStatus`)
- **Interfaces/types:** PascalCase (`LiveStatus`, `YoutubeResponse`)
- **Constants:** UPPER_SNAKE_CASE for true constants (`INTERVALS`, `THRESHOLDS`)
- **Files:** camelCase matching main export (`liveChecker.ts`, `timeUtils.ts`)

### Formatting
- 2-space indentation
- Single quotes for strings
- Trailing semicolons
- Max line length: ~100 characters
- No trailing whitespace

### Error Handling
- Use typed errors with `unknown` type and narrowing
- Always log errors
- Remove dead resources (e.g., blocked subscribers) on 403 errors
- Example:
  ```typescript
  try {
    await operation();
  } catch (err) {
    logError('Operation failed:', err);
    if (err.response?.error_code === 403) {
      // Clean up dead resource
    }
  }
  ```

### Logging
- Use simple logging functions (no timestamps - journalctl adds them)
- Use appropriate log levels:
  - `log()` - Important events (startup, notifications, errors)
  - `logDebug()` - Detailed debug info, only shown with `--verbose` flag
  - `logError()` - Errors and exceptions
- Import logging functions from `logger.js` module
- Example:
  ```typescript
  import { log, logDebug, logError } from './logger.js';
  
  log('Bot started');                    // Always shown
  logDebug('Checking API endpoint...');   // Only with --verbose
  logError('Failed to fetch:', error);    // Always shown
  ```

### Async Patterns
- Use async/await, not raw promises
- Handle promise rejections properly
- Use `Promise.all()` for parallel operations
- Always await bot operations

## Architecture Patterns

### Module Organization
- `index.ts` - Bot setup, command handlers, main entry
- `liveChecker.ts` - API polling, live status logic, Notable People tracking
- `timeUtils.ts` - WAN time calculations (shared logic)
- `subscriptionManager.ts` - User preferences and persistence

### State Management
- In-memory Map for subscribers with preferences
- JSON file persistence (`subscriptions.json`)
- Load on startup, save on changes
- Auto-migration from legacy `subscribers.json`

### Subscription Data Structure
```typescript
interface SubscriptionData {
  preferences: {
    wan: boolean;           // WAN Show notifications (default: true)
    notablePeople: boolean; // Notable People notifications (default: false)
  };
  joinedAt: string;         // ISO timestamp
}
```

### Polling Strategy
- Adaptive intervals based on proximity to show time:
  - Default: 1 minute
  - <10 minutes: 30 seconds
  - Thumbnail updated: 10 seconds (imminent!)
  - Already live: 5 minutes
- Notable People checked on every poll

## Bot Commands

### User Commands
- `/start` - Start bot, auto-subscribe for WAN notifications
- `/next` - Show next WAN scheduled time
- `/status` - Check real-time WAN live status
- `/live` - Quick yes/no WAN live check
- `/notable` - Check which notable people are streaming
- `/settings` - Toggle notification preferences (inline buttons)
- `/subscribe` - Manually subscribe
- `/unsubscribe` - Unsubscribe from all notifications
- `/help` - Show available commands

### Admin/Debug Commands
- `/testnotif` - Preview notification format
- `/debug` - Show bot status and diagnostics

## Notification Logic

### WAN Show Notifications
- Only sent when WAN **newly** goes live
- Transition: not live → live with isWAN=true
- Duplicate protection: won't notify again until stream ends

### Notable People Notifications
- Opt-in only (default: OFF)
- Sent when streamer **newly** goes live
- Uses person's display name from API (not internal key)
- Includes Twitch channel link directly
- Each streamer gets individual notification

## Environment

Required environment variables (in `.env` file):
- `BOT_TOKEN` - Telegram bot token from @BotFather

## Dependencies

Key libraries:
- `telegraf` - Telegram bot framework
- `luxon` - Date/time handling
- `dotenv` - Environment variable loading

Never add dependencies without confirming necessity.

## Testing

Currently no test framework is configured. To test:
1. Run `npm run build` to compile
2. Run `npm start` to start locally
3. Use `/debug`, `/testnotif`, and `/notable` bot commands for manual verification
