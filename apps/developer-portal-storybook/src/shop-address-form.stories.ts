import { of } from 'rxjs';

import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';

import { GeoGateway } from '../../storefront/src/app/core/geo/geo.gateway';
import { ShopAddressForm } from '../../storefront/src/app/shared/ui/shop-address-form/shop-address-form';

/**
 * One postal address with its country's rules (shop15, shop16, shop17; a copy of the admin form without the Area line): the
 * country picks the State or county list, the phone code and what the postal code is called; in
 * India a full PIN code fills the city and State. Real component; the country data is a stand-in,
 * so Storybook never calls the API. PIN 700026 is listed, any other six digits are not.
 */
const geoBoundary = {
	countries: () =>
		of([
			{ code: 'IN', name: 'India', callingCode: '91' },
			{ code: 'GB', name: 'United Kingdom', callingCode: '44' },
		]),
	country: (code: string) =>
		of(
			code === 'GB'
				? {
						code: 'GB',
						name: 'United Kingdom',
						callingCode: '44',
						subdivisionLabel: 'county',
						postalCodeLabel: 'postcode',
						subdivisions: [
							{ code: 'KEN', name: 'Kent', gstStateCode: null },
							{ code: 'LND', name: 'London, City of', gstStateCode: null },
						],
					}
				: {
						code: 'IN',
						name: 'India',
						callingCode: '91',
						subdivisionLabel: 'state',
						postalCodeLabel: 'pin',
						subdivisions: [
							{ code: 'WB', name: 'West Bengal', gstStateCode: '19' },
							{ code: 'MH', name: 'Maharashtra', gstStateCode: '27' },
						],
					},
		),
	pin: (pin: string) =>
		of(
			pin === '700026'
				? {
						pin,
						found: true,
						city: 'Kolkata',
						subdivisionCode: 'WB',
						state: 'West Bengal',
						gstStateCode: '19',
						deliverable: null,
					}
				: {
						pin,
						found: false,
						city: null,
						subdivisionCode: null,
						state: null,
						gstStateCode: null,
						deliverable: null,
					},
		),
};

const meta = {
	title: 'Storefront/Forms/Shop Address Form',
	component: ShopAddressForm,
	tags: ['autodocs'],
	decorators: [moduleMetadata({ providers: [{ provide: GeoGateway, useValue: geoBoundary }] })],
	parameters: { application: 'admin' },
	args: { idPrefix: 'story' },
} satisfies Meta<ShopAddressForm>;

export default meta;
type Story = StoryObj<ShopAddressForm>;

/** An empty address in India: type PIN code 700026 to see the city and State filled in. */
export const NewInIndia: Story = {};

/** A UK address: the phone code is +44, the postal code is a Postcode, and the list is counties. */
export const UnitedKingdom: Story = {
	args: {
		initial: {
			countryCode: 'GB',
			callingCode: '44',
			fullName: 'Arjun Mehta',
			line1: '22 Belsize Park',
			city: 'London',
		},
	},
};
