import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { BehaviorSubject, of, Subject, throwError, type Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GeoGateway } from '@core/geo/geo.gateway';

import { EMPTY_ADDRESS, flagOf, ShopAddressForm, type PostalAddressDraft } from './shop-address-form';

import type { PinLookup } from '@saha-textile/contracts';

const countryData = signal<unknown>(undefined);
const asked = vi.hoisted(() => ({ code: null as null | (() => string | null) }));

vi.mock('@core/geo/geo.gateway', () => ({
	GeoGateway: class {},
	injectGeoCountryQuery: (code: () => string | null) => {
		asked.code = code;
		return { data: countryData };
	},
}));

const row = (code: string, name: string, callingCode: string) => ({ code, name, callingCode });
const COUNTRIES = [
	row('GB', 'United Kingdom', '44'),
	row('IN', 'India', '91'),
	row('US', 'United States', '1'),
	row('CA', 'Canada', '1'),
	row('FR', 'France', '33'),
];

const pins = new Subject<PinLookup | null>();
const lookup = (found: Partial<PinLookup>): PinLookup => ({
	pin: '700001',
	found: true,
	city: 'Kolkata',
	subdivisionCode: 'WB',
	state: 'West Bengal',
	gstStateCode: '19',
	deliverable: true,
	...found,
});

let lang = 'en';
const transloco = {
	getActiveLang: () => lang,
	translate: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
};

const render = (
	geo: { countries: () => Observable<unknown>; pin: (pin: string) => Observable<PinLookup | null> } = {
		countries: () => new BehaviorSubject(COUNTRIES),
		pin: () => pins,
	},
) => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: GeoGateway, useValue: geo },
			{ provide: TranslocoService, useValue: transloco },
		],
	});
	TestBed.overrideComponent(ShopAddressForm, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(ShopAddressForm);
	const emitted: unknown[] = [];
	fixture.componentInstance.changed.subscribe((value) => emitted.push(value));
	fixture.detectChanges();
	return { fixture, form: fixture.componentInstance, emitted };
};

const fill = (form: ShopAddressForm, draft: Partial<PostalAddressDraft>) =>
	form.draft.set({ ...EMPTY_ADDRESS, ...draft });

const COMPLETE: Partial<PostalAddressDraft> = {
	fullName: ' Asha Roy ',
	line1: ' 12 Park Street ',
	city: ' Kolkata ',
	mobile: '098300 12345',
	postalCode: ' 700016 ',
};

afterEach(() => {
	countryData.set(undefined);
	lang = 'en';
	vi.restoreAllMocks();
});

describe('flagOf', () => {
	it('draws a flag from two capital letters and nothing from anything else', () => {
		expect(flagOf('IN')).toBe('🇮🇳');
		expect(flagOf('in')).toBe('');
		expect(flagOf('IND')).toBe('');
	});
});

describe('ShopAddressForm', () => {
	it('starts empty in India, asks for India’s States and labels them by default', () => {
		const { form } = render();
		expect(form.draft()).toEqual(EMPTY_ADDRESS);
		expect(asked.code?.()).toBe('IN');
		expect(form.states()).toEqual([]);
		expect(form.subdivisionLabel()).toBe('state');
		expect(form.postalLabel()).toBe('postal');

		form.set('countryCode', '');
		expect(asked.code?.()).toBeNull();
	});

	it('uses the country’s own labels and States once they arrive', () => {
		const { form } = render();
		countryData.set({
			subdivisionLabel: 'county',
			postalCodeLabel: 'postcode',
			subdivisions: [{ code: 'KEN', name: 'Kent' }],
		});
		expect(form.subdivisionLabel()).toBe('county');
		expect(form.postalLabel()).toBe('postcode');
		expect(form.states()).toEqual([{ code: 'KEN', name: 'Kent' }]);
	});

	it('lists India first, then the rest by their names in the page language', () => {
		const { form } = render();
		const rows = form.countryRows();
		expect(rows[0]).toMatchObject({ code: 'IN', callingCode: '91', flag: '🇮🇳' });
		expect(rows.map((r) => r.code).slice(1)).toEqual(['CA', 'FR', 'GB', 'US']);

		lang = 'bn';
		expect(render().form.countryRows()[0].code).toBe('IN');
	});

	it('falls back to the English names when the browser cannot name regions', () => {
		vi.spyOn(Intl, 'DisplayNames').mockImplementation(function () {
			throw new Error('no region names');
		});
		const { form } = render();
		expect(form.countryRows().map((r) => r.name)).toEqual([
			'India',
			'Canada',
			'France',
			'United Kingdom',
			'United States',
		]);
	});

	it('shows the chosen country’s flag on a code picker, else the first country with that code, else the chosen one', () => {
		const { form } = render();
		form.set('phoneCountry', 'US');
		form.set('callingCode', '+1');
		expect(form.mobilePick()).toBe('US');

		form.set('phoneCountry', 'IN');
		expect(form.mobilePick()).toBe('US');

		form.set('callingCode', '999');
		expect(form.mobilePick()).toBe('IN');

		form.set('altPhoneCountry', 'GB');
		form.set('altCallingCode', '44');
		expect(form.altPick()).toBe('GB');
	});

	it('explains the State list: India’s PIN help, “the” countries, other countries and unknown codes', () => {
		const { form } = render();
		countryData.set({ subdivisions: [{ code: 'WB', name: 'West Bengal' }] });
		expect(form.statesHelp()).toBe('addr_states_help_in {"count":1}');

		form.set('countryCode', 'GB');
		countryData.set({ subdivisionLabel: 'county', subdivisions: [] });
		expect(form.statesHelp()).toContain('addr_states_help_the');
		expect(form.statesHelp()).toContain('addr_sub_plural_county');

		form.set('countryCode', 'FR');
		expect(form.statesHelp()).toMatch(/^addr_states_help \{"country":"France"/);

		form.set('countryCode', 'ZZ');
		expect(form.statesHelp()).toContain('"country":"ZZ"');
	});

	it('emits nothing sendable until name, line 1, city, country and a mobile are there', () => {
		const { form, fixture, emitted } = render();
		expect(form.value()).toBeNull();

		fill(form, { ...COMPLETE, fullName: ' ' });
		expect(form.value()).toBeNull();
		fill(form, { ...COMPLETE, line1: '' });
		expect(form.value()).toBeNull();
		fill(form, { ...COMPLETE, city: '' });
		expect(form.value()).toBeNull();
		fill(form, { ...COMPLETE, countryCode: '' });
		expect(form.value()).toBeNull();
		fill(form, { ...COMPLETE, mobile: '0123' });
		expect(form.value()).toBeNull();

		fill(form, COMPLETE);
		fixture.detectChanges();
		expect(emitted.at(-1)).toEqual({
			fullName: 'Asha Roy',
			line1: '12 Park Street',
			city: 'Kolkata',
			postalCode: '700016',
			countryCode: 'IN',
			mobile: { countryCallingCode: '91', number: '9830012345' },
		});
	});

	it('needs a State where the country has them, and sends it with the optional lines and the second number', () => {
		const { form } = render();
		countryData.set({ subdivisions: [{ code: 'WB', name: 'West Bengal' }] });
		fill(form, COMPLETE);
		expect(form.value()).toBeNull();

		fill(form, {
			...COMPLETE,
			subdivisionCode: 'WB',
			line2: ' Park Circus ',
			landmark: ' Near the market ',
			callingCode: '',
			altCallingCode: '+44',
			altMobile: '07700 900123',
		});
		expect(form.value()).toMatchObject({
			line2: 'Park Circus',
			landmark: 'Near the market',
			state: 'West Bengal',
			subdivisionCode: 'WB',
			mobile: { countryCallingCode: '91' },
			altMobile: { countryCallingCode: '44', number: '7700900123' },
		});

		fill(form, { ...COMPLETE, subdivisionCode: 'WB', altCallingCode: '', altMobile: '98300' });
		expect(form.value()).toMatchObject({ altMobile: { countryCallingCode: '91', number: '98300' } });
	});

	it('sends a code the country list does not hold without a State', () => {
		const { form } = render();
		countryData.set({ subdivisions: [{ code: 'WB', name: 'West Bengal' }] });
		fill(form, { ...COMPLETE, subdivisionCode: 'XX' });
		expect(form.value()).not.toHaveProperty('state');
	});

	it('starts from an initial address, giving the phones its country', () => {
		const { form, fixture } = render();
		fixture.componentRef.setInput('initial', { countryCode: 'GB', callingCode: '44', fullName: 'Jo' });
		fixture.detectChanges();
		expect(form.draft()).toMatchObject({
			countryCode: 'GB',
			phoneCountry: 'GB',
			altPhoneCountry: 'GB',
			callingCode: '44',
			altCallingCode: '44',
			fullName: 'Jo',
		});

		fixture.componentRef.setInput('initial', { fullName: 'Ravi' });
		fixture.detectChanges();
		expect(form.draft()).toMatchObject({
			countryCode: 'IN',
			phoneCountry: 'IN',
			altCallingCode: '91',
			fullName: 'Ravi',
		});
	});

	it('changes country: its code for both phones, no State, no PIN note; an unknown country keeps the codes', () => {
		const { form } = render();
		form.set('subdivisionCode', 'WB');
		form.pinNote.set('found');
		form.setCountry('GB');
		expect(form.draft()).toMatchObject({
			countryCode: 'GB',
			callingCode: '44',
			phoneCountry: 'GB',
			altCallingCode: '44',
			altPhoneCountry: 'GB',
			subdivisionCode: '',
		});
		expect(form.pinNote()).toBeNull();
		expect(form.pinFound()).toBeNull();

		form.setCountry('ZZ');
		expect(form.draft()).toMatchObject({ countryCode: 'ZZ', callingCode: '44', phoneCountry: 'GB' });
	});

	it('changes one phone’s code from its picker and ignores an unknown country', () => {
		const { form } = render();
		form.setPhoneCountry('mobile', 'US');
		expect(form.draft()).toMatchObject({ phoneCountry: 'US', callingCode: '1', altPhoneCountry: 'IN' });
		form.setPhoneCountry('alt', 'FR');
		expect(form.draft()).toMatchObject({ altPhoneCountry: 'FR', altCallingCode: '33' });
		const before = form.draft();
		form.setPhoneCountry('alt', 'ZZ');
		expect(form.draft()).toBe(before);
	});

	describe('PIN code', () => {
		it('looks nothing up outside India or for anything but six digits', async () => {
			const pin = vi.fn(() => pins);
			const { form } = render({ countries: () => of(COUNTRIES), pin });
			await form.setPostalCode('70001');
			form.setCountry('GB');
			await form.setPostalCode('700001');
			expect(pin).not.toHaveBeenCalled();
			expect(form.draft().postalCode).toBe('700001');
		});

		it('fills the city and State from a found PIN, keeping a city already typed', async () => {
			const { form } = render();
			const typing = form.setPostalCode(' 700001 ');
			pins.next(lookup({}));
			await typing;
			expect(form.draft()).toMatchObject({ city: 'Kolkata', subdivisionCode: 'WB' });
			expect(form.pinNote()).toBe('found');
			expect(form.pinFound()?.state).toBe('West Bengal');

			form.set('city', 'Salt Lake');
			const again = form.setPostalCode('700091');
			pins.next(lookup({ pin: '700091', city: 'Bidhannagar' }));
			await again;
			expect(form.draft().city).toBe('Salt Lake');
		});

		it('keeps the city and State when the directory has neither', async () => {
			const { form } = render();
			form.set('subdivisionCode', 'WB');
			const typing = form.setPostalCode('700001');
			pins.next(lookup({ city: null, subdivisionCode: null }));
			await typing;
			expect(form.draft()).toMatchObject({ city: '', subdivisionCode: 'WB' });
		});

		it('says a PIN is unknown when the directory does not have it', async () => {
			const { form } = render();
			const typing = form.setPostalCode('999999');
			pins.next(lookup({ found: false }));
			await typing;
			expect(form.pinNote()).toBe('unknown');
			expect(form.pinFound()).toBeNull();
		});

		it('drops an empty answer and an answer for a PIN that was changed since', async () => {
			const { form } = render();
			const empty = form.setPostalCode('700001');
			pins.next(null);
			await empty;
			expect(form.pinNote()).toBeNull();

			const stale = form.setPostalCode('700001');
			form.set('postalCode', '700002');
			pins.next(lookup({}));
			await stale;
			expect(form.pinNote()).toBeNull();
			expect(form.draft().city).toBe('');
		});

		it('stays quiet when the lookup fails', async () => {
			const { form } = render({
				countries: () => of(COUNTRIES),
				pin: () => throwError(() => new Error('offline')),
			});
			await expect(form.setPostalCode('700001')).resolves.toBeUndefined();
			expect(form.pinNote()).toBeNull();
		});
	});
});
