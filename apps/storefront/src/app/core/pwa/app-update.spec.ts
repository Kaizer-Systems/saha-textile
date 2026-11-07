import { Location } from '@angular/common';
import { DOCUMENT, PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationError, NavigationStart, Router } from '@angular/router';

import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppUpdate, provideAppUpdate, SERVICE_WORKER_ENABLED } from './app-update';

const HOUR = 60 * 60 * 1000;
const flush = () => new Promise((done) => setTimeout(done));

function setUp(options: { controller?: boolean; enabled?: boolean; platform?: string; readyState?: string } = {}) {
	const pageListeners: Record<string, () => void> = {};
	const workerListeners: Record<string, () => void> = {};
	const registration = { update: vi.fn(() => Promise.resolve()) };
	const workers = {
		controller: options.controller === false ? null : {},
		addEventListener: vi.fn((type: string, listener: () => void) => (workerListeners[type] = listener)),
		register: vi.fn(() => Promise.resolve(registration)),
	};
	const view = {
		navigator: { serviceWorker: workers as unknown },
		performance: { now: vi.fn(() => 60_000) },
		addEventListener: vi.fn((type: string, listener: () => void) => (pageListeners[`view:${type}`] = listener)),
		setInterval: vi.fn(),
	};
	const page = {
		defaultView: view as unknown,
		readyState: options.readyState ?? 'complete',
		visibilityState: 'visible',
		location: { assign: vi.fn() },
		addEventListener: vi.fn((type: string, listener: () => void) => (pageListeners[type] = listener)),
	};
	const events = new Subject<unknown>();
	TestBed.configureTestingModule({
		providers: [
			{ provide: DOCUMENT, useValue: page },
			{ provide: PLATFORM_ID, useValue: options.platform ?? 'browser' },
			{ provide: SERVICE_WORKER_ENABLED, useValue: options.enabled ?? true },
			{ provide: Router, useValue: { events } },
			{ provide: Location, useValue: { prepareExternalUrl: (url: string) => `/fr${url}` } },
		],
	});
	return {
		events,
		page,
		pageListeners,
		registration,
		service: TestBed.inject(AppUpdate),
		view,
		workerListeners,
		workers,
	};
}

const link = (url: string, trigger: 'imperative' | 'popstate' = 'imperative') => new NavigationStart(2, url, trigger);

describe('AppUpdate', () => {
	beforeEach(() => {
		vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		TestBed.resetTestingModule();
	});

	it('starts with the app, and stays off in development', () => {
		const start = vi.spyOn(AppUpdate.prototype, 'start').mockImplementation(() => undefined);
		TestBed.configureTestingModule({ providers: [provideAppUpdate()] });
		expect(TestBed.inject(SERVICE_WORKER_ENABLED)).toBe(false);
		expect(start).toHaveBeenCalledOnce();
	});

	it('registers the worker for the whole site, always reading it fresh', async () => {
		const { service, workers } = setUp();
		service.start();
		await flush();
		expect(workers.register).toHaveBeenCalledWith('/sw.js', { scope: '/', updateViaCache: 'none' });
	});

	it('waits for the page to load before registering', async () => {
		const { pageListeners, service, view, workers } = setUp({ readyState: 'loading' });
		service.start();
		expect(workers.register).not.toHaveBeenCalled();
		expect(view.addEventListener).toHaveBeenCalledWith('load', expect.any(Function), { once: true });
		pageListeners['view:load']();
		await flush();
		expect(workers.register).toHaveBeenCalled();
	});

	it('does nothing on the server, in development, or without service workers', () => {
		const server = setUp({ platform: 'server' });
		server.service.start();
		expect(server.workers.register).not.toHaveBeenCalled();
		TestBed.resetTestingModule();

		const development = setUp({ enabled: false });
		development.service.start();
		expect(development.workers.register).not.toHaveBeenCalled();
		TestBed.resetTestingModule();

		const unsupported = setUp();
		unsupported.view.navigator.serviceWorker = undefined;
		expect(() => unsupported.service.start()).not.toThrow();
		TestBed.resetTestingModule();

		const noWindow = setUp();
		noWindow.page.defaultView = null;
		expect(() => noWindow.service.start()).not.toThrow();
	});

	it('keeps working when registration fails', async () => {
		const { service, view, workers } = setUp();
		workers.register.mockRejectedValue(new Error('blocked'));
		service.start();
		await flush();
		expect(view.setInterval).not.toHaveBeenCalled();
	});

	it('turns the next in-app link into a page load once a new build takes over', async () => {
		const { events, page, service, workerListeners } = setUp();
		service.start();
		await flush();

		events.next(link('/cart'));
		expect(page.location.assign).not.toHaveBeenCalled();

		workerListeners['controllerchange']();
		events.next(link('/cart'));
		expect(page.location.assign).toHaveBeenCalledWith('/fr/cart');
	});

	it('leaves the back button alone', async () => {
		const { events, page, service, workerListeners } = setUp();
		service.start();
		await flush();
		workerListeners['controllerchange']();
		events.next(link('/cart', 'popstate'));
		expect(page.location.assign).not.toHaveBeenCalled();
	});

	it('does not treat the first install as an update', async () => {
		const { events, page, service, workerListeners } = setUp({ controller: false });
		service.start();
		await flush();
		workerListeners['controllerchange']();
		events.next(link('/cart'));
		expect(page.location.assign).not.toHaveBeenCalled();

		workerListeners['controllerchange']();
		events.next(link('/cart'));
		expect(page.location.assign).toHaveBeenCalledWith('/fr/cart');
	});

	it('loads the page afresh when a long-open page asks for a file the new build removed', () => {
		const { events, page, service } = setUp();
		service.start();
		const failed = new TypeError('Failed to fetch dynamically imported module: /assets/x.js');
		events.next(new NavigationError(2, '/product/x', failed));
		expect(page.location.assign).toHaveBeenCalledWith('/fr/product/x');
	});

	it('never loops on a page that has only just loaded, or on other errors', () => {
		const { events, page, service, view } = setUp();
		service.start();
		events.next(new NavigationError(2, '/x', new Error('Cannot match any routes')));
		view.performance.now.mockReturnValue(1_000);
		events.next(new NavigationError(2, '/x', new TypeError('Importing a module script failed.')));
		expect(page.location.assign).not.toHaveBeenCalled();
	});

	it('checks for a new build every hour, and on return after an hour away', async () => {
		const { page, pageListeners, registration, service, view } = setUp();
		service.start();
		await flush();
		const [hourly, every] = view.setInterval.mock.calls[0] as unknown as [() => void, number];
		expect(every).toBe(HOUR);
		hourly();
		expect(registration.update).toHaveBeenCalledTimes(1);

		pageListeners['visibilitychange']();
		expect(registration.update).toHaveBeenCalledTimes(1);

		vi.mocked(Date.now).mockReturnValue(1_000_000 + HOUR);
		page.visibilityState = 'hidden';
		pageListeners['visibilitychange']();
		expect(registration.update).toHaveBeenCalledTimes(1);

		page.visibilityState = 'visible';
		pageListeners['visibilitychange']();
		expect(registration.update).toHaveBeenCalledTimes(2);
	});

	it('ignores a failed check', async () => {
		const { registration, service, view } = setUp();
		registration.update.mockRejectedValue(new Error('offline'));
		service.start();
		await flush();
		const [hourly] = view.setInterval.mock.calls[0] as unknown as [() => void];
		expect(() => hourly()).not.toThrow();
		await flush();
	});
});
