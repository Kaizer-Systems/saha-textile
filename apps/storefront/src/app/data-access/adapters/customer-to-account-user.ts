import { countryCodes } from '@shared/data/country-code';

import { IAccountUser } from '@data-access/interfaces/account.interface';
import { ICustomer, ICustomerAddress } from '@data-access/interfaces/customer.interface';
import { IUserAddress } from '@data-access/interfaces/user.interface';

/**
 * Maps the customer OUR API returns onto the shape the ported account views read.
 *
 * ## Why an adapter rather than rewriting the views
 *
 * The vendor screens were built against a Laravel-shaped `account.json` fixture — snake_case,
 * numeric ids, a role, a permission list, an embedded wallet. Our customer is a different and
 * deliberately smaller thing. Translating once, here, keeps that vendor vocabulary from spreading
 * back through eleven components and their templates, and leaves exactly one file to delete when
 * those screens are eventually rewritten against our own shape.
 *
 * ## What is deliberately empty
 *
 * `wallet`, `point`, `orders_count`, `payment_account` and `profile_image` have NO counterpart in
 * our data, because they are separate features that do not exist yet — a store-credit ledger, a
 * loyalty ledger, an order count, payout bank details, and avatar uploads. The fixture supplied
 * all five as invented numbers, which is why the dashboard has been showing a ₹300 balance and 8
 * orders to every account including brand-new ones.
 *
 * They are zeroed rather than carried over. A zero is true — nobody has any store credit, because
 * store credit does not exist — whereas keeping the fixture's numbers would be showing every
 * customer somebody else's balance. When those features land they gain real sources; until then
 * the tiles render honestly.
 *
 * They are also NOT modelled onto the customer to make the tiles look busy: a balance is the
 * closing position of a ledger, and putting a number on the account row is how that becomes
 * impossible to reconcile later.
 */

/**
 * Every dial code the picker knows, longest first.
 *
 * Longest-first is the whole algorithm: dial codes are 1–4 digits and overlap by prefix, so a
 * shortest-first scan matches `1` inside `1264` and `9` inside `91`. Matching the longest known
 * code is the standard E.164 reading and the only one that gets `+1 415…` and `+1264 …` both
 * right.
 */
const DIAL_CODES_LONGEST_FIRST = [
	// `Select2Data` is a union of options and groups; only options carry a value.
	...new Set(
		countryCodes
			.map((entry) => (entry as { value?: unknown }).value)
			.filter((value): value is string | number => value !== undefined)
			.map(String),
	),
].sort((left, right) => right.length - left.length);

/**
 * Splits E.164 into the dial code and national number the ported forms expect separately.
 *
 * This used to hard-code `91` for everything and return the WHOLE number as the national part
 * for anything else, so a US number rendered as "+91 14155550123" — the country digits shown as
 * part of the subscriber number under the wrong flag. India is only the default for a value that
 * carries no recognisable code at all.
 */
export function splitPhone(e164: string | null): { countryCode: string; national: string } {
	if (!e164) return { countryCode: '91', national: '' };

	const digits = e164.replace(/[^\d]/g, '');
	if (!digits) return { countryCode: '91', national: '' };

	const match = DIAL_CODES_LONGEST_FIRST.find((code) => digits.startsWith(code) && digits.length > code.length);
	if (match) return { countryCode: match, national: digits.slice(match.length) };

	/**
	 * A value that is EXACTLY a dial code and nothing else: a country with no subscriber number.
	 * Handled separately from the match above, which deliberately requires digits to remain —
	 * without this branch the code itself fell through and was returned as the phone number.
	 */
	if (DIAL_CODES_LONGEST_FIRST.includes(digits)) return { countryCode: digits, national: '' };

	// No recognisable code — treated as a local Indian number, which is the default market.
	return { countryCode: '91', national: digits };
}

/**
 * A stable positive integer for a `cus_<uuid>` id.
 *
 * The ported templates and their `track` expressions type ids as numbers. Nothing sends this
 * back to the server — every write goes out with the real string id — so it only has to be
 * stable and collision-free within one rendered list.
 */
function numericId(id: string): number {
	let hash = 0;
	for (let index = 0; index < id.length; index += 1) {
		hash = (hash * 31 + id.charCodeAt(index)) | 0;
	}
	return Math.abs(hash);
}

function toViewAddress(address: ICustomerAddress): IUserAddress {
	const { countryCode, national } = splitPhone(address.phone ?? null);
	return {
		id: numericId(address.id),
		// Carried alongside the display id so a write can name the row the server knows.
		address_id: address.id,
		user_id: 0,
		title: address.label ?? '',
		street: [address.line1, address.line2].filter(Boolean).join(', '),
		type: '',
		city: address.city,
		pincode: address.postalCode,
		state_id: 0,
		state: { name: address.state ?? '' } as IUserAddress['state'],
		country: { name: address.country } as IUserAddress['country'],
		country_code: Number(countryCode),
		phone: Number(national),
		country_id: 0,
		is_default: address.isDefault,
	};
}

export function toAccountUser(customer: ICustomer): IAccountUser {
	const { countryCode, national } = splitPhone(customer.phone);

	return {
		id: numericId(customer.id),
		// The account screens greet people by name; an address is a poor greeting but a better
		// one than an empty heading, and it is what they signed up with.
		name: customer.displayName?.trim() || customer.email?.split('@')[0] || '',
		email: customer.email ?? '',
		phone: national,
		country_code: countryCode,
		status: customer.status === 'active',
		email_verified_at: customer.emailVerified ? (customer.updatedAt ?? '') : '',
		address: customer.addresses.map(toViewAddress),
		// Everything below has no source in our data yet — see the note at the top of this file.
		orders_count: 0,
		is_approved: customer.status === 'active',
		role_id: 0,
		payment_account: undefined as unknown as IAccountUser['payment_account'],
		permission: [],
		created_at: customer.createdAt,
		updated_at: customer.updatedAt,
	};
}
