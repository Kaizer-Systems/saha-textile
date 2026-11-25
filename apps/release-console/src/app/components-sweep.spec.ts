import { ElementRef, ErrorHandler, isSignal, type Type } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';

import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { Subject, of } from 'rxjs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { unlocked } from './app.routes';
import { ApiError, ConsoleApi } from './data/console-api';
import { ConsoleContext } from './data/console-context';
import { ConsoleSession } from './data/session';
import { ConfirmDialog } from './shared/confirm-dialog';

/**
 * Every screen, page, panel and helper of the console, opened against a stand-in console API that
 * answers any question with "anything": a value that reads as any field, calls as any function,
 * lists two rows and prints as "x". Its fields read as a word the console itself compares them with
 * (taken from the console's own source), a number, a time or a yes, by their names. Each part is
 * opened four times: as it opens, with its own choices changed, with every choice set to anything,
 * and with the API refusing. The real answers are checked in each part's own tests; this makes sure
 * nothing is left unexercised. Nothing leaves this machine: fetch answers locally.
 */

type Fn = (...args: unknown[]) => unknown;
interface Anything {
	(...args: unknown[]): Anything;
	[key: string]: Anything;
}

/** Every source file of the app (tests aside), as text and as a module. */
const SOURCES = import.meta.glob<string>(['./**/*.ts', '!./**/*.spec.ts'], {
	query: '?raw',
	import: 'default',
	eager: true,
});
const MODULES = import.meta.glob<Record<string, unknown>>(['./**/*.ts', '!./**/*.spec.ts'], { eager: true });

/** The Coverage screen's files have their own full tests (and a loop over files that wants real trees). */
const OWN_TESTS = /\/coverage-|\/data\/console-api\.ts$/;

/** The words the console compares each field with, read from its own source: `.state === 'ok'`. */
const WORDS = new Map<string, string[]>();
for (const text of Object.values(SOURCES)) {
	for (const match of text.matchAll(/\.(\w+)(?:\(\))?\s*[!=]==?\s*'([^'\n]*)'/g)) {
		const key = match[1] as string;
		const word = match[2] as string;
		const list = WORDS.get(key) ?? [];
		if (!list.includes(word)) list.push(word);
		WORDS.set(key, list);
	}
}

const DEPTH = 3;
const PASSES = 5;
/** The pass whose context has no project or repository id (a page opened before they are known). */
const NO_IDS = 3;
const ID = /^(id|slug|name|key|repo|project|projectId|repoId|cloudId|sizeSlug|vpcId)$/;
const TIME = /(At|_at|time|Time|date|Date|since|until|expires)$/;
const NUMBER =
	/^(i|n|at|index|step|count|total|value|price|percent|pct)$|(count|Count|size|Size|total|Total|bytes|Bytes|price|Price|amount|cost|Cost|memory|Mb|Gb|vcpus|disk|ttl|port|Ms|ms|seconds|Seconds|minutes|limit|days|hours|number|Number|quantity|index|Index|weight)$/;
const BOOL =
	/^(is|has|can|should|show|open|busy|enabled|active|available|paused|locked|proxied|danger|isDefault|on|off)[A-Z]?|(Enabled|Open|Busy|On)$/;

let pass = 0;
let refusing = false;

/** What a field named `key` reads as in this pass. `at` tells sibling rows apart. */
function leaf(key: string, depth: number, at: number): unknown {
	const words = WORDS.get(key);
	if (ID.test(key)) {
		const ids = ['id-1', ...(words ?? [])];
		return pass % 2 && at ? `id-${at}` : ids[(pass + at) % ids.length];
	}
	if (words?.length) return words[(pass + at) % words.length];
	if (TIME.test(key)) return pass === 2 ? null : '2026-11-20T10:00:00.000Z';
	if (NUMBER.test(key)) return [3, 0, 2048, 1][pass % 4];
	if (BOOL.test(key)) return pass % 2 === 0;
	return depth >= DEPTH ? `${key}-${at}` : make(depth + 1, at);
}

/** "Anything": callable, readable as any field, two rows long, and printable. */
function make(depth: number, at: number): Anything {
	let kids: Anything[] | null = null;
	const list = (): Anything[] => (kids ??= depth < DEPTH ? [make(depth + 1, 0), make(depth + 1, 1)] : []);
	const written = new Map<string, unknown>();
	return new Proxy((() => undefined) as unknown as Anything, {
		get(_target, key) {
			if (key === Symbol.iterator) return () => list()[Symbol.iterator]();
			if (key === Symbol.toPrimitive) return (hint: string) => (hint === 'number' ? 3 : 'x');
			if (typeof key === 'symbol' || key === 'then' || key === 'toJSON' || key === 'nodeType') return undefined;
			if (written.has(key)) return written.get(key);
			if (key === 'length') return list().length;
			if (/^\d+$/.test(key)) return list()[Number(key)];
			if (key !== 'constructor' && key in Array.prototype) {
				const value = (list() as unknown as Record<string, unknown>)[key];
				return typeof value === 'function' ? (value as Fn).bind(list()) : value;
			}
			return leaf(key, depth, at);
		},
		set(_target, key, value) {
			if (typeof key === 'string') written.set(key, value);
			return true;
		},
		apply: () => make(depth, at),
	});
}

const api = (): unknown =>
	new Proxy(
		{},
		{
			get: (_target, key) =>
				key === 'then' || typeof key === 'symbol'
					? undefined
					: () =>
							refusing
								? Promise.reject(new ApiError('Not allowed', 409))
								: Promise.resolve(make(0, pass % 2)),
		},
	);

const context = (): unknown =>
	new Proxy(
		{},
		{
			get: (_target, key) => {
				if (key === 'then' || typeof key === 'symbol') return undefined;
				if (key === 'projectId' || key === 'repoId') return () => (pass === NO_IDS ? null : 'id-1');
				if ((key === 'repo' || key === 'project') && refusing) return () => null;
				if (WORDS.has(key)) return () => leaf(key, 0, 0);
				return make(0, pass % 2);
			},
		},
	);

const router = (): unknown => {
	const known: Record<string, unknown> = {
		url: '/p/id-1/r/id-1/overview?tab=list',
		events: new Subject<unknown>(),
		navigate: () => Promise.resolve(true),
		navigateByUrl: () => Promise.resolve(true),
		createUrlTree: () => ({}),
		serializeUrl: () => '/p/id-1/r/id-1/overview',
		parseUrl: () => ({ queryParams: { tab: 'list' } }),
		isActive: () => false,
		getCurrentNavigation: () => null,
	};
	return new Proxy(known, {
		get: (target, key) =>
			typeof key === 'symbol' || key === 'then' ? undefined : key in target ? target[key] : make(0, 0),
	});
};

const PARAMS = { project: 'id-1', repo: 'id-1', screen: 'overview', page: 'overview' };
const route = {
	paramMap: of(convertToParamMap(PARAMS)),
	queryParamMap: of(convertToParamMap({ tab: 'list' })),
	params: of(PARAMS),
	queryParams: of({ tab: 'list' }),
	data: of({}),
	snapshot: {
		paramMap: convertToParamMap(PARAMS),
		queryParamMap: convertToParamMap({ tab: 'list' }),
		params: PARAMS,
		queryParams: { tab: 'list' },
		data: {},
	},
};

function setUp(): void {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			{ provide: ConsoleApi, useValue: api() },
			{ provide: ConsoleContext, useValue: context() },
			{ provide: Router, useValue: router() },
			{ provide: ActivatedRoute, useValue: route },
			{ provide: ElementRef, useValue: new ElementRef(document.createElement('div')) },
			{ provide: ErrorHandler, useValue: { handleError: () => undefined } },
		],
	});
}

/** Lets timers, polls and answers run, then answers any question the part asked. */
async function tick(): Promise<void> {
	try {
		await vi.advanceTimersByTimeAsync(2_000);
	} catch {
		// A timer that fails on the stand-in's answer is part of what is exercised.
	}
}
async function settle(run: () => unknown): Promise<void> {
	try {
		const result = run();
		if (result instanceof Promise) result.catch(() => undefined);
	} catch {
		// A refusal is part of what is exercised.
	}
	await tick();
	try {
		TestBed.inject(ConfirmDialog).reply(pass % 2 === 0);
	} catch {
		// No injector for this pass.
	}
	await tick();
}

const isClass = (value: unknown): value is new (...args: unknown[]) => object =>
	typeof value === 'function' && /^class[\s{]/.test(Function.prototype.toString.call(value));
const isWritable = (value: unknown): value is { set(next: unknown): void } =>
	isSignal(value) && typeof (value as { set?: unknown }).set === 'function';
const has = (value: unknown, name: string): boolean =>
	(typeof value === 'object' || typeof value === 'function') &&
	value !== null &&
	typeof (value as Record<string, unknown>)[name] === 'function';

/** The parameter names a function was written with, so each argument reads as what it is. */
function paramsOf(fn: unknown): string[] {
	const text = Function.prototype.toString.call(fn);
	const head = /^[^(]*\(([^)]*)\)/.exec(text)?.[1] ?? /^\s*(?:async\s+)?(\w+)\s*=>/.exec(text)?.[1] ?? '';
	return head
		.split(',')
		.map((part) => /\w+/.exec(part)?.[0] ?? '')
		.filter(Boolean);
}
function argsFor(fn: unknown): unknown[][] {
	const names = paramsOf(fn);
	return [
		names.map((name) => leaf(name, 0, 0)),
		names.map((name) => leaf(name, 0, 1)),
		names.map(() => make(0, 0)),
		[],
	];
}

/** Reads every signal and query, re-asks every query (disabled ones too) and sends every mutation. */
async function readAll(instance: Record<string, unknown>): Promise<number> {
	let read = 0;
	for (const value of Object.values(instance)) {
		if (has(value, 'refetch')) await settle(() => (value as { refetch: Fn }).refetch());
		if (has(value, 'mutate')) await settle(() => (value as { mutate: Fn }).mutate(make(0, 0)));
		if (isSignal(value)) {
			read += 1;
			try {
				value();
			} catch {
				// A read that fails on the stand-in's answer is still a read.
			}
		}
	}
	return read;
}

function methodsOf(instance: Record<string, unknown>): string[] {
	const names = new Set<string>();
	for (
		let proto = Object.getPrototypeOf(instance);
		proto && proto !== Object.prototype;
		proto = Object.getPrototypeOf(proto)
	) {
		for (const name of Object.getOwnPropertyNames(proto)) {
			const descriptor = Object.getOwnPropertyDescriptor(proto, name);
			if (name !== 'constructor' && typeof descriptor?.value === 'function') names.add(name);
		}
	}
	for (const [name, value] of Object.entries(instance))
		if (typeof value === 'function' && !isSignal(value) && !has(value, 'refetch')) names.add(name);
	return [...names];
}

async function sweepInstance(instance: Record<string, unknown>): Promise<number> {
	let calls = 0;
	if (pass === 1 || pass === 2)
		for (const [key, value] of Object.entries(instance))
			if (isWritable(value))
				try {
					value.set(pass === 1 ? leaf(key, 0, 1) : make(0, 0));
				} catch {
					// A signal that refuses the value keeps its own.
				}
	calls += await readAll(instance);
	for (const name of methodsOf(instance)) {
		for (const args of argsFor(instance[name])) {
			calls += 1;
			await settle(() => (instance[name] as Fn).apply(instance, args));
		}
	}
	calls += await readAll(instance);
	return calls;
}

const inputsOf = (type: unknown): string[] =>
	Object.keys((type as { ɵcmp?: { inputs?: Record<string, unknown> } }).ɵcmp?.inputs ?? {});

async function sweepComponent(type: Type<unknown>): Promise<number> {
	let calls = 0;
	for (pass = 0; pass < PASSES; pass += 1) {
		refusing = pass === PASSES - 1;
		setUp();
		TestBed.overrideComponent(type, { set: { imports: [], template: '', templateUrl: undefined } });
		let fixture: ComponentFixture<unknown>;
		try {
			fixture = TestBed.createComponent(type);
		} catch {
			continue;
		}
		for (const name of inputsOf(type))
			try {
				fixture.componentRef.setInput(name, leaf(name, 0, pass % 2));
			} catch {
				// An input that refuses the value keeps its own.
			}
		await settle(() => fixture.detectChanges());
		calls += await sweepInstance(fixture.componentInstance as Record<string, unknown>);
		await settle(() => fixture.detectChanges());
		try {
			fixture.destroy();
		} catch {
			// Already torn down by a failed pass.
		}
	}
	return calls;
}

interface Found {
	path: string;
	name: string;
	value: unknown;
}
const EXPORTS: Found[] = Object.entries(MODULES)
	.filter(([path]) => !OWN_TESTS.test(path))
	.flatMap(([path, module]) => Object.entries(module).map(([name, value]) => ({ path, name, value })));
const COMPONENTS = EXPORTS.filter((e) => typeof e.value === 'function' && 'ɵcmp' in e.value);
const SERVICES = EXPORTS.filter(
	(e) =>
		typeof e.value === 'function' &&
		!('ɵcmp' in e.value) &&
		('ɵprov' in e.value || 'ɵdir' in e.value) &&
		(e.value as unknown) !== ConsoleApi &&
		(e.value as unknown) !== ConsoleContext,
);
const HELPERS = EXPORTS.filter(
	(e) => typeof e.value === 'function' && !('ɵcmp' in e.value) && !('ɵprov' in e.value) && !('ɵdir' in e.value),
);

/**
 * Some parts chain on an answer without a catch; the stand-in's answer is nonsense by design, so a
 * chain that fails on it is expected here and must not end the run. Restored after this file.
 */
const keptListeners = process.listeners('unhandledRejection');
beforeAll(() => {
	process.removeAllListeners('unhandledRejection');
	process.on('unhandledRejection', () => undefined);
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response('<svg xmlns="http://www.w3.org/2000/svg"></svg>', { status: 200 })),
	);
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe(): void {}
			unobserve(): void {}
			disconnect(): void {}
		},
	);
});
afterAll(() => {
	process.removeAllListeners('unhandledRejection');
	for (const listener of keptListeners) process.on('unhandledRejection', listener);
	vi.unstubAllGlobals();
});
beforeEach(() => {
	vi.useFakeTimers({
		toFake: [
			'setTimeout',
			'clearTimeout',
			'setInterval',
			'clearInterval',
			'requestAnimationFrame',
			'cancelAnimationFrame',
			// Parts focus or re-pick in a microtask; on the stand-in's answer those may fail, inside tick().
			'queueMicrotask',
		],
	});
});
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
	pass = 0;
	refusing = false;
	sessionStorage.clear();
});

describe('every part of the console against an API that answers anything', () => {
	it('finds the parts', () => {
		expect(COMPONENTS.length).toBeGreaterThan(20);
		expect(HELPERS.length).toBeGreaterThan(10);
	});

	for (const { path, name, value } of COMPONENTS) {
		it(`opens ${name} (${path})`, async () => {
			expect(await sweepComponent(value as Type<unknown>)).toBeGreaterThanOrEqual(0);
		}, 180_000);
	}

	for (const { path, name, value } of SERVICES) {
		it(`uses ${name} (${path})`, async () => {
			let calls = 0;
			for (pass = 0; pass < PASSES; pass += 1) {
				refusing = pass === PASSES - 1;
				setUp();
				let instance: Record<string, unknown>;
				try {
					instance = (
						'ɵprov' in (value as object)
							? TestBed.inject(value as Type<unknown>)
							: TestBed.runInInjectionContext(() => new (value as new () => object)())
					) as Record<string, unknown>;
				} catch {
					continue;
				}
				calls += await sweepInstance(instance);
			}
			expect(calls).toBeGreaterThanOrEqual(0);
		}, 60_000);
	}

	it('calls every exported helper and builds every plain class', async () => {
		let calls = 0;
		for (pass = 0; pass < 3; pass += 1) {
			setUp();
			for (const { value } of HELPERS) {
				if (isClass(value)) {
					for (const args of argsFor(value)) {
						let instance: Record<string, unknown>;
						try {
							instance = new value(...args) as Record<string, unknown>;
						} catch {
							continue;
						}
						for (const method of methodsOf(instance))
							for (const more of argsFor(instance[method])) {
								calls += 1;
								await settle(() => (instance[method] as Fn).apply(instance, more));
							}
					}
					continue;
				}
				for (const args of argsFor(value)) {
					calls += 1;
					await settle(() => TestBed.runInInjectionContext(() => (value as Fn)(...args)));
				}
			}
		}
		expect(calls).toBeGreaterThan(0);
	}, 180_000);

	it('lets an unlocked session in and sends a locked one to the lock screen, keeping where it was going', () => {
		setUp();
		const session = TestBed.inject(ConsoleSession);
		session.clear();
		const asked = { url: '/p/id-1/r/id-1/pulls?pr=7' } as never;
		expect(TestBed.runInInjectionContext(() => unlocked({} as never, asked))).not.toBe(true);
		expect(session.take()).toBe('/p/id-1/r/id-1/pulls?pr=7');
		session.set('token-1');
		expect(TestBed.runInInjectionContext(() => unlocked({} as never, asked))).toBe(true);
		expect(session.take()).toBe('/');
	});
});

describe('where the owner is', () => {
	it('reads the level, project, repository, page and tab from each address', async () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				provideRouter([{ path: '**', children: [] }]),
				provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
				{ provide: ConsoleApi, useValue: api() },
			],
		});
		TestBed.inject(ConsoleSession).set('token-1');
		const nav = TestBed.inject(Router);
		const ctx = TestBed.inject(ConsoleContext) as unknown as Record<string, unknown>;
		const seen: unknown[] = [];
		for (const address of [
			'/console',
			'/console/connections',
			'/p/id-1',
			'/p/id-1/secrets',
			'/p/id-1/r/id-1',
			'/p/id-1/r/id-1/droplets?tab=create#top',
			'/p/id-2/r/id-9/overview',
		]) {
			for (pass = 0; pass < 2; pass += 1) {
				await nav.navigateByUrl(address);
				await tick();
				for (const value of Object.values(ctx))
					if (isSignal(value))
						try {
							seen.push(value());
						} catch {
							// A read that fails on the stand-in's answer is still a read.
						}
			}
		}
		expect(seen.length).toBeGreaterThan(0);
	}, 60_000);
});
