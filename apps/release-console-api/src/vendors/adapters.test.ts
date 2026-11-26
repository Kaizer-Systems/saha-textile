import { describe, expect, it } from 'vitest';

import { toRecord, toZone } from './cloudflare.adapter.js';
import { toDroplet } from './digitalocean.adapter.js';
import { toPull, toRun } from './github.adapter.js';

describe('vendor adapters map vendor answers to console shapes', () => {
	it('GitHub pull requests and runs', () => {
		expect(
			toPull({
				number: 7,
				title: 'feat: x',
				user: { login: 'kaizer03' },
				head: { ref: 'feat/x' },
				base: { ref: 'dev' },
				draft: false,
				updated_at: 't',
				html_url: 'https://github.com/o/r/pull/7',
			}),
		).toMatchObject({ number: 7, author: 'kaizer03', branch: 'feat/x', base: 'dev' });
		expect(
			toRun({
				id: 9,
				name: 'CI',
				head_branch: 'dev',
				event: 'push',
				status: 'completed',
				conclusion: null,
				html_url: 'https://github.com/o/r/actions/runs/9',
			}),
		).toMatchObject({ id: 9, conclusion: null });
	});

	it('DigitalOcean droplets prefer the public address', () => {
		expect(
			toDroplet({
				id: 1,
				networks: {
					v4: [
						{ type: 'private', ip_address: '10.0.0.2' },
						{ type: 'public', ip_address: '203.0.113.9' },
					],
				},
			}).ipv4,
		).toBe('203.0.113.9');
		expect(toDroplet({ id: 2 }).ipv4).toBeNull();
	});

	it('Cloudflare zones and records', () => {
		expect(
			toZone({
				id: 'z',
				name: 'sahatextile.com',
				status: 'active',
				plan: { name: 'Free Website' },
				account: { name: 'Second' },
			}),
		).toEqual({ id: 'z', name: 'sahatextile.com', status: 'active', plan: 'Free Website', account: 'Second' });
		expect(
			toRecord({ id: 'r', type: 'MX', name: 'sahatextile.com', content: 'mx.example', ttl: 1 }).proxied,
		).toBeNull();
	});
});
