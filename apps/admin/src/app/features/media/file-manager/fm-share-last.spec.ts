import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MediaLibraryGateway } from '@core/media-library/media-library.gateway';

import { FmShare } from './fm-share';
import { FmStorageDetails } from './fm-storage-details';

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

const setup = (
	answer: object,
	stopAnswer: 'yes' | 'no' = 'yes',
	template = '<ng-template #fmStopAsk></ng-template>',
) => {
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
	TestBed.overrideComponent(FmShare, { set: { imports: [], template } });
	TestBed.overrideComponent(FmStorageDetails, { set: { imports: [], template: '' } });
	return { gateway, modals };
};

const refused = { error: { issues: [{ code: 'x', message: 'Refused here' }] } };

describe('Share: the last cases', () => {
	it('loads nothing before a file is given, and says why the links could not load', async () => {
		const { gateway } = setup({ visibility: 'private', links: [] });
		const share = TestBed.createComponent(FmShare).componentInstance;
		expect([share.kind(), share.activeLinks()]).toEqual([null, 0]);
		await share.load();
		expect(gateway.links).not.toHaveBeenCalled();
		gateway.links.mockReturnValueOnce(throwError(() => new Error('down')) as never);
		await share.start(pdf);
		expect(share.error()).toBe('fm_action_failed');
		expect(share.kind()?.icon).toBe('ri-file-pdf-2-line');
		await share.start(photo);
		expect(share.activeLinks()).toBe(0);
	});

	it('changes visibility, makes a link with no code back, and saves a new end on a date', async () => {
		const { gateway } = setup({ visibility: 'private', links: [link('active'), link('stopped')] });
		const share = TestBed.createComponent(FmShare).componentInstance;
		await share.setVisibility('public');
		expect(gateway.setVisibility).toHaveBeenCalledWith('', 'public');
		gateway.createLink.mockReturnValueOnce(of(link('active')) as never);
		await share.create();
		expect(gateway.createLink).toHaveBeenCalledWith('', expect.anything());
		expect(share.made()).toBeNull();
		await share.start(pdf);
		expect(share.activeLinks()).toBe(1);
		await share.saveEnd();
		share.changing.set({ id: 'lnk_active', expiry: 'date', date: '' });
		await share.saveEnd();
		expect(gateway.updateLink).not.toHaveBeenCalled();
		share.changing.set({ id: 'lnk_active', expiry: 'date', date: '2026-12-31' });
		await share.saveEnd();
		expect(gateway.updateLink).toHaveBeenCalledWith('lnk_active', {
			expiry: 'date',
			expiresAt: expect.any(String),
		});
		expect(share.changing()).toBeNull();
	});

	it('stops a link straight away when there is no question to ask, and copies or says copying failed', async () => {
		const { gateway } = setup({ visibility: 'private', links: [] }, 'yes', '');
		const share = TestBed.createComponent(FmShare).componentInstance;
		await share.start(pdf);
		await share.stop('lnk_1');
		expect(gateway.updateLink).toHaveBeenCalledWith('lnk_1', { stop: true });
		const writeText = vi.fn(async () => undefined);
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		await share.copy('https://x.test/s/abc');
		expect(share.copied()).toBe('https://x.test/s/abc');
		writeText.mockRejectedValueOnce(new Error('denied'));
		await share.copy('again');
		expect(share.error()).toBe('fm_share_copy_failed');
		gateway.updateLink.mockReturnValueOnce(throwError(() => refused) as never);
		await share.stop('lnk_2');
		expect(share.error()).toBe('Refused here');
	});
});

describe('Storage details: the last cases', () => {
	it('reads the on-demand switch as off before anything loads, colours the bar, and says why a save failed', async () => {
		const { gateway } = setup({ visibility: 'private', links: [] });
		const details = TestBed.createComponent(FmStorageDetails).componentInstance;
		expect(details.othersAllowed()).toBe(false);
		details.start({ colour: 'red', canChangeOnDemand: true, othersMayUseOnDemand: false } as never);
		expect(details.barClass()).toBe('bg-danger');
		details.summary.set({ colour: 'yellow', canChangeOnDemand: true, othersMayUseOnDemand: false } as never);
		expect(details.barClass()).toBe('bg-warning');
		details.summary.set({ colour: 'green', canChangeOnDemand: true, othersMayUseOnDemand: false } as never);
		expect(details.barClass()).toBe('bg-success');
		gateway.saveStorageSettings.mockReturnValueOnce(throwError(() => new Error('down')) as never);
		await details.toggleOthers();
		expect(details.error()).toBe('fm_action_failed');
		gateway.saveStorageSettings.mockReturnValueOnce(throwError(() => refused) as never);
		await details.toggleOthers();
		expect(details.error()).toBe('Refused here');
	});
});
