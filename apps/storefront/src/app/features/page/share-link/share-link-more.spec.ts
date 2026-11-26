import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ShareLinkService } from '@data-access/services/share-link.service';

import { OPEN_ADDRESS, ShareLink } from './share-link';

const render = (platform = 'browser', code: string | null = 'k7Q2', shares: Record<string, unknown> = {}) => {
	const service = {
		check: vi.fn(async () => ({ state: 'password' })),
		openWithPassword: vi.fn(async () => {
			throw new Error('offline');
		}),
		...shares,
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: ShareLinkService, useValue: service },
			{ provide: OPEN_ADDRESS, useValue: vi.fn() },
			{ provide: PLATFORM_ID, useValue: platform },
			{ provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map(code ? [['code', code]] : []) } } },
			{ provide: TranslocoService, useValue: { selectTranslate: () => of(''), getActiveLang: () => 'en' } },
		],
	});
	TestBed.overrideComponent(ShareLink, { set: { imports: [], template: '' } });
	return { view: TestBed.createComponent(ShareLink).componentInstance, service };
};

describe('ShareLink: the remaining cases', () => {
	it('sends the tab to an address by default', () => {
		TestBed.resetTestingModule();
		TestBed.inject(OPEN_ADDRESS)('#shared-file');
		expect(location.hash).toBe('#shared-file');
		location.hash = '';
	});

	it('checks nothing on the server, and reads a missing code as empty', () => {
		const { service } = render('server', null);
		expect(service.check).not.toHaveBeenCalled();
	});

	it('writes the file’s size once it is known', () => {
		const { view } = render('server');
		expect(view.fileSize()).toBe('');
		view.file.set({ name: 'catalogue.pdf', bytes: 2048 });
		expect(view.fileSize()).toMatch(/^2\s?kB$/);
	});

	it('treats a password or a second download that cannot be sent as a failed answer', async () => {
		const { view, service } = render('server', 'k7Q2', {
			check: vi.fn(async () => {
				throw new Error('offline');
			}),
		});
		view.password = 'secret';
		await view.submit();
		expect(view.busy()).toBe(false);
		await view.downloadAgain();
		expect(service.check).toHaveBeenCalledOnce();
		expect(view.busy()).toBe(false);
	});

	it('ignores a second download while one is being asked for', async () => {
		const { view, service } = render('server');
		view.busy.set(true);
		await view.downloadAgain();
		expect(service.check).not.toHaveBeenCalled();
	});
});
