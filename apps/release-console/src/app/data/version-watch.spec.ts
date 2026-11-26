import { DOCUMENT, Injector, runInInjectionContext } from '@angular/core';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConsoleApi } from './console-api';
import { CHECK_EVERY, RETRY_EVERY, VersionWatch } from './version-watch';

/** The page as the watch sees it: whether it is in view, its listeners, and its reload. */
function pageOf() {
	const on: Record<string, (e: Event) => void> = {};
	return {
		on,
		doc: {
			hidden: false,
			addEventListener: (type: string, fn: (e: Event) => void) => (on[type] = fn),
			location: { reload: vi.fn() },
		},
	};
}
const healthy = (build: string | null, startedAt = '2026-11-24T10:16:00.000Z') => ({
	status: 'ok' as const,
	version: '0.2.0',
	build,
	startedAt,
});

function watchOf(health: ReturnType<typeof vi.fn>) {
	const page = pageOf();
	const injector = Injector.create({
		providers: [
			{ provide: ConsoleApi, useValue: { health } },
			{ provide: DOCUMENT, useValue: page.doc },
		],
	});
	return { watch: runInInjectionContext(injector, () => new VersionWatch()), page };
}
const flush = async () => {
	for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('the newer-version watch (brief 7Hu1SuB3A8qiJzeDwvFZLR, B)', () => {
	it('keeps the first fingerprint, and says when the console API serves another', async () => {
		const health = vi.fn().mockResolvedValueOnce(healthy('aaa')).mockResolvedValue(healthy('aaa'));
		const { watch, page } = watchOf(health);
		watch.start();
		await flush();
		await watch.check();
		expect(watch.newer()).toBeNull();
		health.mockResolvedValue(healthy('bbb', '2026-11-24T10:16:20.000Z'));
		page.doc.hidden = true;
		page.on['visibilitychange']?.(new Event('visibilitychange'));
		vi.advanceTimersByTime(CHECK_EVERY);
		await flush();
		expect(health).toHaveBeenCalledTimes(2);
		page.doc.hidden = false;
		page.on['visibilitychange']?.(new Event('visibilitychange'));
		await flush();
		expect(watch.newer()).toBe('2026-11-24T10:16:20.000Z');
		watch.hidden.set(true);
		vi.advanceTimersByTime(CHECK_EVERY);
		await flush();
		expect(health).toHaveBeenCalledTimes(4);
		expect(watch.hidden()).toBe(false);
		expect(watch.loadedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
	});

	it('asks nothing of a development server, and asks again soon after the console stops answering', async () => {
		const health = vi.fn().mockRejectedValue(new Error('down')).mockResolvedValueOnce(healthy(null));
		const { watch, page } = watchOf(health);
		// 1: the development server serves no fingerprint.
		await watch.check();
		expect(watch.newer()).toBeNull();
		// 2: not answering, so it asks again in 10 s; 3: still not, and a second ask already waits.
		await watch.check();
		await watch.check();
		// 4: the second ask, still not answering, so another waits.
		vi.advanceTimersByTime(RETRY_EVERY);
		await flush();
		expect(health).toHaveBeenCalledTimes(4);
		// 5: out of view, still not answering: it waits for the tab to come back.
		page.doc.hidden = true;
		vi.advanceTimersByTime(RETRY_EVERY);
		await flush();
		vi.advanceTimersByTime(RETRY_EVERY * 3);
		await flush();
		expect(health).toHaveBeenCalledTimes(5);
	});

	it('knows text typed and not sent, leaving search boxes and gone or emptied fields out', async () => {
		const health = vi.fn().mockResolvedValueOnce(healthy('aaa')).mockResolvedValue(healthy('bbb'));
		const { watch, page } = watchOf(health);
		watch.start();
		await flush();
		const box = document.body.appendChild(document.createElement('textarea'));
		const search = document.body.appendChild(Object.assign(document.createElement('input'), { type: 'search' }));
		search.value = 'dev';
		page.on['input']?.({ target: search } as unknown as Event);
		page.on['input']?.({ target: null } as unknown as Event);
		page.on['input']?.({ target: document.createElement('div') } as unknown as Event);
		expect(watch.typedNotSent()).toBe(false);
		box.value = 'Looks good';
		page.on['input']?.({ target: box } as unknown as Event);
		expect(watch.typedNotSent()).toBe(true);
		box.value = '';
		expect(watch.typedNotSent()).toBe(false);
		box.value = 'again';
		page.on['input']?.({ target: box } as unknown as Event);
		box.remove();
		expect(watch.typedNotSent()).toBe(false);
		await watch.check();
		await watch.check();
		vi.advanceTimersByTime(1_000);
		expect(watch.newer()).not.toBeNull();
		search.remove();
	});

	it('reloads the page', () => {
		const { watch, page } = watchOf(vi.fn());
		watch.reload();
		expect(page.doc.location.reload).toHaveBeenCalled();
	});
});
