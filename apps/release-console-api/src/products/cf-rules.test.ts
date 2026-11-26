import { describe, expect, it } from 'vitest';

import type { ProductWrite } from '@saha-textile/release-console-contracts';

import { RULE_KINDS, headerLines, pageActions } from './cf-rules.js';

const write = (values: Record<string, unknown>): ProductWrite => ({ values, pin: '000000' }) as unknown as ProductWrite;
const kind = (tab: string) => {
	const k = RULE_KINDS.find((x) => x.tab === tab);
	if (!k) throw new Error(tab);
	return k;
};

describe('Cloudflare rule kinds', () => {
	it('reads header lines: set, add, remove and an expression', () => {
		expect(
			headerLines(
				'set X-Shop: saha-textile\nset X-Country = ip.src.country\nadd Set-Cookie: a=b\nremove X-Powered-By',
			),
		).toEqual({
			'X-Shop': { operation: 'set', value: 'saha-textile' },
			'X-Country': { operation: 'set', expression: 'ip.src.country' },
			'Set-Cookie': { operation: 'add', value: 'a=b' },
			'X-Powered-By': { operation: 'remove' },
		});
		expect(() => headerLines('set X-Empty')).toThrow(/give a value/);
		expect(() => headerLines('rename X-A: b')).toThrow(/Each line/);
	});

	it('rewrites the path, the query or both, never neither', () => {
		const rewrite = kind('rewrite');
		expect(rewrite.params(write({ pathMode: 'static', path: '/en/sarees', queryMode: 'keep' }), null)).toEqual({
			uri: { path: { value: '/en/sarees' } },
		});
		expect(
			rewrite.params(write({ pathMode: 'keep', queryMode: 'dynamic', query: 'concat("lang=", "en")' }), null),
		).toEqual({
			uri: { query: { expression: 'concat("lang=", "en")' } },
		});
		expect(() => rewrite.params(write({ pathMode: 'keep', queryMode: 'keep' }), null)).toThrow(/path, the query/);
		expect(() => rewrite.params(write({ pathMode: 'static', path: 'no-slash', queryMode: 'keep' }), null)).toThrow(
			/starts with \//,
		);
	});

	it('sends only the configuration settings that were changed', () => {
		const config = kind('config');
		expect(
			config.params(write({ rocket_loader: 'off', security_level: 'high', disable_zaraz: true, bic: '' }), null),
		).toEqual({
			rocket_loader: false,
			security_level: 'high',
			disable_zaraz: true,
		});
		expect(() => config.params(write({}), null)).toThrow(/at least one/);
	});

	it('compresses with the chosen order', () => {
		expect(kind('compress').params(write({ algorithms: 'zstd,brotli,gzip' }), null)).toEqual({
			algorithms: [{ name: 'zstd' }, { name: 'brotli' }, { name: 'gzip' }],
		});
	});
});

describe('page rule settings', () => {
	it('turns the setting slots into Cloudflare actions', () => {
		expect(
			pageActions(
				write({
					setting1: 'cache_level',
					value1: 'cache_everything',
					setting2: 'edge_cache_ttl',
					value2: '7200',
					setting3: 'always_use_https',
					setting4: 'rocket_loader',
					value4: 'off',
				}),
			),
		).toEqual([
			{ id: 'cache_level', value: 'cache_everything' },
			{ id: 'edge_cache_ttl', value: 7200 },
			{ id: 'always_use_https' },
			{ id: 'rocket_loader', value: 'off' },
		]);
	});

	it('keeps a forwarding URL alone and well formed', () => {
		expect(pageActions(write({ setting1: 'forwarding_url', value1: '301 https://sahatextile.com/$1' }))).toEqual([
			{ id: 'forwarding_url', value: { status_code: 301, url: 'https://sahatextile.com/$1' } },
		]);
		expect(() => pageActions(write({ setting1: 'forwarding_url', value1: 'https://x.example' }))).toThrow(
			/301 or 302/,
		);
		expect(() =>
			pageActions(
				write({ setting1: 'forwarding_url', value1: '302 https://x.example', setting2: 'always_use_https' }),
			),
		).toThrow(/only setting/);
		expect(() => pageActions(write({}))).toThrow(/at least one/);
	});
});
