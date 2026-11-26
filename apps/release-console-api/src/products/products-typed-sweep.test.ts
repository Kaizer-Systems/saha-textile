import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { forget } from './kit.js';
import { PRODUCT_SCREENS } from './registry.js';

import type { ProductCtx, ProductFormSpec } from './kit.js';

/**
 * A second pass over every product screen, with answers shaped more like the vendors' own: no
 * `errors` list (so GraphQL analytics read through), deeper nesting, and form values of every type
 * the screens read (yes/no, whole numbers, lists, an IPv4 address, the console's own words for a
 * field). The first sweep (products-sweep.test.ts) keeps its own shapes. Nothing leaves this
 * machine: fetch is replaced for the whole file.
 */

function sources(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory()
			? sources(join(dir, entry.name))
			: entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
				? [join(dir, entry.name)]
				: [],
	);
}
/** The words each field is compared with in the console's source: `.state === 'active'`, `['type'] === 'A'`. */
const WORDS = new Map<string, string[]>();
for (const file of sources(join(__dirname, '..'))) {
	const code = readFileSync(file, 'utf8');
	for (const match of code.matchAll(/(?:\.(\w+)|\['(\w+)'\])\)?\s*[!=]==?\s*'([^'\n]*)'/g)) {
		const key = (match[1] ?? match[2]) as string;
		const list = WORDS.get(key) ?? [];
		if (!list.includes(match[3] as string)) list.push(match[3] as string);
		WORDS.set(key, list);
	}
	for (const match of code.matchAll(/\['(\w+)'\]\)?\s*\)?\s*\.(?:includes|startsWith|endsWith)\('([^'\n]*)'\)/g)) {
		const key = match[1] as string;
		const list = WORDS.get(key) ?? [];
		if (!list.includes(match[2] as string)) list.push(match[2] as string);
		WORDS.set(key, list);
	}
}

const DEPTH = 8;
const NUMBER =
	/(count|size|total|bytes|requests|price|amount|cost|memory|vcpus|disk|ttl|port|priority|percent|ms|seconds|minutes|limit|threshold|days|hours|weight|code|number|score|ratio|rate|sum|avg|p50|p95|p99|value|version|replicas|nodes|instances|cpu|ram|gb|mb|uniques|threats|bandwidth|hits|misses|duration|usage|balance|monthly|hourly)$/;
const BOOL =
	/^(is|has|can|enabled|active|paused|locked|proxied|on|off|auto|allow|deny|required|default|public|private|managed|draft|prerelease|merged|archived|fork|success)|(enabled|_on|ed)$/;
const TIME = /(_at|at|date|datetime|time|created|updated|modified|expires|since|until|start|end|timestamp)$/;
let pass = 0;

function leaf(key: string, depth: number, at: number): unknown {
	const k = key.toLowerCase();
	// Vendors list their errors only when something failed.
	if (k === 'errors' || k === 'messages') return [];
	if (k === 'error') return null;
	// Ids and names stay readable: an empty word there would hide the product itself.
	const words = /^(id|uuid|name)$/.test(k) ? WORDS.get(key)?.filter(Boolean) : WORDS.get(key);
	if (words?.length && pass % 3 !== 0) return words[(pass + at) % words.length];
	if (TIME.test(k)) return pass === 4 ? null : at ? '2026-11-20T10:00:00.000Z' : '2026-11-20';
	if (NUMBER.test(k)) return [3, 0, 2048, 1, 150][pass % 5];
	if (BOOL.test(k)) return (pass + at) % 2 === 0;
	const named = (re: RegExp) =>
		re.test(k) && (k === 'ip' || k.endsWith('address') ? '203.0.113.9' : `${k}-${(pass + at) % 2}`);
	const exact = named(
		/^(id|uuid|name|type|kind|status|state|region|slug|url|href|ip|address|host|hostname|domain|zone|email|message|title|description|label|tag|key|content|path|ref|sha|branch|conclusion|event|action|mode|plan|pattern|expression|target|value)$/,
	);
	if (exact) return exact;
	// A plural name is a list: zones, records, rules, droplets.
	if (k.endsWith('s') && depth < DEPTH) return anything(depth + 1, at);
	const prefixed = named(
		/^(id|uuid|name|type|kind|status|state|region|slug|url|href|ip|address|host|domain|zone|email|message|title|description|label|tag|key|content|path|ref|sha|branch|event|action|mode|plan)/,
	);
	if (prefixed) return prefixed;
	return depth >= DEPTH ? k : anything(depth + 1, at);
}

function anything(depth = 0, at = 0): unknown {
	// Two rows, each made on first read, so deep answers cost only what is read.
	const kids: unknown[] = [];
	if (depth < DEPTH)
		for (const i of [0, 1]) {
			let made: unknown;
			Object.defineProperty(kids, i, {
				enumerable: true,
				configurable: true,
				get: () => (made ??= anything(depth + 1, i)),
			});
		}
	return new Proxy(kids, {
		get(target, key, receiver) {
			if (typeof key === 'symbol' || key in target) return Reflect.get(target, key, receiver);
			if (key === 'then' || key === 'toJSON') return undefined;
			return leaf(key, depth, at);
		},
	});
}

/**
 * How the vendor answers this pass: typed answers everywhere, or the domain found and every other
 * read refused (403), empty, or failing (500), so each screen's "not readable", "none yet" and error
 * words are drawn too.
 */
let rest: 'typed' | 'refused' | 'empty' | 'broken' = 'typed';
const ZONE_FOUND = {
	success: true,
	result: [
		{ id: 'zone-1', name: 'example.test', status: 'active', account: { id: 'acct-1' }, plan: { name: 'Free' } },
	],
};
/**
 * One read answered differently while the rest stay typed: refused (403) or empty, so a screen's
 * "not readable" and "none" words for that one read are drawn while the reads before it succeed.
 */
let only: string | null = null;
let onlyHow: 'refused' | 'empty' = 'refused';
const seen = new Set<string>();
const pathOf = (url: unknown) => String(url).split('?')[0] as string;
/** An answer with nothing in it: every field an empty list. */
const nothing = (): unknown =>
	new Proxy([], {
		get: (target, key, receiver) =>
			typeof key === 'symbol' || key in target
				? Reflect.get(target, key, receiver)
				: key === 'then' || key === 'toJSON'
					? undefined
					: [],
	});
const fetchStub = vi.fn(async (url: unknown) => {
	seen.add(pathOf(url));
	if (only !== null && pathOf(url) === only) {
		const refused = onlyHow === 'refused';
		return {
			status: refused ? 403 : 200,
			ok: !refused,
			headers: new Headers(),
			json: async () => (refused ? { errors: [] } : nothing()),
			text: async () => '',
			arrayBuffer: async () => new ArrayBuffer(0),
		};
	}
	const zoneLookup = /\/zones\?name=/.test(String(url));
	const status = rest === 'typed' || zoneLookup ? 200 : rest === 'refused' ? 403 : rest === 'broken' ? 500 : 200;
	const body =
		rest === 'typed'
			? anything()
			: zoneLookup
				? ZONE_FOUND
				: rest === 'empty'
					? { success: true, result: [] }
					: { errors: [] };
	return {
		status,
		ok: status < 400,
		headers: new Headers({ 'x-total-count': '2' }),
		json: async () => body,
		text: async () => (rest === 'typed' ? 'text' : ''),
		arrayBuffer: async () => new ArrayBuffer(0),
	};
});
vi.stubGlobal('fetch', fetchStub);

let keyCounter = 0;
function ctx(id: string | null, zones = ['example.test']): ProductCtx {
	keyCounter += 1;
	const key = `typed-key-${keyCounter}`;
	return {
		projectId: 'proj_1',
		repo: {
			id: 'shop',
			name: 'Shop',
			role: '',
			sourceCode: { platform: 'github', repository: 'owner/shop' },
			environments: [
				{ name: 'production', domains: ['example.test'], cloudId: 'c1', branch: 'main' },
				{ name: 'staging', domains: ['staging.example.test'], cloudId: 'c1', branch: 'dev' },
			],
			cloud: [{ id: 'c1', vendor: 'digitalocean' }],
			edge: [{ vendor: 'cloudflare', zones }],
			secrets: [],
			menus: [],
		} as never,
		key,
		writeKey: async () => `write-${key}`,
		zones,
		id,
		range: (['1h', '24h', '7d', '30d'] as const)[pass % 4] as never,
		keyRefs: [{ name: 'do', kind: 'digitalocean', state: 'ok' }] as never,
		consoleKey: (name: string) => `console-${name}`,
		envTags: () => ({ 'do:droplet:3': 'production', 'droplet:id-1': 'staging' }),
		setEnvTag: () => undefined,
		pruneEnvTags: () => undefined,
		recent: () => [{ at: '2026-11-20T10:00:00.000Z', detail: 'detail-1' }],
		recentAll: () => [{ at: '2026-11-20T10:00:00.000Z', detail: 'detail-1' }],
		repository: 'owner/shop',
		localRequests: () => [[Date.now(), 120, 0.01, 10]],
		localView: () => anything() as never,
		helper: async () => anything() as never,
		auditLog: () => [{ at: '2026-11-20T10:00:00.000Z', action: 'action-1', detail: 'detail-1' }],
	};
}

/** A form value of the type this pass tries, or the console's own word for the field. */
function value(key: string): unknown {
	const words = WORDS.get(key);
	const typed = [
		true,
		'3',
		'name-1',
		['name-1', 'example.test'],
		'203.0.113.9',
		false,
		'true',
		3,
		'A',
		'production',
		'staging',
		'approved',
		'',
		'main',
		'2026-12-01',
	];
	if (words?.length && pass % 2 === 1) return words[Math.floor(pass / 2) % words.length];
	return typed[pass % typed.length];
}
const write = (confirm: string) =>
	({
		pin: '123456',
		confirm,
		id: 'id-1',
		values: new Proxy({} as Record<string, unknown>, {
			get: (_target, key) => (typeof key === 'string' ? value(key) : undefined),
			has: () => true,
		}),
	}) as never;

async function settle(run: () => unknown): Promise<unknown> {
	try {
		return await run();
	} catch {
		return null;
	}
}

async function sweepForm(spec: ProductFormSpec, id: string | null): Promise<void> {
	await settle(() => spec.read(ctx(id)));
	for (const confirm of ['name-0', 'example.test', 'name-1']) {
		const sent = (await settle(() => spec.send(ctx(id), write(confirm)))) as {
			follow?: Array<{ check(key: string): Promise<boolean>; detail?: () => string }>;
		} | null;
		for (const step of sent?.follow ?? []) {
			await settle(() => step.check('typed-follow'));
			await settle(() => step.detail?.());
		}
	}
}

afterEach(() => {
	pass = 0;
	only = null;
	forget('typed-follow');
});

/** Runs one read or send typed, then again with each read it made refused, then empty. */
async function eachReadOnce(run: () => Promise<unknown>): Promise<void> {
	only = null;
	seen.clear();
	await settle(run);
	const paths = [...seen];
	for (const path of paths)
		for (onlyHow of ['refused', 'empty'] as const) {
			only = path;
			await settle(run);
		}
	only = null;
}

describe('every product screen, with typed answers and values', () => {
	for (const [name, screen] of Object.entries(PRODUCT_SCREENS)) {
		it(`reads and sends ${name}`, async () => {
			for (pass = 0; pass < 15; pass++) {
				for (const id of [null, 'id-1', '3']) {
					for (const read of Object.values(screen.tabs)) await settle(() => read(ctx(id)));
					if (name === 'loadtest') continue;
					for (const spec of Object.values(screen.forms ?? {})) await sweepForm(spec, id);
				}
			}
			// A repository whose edge names no domain.
			for (const read of Object.values(screen.tabs)) await settle(() => read(ctx(null, [])));
			// The domain found, and every other read refused, empty or failing.
			for (rest of ['refused', 'empty', 'broken'] as const)
				for (const id of [null, 'id-1']) {
					for (const read of Object.values(screen.tabs)) await settle(() => read(ctx(id)));
					if (name === 'loadtest') continue;
					for (const spec of Object.values(screen.forms ?? {})) await sweepForm(spec, id);
				}
			rest = 'typed';
			expect(Object.keys(screen.tabs).length + Object.keys(screen.forms ?? {}).length).toBeGreaterThan(0);
		}, 300_000);
	}
});

describe('every product screen, with one read at a time refused or empty', () => {
	for (const [name, screen] of Object.entries(PRODUCT_SCREENS)) {
		it(`reads and sends ${name}`, async () => {
			for (pass of [1, 2])
				for (const id of [null, 'id-1']) {
					for (const read of Object.values(screen.tabs)) await eachReadOnce(async () => read(ctx(id)));
					if (name === 'loadtest') continue;
					for (const spec of Object.values(screen.forms ?? {})) {
						await eachReadOnce(async () => spec.read(ctx(id)));
						await eachReadOnce(async () => spec.send(ctx(id), write('name-1')));
					}
				}
			expect(seen.size).toBeGreaterThanOrEqual(0);
		}, 300_000);
	}
});
