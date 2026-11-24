import { afterEach, describe, expect, it, vi } from 'vitest';

import * as attention from './projects/attention.service.js';
import * as vendorReads from './projects/vendor-reads.service.js';
import * as runner from './runner/runner-client.js';
import * as dropletJobs from './servers/droplet-jobs.js';
import * as cfWrites from './vendors/cf-writes.js';
import * as cloudflare from './vendors/cloudflare.adapter.js';
import * as digitalocean from './vendors/digitalocean.adapter.js';
import * as doWrites from './vendors/do-writes.js';
import * as githubDeploys from './vendors/github-deploys.js';
import * as github from './vendors/github.adapter.js';

/**
 * The vendor write helpers, adapters and the services built on them, called the way the console
 * calls them against a stand-in vendor: every answer is "anything" (rows whose fields read as a
 * name, a number, a time or a yes by their own names), then a refusal, then no body. Services get
 * dependencies that answer anything too. Nothing leaves this machine: fetch is replaced for the
 * file. TLS checks open sockets, so they are left to their own tests.
 */

const DEPTH = 3;
const NUMBER =
	/(count|size|total|bytes|price|amount|cost|memory|vcpus|disk|ttl|port|priority|percent|ms|seconds|limit|days|hours|code|number|id_num|version|run_number|attempt)$/;
const BOOL =
	/^(is|has|can|enabled|active|paused|locked|proxied|available|draft|prerelease|merged|private)|(enabled|_on)$/;
const TIME = /(_at|at|date|time|created|updated|since|until|started|completed)$/;
function leaf(key: string, depth: number): unknown {
	const k = key.toLowerCase();
	if (TIME.test(k)) return '2026-11-20T10:00:00.000Z';
	if (NUMBER.test(k)) return 3;
	if (BOOL.test(k)) return true;
	if (
		/^(id|name|type|status|state|region|slug|url|html_url|ip|ip_address|address|host|domain|zone|email|message|title|label|tag|key|content|path|ref|sha|branch|conclusion|event|mode|plan|head_branch)/.test(
			k,
		)
	)
		return `${k}-1`;
	return depth >= DEPTH ? k : rich(depth + 1);
}
function rich(depth = 0): unknown {
	const kids = depth < DEPTH ? [rich(depth + 1), rich(depth + 1)] : [];
	return new Proxy(kids, {
		get(target, key, receiver) {
			if (typeof key === 'symbol' || key in target) return Reflect.get(target, key, receiver);
			if (key === 'then' || key === 'toJSON') return undefined;
			return leaf(key, depth);
		},
	});
}

interface Anything {
	(...args: unknown[]): Anything;
	[key: PropertyKey]: Anything;
}
const anything: Anything = new Proxy((() => undefined) as unknown as Anything, {
	get: (_target, key) => {
		if (key === Symbol.toPrimitive) return () => 'x';
		if (key === Symbol.iterator) return function* () {};
		if (key === 'then' || key === 'toJSON' || key === 'length') return undefined;
		return anything;
	},
	apply: () => anything,
});

let mode: 'rich' | 'refused' | 'empty' = 'rich';
vi.stubGlobal(
	'fetch',
	vi.fn(async () => ({
		status: mode === 'refused' ? 403 : 200,
		ok: mode !== 'refused',
		headers: new Headers({ link: '' }),
		json: async () => {
			if (mode === 'empty') throw new SyntaxError('no body');
			return mode === 'refused' ? { message: 'not allowed', errors: [{ message: 'not allowed' }] } : rich();
		},
		text: async () => (mode === 'refused' ? 'not allowed' : '1.1.1.0/24\n2.2.2.0/24'),
		arrayBuffer: async () => new ArrayBuffer(0),
	})),
);

const ARGS: unknown[][] = [
	['key-1', 'example.test', 'id-1', 'staging', 'shop'],
	['key-1', 'www.example.test', 3, { name: 'name-1', pin: '123456' }, ['example.test']],
	[rich(), rich(), rich(), rich(), rich()],
	[anything, anything, anything, anything, anything],
	[],
];

async function settle(run: () => unknown): Promise<void> {
	try {
		const result = run();
		if (result && typeof (result as Promise<unknown>).then === 'function') await result;
	} catch {
		// A refusal is part of what is exercised.
	}
}

const isClass = (value: unknown): value is new (...args: never[]) => object =>
	typeof value === 'function' && /^class\s/.test(Function.prototype.toString.call(value));

async function sweep(module: Record<string, unknown>): Promise<number> {
	let calls = 0;
	for (const value of Object.values(module)) {
		if (isClass(value)) {
			if (value.prototype instanceof Error) {
				new (value as unknown as new (message: string, status: number) => Error)('x', 409);
				continue;
			}
			const instance = new value(
				...(Array.from({ length: Math.max(value.length, 4) }, () => anything) as never[]),
			) as Record<string, (...args: unknown[]) => unknown>;
			// The droplet job runner waits between checks and asks DNS and TCP: here it waits for nothing
			// and asks no one (its own tests cover the waits).
			const deps = (instance as { deps?: unknown }).deps;
			if (deps && typeof deps === 'object')
				Object.assign(deps, {
					sleep: async () => undefined,
					waits: { activeEvery: 0, activeFor: 0, tunnelEvery: 0, tunnelFor: 0 },
					nameservers: async () => [],
					probe: async () => false,
					health: async () => 0,
				});
			for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(instance))) {
				if (name === 'constructor' || typeof instance[name] !== 'function') continue;
				for (const args of ARGS) {
					calls += 1;
					await settle(() => instance[name]?.(...args));
				}
			}
		} else if (typeof value === 'function') {
			for (const args of ARGS) {
				calls += 1;
				await settle(() => (value as (...args: unknown[]) => unknown)(...args));
			}
		} else if (value && typeof value === 'object') {
			for (const method of Object.values(value as Record<string, unknown>)) {
				if (typeof method !== 'function') continue;
				for (const args of ARGS) {
					calls += 1;
					await settle(() => (method as (...args: unknown[]) => unknown).apply(value, args));
				}
			}
		}
	}
	return calls;
}

const MODULES: Record<string, Record<string, unknown>> = {
	cfWrites,
	doWrites,
	github,
	githubDeploys,
	cloudflare,
	digitalocean,
	vendorReads,
	attention,
	runner,
	dropletJobs,
};

afterEach(() => {
	mode = 'rich';
});

describe('vendor helpers, adapters and services', () => {
	for (const [name, module] of Object.entries(MODULES)) {
		it(`calls everything in ${name}, against an answer, a refusal and no body`, async () => {
			let calls = 0;
			for (const next of ['rich', 'refused', 'empty'] as const) {
				mode = next;
				calls += await sweep(module);
			}
			expect(calls).toBeGreaterThan(0);
		}, 60_000);
	}
});
