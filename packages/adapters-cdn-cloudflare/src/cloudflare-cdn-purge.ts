import type { CdnPurgePort } from '@saha-textile/core-domain';
import { z } from 'zod';

/** Cloudflare accepts a bounded number of URLs per purge call; stay well inside it. */
const URLS_PER_CALL = 30;

const PurgeResponse = z.object({
	success: z.boolean(),
	errors: z.array(z.object({ code: z.number(), message: z.string() })).default([]),
});

export interface CloudflareCdnPurgeConfig {
	zoneId: string;
	/** A token scoped to Zone → Cache Purge only, on the one zone. Server env, never logged. */
	apiToken: string;
	fetch?: typeof fetch;
}

export class CloudflarePurgeError extends Error {
	constructor(message: string, cause?: unknown) {
		super(message, { cause });
		this.name = 'CloudflarePurgeError';
	}
}

/**
 * Cloudflare implementation of `CdnPurgePort` (owner lock 2026-08-23: Cloudflare fronts the
 * Spaces CDN and is the only layer purged; DigitalOcean's 60-second TTL self-corrects).
 *
 * Purges by exact URL. Most derivative keys are content-hashed and never change, so purges
 * happen only when an object is DELETED — a GC'd asset, a stale ladder width, a rejected
 * review photo — so it stops being served from the edge.
 */
export class CloudflareCdnPurge implements CdnPurgePort {
	private readonly fetchImpl: typeof fetch;

	constructor(private readonly config: CloudflareCdnPurgeConfig) {
		this.fetchImpl = config.fetch ?? fetch;
	}

	async purgeUrls(urls: readonly string[]): Promise<void> {
		const unique = [...new Set(urls)];
		for (let start = 0; start < unique.length; start += URLS_PER_CALL) {
			const files = unique.slice(start, start + URLS_PER_CALL);
			let response: Response;
			try {
				response = await this.fetchImpl(
					`https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(this.config.zoneId)}/purge_cache`,
					{
						method: 'POST',
						headers: {
							Authorization: `Bearer ${this.config.apiToken}`,
							'Content-Type': 'application/json',
						},
						body: JSON.stringify({ files }),
					},
				);
			} catch (error) {
				throw new CloudflarePurgeError('Cloudflare purge request failed', error);
			}
			const parsed = PurgeResponse.safeParse(await response.json().catch(() => null));
			if (!response.ok || !parsed.success || !parsed.data.success) {
				const detail = parsed.success
					? parsed.data.errors.map((error) => `${error.code}`).join(',')
					: 'unreadable';
				throw new CloudflarePurgeError(`Cloudflare purge refused (HTTP ${response.status}, errors ${detail})`);
			}
		}
	}
}
