import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConsentStore } from '@core/consent/consent.store';
import { CONSENT_TAP_ATTRIBUTE } from '@core/consent/cookie-catalogue';
import { AccountStore } from '@core/state/account.store';
import { AuthStore } from '@core/state/auth.store';
import { blogImage } from '@data-access/interfaces/blog.interface';

import { Cookie } from './ui/cookie/cookie';
import { CookieSettings } from './ui/cookie/cookie-settings/cookie-settings';
import { AddressModal } from './ui/modal/address-modal/address-modal';
import { AddonGroup } from './ui/product-config/parts/addon-group/addon-group';
import { AddonSheet } from './ui/product-config/parts/addon-sheet/addon-sheet';
import { MeasurementRow } from './ui/product-config/parts/measurement-row/measurement-row';
import { VariationAxis } from './ui/product-config/parts/variation-axis/variation-axis';
import { VideoPoster } from './ui/video/video-poster';
import { fileSizeLabel } from './util/file-size';

vi.mock('@data-access/queries/country.queries', () => ({ injectCountriesQuery: () => ({ data: signal([]) }) }));
vi.mock('@data-access/queries/state.queries', () => ({ injectStatesQuery: () => ({ data: signal([]) }) }));

const bare = <T>(type: new (...args: never[]) => T, providers: unknown[] = []) => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: providers as never[] });
	TestBed.overrideComponent(type as never, { set: { imports: [], template: '' } });
	return TestBed.createComponent(type as never) as unknown as import('@angular/core/testing').ComponentFixture<T>;
};

afterEach(() => document.documentElement.removeAttribute(CONSENT_TAP_ATTRIBUTE));

describe('the cookie box: early taps', () => {
	const setup = () => {
		const consent = {
			settingsRequests: signal(0),
			decided: signal(false),
			openSettings: vi.fn(),
			allows: vi.fn(() => false),
			save: vi.fn(),
			syncAccount: vi.fn(async () => {}),
		};
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: ConsentStore, useValue: consent },
				{ provide: AuthStore, useValue: { isAuthenticated: signal(false) } },
				{ provide: NgbModal, useValue: { open: vi.fn() } },
			],
		});
		TestBed.overrideComponent(Cookie, { set: { imports: [CookieSettings], template: '<app-cookie-settings />' } });
		TestBed.overrideComponent(CookieSettings, {
			set: { imports: [], template: '<ng-template #cookieSettings></ng-template>' },
		});
		const fixture = TestBed.createComponent(Cookie);
		fixture.detectChanges();
		return { box: fixture.componentInstance, consent };
	};

	it('carries out an early Necessary only, and ignores a tap on anything else', () => {
		const { box, consent } = setup();
		document.documentElement.setAttribute(CONSENT_TAP_ATTRIBUTE, 'cookie_necessary_btn');
		box.carryOutEarlyTap(document);
		expect(consent.save).toHaveBeenCalledOnce();

		const other = setup();
		document.documentElement.setAttribute(CONSENT_TAP_ATTRIBUTE, 'somewhere_else');
		other.box.carryOutEarlyTap(document);
		expect(other.consent.save).not.toHaveBeenCalled();
		expect(other.consent.openSettings).not.toHaveBeenCalled();
	});
});

describe('the video poster', () => {
	it('waits for a tap unless told to start, and shows the large poster', () => {
		const fixture = bare(VideoPoster, [{ provide: PLATFORM_ID, useValue: 'browser' }]);
		fixture.componentRef.setInput('video', { videoId: 'abc', title: 'Saree', kind: 'video', thumbnailUrl: null });
		fixture.detectChanges();
		TestBed.tick();
		expect(fixture.componentInstance.state()).toBe('poster');
		expect(fixture.componentInstance.poster()).toContain('abc');
	});
});

describe('the address pop-up', () => {
	it('leaves a PIN code in English digits as it is, and turns Bengali digits into English ones', () => {
		const fixture = bare(AddressModal, [
			{ provide: NgbModal, useValue: { open: vi.fn(), dismissAll: vi.fn() } },
			{ provide: AccountStore, useValue: {} },
			{ provide: PLATFORM_ID, useValue: 'browser' },
		]);
		const pin = fixture.componentInstance.form.controls['pincode'];
		const set = vi.spyOn(pin, 'setValue');
		pin.setValue('700001');
		expect(set).toHaveBeenCalledOnce();
		expect(pin.value).toBe('700001');
		pin.setValue('৭০০০০১');
		expect(pin.value).toBe('700001');
	});
});

describe('product option parts', () => {
	it('the option axis chooses nothing before its buttons are drawn, then through them', () => {
		const fixture = bare(VariationAxis);
		expect(() => fixture.componentInstance.choose({ id: 1 } as never)).not.toThrow();
		const picker = { setVariant: vi.fn() };
		Object.defineProperty(fixture.componentInstance, 'picker', { value: () => picker });
		fixture.componentRef.setInput('product', { variations: [{ id: 'v1' }] });
		fixture.componentInstance.choose({ id: 1 } as never);
		expect(picker.setVariant).toHaveBeenCalledWith([{ id: 'v1' }], { id: 1 });
	});

	it('the add-on part has no measurement fields when the product names none', () => {
		const fixture = bare(AddonGroup, [
			{ provide: NgbModal, useValue: { open: vi.fn() } },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
		]);
		fixture.componentRef.setInput('product', { addon_groups: [] });
		expect(fixture.componentInstance.fields()).toEqual([]);
	});

	it('the add-on sheet adds nothing over a price it has not been given', () => {
		const fixture = bare(AddonSheet, [{ provide: NgbActiveModal, useValue: { close: vi.fn() } }]);
		expect(fixture.componentInstance.delta()).toBe(fixture.componentInstance.total());
	});

	it('the measurement row starts with no fields and nothing added', () => {
		const fixture = bare(MeasurementRow);
		fixture.componentRef.setInput('title', 'Blouse');
		expect([fixture.componentInstance.fieldCount(), fixture.componentInstance.added()]).toEqual([0, false]);
	});
});

describe('small helpers', () => {
	it('writes a size under a kilobyte in whole bytes', () => {
		expect(fileSizeLabel(512, 'en-IN')).toMatch(/^512\s?byte/);
	});

	it('takes the narrowest blog picture when every width is over the limit', () => {
		const image = {
			alt: 'Saree',
			width: 2400,
			height: 1600,
			roles: {
				blog: [
					{ url: 'a-2000.webp', width: 2000 },
					{ url: 'a-2400.webp', width: 2400 },
				],
			},
		};
		expect(blogImage(image as never, 1600)?.original_url).toBe('a-2000.webp');
	});
});
