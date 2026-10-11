/** Remove "Electron/x" and the app name so users don't stand out to trackers (AR-4). */
export function cleanUserAgent(ua: string): string {
  return ua.replace(/\s?Electron\/\S+/i, '').replace(/\s?(@frontier\/desktop|frontier[-\w]*)\/\S+/i, '').replace(/\s{2,}/g, ' ').trim();
}
