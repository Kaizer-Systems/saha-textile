import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { runtimeConfig } from '@core/config/runtime-config';
import { MediaLibraryGateway } from '@core/media-library/media-library.gateway';

import { FmShare, shareAddress } from './fm-share';
import { FmStorageDetails, STORAGE_ROWS } from './fm-storage-details';

const pdf = { id: 'med_pdf', name: 'size-chart.pdf', kind: 'file', bytes: 10, location: '' } as never;
const photo = { id: 'med_img', name: 'red.jpg', kind: 'image', bytes: 10, location: 'Banarasi' } as never;
const link = (state: string, extra: object = {}) => ({
	id: `lnk_${state}`,
	assetId: 'med_pdf',
	codeEnd: 'T3vX',
	who: 'anyone',
	expiresAt: null,
	stoppedAt: null,
	stoppedBecause: null,
	opens: 0,
	lastOpenedAt: null,
	createdBy: 'adm_1',
	createdAt: '2026-11-15T10:00:00.000Z',
	hasPassword: false,
	state,
	...extra,
});

const setup = (answer: object, stopAnswer: 'yes' | 'no' = 'yes') => {
	const modals = {
		open: vi.fn(() => ({ result: stopAnswer === 'yes' ? Promise.resolve('yes') : Promise.reject('cancel') })),
	};
	const gateway = {
		links: vi.fn(() => of(answer)),
		createLink: vi.fn(() => of(link('active', { code: 'AbCdEfGhIjKlMnOpQrT3vX' }))),
		updateLink: vi.fn(() => of(link('stopped'))),
		setVisibility: vi.fn(() => of({ done: 1, inUse: [], undoId: null })),
		saveStorageSettings: vi.fn(() => of({ othersMayUseOnDemand: true })),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: MediaLibraryGateway, useValue: gateway },
			{ provide: NgbActiveModal, useValue: { close: vi.fn(), dismiss: vi.fn() } },
			{ provide: NgbModal, useValue: modals },
			{ provide: QueryClient, useValue: { invalidateQueries: vi.fn() } },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
		],
	});
	TestBed.overrideComponent(FmShare, { set: { imports: [], template: '<ng-template #fmStopAsk></ng-template>' } });
	TestBed.overrideComponent(FmStorageDetails, { set: { imports: [], template: '' } });
	return { gateway, modals };
};

describe('Share (A35–A35D)', () => {
	it('makes a link and shows its full address once, on the shop under /s/', async () => {
		const { gateway } = setup({ visibility: 'private', publicUrl: null, publicPicture: null, links: [] });
		const share = TestBed.createComponent(FmShare).componentInstance;
		await share.start(pdf);
		expect(gateway.links).toHaveBeenCalledWith('med_pdf');
		share.who.set('anyone');
		share.expiry.set('30d');
		share.askPassword.set(true);
		share.password.set('tant-2027');
		await share.create();
		expect(gateway.createLink).toHaveBeenCalledWith('med_pdf', {
			expiry: '30d',
			who: 'anyone',
			password: 'tant-2027',
		});
		expect(share.made()).toBe(`${runtimeConfig.siteUrl}/s/AbCdEfGhIjKlMnOpQrT3vX`);
		expect(share.password()).toBe('');
		expect(shareAddress('abc')).toBe(`${runtimeConfig.siteUrl.replace(/\/+$/, '')}/s/abc`);
	});

	it('admins-only links never send a password; a date runs to the end of that day', async () => {
		const { gateway } = setup({ visibility: 'private', publicUrl: null, publicPicture: null, links: [] });
		const share = TestBed.createComponent(FmShare).componentInstance;
		await share.start(pdf);
		share.who.set('admins');
		share.askPassword.set(true);
		share.password.set('ignored');
		share.expiry.set('date');
		await share.create();
		expect(gateway.createLink).not.toHaveBeenCalled();
		expect(share.error()).toBe('fm_share_pick_date');
		share.date.set('2026-12-31');
		await share.create();
		expect(gateway.createLink).toHaveBeenCalledWith('med_pdf', {
			expiry: 'date',
			who: 'admins',
			expiresAt: new Date('2026-12-31T23:59:59').toISOString(),
		});
	});

	it('asks before stopping a link, and a no keeps it', async () => {
		const { gateway, modals } = setup(
			{ visibility: 'private', publicUrl: null, publicPicture: null, links: [link('active')] },
			'no',
		);
		const share = TestBed.createComponent(FmShare).componentInstance;
		await share.start(pdf);
		await share.stop('lnk_active');
		expect(modals.open).toHaveBeenCalledTimes(1);
		expect(gateway.updateLink).not.toHaveBeenCalled();
	});

	it('gives a live link a new end, stops one, and names a refusal', async () => {
		const { gateway } = setup({
			visibility: 'private',
			publicUrl: null,
			publicPicture: null,
			links: [link('active')],
		});
		const share = TestBed.createComponent(FmShare).componentInstance;
		await share.start(pdf);
		share.changing.set({ id: 'lnk_active', expiry: 'never', date: '' });
		await share.saveEnd();
		expect(gateway.updateLink).toHaveBeenCalledWith('lnk_active', { expiry: 'never' });
		expect(share.changing()).toBeNull();
		await share.stop('lnk_active');
		expect(gateway.updateLink).toHaveBeenLastCalledWith('lnk_active', { stop: true });
		gateway.updateLink.mockReturnValueOnce(
			throwError(() => ({ error: { error: { code: 'not_found', message: 'That link has ended' } } })),
		);
		await share.stop('lnk_active');
		expect(share.error()).toBe('That link has ended');
	});

	it('a plain file goes public and private; a photo is never treated as public here (A35C, A35D)', async () => {
		const { gateway } = setup({ visibility: 'private', publicUrl: null, publicPicture: null, links: [] });
		const share = TestBed.createComponent(FmShare).componentInstance;
		await share.start(pdf);
		await share.setVisibility('public');
		expect(gateway.setVisibility).toHaveBeenCalledWith('med_pdf', 'public');
		await share.setVisibility('private');
		// Already private after the reload: nothing is sent twice.
		expect(gateway.setVisibility).toHaveBeenCalledTimes(1);
		const picture = setup({
			visibility: 'public',
			publicUrl: 'https://cdn.test/red-1600w.webp',
			publicPicture: { role: 'gallery', width: 1600 },
			links: [],
		});
		const photoShare = TestBed.createComponent(FmShare).componentInstance;
		await photoShare.start(photo);
		expect(photoShare.isPhoto()).toBe(true);
		expect(photoShare.isPublic()).toBe(false);
		expect(picture.gateway.links).toHaveBeenCalledWith('med_img');
	});
});

describe('Storage details (A47)', () => {
	const summary = (extra: object = {}) =>
		({
			usedBytes: 10,
			planBytes: 100,
			percent: 82,
			colour: 'yellow',
			onDemandBytes: 0,
			onDemandMonthlyUsd: 0,
			breakdown: [{ key: 'originals', bytes: 4 }],
			othersMayUseOnDemand: false,
			canChangeOnDemand: true,
			reservedBytes: 0,
			...extra,
		}) as never;

	it('lets a super admin switch “other admins may use on-demand storage”; others cannot', async () => {
		const { gateway } = setup({});
		const details = TestBed.createComponent(FmStorageDetails).componentInstance;
		details.start(summary());
		expect(details.barClass()).toBe('bg-warning');
		expect(details.othersAllowed()).toBe(false);
		await details.toggleOthers();
		expect(gateway.saveStorageSettings).toHaveBeenCalledWith({ othersMayUseOnDemand: true });
		expect(details.othersAllowed()).toBe(true);
		const other = TestBed.createComponent(FmStorageDetails).componentInstance;
		other.start(summary({ canChangeOnDemand: false }));
		await other.toggleOthers();
		expect(gateway.saveStorageSettings).toHaveBeenCalledTimes(1);
		expect(Object.keys(STORAGE_ROWS)).toEqual(['originals', 'versions', 'files', 'trash', 'zips']);
	});
});
