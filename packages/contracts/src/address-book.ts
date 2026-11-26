import { z } from 'zod';

import { EnglishDeliveryText, EnglishName, Id, LatinDigits, cleanText } from './common';

/**
 * Saved addresses with country rules (owner decision `DEC-ADDRESS`, 2026-11-20; orders brief
 * shop14–shop17, ad04–ad07).
 *
 * - Several named addresses per customer (and per business). The chosen country limits the State
 *   list and sets the phone country code; the code stays changeable for the phone only.
 * - A mobile number is required: 10 digits in India, the country's own format abroad. A second
 *   number and a landmark are optional.
 * - In India the PIN code fills the city and State; the State must match the PIN.
 *
 * Country, State and phone data come from the repository's own data file (`/geo/*` routes), never
 * from an outside service while someone types. Checks that need that data run on the server;
 * these shapes only hold what was typed.
 */

/** ISO 3166-1 alpha-2, upper case (`IN`, `GB`). */
export const CountryCode = z
	.string()
	.trim()
	.transform((value) => value.toUpperCase())
	.pipe(z.string().regex(/^[A-Z]{2}$/, { message: 'country_code_shape' }));
export type CountryCode = z.infer<typeof CountryCode>;

/** A phone number kept as its country calling code and the number within that country. */
export const PhoneNumber = z.object({
	/** Digits only, without the plus: `91`, `44`, `1`. */
	countryCallingCode: z.string().regex(/^\d{1,4}$/, { message: 'calling_code_shape' }),
	/** The national number, digits only, without the trunk 0 (`9830012345`). */
	number: z.string().regex(/^\d{4,15}$/, { message: 'phone_digits' }),
});
export type PhoneNumber = z.infer<typeof PhoneNumber>;

/** As typed: Bengali digits converted, spaces and dashes removed, a leading 0 dropped. */
export const PhoneNumberInput = z.object({
	countryCallingCode: LatinDigits.pipe(z.string().regex(/^\d{1,4}$/, { message: 'calling_code_shape' })),
	number: LatinDigits.transform((value) => value.replace(/[^\d]/g, '').replace(/^0+/, '')).pipe(
		z.string().regex(/^\d{4,15}$/, { message: 'phone_digits' }),
	),
});
export type PhoneNumberInput = z.infer<typeof PhoneNumberInput>;

/** `+91 9830012345`: how a phone number is shown and how older readers find it. */
export function formatPhoneNumber(phone: PhoneNumber): string {
	return `+${phone.countryCallingCode} ${phone.number}`;
}

/**
 * The address fields shared by saved addresses, business addresses and the addresses kept on an
 * order. Fields added on 2026-11-20 are optional so an older saved row still reads; the write
 * shape below requires what the rules require.
 */
export const PostalAddressFields = z.object({
	fullName: z.string().min(1),
	line1: z.string().min(1),
	line2: z.string().optional(),
	landmark: z.string().max(120).optional(),
	city: z.string().min(1),
	/** The State, county or region as its name reads (from the country's list). */
	state: z.string().optional(),
	/** ISO 3166-2 subdivision code without the country part (`WB`, `ENG`); empty where a country has none. */
	subdivisionCode: z.string().max(10).optional(),
	/** India only: the GST State code the State maps to (`19` for West Bengal). */
	gstStateCode: z
		.string()
		.regex(/^\d{2}$/)
		.optional(),
	postalCode: z.string().default(''),
	/** The country as older rows hold it (a code or a name). New rows keep the ISO code here too. */
	country: z.string().min(2),
	countryCode: z
		.string()
		.regex(/^[A-Z]{2}$/)
		.optional(),
	mobile: PhoneNumber.optional(),
	altMobile: PhoneNumber.nullable().optional(),
	/** Older rows: one phone string. New rows keep the formatted mobile here too. */
	phone: z.string().optional(),
});
export type PostalAddressFields = z.infer<typeof PostalAddressFields>;

/** One address as typed in any address form (shop account, admin customer page, both checkouts). */
export const PostalAddressInput = z.object({
	fullName: EnglishName,
	line1: EnglishDeliveryText.pipe(z.string().min(1).max(200)),
	line2: EnglishDeliveryText.pipe(z.string().max(200)).optional(),
	landmark: EnglishDeliveryText.pipe(z.string().max(120)).optional(),
	city: EnglishDeliveryText.pipe(z.string().min(1).max(80)),
	state: EnglishDeliveryText.pipe(z.string().max(80)).optional(),
	subdivisionCode: z.string().trim().max(10).optional(),
	postalCode: LatinDigits.transform((value) => value.trim().toUpperCase()).pipe(z.string().max(12)),
	countryCode: CountryCode,
	mobile: PhoneNumberInput,
	altMobile: PhoneNumberInput.nullable().optional(),
});
export type PostalAddressInput = z.infer<typeof PostalAddressInput>;

/** A saved address: the fields plus its name ("Home", "Office") and whether it is the default. */
export const SavedAddressWrite = PostalAddressInput.extend({
	label: z.string().transform(cleanText).pipe(z.string().min(1).max(80)),
	isDefault: z.boolean().default(false),
});
export type SavedAddressWrite = z.infer<typeof SavedAddressWrite>;

/** Why an address can't be saved as typed. The server checks these against the country data. */
export const AddressProblem = z.enum([
	'unknown_country',
	'state_required',
	'state_not_in_country',
	'postal_code_required',
	'postal_code_shape',
	'pin_unknown',
	'pin_state_mismatch',
	'mobile_invalid',
	'mobile_india_ten_digits',
	'alt_mobile_invalid',
]);
export type AddressProblem = z.infer<typeof AddressProblem>;

/* ---------------------------------------------------------------------------------------------- */
/* Country data served to address forms (`/geo/*`)                                                */
/* ---------------------------------------------------------------------------------------------- */

/** One row of the country picker. Names come from the browser in the page's language. */
export const GeoCountry = z.object({
	code: z.string().regex(/^[A-Z]{2}$/),
	/** English name, for search and for browsers without the page language's names. */
	name: z.string().min(1),
	/** The default phone calling code for this country (`91`). */
	callingCode: z.string().regex(/^\d{1,4}$/),
	/** What the subdivision is called here: State, County, Province, Region… (a translation key). */
	subdivisionLabel: z.enum(['state', 'county', 'province', 'region', 'emirate', 'prefecture', 'district', 'none']),
	/** What the postal code is called: PIN code, Postcode, ZIP code (a translation key). */
	postalCodeLabel: z.enum(['pin', 'postcode', 'zip', 'postal', 'none']),
	postalCodeRequired: z.boolean(),
	/** A pattern the postal code must match, when the country has a fixed shape. */
	postalCodePattern: z.string().nullable(),
	/** National number lengths a mobile can have here (from libphonenumber's data). */
	mobileLengths: z.array(z.number().int().positive()),
	hasSubdivisions: z.boolean(),
});
export type GeoCountry = z.infer<typeof GeoCountry>;

export const GeoSubdivision = z.object({
	/** ISO 3166-2 part after the country (`WB`). */
	code: z.string().min(1).max(10),
	name: z.string().min(1),
	/** India only: the GST State code. */
	gstStateCode: z
		.string()
		.regex(/^\d{2}$/)
		.nullable()
		.default(null),
});
export type GeoSubdivision = z.infer<typeof GeoSubdivision>;

export const GeoCountryDetail = GeoCountry.extend({ subdivisions: z.array(GeoSubdivision) });
export type GeoCountryDetail = z.infer<typeof GeoCountryDetail>;

/** What a PIN code tells an Indian address form (India Post directory + delivery check). */
export const PinLookup = z.object({
	pin: z.string().regex(/^\d{6}$/),
	found: z.boolean(),
	city: z.string().nullable(),
	subdivisionCode: z.string().nullable(),
	state: z.string().nullable(),
	gstStateCode: z.string().nullable(),
	/** Whether a courier we use delivers there; null while no courier is connected. */
	deliverable: z.boolean().nullable(),
});
export type PinLookup = z.infer<typeof PinLookup>;

/** A saved address as the account page, the admin customer page and checkout read it. */
export const SavedAddressRow = PostalAddressFields.extend({
	id: Id,
	label: z.string().optional(),
	isDefault: z.boolean(),
});
export type SavedAddressRow = z.infer<typeof SavedAddressRow>;
