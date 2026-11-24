import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { forget } from './kit.js';
import { PRODUCT_SCREENS } from './registry.js';

import type { ProductCtx, ProductFormSpec } from './kit.js';

/**
 * Every product screen's tabs and forms, read and sent against a stand-in vendor that answers any
 * question with "anything": arrays of two rows whose fields read as a name, a number, a time or a
 * yes by their own names, nested a few levels deep. A second pass answers with a refusal and a
 * third with no body, so each screen's own fallbacks run too. Nothing leaves this machine: fetch
 * is replaced for the whole file. The screens' real answers are checked in their own tests.
 */

/** The words the console compares each field with, read from its own source: `.state === 'active'`. */
function sources(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory()
			? sources(join(dir, entry.name))
			: entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
				? [join(dir, entry.name)]
				: [],
	);
}
const WORDS = new Map<string, string[]>();
for (const file of sources(join(__dirname, '..'))) {
	for (const match of readFileSync(file, 'utf8').matchAll(/\.(\w+)\s*[!=]==?\s*'([^'\n]*)'/g)) {
		const key = match[1] as string;
		const list = WORDS.get(key) ?? [];
		if (!list.includes(match[2] as string)) list.push(match[2] as string);
		WORDS.set(key, list);
	}
}

const DEPTH = 3;
const NUMBER =
	/(count|size|total|bytes|requests|price|amount|cost|memory|vcpus|disk|ttl|port|priority|percent|ms|seconds|minutes|limit|threshold|days|hours|weight|code|number|score|ratio|rate|sum|avg|p50|p95|p99|value|version|replicas|nodes|instances|cpu|ram|gb|mb)$/;
const BOOL =
	/^(is|has|can|enabled|active|paused|locked|proxied|on|off|auto|allow|deny|required|default|public|private|managed|draft|prerelease|merged|archived|fork)|(enabled|_on|ed)$/;
const TIME = /(_at|at|date|time|created|updated|modified|expires|since|until|start|end|timestamp)$/;
/** Which reading of the words this pass uses: each pass answers differently, so both sides of a check run. */
let pass = 0;

function leaf(key: string, depth: number, at: number): unknown {
	// The first pass reads every field by its name alone; the others answer with the console's own words.
	const words = pass === 0 ? undefined : WORDS.get(key);
	if (words?.length) return words[(pass - 1 + at) % words.length];
	const k = key.toLowerCase();
	if (TIME.test(k)) return pass === 2 ? null : '2026-11-20T10:00:00.000Z';
	if (NUMBER.test(k)) return [3, 0, 2048, 1][pass % 4];
	if (BOOL.test(k)) return pass % 2 === 0;
	if (
		/^(id|uuid|name|type|kind|status|state|region|slug|url|href|ip|address|host|hostname|domain|zone|email|message|title|description|label|tag|key|value_text|content|path|ref|sha|branch|conclusion|event|action|mode|plan)/.test(
			k,
		)
	)
		return `${k}-${pass % 2 ? at : 1}`;
	return depth >= DEPTH ? k : anything(depth + 1, at);
}

function anything(depth = 0, at = 0): unknown {
	const kids = depth < DEPTH ? [anything(depth + 1, 0), anything(depth + 1, 1)] : [];
	return new Proxy(kids, {
		get(target, key, receiver) {
			if (typeof key === 'symbol' || key in target) return Reflect.get(target, key, receiver);
			if (key === 'then' || key === 'toJSON') return undefined;
			return leaf(key, depth, at);
		},
	});
}

type Answer = 'rich' | 'refused' | 'empty';
let answer: Answer = 'rich';
const fetchStub = vi.fn(async () => ({
	status: answer === 'refused' ? 403 : 200,
	ok: answer !== 'refused',
	headers: new Headers(),
	json: async () => {
		if (answer === 'empty') throw new SyntaxError('no body');
		return answer === 'refused' ? { errors: [{ message: 'not allowed' }], message: 'not allowed' } : anything();
	},
	text: async () => 'text',
	arrayBuffer: async () => new ArrayBuffer(0),
}));
vi.stubGlobal('fetch', fetchStub);

let keyCounter = 0;
function ctx(id: string | null): ProductCtx {
	keyCounter += 1;
	const key = `key-${keyCounter}`;
	return {
		projectId: 'proj_1',
		repo: {
			id: 'shop',
			name: 'Shop',
			role: '',
			sourceCode: { platform: 'github', repository: 'owner/shop' },
			environments: [{ name: 'production' }, { name: 'staging' }],
			cloud: [{ vendor: 'digitalocean' }],
			edge: [{ vendor: 'cloudflare', zones: ['example.test'] }],
			secrets: [],
			menus: [],
		} as never,
		key,
		writeKey: async () => `write-${key}`,
		zones: ['example.test'],
		id,
		range: '24h' as never,
		keyRefs: [{ name: 'do', kind: 'digitalocean', state: 'ok' }] as never,
		consoleKey: (name: string) => `console-${name}`,
		envTags: () => ({ 'droplet:id-1': 'production' }),
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

const write = (confirm = '') =>
	({
		pin: '123456',
		confirm,
		id: 'id-1',
		values: new Proxy({} as Record<string, unknown>, {
			get: (_target, key) => {
				if (typeof key !== 'string') return undefined;
				const words = WORDS.get(key);
				return words?.length ? words[pass % words.length] : ['3', '', 'name-1', '0'][pass % 4];
			},
		}),
	}) as never;

/** Runs one call to its end, whatever it throws: a refusal is part of what is being exercised. */
async function settle(run: () => unknown): Promise<unknown> {
	try {
		return await run();
	} catch {
		return null;
	}
}

async function sweepForm(spec: ProductFormSpec, id: string | null): Promise<void> {
	await settle(() => spec.read(ctx(id)));
	for (const confirm of ['', 'name-1']) {
		const sent = (await settle(() => spec.send(ctx(id), write(confirm)))) as {
			follow?: Array<{ check(key: string): Promise<boolean>; detail?: () => string }>;
		} | null;
		for (const step of sent?.follow ?? []) {
			await settle(() => step.check('key-follow'));
			await settle(() => step.detail?.());
		}
	}
}

afterEach(() => {
	answer = 'rich';
	pass = 0;
	forget('key-follow');
});

describe('every product screen, tab by tab and form by form', () => {
	for (const [name, screen] of Object.entries(PRODUCT_SCREENS)) {
		it(`reads and sends ${name}`, async () => {
			const modes = [
				['rich', 0],
				['rich', 1],
				['rich', 2],
				['rich', 3],
				['refused', 0],
				['empty', 0],
			] as const;
			for (const [mode, at] of modes) {
				answer = mode;
				pass = at;
				for (const id of [null, 'id-1']) {
					for (const read of Object.values(screen.tabs)) await settle(() => read(ctx(id)));
					// The load test sends real requests for as long as it is told; its form is left to its own tests.
					if (name === 'loadtest') continue;
					for (const spec of Object.values(screen.forms ?? {})) await sweepForm(spec, id);
				}
			}
			expect(Object.keys(screen.tabs).length + Object.keys(screen.forms ?? {}).length).toBeGreaterThan(0);
		}, 120_000);
	}
});
