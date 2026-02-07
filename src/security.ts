/**
 * Security utilities for sanitizing user input and external data
 */

/**
 * Escape HTML special characters to prevent HTML injection
 * Converts: & < > " ' to their HTML entities
 */
export function escapeHtml(text: string | undefined | null): string {
  if (text === undefined || text === null) {
    return '';
  }
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Validate that a string is safe to use as a Telegram callback data
 * Callback data is limited to 1-64 bytes
 */
export function isValidCallbackData(data: string): boolean {
  return data.length > 0 && data.length <= 64;
}

/**
 * Validate user ID is a positive integer
 */
export function isValidUserId(userId: unknown): userId is number {
  return typeof userId === 'number' && Number.isInteger(userId) && userId > 0;
}

/**
 * Sanitize a URL to ensure it only contains allowed protocols
 * Prevents javascript: and data: URL injection
 */
export function sanitizeUrl(url: string | undefined | null): string {
  if (!url) {
    return '';
  }
  
  const allowedProtocols = ['http:', 'https:'];
  try {
    const parsed = new URL(url);
    if (allowedProtocols.includes(parsed.protocol)) {
      return url;
    }
  } catch {
    // Invalid URL
  }
  
  return '';
}

/**
 * Validate Telegram message length (max 4096 characters)
 */
export function truncateMessage(message: string, maxLength = 4096): string {
  if (message.length <= maxLength) {
    return message;
  }
  return message.substring(0, maxLength - 3) + '...';
}
