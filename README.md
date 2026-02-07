# WhenPlane Telegram Bot

A Telegram bot that tracks the WAN Show and notifies users when it **actually** goes live. Since WAN is never on time (can be ±10 hours!), this bot polls YouTube, Floatplane, and Twitch 24/7 to catch the moment they really start.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file with just your Telegram bot token:
   ```
   BOT_TOKEN=your_telegram_bot_token_here
   ```
   Get this from [@BotFather](https://t.me/botfather) on Telegram.

3. Build:
   ```bash
   npm run build
   ```

**No API credentials needed!** The bot uses the whenplane.com API which handles all platform authentication internally.

## Running the Bot

### Option 1: Manual (for testing)
```bash
npm start
```

### Option 2: Systemd Service (Recommended for servers)
Install as a systemd service that starts automatically on boot:

```bash
sudo bash install-service.sh
```

Manage the service:
```bash
sudo systemctl status whenplane-bot    # Check status
sudo systemctl stop whenplane-bot      # Stop bot
sudo systemctl start whenplane-bot     # Start bot
sudo systemctl restart whenplane-bot   # Restart bot
sudo journalctl -u whenplane-bot -f    # View live logs
```

### Option 3: PM2 (Good for development/restart management)
If you have PM2 installed:
```bash
npm run pm2:start    # Start with PM2
npm run pm2:logs     # View logs
npm run pm2:restart  # Restart
npm run pm2:stop     # Stop
```

## How It Works

- **Auto-subscribe**: First time users are automatically subscribed for live notifications
- **Granular Preferences**: Choose which notifications you want:
  - **WAN Show** (default: ON) - The main Friday show
  - **Notable People** (default: OFF) - LTT-related creators (opt-in)
- **Adaptive Monitoring**: Uses whenplane.com API with smart intervals:
  - Every 1 minute (default)
  - Every 30 seconds when <10 minutes away
  - Every 10 seconds when thumbnail updated (imminent!)
  - Every 5 minutes when already live (just to verify)
- **Instant Alerts**: You get notified the moment content goes live
- **No API Keys Needed**: Uses whenplane.com which handles all platform auth

## Commands

- `/start` - Start bot (auto-subscribes you for WAN notifications)
- `/next` - When is WAN supposed to be? (just for reference - it's never accurate!)
- `/status` - Check real-time WAN status across all platforms
- `/live` - Quick yes/no if WAN is live
- `/notable` - Check which notable people are currently streaming
- `/settings` - Manage notification preferences (toggle WAN/Notable People)
- `/subscribe` - Manually subscribe for notifications
- `/unsubscribe` - Stop all notifications
- `/help` - Show all commands

## Features

### Granular Notification Preferences
Users can choose exactly what they want to be notified about:
- **WAN Show notifications** - Always enabled by default for new users
- **Notable People notifications** - Opt-in only, off by default

Use `/settings` to toggle either option anytime with inline buttons.

### Notable People
Other LTT-related creators who might go live:
- TQ, Sarah, Andy, Madison, etc.
- Guest appearances and special events
- Each streamer gets their own notification with Twitch link

**Important**: You won't get duplicate notifications. Once notified about a stream, you won't get another until they end and start a new stream.

### Smart Detection
- Uses whenplane.com API to check all platforms simultaneously
- Automatic dead subscriber cleanup (removes users who block the bot)
- Platform detection shows which platform went live first

### Persistent Storage
Subscriptions are saved to `subscriptions.json` in the project root. The file format:
```json
{
  "123456789": {
    "preferences": {
      "wan": true,
      "notablePeople": false
    },
    "joinedAt": "2026-01-31T19:30:00.000Z"
  }
}
```

## Files Structure

- `src/index.ts` - Bot setup, command handlers, main entry
- `src/liveChecker.ts` - API polling, live status logic
- `src/timeUtils.ts` - WAN time calculations (shared logic)
- `src/subscriptionManager.ts` - User preferences and persistence

## Tech Stack

- **Runtime**: Node.js with TypeScript
- **Bot Framework**: Telegraf
- **Time Handling**: Luxon (same as the site)
- **APIs**: WhenPlane aggregate API

## Why Telegraf?

The original site is Node.js/TypeScript (SvelteKit), so Telegraf keeps everything in the same ecosystem. It's the most popular Node.js Telegram bot library with excellent TypeScript support.
