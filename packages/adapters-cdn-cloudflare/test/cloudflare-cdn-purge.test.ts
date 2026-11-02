import { describe, expect, it } from 'vitest';

import { CloudflareCdnPurge, CloudflarePurgeError } from '../src/index.js';

const recorder = (status = 200, body: unknown = { success: true, errors: [] }) => {
	const calls: { url: string; init: RequestInit }[] = [];
	const fetchImpl = (async (url: string, init: RequestInit) => {
		calls.push({ url, init });
		return new Response(JSON.stringify(body), { status });
	}) as unknown as typeof fetch;
	return { calls, fetchImpl };
};

describe('CloudflareCdnPurge', () => {
	it('purges unique URLs in batches with a bearer token', async () => {
		const { calls, fetchImpl } = recorder();
		const purge = new CloudflareCdnPurge({ zoneId: 'zone123', apiToken: 'test-token', fetch: fetchImpl });
		const urls = Array.from({ length: 45 }, (_, index) => `https://cdn.test/media/a/${index}.webp`);
		await purge.purgeUrls([...urls, urls[0] ?? '']);
		expect(calls).toHaveLength(2);
		expect(calls[0]?.url).toBe('https://api.cloudflare.com/client/v4/zones/zone123/purge_cache');
		expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
		expect(JSON.parse(String(calls[0]?.init.body)).files).toHaveLength(30);
		expect(JSON.parse(String(calls[1]?.init.body)).files).toHaveLength(15);
	});

	it('fails loudly so the queue retries, without echoing the token', async () => {
		const { fetchImpl } = recorder(403, {
			success: false,
			errors: [{ code: 10000, message: 'Authentication error' }],
		});
		const purge = new CloudflareCdnPurge({ zoneId: 'zone123', apiToken: 'secret-token', fetch: fetchImpl });
		const error = await purge.purgeUrls(['https://cdn.test/a.webp']).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(CloudflarePurgeError);
		expect(String((error as Error).message)).not.toContain('secret-token');
	});
});
