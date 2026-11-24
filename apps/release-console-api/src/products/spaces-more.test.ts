import { afterEach, describe, expect, it, vi } from 'vitest';

import { envTagForm } from './env-tags.js';
import { PRODUCT_SCREENS } from './registry.js';

import type { ProductCtx } from './kit.js';

/** Spaces answers locally by method and address; the first matching route wins. */
type Route = [RegExp, number, string];
function spaces(routes: Route[]) {
	const sent: string[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: URL | string, init?: RequestInit) => {
			const line = `${init?.method ?? 'GET'} ${String(url)}`;
			sent.push(line);
			const hit = routes.find(([re]) => re.test(line));
			const status = hit?.[1] ?? 200;
			return new Response(status === 204 ? null : (hit?.[2] ?? ''), { status });
		}),
	);
	return sent;
}
const BUCKETS =
	'<ListAllMyBucketsResult><Buckets><Bucket><Name>media</Name><CreationDate>2026-01-01</CreationDate></Bucket></Buckets></ListAllMyBucketsResult>';
const LISTED: Route = [/GET https:\/\/sgp1\.digitaloceanspaces\.com\/$/, 200, BUCKETS];
const ctx = (over: Partial<ProductCtx> = {}, keys = true): ProductCtx =>
	({
		key: 'k',
		id: null,
		keyRefs: [],
		consoleKey: (name: string) => (keys ? `value-of-${name}` : null),
		envTags: () => ({}),
		pruneEnvTags: vi.fn(),
		repo: { environments: [] },
		writeKey: async () => 'w',
		...over,
	}) as unknown as ProductCtx;
const write = (values: Record<string, unknown>, id: string | null = null, confirm = '') =>
	({ pin: '123456', confirm, id, values }) as never;
const screen = () => PRODUCT_SCREENS['spaces'];

afterEach(() => vi.unstubAllGlobals());

describe('Spaces CORS and files', () => {
	it('reads a bucket’s CORS, and says when there is no bucket to read', async () => {
		spaces([
			LISTED,
			[
				/\?cors/,
				200,
				'<CORSRule><AllowedOrigin>https://shop.example.test</AllowedOrigin><AllowedMethod>PUT</AllowedMethod></CORSRule>',
			],
		]);
		expect(JSON.stringify(await screen()?.forms?.['cors']?.read(ctx()))).toContain('GET,HEAD,PUT');
		spaces([[/sgp1\.digitaloceanspaces\.com\/$/, 200, '<ListAllMyBucketsResult></ListAllMyBucketsResult>']]);
		expect(JSON.stringify(await screen()?.forms?.['cors']?.read(ctx()))).toContain(
			'No buckets the Spaces key can reach.',
		);
		// The tag form lists buckets too.
		spaces([LISTED]);
		expect(JSON.stringify(await envTagForm('spaces').read(ctx()))).toContain('media');
		// A CORS read that fails shows no sites; a key that may not list buckets names its own.
		spaces([
			[/sgp1\.digitaloceanspaces\.com\/$/, 403, '<Error><Code>AccessDenied</Code></Error>'],
			[/\?cors/, 500, 'Boom'],
		]);
		const limited = ctx({ keyRefs: [{ kind: 'spaces-key', target: '/media' }] as never });
		expect(JSON.stringify(await screen()?.forms?.['cors']?.read(limited))).toContain('media|sgp1');
	});

	it('saves, removes and refuses CORS, and words what Spaces refused', async () => {
		const cors = screen()?.forms?.['cors'];
		await expect(cors?.send(ctx(), write({ origins: '' }))).rejects.toThrow('Choose a bucket.');
		await expect(cors?.send(ctx(), write({ origins: 'not a site' }, 'media|sgp1'))).rejects.toThrow('one per line');
		const sent = spaces([
			[/DELETE .*\?cors/, 204, ''],
			[/PUT .*\?cors/, 200, ''],
		]);
		expect((await cors?.send(ctx(), write({ origins: '' }, 'media')))?.message).toBe('CORS removed from media');
		expect(
			(await cors?.send(ctx({ id: 'media|sfo3' }), write({ origins: 'https://shop.example.test\n*' })))?.message,
		).toContain('CORS on media');
		expect(sent.some((s) => s.includes('media.sfo3.'))).toBe(true);
		spaces([[/PUT .*\?cors/, 403, '<Error><Code>AccessDenied</Code></Error>']]);
		await expect(cors?.send(ctx(), write({ origins: '*', methods: 'GET,HEAD,PUT' }, 'media'))).rejects.toThrow(
			'Spaces answered 403: AccessDenied.',
		);
		spaces([[/PUT .*\?cors/, 500, 'Boom']]);
		await expect(cors?.send(ctx(), write({ origins: '*' }, 'media'))).rejects.toThrow('Spaces answered 500.');
		await expect(cors?.send(ctx({}, false), write({ origins: '*' }, 'media'))).rejects.toThrow(
			'needs the console’s Spaces key',
		);
	});

	it('lists a bucket’s files, filling in what Spaces leaves out, and deletes one by its typed name', async () => {
		spaces([
			LISTED,
			[
				/list-type=2/,
				200,
				'<Contents><Key>a.jpg</Key><Size>2048</Size><LastModified>2026-11-24T10:00:00Z</LastModified></Contents><Contents><Key>b.jpg</Key></Contents>',
			],
		]);
		const files = JSON.stringify(await screen()?.tabs['files']?.(ctx()));
		expect(files).toContain('0 KB');
		spaces([[/sgp1\.digitaloceanspaces\.com\/$/, 200, '']]);
		expect(JSON.stringify(await screen()?.tabs['files']?.(ctx()))).toContain('Files in  (first 200)');
		spaces([LISTED, [/DELETE/, 204, '']]);
		const del = screen()?.forms?.['filedelete'];
		expect(JSON.stringify(await del?.read(ctx()))).toContain('media|sgp1');
		await expect(del?.send(ctx(), write({ bucket: 'media|sgp1', key: '../x' }, null, 'x'))).rejects.toThrow(
			'Choose a bucket and a file path.',
		);
		expect(
			(await del?.send(ctx(), write({ bucket: 'media', key: '/photos/a b.jpg' }, null, 'a b.jpg')))?.message,
		).toBe('photos/a b.jpg deleted from media');
	});
});
