import { HttpErrorResponse, HttpRequest } from '@angular/common/http';
import { PLATFORM_ID, TransferState } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { dehydrate, QueryClient } from '@tanstack/angular-query-experimental';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { QUERY_CLIENT, QUERY_STATE, isPublicQuery, isPublicRequest } from './query-client';
import { provideQueryTransfer, provideServerQueryWait } from './query-transfer.server';

const client = (platform: string) => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: platform }] });
	return TestBed.inject(QUERY_CLIENT);
};
const retry = (instance: QueryClient) =>
	instance.getDefaultOptions().queries?.retry as (count: number, error: unknown) => boolean;

afterEach(() => vi.useRealTimers());

describe('isPublicQuery', () => {
	it('allows catalogue data and refuses everything else', () => {
		expect(isPublicQuery(['catalog', 'home'])).toBe(true);
		expect(isPublicQuery(['orders'])).toBe(false);
		expect(isPublicQuery([1])).toBe(false);
	});
});

describe('isPublicRequest', () => {
	const request = (url: string, withCredentials = false) => new HttpRequest('GET', url, { withCredentials });

	it('allows public reads', () => {
		expect(isPublicRequest(request('https://api.test/catalog/home'))).toBe(true);
		expect(isPublicRequest(request('/assets/i18n/en.json'))).toBe(true);
	});

	it('refuses credentialed and private requests', () => {
		expect(isPublicRequest(request('https://api.test/catalog/home', true))).toBe(false);
		expect(isPublicRequest(request('https://api.test/storefront/account'))).toBe(false);
	});
});

describe('QUERY_CLIENT', () => {
	it('never retries on the server', () => {
		expect(retry(client('server'))(0, new Error('x'))).toBe(false);
	});

	it('retries a failure three times in the browser, but never a refusal', () => {
		const answer = retry(client('browser'));
		expect(answer(0, new Error('x'))).toBe(true);
		expect(answer(3, new Error('x'))).toBe(false);
		expect(answer(0, new HttpErrorResponse({ status: 404 }))).toBe(false);
		expect(answer(0, new HttpErrorResponse({ status: 500 }))).toBe(true);
		expect(answer(0, new HttpErrorResponse({ status: 0 }))).toBe(true);
	});

	it('picks up what the server shipped, once', () => {
		const source = new QueryClient();
		source.setQueryData(['catalog', 'x'], { ok: true });
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: 'browser' }] });
		const transfer = TestBed.inject(TransferState);
		transfer.set(QUERY_STATE, dehydrate(source));
		const hydrated = TestBed.inject(QUERY_CLIENT);
		expect(hydrated.getQueryData(['catalog', 'x'])).toEqual({ ok: true });
		expect(transfer.hasKey(QUERY_STATE)).toBe(false);
	});
});

describe('provideQueryTransfer', () => {
	it('serialises only finished public queries', () => {
		const held = new QueryClient();
		held.setQueryData(['catalog', 'x'], 1);
		held.setQueryData(['orders'], 2);
		void held.prefetchQuery({ queryKey: ['catalog', 'slow'], queryFn: () => new Promise(() => undefined) });
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [{ provide: QUERY_CLIENT, useValue: held }, provideQueryTransfer()],
		});
		TestBed.inject(QUERY_CLIENT);
		const transfer = TestBed.inject(TransferState);
		const state = JSON.parse(transfer.toJson()) as Record<string, { queries: { queryKey: unknown[] }[] }>;
		expect(state['st-query-state']?.queries.map((query) => query.queryKey)).toEqual([['catalog', 'x']]);
	});
});

describe('provideServerQueryWait', () => {
	const setup = () => {
		vi.useFakeTimers();
		const held = new QueryClient();
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [{ provide: QUERY_CLIENT, useValue: held }, provideServerQueryWait()],
		});
		TestBed.inject(QUERY_CLIENT);
		return held;
	};

	it('holds the render open until queries finish', async () => {
		const held = setup();
		let finish: (value: number) => void = () => undefined;
		const fetched = held.fetchQuery({
			queryKey: ['catalog', 'x'],
			queryFn: () => new Promise<number>((resolve) => (finish = resolve)),
		});
		await vi.advanceTimersByTimeAsync(0);
		expect(held.isFetching()).toBe(1);
		finish(1);
		await fetched;
		await vi.advanceTimersByTimeAsync(10);
		expect(held.isFetching()).toBe(0);
	});

	it('keeps waiting when another query starts during the settle time', async () => {
		const held = setup();
		let first: (value: number) => void = () => undefined;
		let second: (value: number) => void = () => undefined;
		const one = held.fetchQuery({
			queryKey: ['catalog', 'a'],
			queryFn: () => new Promise<number>((resolve) => (first = resolve)),
		});
		await vi.advanceTimersByTimeAsync(0);
		first(1);
		await one;
		const two = held.fetchQuery({
			queryKey: ['catalog', 'b'],
			queryFn: () => new Promise<number>((resolve) => (second = resolve)),
		});
		await vi.advanceTimersByTimeAsync(10);
		expect(held.isFetching()).toBe(1);
		second(1);
		await two;
		await vi.advanceTimersByTimeAsync(10);
		expect(held.isFetching()).toBe(0);
	});
});
