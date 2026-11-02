/**
 * CDN cache purge (`CdnPurgePort`).
 *
 * Owner lock (2026-08-23): Cloudflare fronts the Spaces CDN; the DigitalOcean layer keeps a
 * 60-second TTL and only Cloudflare is ever purged. Dev uses a log-only adapter; staging and
 * prod use the Cloudflare adapter with the purge token the owner creates at cutover.
 *
 * Purges are queued jobs, never inline: a delete or reprocess must not fail because the
 * CDN API is slow, and a failed purge retries on its own.
 */
export interface CdnPurgePort {
	purgeUrls(urls: readonly string[]): Promise<void>;
}
