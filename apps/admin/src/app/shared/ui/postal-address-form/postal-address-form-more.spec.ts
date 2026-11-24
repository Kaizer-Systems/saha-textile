import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CustomerAddressBookGateway } from '@core/admin-customers/customer-address-book.gateway';
import { GeoGateway } from '@core/geo/geo.gateway';
import {
	CustomerAddressPopup,
	addressCardLine,
	phoneTextOf,
	postalLabelKeyOf,
} from '@features/customer/form-customer/customer-address-popup';

import { PostalAddressForm, flagOf } from './postal-address-form';

const h = vi.hoisted(() => ({ country: undefined as unknown }));
vi.mock('@core/geo/geo.gateway', async (original) => ({
	...(await original<typeof import('@core/geo/geo.gateway')>()),
	injectGeoCountryQuery: (code: () => string | null) => {
		code();
		return { data: () => h.country };
	},
}));

const t = (key: string, params?: Record<string, unknown>) =>
	params && Object.keys(params).length ? `${key}(${Object.values(params).join('|')})` : key;

function form(lang = 'en', pin: unknown = of(null)) {
	const geo = {
		countries: vi.fn(() =>
			of([
				{ code: 'GB', name: 'United Kingdom', callingCode: '44' },
				{ code: 'IN', name: 'India', callingCode: '91' },
				{ code: 'US', name: 'United States', callingCode: '1' },
				{ code: 'CA', name: 'Canada', callingCode: '1' },
				{ code: 'BD', name: 'Bangladesh', callingCode: '880' },
			]),
		),
		pin: vi.fn(() => pin),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: GeoGateway, useValue: geo },
			{ provide: TranslocoService, useValue: { translate: t, getActiveLang: () => lang } },
		],
	});
	TestBed.overrideComponent(PostalAddressForm, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(PostalAddressForm);
	const out: unknown[] = [];
	fixture.componentInstance.changed.subscribe((value) => out.push(value));
	fixture.detectChanges();
	return { c: fixture.componentInstance, fixture, geo, out };
}

afterEach(() => {
	h.country = undefined;
});

describe('the shared postal address form (ad04, ad05, ad07)', () => {
	it('lists countries with India first, and labels with their defaults', () => {
		const { c } = form('bn');
		expect(c.countryRows()[0]?.code).toBe('IN');
		expect(c.countryRows()[1]?.name).toBeTypeOf('string');
		expect(c.states()).toEqual([]);
		expect(c.subdivisionLabel()).toBe('state');
		expect(c.postalLabel()).toBe('postal');
		expect(flagOf('in')).toBe('');
		expect(flagOf('IN')).toBe('🇮🇳');
	});

	it('picks the flag for a shared phone code', () => {
		const { c } = form();
		c.set('phoneCountry', 'CA');
		c.set('callingCode', '+1');
		expect(c.mobilePick()).toBe('CA');
		c.set('phoneCountry', 'GB');
		expect(c.mobilePick()).toBe('US');
		c.set('callingCode', '999');
		expect(c.mobilePick()).toBe('GB');
		expect(c.altPick()).toBe('IN');
	});

	it('says which State list is shown, naming “the” countries', () => {
		h.country = {
			subdivisions: [{ code: 'KEN', name: 'Kent' }],
			subdivisionLabel: 'county',
			postalCodeLabel: 'postcode',
		};
		const { c } = form();
		expect(c.statesHelp()).toBe('addr_states_help_in(1)');
		c.setCountry('GB');
		expect(c.statesHelp()).toBe('addr_states_help_the(United Kingdom|addr_sub_plural_county)');
		c.setCountry('BD');
		expect(c.statesHelp()).toBe('addr_states_help(Bangladesh|addr_sub_plural_county)');
		c.setCountry('ZZ');
		expect(c.statesHelp()).toBe('addr_states_help(ZZ|addr_sub_plural_county)');
		expect(c.draft().callingCode).toBe('880');
	});

	it('hands back the address only once complete, with its optional parts', () => {
		h.country = { subdivisions: [{ code: 'WB', name: 'West Bengal' }] };
		const { c, fixture, out } = form();
		const fill = (field: Parameters<typeof c.set>[0], value: string) => c.set(field, value as never);
		fill('fullName', ' Kavita ');
		fill('line1', ' 12 Rash Behari ');
		fill('city', 'Kolkata');
		fill('mobile', '983');
		expect(c.value()).toBeNull();
		fill('mobile', '98311 22334');
		expect(c.value()).toBeNull();
		fill('subdivisionCode', 'WB');
		fill('callingCode', '');
		expect(c.value()).toMatchObject({
			fullName: 'Kavita',
			state: 'West Bengal',
			mobile: { countryCallingCode: '91', number: '9831122334' },
		});
		expect(c.value()).not.toHaveProperty('line2');
		fill('line2', ' Flat 2 ');
		fill('landmark', ' Near the park ');
		fill('altMobile', '98300 00000');
		fill('altCallingCode', '');
		expect(c.value()).toMatchObject({
			line2: 'Flat 2',
			landmark: 'Near the park',
			altMobile: { countryCallingCode: '91' },
		});
		fill('subdivisionCode', 'XX');
		expect(c.value()).not.toHaveProperty('state');
		fill('countryCode', '');
		expect(c.value()).toBeNull();
		fixture.detectChanges();
		expect(out.length).toBeGreaterThan(0);
	});

	it('starts from an initial address, in its own country', () => {
		const { c, fixture } = form();
		fixture.componentRef.setInput('initial', { fullName: 'A', countryCode: 'GB', callingCode: '44' });
		fixture.detectChanges();
		expect(c.draft()).toMatchObject({ countryCode: 'GB', phoneCountry: 'GB', altCallingCode: '44' });
		fixture.componentRef.setInput('initial', { fullName: 'B' });
		fixture.detectChanges();
		expect(c.draft()).toMatchObject({ countryCode: 'IN', altCallingCode: '91' });
	});

	it('changes the country or the code picker beside a phone', () => {
		const { c } = form();
		c.set('subdivisionCode', 'WB');
		c.setCountry('GB');
		expect(c.draft()).toMatchObject({
			countryCode: 'GB',
			callingCode: '44',
			phoneCountry: 'GB',
			subdivisionCode: '',
		});
		c.setCountry('ZZ');
		expect(c.draft()).toMatchObject({ countryCode: 'ZZ', callingCode: '44', phoneCountry: 'GB' });
		c.setPhoneCountry('mobile', 'US');
		expect(c.draft()).toMatchObject({ phoneCountry: 'US', callingCode: '1' });
		c.setPhoneCountry('alt', 'BD');
		expect(c.draft()).toMatchObject({ altPhoneCountry: 'BD', altCallingCode: '880' });
		c.setPhoneCountry('alt', 'ZZ');
		expect(c.draft().altPhoneCountry).toBe('BD');
	});

	it('fills the city and State from an Indian PIN code, and notes one it does not know', async () => {
		const found = { pin: '700026', found: true, city: 'Kolkata', subdivisionCode: 'WB' };
		const { c, geo } = form('en', of(found));
		await c.setPostalCode('7000');
		expect(geo.pin).not.toHaveBeenCalled();
		await c.setPostalCode('700026');
		expect(c.draft()).toMatchObject({ city: 'Kolkata', subdivisionCode: 'WB' });
		expect(c.pinNote()).toBe('found');
		c.set('city', 'Howrah');
		geo.pin.mockReturnValueOnce(of({ pin: '711101', found: true, city: null, subdivisionCode: null }) as never);
		await c.setPostalCode('711101');
		expect(c.draft()).toMatchObject({ city: 'Howrah', subdivisionCode: 'WB' });
		c.set('city', ' ');
		geo.pin.mockReturnValueOnce(of({ pin: '711101', found: true, city: null, subdivisionCode: null }) as never);
		await c.setPostalCode('711101');
		expect(c.draft().city).toBe(' ');
		geo.pin.mockReturnValueOnce(of({ pin: '999999', found: false }) as never);
		await c.setPostalCode('999999');
		expect(c.pinNote()).toBe('unknown');
		geo.pin.mockReturnValueOnce(of(null) as never);
		await c.setPostalCode('700001');
		expect(c.pinNote()).toBeNull();
		geo.pin.mockReturnValueOnce(throwError(() => new Error('down')) as never);
		await c.setPostalCode('700002');
		geo.pin.mockImplementationOnce(() => {
			c.set('postalCode', '700099');
			return of(found) as never;
		});
		await c.setPostalCode('700003');
		expect(c.pinNote()).toBeNull();
		c.setCountry('GB');
		await c.setPostalCode('700026');
		expect(geo.pin).toHaveBeenCalledTimes(7);
	});
});

describe('the customer address popup and card words (ad04, bz02)', () => {
	function popup(save: unknown = of({})) {
		const close = vi.fn();
		const gateway = { save: vi.fn(() => save) };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: NgbActiveModal, useValue: { close } },
				{ provide: CustomerAddressBookGateway, useValue: gateway },
				{ provide: TranslocoService, useValue: { translate: t } },
			],
		});
		TestBed.overrideComponent(CustomerAddressPopup, { set: { imports: [], template: '' } });
		return { c: TestBed.createComponent(CustomerAddressPopup).componentInstance, close, gateway };
	}
	const row = (over: Record<string, unknown> = {}) =>
		({
			id: 'adr_1',
			label: 'Home',
			fullName: 'Asha Roy',
			line1: '12 Road',
			city: 'Kolkata',
			postalCode: '700026',
			country: 'IN',
			isDefault: true,
			...over,
		}) as never;
	const address = {
		fullName: 'Asha',
		line1: 'x',
		city: 'y',
		postalCode: '1',
		countryCode: 'IN',
		mobile: { countryCallingCode: '91', number: '1' },
	} as never;

	it('starts new, from a saved row, or from a typed one still to be saved', () => {
		const { c } = popup();
		c.start({ customerId: 'cus_1', customerName: 'Asha Roy', firstAddress: true });
		expect(c.editing()).toBe(false);
		expect(c.isDefault()).toBe(true);
		expect(c.initial()).toEqual({ fullName: 'Asha Roy' });
		c.start({ customerId: 'cus_1', customerName: '' });
		expect(c.initial()).toBeNull();
		expect(c.isDefault()).toBe(false);
		c.start({ customerId: 'cus_1', customerName: 'Asha', row: row({ label: undefined }) });
		expect(c.editing()).toBe(true);
		expect(c.label()).toBe('');
		c.start({ customerId: null, customerName: 'Asha', row: row({ id: 'draft_0', isDefault: false }) });
		expect(c.addressId()).toBeNull();
	});

	it('hands back an address for a customer not saved yet, and saves one for a saved customer', async () => {
		const unsaved = popup();
		unsaved.c.start({ customerId: null, customerName: 'Asha' });
		await unsaved.c.save();
		expect(unsaved.close).not.toHaveBeenCalled();
		unsaved.c.address.set(address);
		unsaved.c.label.set('  ');
		expect(unsaved.c.ready()).toBe(false);
		await unsaved.c.save();
		unsaved.c.label.set('Home');
		await unsaved.c.save();
		expect(unsaved.close).toHaveBeenCalledWith(expect.objectContaining({ label: 'Home' }));
		expect(unsaved.gateway.save).not.toHaveBeenCalled();
		const saved = popup();
		saved.c.start({ customerId: 'cus_1', customerName: 'Asha', row: row() });
		saved.c.address.set(address);
		saved.c.label.set('Office');
		await saved.c.save();
		expect(saved.gateway.save).toHaveBeenCalledWith('cus_1', 'adr_1', expect.objectContaining({ label: 'Office' }));
		expect(saved.close).toHaveBeenCalled();
		const refused = popup(throwError(() => new Error('down')));
		refused.c.start({ customerId: 'cus_1', customerName: 'Asha' });
		refused.c.address.set(address);
		refused.c.label.set('Home');
		await refused.c.save();
		expect(refused.c.error()).toBe('cust_address_not_saved');
		expect(refused.c.busy()).toBe(false);
	});

	it('writes a card line, its postal label and its phone', () => {
		expect(addressCardLine(row({ line2: ' ', landmark: 'Park', state: 'West Bengal' }), 'en')).toBe(
			'12 Road, Park, Kolkata, West Bengal, India',
		);
		expect(addressCardLine(row({ country: 'India' }), 'bn')).toBe('12 Road, Kolkata, India');
		expect(addressCardLine(row({ countryCode: 'India' }), 'en')).toBe('12 Road, Kolkata, IN');
		expect(postalLabelKeyOf({ country: 'India' } as never)).toBe('addr_postal_pin');
		expect(postalLabelKeyOf({ country: 'x', countryCode: 'GB' } as never)).toBe('addr_postal_postcode');
		expect(postalLabelKeyOf({ country: 'US' } as never)).toBe('addr_postal_zip');
		expect(postalLabelKeyOf({ country: 'DE' } as never)).toBe('addr_postal_postal');
		expect(phoneTextOf({ mobile: { countryCallingCode: '91', number: '98' } } as never)).toBe('+91 98');
		expect(phoneTextOf({ phone: '033' } as never)).toBe('033');
		expect(phoneTextOf({} as never)).toBe('');
	});
});
