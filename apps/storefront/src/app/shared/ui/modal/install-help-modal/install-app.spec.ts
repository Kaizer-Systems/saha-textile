import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InstallApp, provideInstallApp } from './install-app';
import { InstallHelpModal } from './install-help-modal';

function setUp(platform = 'browser') {
	const modals = { open: vi.fn() };
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbModal, useValue: modals },
			{ provide: PLATFORM_ID, useValue: platform },
		],
	});
	return { modals, service: TestBed.inject(InstallApp) };
}

/** Raises the browser's install offer and returns its prompt. */
function browserOffers(prompt = vi.fn(() => Promise.resolve())) {
	const offer = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt });
	window.dispatchEvent(offer);
	return { offer, prompt };
}

describe('InstallApp', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		TestBed.resetTestingModule();
	});

	it('starts with the app', () => {
		const start = vi.spyOn(InstallApp.prototype, 'start').mockImplementation(() => undefined);
		TestBed.configureTestingModule({
			providers: [{ provide: NgbModal, useValue: {} }, provideInstallApp()],
		});
		TestBed.inject(InstallApp);
		expect(start).toHaveBeenCalledOnce();
	});

	it('does not listen on the server', () => {
		const listen = vi.spyOn(window, 'addEventListener');
		setUp('server').service.start();
		expect(listen).not.toHaveBeenCalled();
	});

	it('shows the how-to popup when the browser has made no offer', async () => {
		const { modals, service } = setUp();
		service.start();
		await service.open();
		expect(modals.open).toHaveBeenCalledWith(InstallHelpModal, {
			ariaLabelledBy: 'install_help_title',
			centered: true,
			windowClass: 'theme-modal modal-lg',
		});
	});

	it("opens the browser's prompt once, then falls back to the popup", async () => {
		const { modals, service } = setUp();
		service.start();
		const { prompt } = browserOffers();

		await service.open();
		expect(prompt).toHaveBeenCalledOnce();
		expect(modals.open).not.toHaveBeenCalled();

		await service.open();
		expect(prompt).toHaveBeenCalledOnce();
		expect(modals.open).toHaveBeenCalledOnce();
	});

	it("leaves the browser's own install bar in place", () => {
		setUp().service.start();
		expect(browserOffers().offer.defaultPrevented).toBe(false);
	});

	it('shows the popup when the browser refuses the prompt', async () => {
		const { modals, service } = setUp();
		service.start();
		browserOffers(vi.fn(() => Promise.reject(new Error('needs a user gesture'))));
		await service.open();
		expect(modals.open).toHaveBeenCalledOnce();
	});

	it('drops the offer once the app is installed', async () => {
		const { modals, service } = setUp();
		service.start();
		const { prompt } = browserOffers();
		window.dispatchEvent(new Event('appinstalled'));
		await service.open();
		expect(prompt).not.toHaveBeenCalled();
		expect(modals.open).toHaveBeenCalledOnce();
	});
});
