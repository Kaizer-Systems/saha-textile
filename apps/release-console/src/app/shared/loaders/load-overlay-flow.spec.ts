import { type ComponentRef } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';

import { QueryClient, QueryObserver, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LoadOverlay, LoadPiece, OFFER_AFTER_S } from './load-overlay';

/** The overlay's members these tests read (protected or private on the component). */
interface Overlay {
	phase: () => string;
	refreshing: () => boolean;
	elapsed: () => number;
	slow: () => boolean;
	offer: () => boolean;
	covering: () => boolean;
	keepWaiting(): void;
	markShown(after?: number): void;
}

let client: QueryClient;
const stops: Array<() => void> = [];

function overlay(inputs: Record<string, unknown> = {}) {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [provideTanStackQuery(client)] });
	TestBed.overrideComponent(LoadOverlay, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(LoadOverlay);
	for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
	fixture.detectChanges();
	return { c: fixture.componentInstance as unknown as Overlay, fixture, ref: fixture.componentRef };
}
/** Lets timers run, then the queued cache counts and the effects. */
async function pass(fixture: ComponentFixture<unknown>, ms: number): Promise<void> {
	await vi.advanceTimersByTimeAsync(ms);
	await Promise.resolve();
	fixture.detectChanges();
	await vi.advanceTimersByTimeAsync(0);
	fixture.detectChanges();
}
/** A read with an observer on screen, as a screen's injectQuery has it. */
function read(key: string, options: Record<string, unknown> = {}): void {
	const observer = new QueryObserver(client, {
		queryKey: [key],
		queryFn: () => new Promise(() => undefined),
		...options,
	});
	stops.push(observer.subscribe(() => undefined));
}
const set = (ref: ComponentRef<unknown>, name: string, value: unknown) => ref.setInput(name, value);

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
	for (const stop of stops.splice(0)) stop();
	client.clear();
	vi.useRealTimers();
});

describe('the Decoder drawing', () => {
	it('resolves each word letter by letter from noise, and starts a word it has no letters for', async () => {
		TestBed.resetTestingModule();
		const fixture = TestBed.createComponent(LoadPiece);
		fixture.componentRef.setInput('loader', 'decoder');
		fixture.detectChanges();
		const host = fixture.nativeElement as HTMLElement;
		host.innerHTML = '<svg><text class="dec" data-word="SHOP"></text><text class="dec2"></text></svg>';
		vi.advanceTimersByTime(90);
		const [word, blank] = Array.from(host.querySelectorAll('text'));
		expect(word?.textContent?.startsWith('S')).toBe(true);
		expect(word?.textContent).toHaveLength(4);
		expect(blank?.textContent).toBe('');
		vi.advanceTimersByTime(90 * 20);
		fixture.destroy();
	});
});

describe('the loader over the content area', () => {
	it('waits a moment for a first read, covers the area, turns slow and offers to keep waiting', async () => {
		const { c, fixture } = overlay();
		expect(c.phase()).toBe('hidden');
		read('first');
		await pass(fixture, 0);
		expect(c.phase()).toBe('waiting');
		await pass(fixture, 150);
		expect(c.phase()).toBe('shown');
		expect(c.covering()).toBe(true);
		await pass(fixture, OFFER_AFTER_S * 1000 + 200);
		expect(c.slow()).toBe(true);
		expect(c.offer()).toBe(true);
		c.keepWaiting();
		expect(c.offer()).toBe(false);
		for (const stop of stops.splice(0)) stop();
		client.clear();
		// Its second is over: it fades, then hides.
		await pass(fixture, 0);
		await pass(fixture, 1000);
		expect(['out', 'hidden']).toContain(c.phase());
		await pass(fixture, 400);
		expect(c.phase()).toBe('hidden');
		fixture.destroy();
	});

	it('drops a read that ends before the moment is over, and comes back while fading out', async () => {
		const { c, fixture, ref } = overlay();
		set(ref, 'active', true);
		await pass(fixture, 0);
		expect(c.phase()).toBe('shown');
		set(ref, 'active', false);
		await pass(fixture, 1000);
		expect(c.phase()).toBe('out');
		set(ref, 'active', true);
		await pass(fixture, 0);
		expect(c.phase()).toBe('shown');
		set(ref, 'active', null);
		read('brief');
		await pass(fixture, 0);
		for (const stop of stops.splice(0)) stop();
		client.clear();
		await pass(fixture, 2000);
		set(ref, 'enabled', false);
		await pass(fixture, 0);
		read('blocked');
		await pass(fixture, 200);
		expect(c.phase()).toBe('hidden');
		fixture.destroy();
	});

	it('cancels the moment when the read is gone before it ends', async () => {
		const { c, fixture } = overlay();
		read('quick');
		await pass(fixture, 0);
		expect(c.phase()).toBe('waiting');
		for (const stop of stops.splice(0)) stop();
		client.clear();
		await pass(fixture, 0);
		expect(c.phase()).toBe('hidden');
		fixture.destroy();
	});

	it('shows at once when a page opens and holds it a second, again for the next page, and after the Boot cover lifts', async () => {
		const { c, fixture, ref } = overlay({ under: true, opened: 'first' });
		await pass(fixture, 0);
		expect(c.phase()).toBe('hidden');
		set(ref, 'under', false);
		await pass(fixture, 0);
		expect(c.phase()).toBe('shown');
		set(ref, 'opened', 'second');
		await pass(fixture, 0);
		expect(c.phase()).toBe('shown');
		// Covered again and uncovered while showing: its second goes on counting after the cover fades.
		set(ref, 'under', true);
		await pass(fixture, 0);
		set(ref, 'under', false);
		await pass(fixture, 0);
		expect(c.phase()).toBe('shown');
		// Two marks before the page draws: only the newest moves the second's start.
		c.markShown();
		c.markShown(350);
		await pass(fixture, 0);
		set(ref, 'opened', 'third');
		await pass(fixture, 100);
		await pass(fixture, 2000);
		expect(c.phase()).not.toBe('shown');
		set(ref, 'opened', '');
		await pass(fixture, 0);
		fixture.destroy();
	});

	it('lights the refresh line for a slow refresh, later for a polling screen, and not for a quick one', async () => {
		client.setQueryData(['refreshed'], 1);
		const { c, fixture } = overlay();
		read('refreshed', { staleTime: 0 });
		await pass(fixture, 0);
		expect(c.phase()).toBe('hidden');
		await pass(fixture, 300);
		expect(c.refreshing()).toBe(true);
		for (const stop of stops.splice(0)) stop();
		client.clear();
		await pass(fixture, 0);
		expect(c.refreshing()).toBe(false);
		client.setQueryData(['polled'], 1);
		read('polled', { staleTime: 0, refetchInterval: 60_000 });
		await pass(fixture, 300);
		expect(c.refreshing()).toBe(false);
		await pass(fixture, 1300);
		expect(c.refreshing()).toBe(true);
		read('placeholder', { placeholderData: 1 });
		await pass(fixture, 0);
		expect(c.phase()).toBe('hidden');
		fixture.destroy();
	});
});
