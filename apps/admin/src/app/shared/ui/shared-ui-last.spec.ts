import { TestBed } from '@angular/core/testing';
import { FormControl } from '@angular/forms';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GeoGateway } from '@core/geo/geo.gateway';
import { YouTubeGateway } from '@core/media/content-blocks.gateway';
import { MediaGateway } from '@core/media/media.gateway';
import { MediaLibraryGateway } from '@core/media-library/media-library.gateway';
import { MediaUploads } from '@core/media-library/media-uploads';
import { NotificationService } from '@data-access/services/notification.service';
import { addressCardLine, draftFromRow } from '@features/customer/form-customer/customer-address-popup';

import { MissingLanguageNotice } from './missing-language-notice/missing-language-notice';
import { MediaDetailsModal } from './modal/media-details-modal/media-details-modal';
import { PostalAddressForm } from './postal-address-form/postal-address-form';
import { SwatchCut } from './swatch-cut/swatch-cut';
import { YouTubeVideosField } from './youtube-videos-field/youtube-videos-field';

import type { CustomerAddressRow } from '@features/customer/form-customer/customer-address-popup';
import type { ProductVideo } from '@saha-textile/contracts';

/** The country query keeps the code reader, so a test can read it after the draft changes. */
const h = vi.hoisted(() => ({ code: null as null | (() => string | null) }));
vi.mock('@core/geo/geo.gateway', async (original) => ({
	...(await original<typeof import('@core/geo/geo.gateway')>()),
	injectGeoCountryQuery: (code: () => string | null) => {
		h.code = code;
		return { data: () => undefined };
	},
}));

const translate = { translate: (key: string) => key, getActiveLang: () => 'en' };

afterEach(() => {
	h.code = null;
});

describe('shared UI: the last cases', () => {
	it('the missing-language notice starts with no language', () => {
		TestBed.resetTestingModule();
		TestBed.overrideComponent(MissingLanguageNotice, { set: { imports: [], template: '' } });
		const notice = TestBed.createComponent(MissingLanguageNotice).componentInstance;
		expect(notice.code()).toBeNull();
	});

	it('the media details popup closed without saving stays quiet', async () => {
		const open = vi.fn(() => {
			const result = Promise.reject(new Error('dismissed'));
			return { result };
		});
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: NgbModal, useValue: { open } },
				{
					provide: MediaGateway,
					useValue: {
						details: () => of({ slug: 'red-saree', text: { alt: {}, title: {}, caption: {} } }),
					},
				},
				{ provide: NotificationService, useValue: { showSuccess: vi.fn(), showError: vi.fn() } },
				{ provide: MediaUploads, useValue: { followRename: vi.fn() } },
				{ provide: TranslocoService, useValue: translate },
			],
		});
		TestBed.overrideComponent(MediaDetailsModal, { set: { imports: [], template: '' } });
		const modal = TestBed.createComponent(MediaDetailsModal).componentInstance;
		await modal.openModal('med_1');
		await Promise.resolve();
		await Promise.resolve();
		expect(open).toHaveBeenCalledTimes(1);
	});

	it('the address form asks for no country while the country is blank', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: GeoGateway, useValue: { countries: () => of([]), pin: () => of(null) } },
				{ provide: TranslocoService, useValue: translate },
			],
		});
		TestBed.overrideComponent(PostalAddressForm, { set: { imports: [], template: '' } });
		const form = TestBed.createComponent(PostalAddressForm).componentInstance;
		form.draft.set({ ...form.draft(), countryCode: '' });
		expect(h.code?.()).toBeNull();
	});

	it('the swatch cut: no square before a photo, and a pointer over an empty box does nothing', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: NgbActiveModal, useValue: { close: vi.fn(), dismiss: vi.fn() } },
				{ provide: MediaLibraryGateway, useValue: { cutSource: vi.fn(), cut: vi.fn() } },
				{ provide: TranslocoService, useValue: translate },
			],
		});
		TestBed.overrideComponent(SwatchCut, { set: { imports: [], template: '', styleUrls: [] } });
		const cut = TestBed.createComponent(SwatchCut).componentInstance;
		expect(cut.px()).toBe(0);
		const before = cut.centre();
		const flat = {
			pointerId: 1,
			clientX: 5,
			clientY: 5,
			currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }) },
		} as unknown as PointerEvent;
		cut.press(flat);
		expect(cut.centre()).toBe(before);
		const noHeight = {
			...flat,
			currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 0 }) },
		} as unknown as PointerEvent;
		cut.follow(noHeight);
		expect(cut.centre()).toBe(before);
		cut.release();
	});

	it('the video field ignores a paste with no text in it', () => {
		const gateway = { validate: vi.fn() };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: YouTubeGateway, useValue: gateway },
				{ provide: TranslocoService, useValue: translate },
			],
		});
		TestBed.overrideComponent(YouTubeVideosField, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(YouTubeVideosField);
		fixture.componentRef.setInput('control', new FormControl<ProductVideo[]>([], { nonNullable: true }));
		const preventDefault = vi.fn();
		fixture.componentInstance.pasted({ clipboardData: null, preventDefault } as unknown as ClipboardEvent);
		expect(preventDefault).not.toHaveBeenCalled();
		expect(gateway.validate).not.toHaveBeenCalled();
	});

	it('an address row from abroad with a second phone, and its card in Bengali', () => {
		const row = {
			id: 'adr_1',
			label: 'Home',
			fullName: 'Asha Roy',
			country: 'US',
			countryCode: 'US',
			phone: '',
			line1: '1 Main St',
			line2: null,
			postalCode: '10001',
			city: 'New York',
			altMobile: { countryCallingCode: '1', number: '2125550100' },
			isDefault: false,
		} as unknown as CustomerAddressRow;
		const draft = draftFromRow(row);
		expect(draft).not.toHaveProperty('callingCode');
		expect(draft.altCallingCode).toBe('1');
		expect(draft.altMobile).toBe('2125550100');
		expect(addressCardLine(row, 'bn')).toContain(
			new Intl.DisplayNames(['bn'], { type: 'region' }).of('US') as string,
		);
	});
});
