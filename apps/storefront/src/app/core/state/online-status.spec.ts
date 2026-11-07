import { DOCUMENT, PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { describe, expect, it, vi } from 'vitest';

import { OnlineStatus } from './online-status';

const setup = (platform = 'browser', onLine = true, view: unknown = undefined) => {
	const listeners = new Map<string, () => void>();
	const win = view === undefined
		? {
				navigator: { onLine },
				addEventListener: vi.fn((name: string, run: () => void) => void listeners.set(name, run)),
				removeEventListener: vi.fn((name: string) => void listeners.delete(name)),
			}
		: view;
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: PLATFORM_ID, useValue: platform },
			{ provide: DOCUMENT, useValue: { defaultView: win } },
		],
	});
	return { status: TestBed.inject(OnlineStatus), listeners, win: win as { navigator: { onLine: boolean } } };
};

describe('OnlineStatus', () => {
	it('answers yes on the server', () => {
		expect(setup('server', false).status.online()).toBe(true);
		expect(setup('browser', false, null).status.online()).toBe(true);
	});

	it('follows the browser, and stops listening when destroyed', () => {
		const { status, listeners, win } = setup('browser', false);
		expect(status.online()).toBe(false);
		win.navigator.onLine = true;
		listeners.get('online')?.();
		expect(status.online()).toBe(true);
		win.navigator.onLine = false;
		listeners.get('offline')?.();
		expect(status.online()).toBe(false);
		TestBed.resetTestingModule();
		expect(listeners.size).toBe(0);
	});
});
