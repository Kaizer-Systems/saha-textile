import type { KeyKind, KeyState } from '@saha-textile/release-console-contracts';

import { arr, getJson, rec, str } from './http.js';
import { signV4 } from './sigv4.js';

export interface KeyCheck {
	state: KeyState;
	account: string;
	rights: string[];
	/** `undefined` keeps the expiry the owner typed; vendors that report one fill it. */
	expiresAt?: string | null;
	note: string;
}

const DAY = 86_400_000;
export const EXPIRING_DAYS = 14;

/** A verified key turns expiring 14 days before its end and expired after it. */
export function stateWithExpiry(state: KeyState, expiresAt: string | null, now = Date.now()): KeyState {
	if (!expiresAt || (state !== 'verified' && state !== 'expiring')) return state;
	const left = Date.parse(expiresAt) - now;
	if (left <= 0) return 'expired';
	return left < EXPIRING_DAYS * DAY ? 'expiring' : 'verified';
}

const failed = (note: string): KeyCheck => ({ state: 'failed', account: '', rights: [], note });

/** GitHub's own expiry header reads `2026-12-01 00:00:00 UTC`. */
export function githubExpiry(header: string | null): string | null {
	if (!header) return null;
	const t = Date.parse(header.replace(' UTC', 'Z').replace(' ', 'T'));
	return Number.isNaN(t) ? null : new Date(t).toISOString();
}

async function checkGithub(key: string, repositories: string[]): Promise<KeyCheck> {
	const me = await getJson('https://api.github.com/user', key);
	if (me.status !== 200) return failed(`GitHub refused the key (${me.status}).`);
	const login = str(rec(me.body)['login']);
	const scopes = me.headers.get('x-oauth-scopes');
	const missing: string[] = [];
	for (const repo of repositories) {
		const r = await getJson(`https://api.github.com/repos/${repo}`, key);
		if (r.status !== 200) missing.push(repo);
	}
	if (missing.length)
		return { ...failed(`Signed in as ${login}, but it cannot open ${missing.join(', ')}.`), account: login };
	return {
		state: 'verified',
		account: login,
		rights: scopes
			? scopes
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean)
			: ['fine-grained'],
		expiresAt: githubExpiry(me.headers.get('github-authentication-token-expiration')),
		note: repositories.length ? `Opens ${repositories.join(', ')}` : '',
	};
}

async function checkDigitalOcean(key: string): Promise<KeyCheck> {
	const a = await getJson('https://api.digitalocean.com/v2/account', key);
	if (a.status !== 200) return failed(`DigitalOcean refused the key (${a.status}).`);
	const account = rec(rec(a.body)['account']);
	return {
		state: 'verified',
		account: str(rec(account['team'])['name']) || str(account['email']),
		rights: [],
		note: 'DigitalOcean does not report a token’s expiry; the date typed when it was pasted is used.',
	};
}

/** User tokens verify at `/user/tokens/verify`; account tokens need the account id from a zone first. */
async function checkCloudflare(key: string): Promise<KeyCheck> {
	const base = 'https://api.cloudflare.com/client/v4';
	const zones = await getJson(`${base}/zones?per_page=1`, key);
	const zone = rec(arr(rec(zones.body)['result'])[0]);
	const accountId = str(rec(zone['account'])['id']);
	const accountName = str(rec(zone['account'])['name']);
	let verify = await getJson(`${base}/user/tokens/verify`, key);
	if (verify.status !== 200 && accountId) verify = await getJson(`${base}/accounts/${accountId}/tokens/verify`, key);
	const result = rec(rec(verify.body)['result']);
	if (verify.status !== 200 || str(result['status']) !== 'active')
		return failed(
			`Cloudflare did not accept the token (${verify.status}${result['status'] ? `, ${str(result['status'])}` : ''}).`,
		);
	const expires = str(result['expires_on']);
	return {
		state: 'verified',
		account: accountName,
		rights: zones.status === 200 && str(zone['name']) ? [`sees ${str(zone['name'])}`] : [],
		expiresAt: expires ? new Date(expires).toISOString() : null,
		note: accountName ? '' : 'The token sees no zone; give it read access to the domain’s zone.',
	};
}

/**
 * A Spaces key is `ACCESS_KEY:SECRET`; it is checked by listing one object of its bucket
 * (`region/bucket`), which also works for keys limited to that bucket.
 */
async function checkSpaces(key: string, target: string): Promise<KeyCheck> {
	const split = key.indexOf(':');
	if (split < 1) return failed('Paste a Spaces key as ACCESS_KEY:SECRET.');
	const [region, bucket] = target.split('/');
	if (!region || !bucket)
		return failed('Give the Spaces key its bucket as region/bucket, for example sgp1/saha-textile-media.');
	const url = new URL(`https://${region}.digitaloceanspaces.com/${bucket}?list-type=2&max-keys=1`);
	const headers = signV4({
		method: 'GET',
		url,
		region,
		service: 's3',
		accessKey: key.slice(0, split),
		secret: key.slice(split + 1),
	});
	const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
	if (res.status === 200)
		return {
			state: 'verified',
			account: key.slice(0, split),
			rights: [`lists ${bucket}`],
			note: `Reaches ${target}`,
		};
	if (res.status === 404) return failed(`Spaces has no bucket ${bucket} in ${region}.`);
	return failed(`Spaces refused the key for ${target} (${res.status}).`);
}

/** Checks a key against its vendor. Kinds without a check are kept and marked unchecked. */
export async function checkKey(kind: KeyKind, key: string, repositories: string[], target = ''): Promise<KeyCheck> {
	try {
		switch (kind) {
			case 'github-cli':
			case 'github-token':
				return await checkGithub(key, repositories);
			case 'do-read':
			case 'do-change':
				return await checkDigitalOcean(key);
			case 'cf-read':
			case 'cf-change':
				return await checkCloudflare(key);
			case 'spaces-key':
				return await checkSpaces(key, target);
			default:
				return {
					state: 'unchecked',
					account: '',
					rights: [],
					note: 'Kept in the Keychain; checked when its screen first reads with it.',
				};
		}
	} catch (err) {
		return failed(`The check could not reach the vendor: ${(err as Error).message}`);
	}
}
