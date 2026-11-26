import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { GeoGateway } from '@core/geo/geo.gateway';

import { PostalAddressForm } from './postal-address-form';

const subdivisions = signal([{ code: 'WB', name: 'West Bengal', gstStateCode: '19' }]);
vi.mock('@core/geo/geo.gateway', async (original) => ({
	...(await original<typeof import('@core/geo/geo.gateway')>()),
	injectGeoCountryQuery: (code: () => string | null) => ({
		data: () =>
			code() === 'GB'
				? {
						subdivisionLabel: 'county',
						postalCodeLabel: 'postcode',
						subdivisions: [{ code: 'KEN', name: 'Kent' }],
					}
				: { subdivisionLabel: 'state', postalCodeLabel: 'pin', subdivisions: subdivisions() },
	}),
}));

function render() {
	const geo = {
		countries: vi.fn(() =>
			of([
				{ code: 'IN', name: 'India', callingCode: '91' },
				{ code: 'GB', name: 'United Kingdom', callingCode: '44' },
			]),
		),
		pin: vi.fn(() =>
			of({
				pin: '700026',
				found: true,
				city: 'Kolkata',
				subdivisionCode: 'WB',
				state: 'West Bengal',
				gstStateCode: '19',
				deliverable: null,
			}),
		),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: GeoGateway, useValue: geo },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key, getActiveLang: () => 'en' } },
		],
	});
	TestBed.overrideComponent(PostalAddressForm, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(PostalAddressForm);
	fixture.detectChanges();
	return { form: fixture.componentInstance, geo };
}

describe('postal address form (shop15, shop16, ad05, ad07)', () => {
	it('fills the city and State from an Indian PIN and gives a complete address', async () => {
		const { form } = render();
		form.set('fullName', 'Kavita Iyer');
		form.set('mobile', '098311 22334');
		form.set('line1', '12 Rash Behari Avenue');
		expect(form.value()).toBeNull();
		await form.setPostalCode('700026');
		expect(form.pinNote()).toBe('found');
		expect(form.value()).toEqual({
			fullName: 'Kavita Iyer',
			line1: '12 Rash Behari Avenue',
			city: 'Kolkata',
			state: 'West Bengal',
			subdivisionCode: 'WB',
			postalCode: '700026',
			countryCode: 'IN',
			mobile: { countryCallingCode: '91', number: '9831122334' },
		});
	});

	it('a new country brings its phone code and its own list, and drops the old State', () => {
		const { form, geo } = render();
		form.set('subdivisionCode', 'WB');
		form.setCountry('GB');
		expect(form.draft()).toMatchObject({ countryCode: 'GB', callingCode: '44', subdivisionCode: '' });
		expect(form.subdivisionLabel()).toBe('county');
		expect(form.postalLabel()).toBe('postcode');
		void form.setPostalCode('NW3 4DU');
		expect(geo.pin).not.toHaveBeenCalled();
		expect(form.countryRows()[0]?.code).toBe('IN');
	});
});
