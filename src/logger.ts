/**
 * Logging utilities with verbose mode support
 */

// Parse CLI arguments
const args = process.argv.slice(2);
export const VERBOSE = args.includes('--verbose') || args.includes('-v');

export function log(message: string): void {
  console.log(message);
}

export function logDebug(message: string): void {
  if (VERBOSE) {
    console.log(`[DEBUG] ${message}`);
  }
}

export function logError(message: string, error?: unknown): void {
  console.error(message, error);
}
