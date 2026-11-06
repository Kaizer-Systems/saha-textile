import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IdleLockService } from '@core/auth/idle-lock.service';
import { AuthStore } from '@core/state/auth.store';
import { SettingStore } from '@core/state/setting.store';

import { App } from './app';

const render = (url = '/dashboard') => {
	const setting = signal<unknown>(null);
	const status = signal('unknown');
	const auth = {
		status,
		isAuthenticated: () => status() === 'authenticated',
		isResolving: () => status() === 'unknown',
	};
	const idle = { start: vi.fn(), stop: vi.fn() };
	const router = { url, navigate: vi.fn() };
	const title = { setTitle: vi.fn() };
	const translate = { setActiveLang: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: SettingStore, useValue: { setting, loadSetting: () => of({}) } },
			{ provide: AuthStore, useValue: auth },
			{ provide: IdleLockService, useValue: idle },
			{ provide: Router, useValue: router },
			{ provide: Title, useValue: title },
			{ provide: TranslocoService, useValue: translate },
		],
	});
	TestBed.overrideComponent(App, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(App);
	TestBed.tick();
	return { fixture, app: fixture.componentInstance, setting, status, idle, router, title, translate };
};

beforeEach(() => {
	const icon = document.createElement('link');
	icon.id = 'appIcon';
	document.head.append(icon);
});

afterEach(() => {
	document.querySelector('#appIcon')?.remove();
	document.documentElement.removeAttribute('dir');
	document.body.classList.remove('rtl');
});

describe('Admin App', () => {
	it('starts in English', () => {
		expect(render().translate.setActiveLang).toHaveBeenCalledWith('en');
	});

	it('watches for idleness only with a session', () => {
		const { status, idle } = render();
		expect(idle.stop).toHaveBeenCalled();
		status.set('authenticated');
		TestBed.tick();
		expect(idle.start).toHaveBeenCalledOnce();
	});

	it('returns to login when a real session ends', () => {
		const { status, router } = render();
		status.set('authenticated');
		TestBed.tick();
		status.set('anonymous');
		TestBed.tick();
		expect(router.navigate).toHaveBeenCalledWith(['/auth/login']);
	});

	it('stays on an auth page, and ignores a visitor who was never signed in', () => {
		const onAuth = render('/auth/otp');
		onAuth.status.set('authenticated');
		TestBed.tick();
		onAuth.status.set('anonymous');
		TestBed.tick();
		expect(onAuth.router.navigate).not.toHaveBeenCalled();
		const visitor = render();
		visitor.status.set('anonymous');
		TestBed.tick();
		expect(visitor.router.navigate).not.toHaveBeenCalled();
	});

	it('applies right-to-left, the icon and the title', () => {
		const { setting, title } = render();
		setting.set({
			general: {
				admin_site_language_direction: 'rtl',
				favicon_image: { original_url: 'https://cdn.test/i.png' },
				site_title: 'Shop',
				site_tagline: 'Sarees',
			},
		});
		TestBed.tick();
		expect(document.documentElement.getAttribute('dir')).toBe('rtl');
		expect(document.body.classList.contains('rtl')).toBe(true);
		expect((document.querySelector('#appIcon') as HTMLLinkElement).href).toBe('https://cdn.test/i.png');
		expect(title.setTitle).toHaveBeenLastCalledWith('Shop | Sarees');
	});

	it('falls back without a title or a tagline', () => {
		const { setting, title } = render();
		setting.set({ general: { site_title: 'Shop' } });
		TestBed.tick();
		expect(title.setTitle).toHaveBeenCalled();
		expect(document.documentElement.hasAttribute('dir')).toBe(false);
	});
});
