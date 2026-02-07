/**
 * Shared provider utilities.
 */

/**
 * Parse a Groq/OpenAI duration string (e.g., "6m23.456s", "1.5s", "2m0s") into milliseconds.
 * Used for x-ratelimit-reset-requests and x-ratelimit-reset-tokens headers.
 *
 * Supported formats:
 *   "6m23.456s"  -> 383456 ms
 *   "1.5s"       -> 1500 ms
 *   "2m0s"       -> 120000 ms
 *   "0s"         -> 0 ms
 *   "500ms"      -> 500 ms
 *   "2h30m0s"    -> 9000000 ms
 */
export function parseDurationToMs(str: string): number {
  let totalMs = 0;

  // Match hours
  const hoursMatch = str.match(/(\d+(?:\.\d+)?)h/);
  if (hoursMatch) {
    totalMs += parseFloat(hoursMatch[1]) * 3600000;
  }

  // Match minutes
  const minutesMatch = str.match(/(\d+(?:\.\d+)?)m(?!s)/);
  if (minutesMatch) {
    totalMs += parseFloat(minutesMatch[1]) * 60000;
  }

  // Match seconds
  const secondsMatch = str.match(/(\d+(?:\.\d+)?)s/);
  if (secondsMatch) {
    totalMs += parseFloat(secondsMatch[1]) * 1000;
  }

  // Match milliseconds
  const msMatch = str.match(/(\d+(?:\.\d+)?)ms/);
  if (msMatch) {
    totalMs += parseFloat(msMatch[1]);
  }

  return Math.round(totalMs);
}
