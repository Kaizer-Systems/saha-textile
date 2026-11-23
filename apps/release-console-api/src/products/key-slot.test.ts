import { type KeyRef, type Repository } from '@saha-textile/release-console-contracts';
import { describe, expect, it } from 'vitest';

import { keySlot } from './products.service.js';

const repo = (keyId: string | null): Repository =>
	({
		id: 'shop',
		name: 'shop',
		sourceCode: { vendor: 'github', repository: 'example-org/shop-web', keyId },
		cloud: [{ id: 'digitalocean', vendor: 'digitalocean', account: '', keyIds: ['do-change'] }],
		edge: [{ id: 'cloudflare', vendor: 'cloudflare', account: '', zones: ['example.com'], keyIds: ['cf-change'] }],
	}) as unknown as Repository;
const keys = [
	{ id: 'cf-change', kind: 'cf-change' },
	{ id: 'project-github', kind: 'github-token' },
] as unknown as KeyRef[];

describe('keySlot', () => {
	it('reads GitHub screens with the repository’s own GitHub token, never the Cloudflare slot', () => {
		expect(keySlot('github', repo('github-token'), keys)).toEqual({ keyIds: ['github-token'] });
	});

	it('falls back to the project’s GitHub tokens when the repository names none', () => {
		expect(keySlot('github', repo(null), keys)).toEqual({ keyIds: ['project-github'] });
	});

	it('keeps DigitalOcean on the cloud slot and Cloudflare on the edge slot', () => {
		expect(keySlot('digitalocean', repo(null), keys)?.keyIds).toEqual(['do-change']);
		expect(keySlot('cloudflare', repo(null), keys)).toMatchObject({
			keyIds: ['cf-change'],
			zones: ['example.com'],
		});
	});
});
