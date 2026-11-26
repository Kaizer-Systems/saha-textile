import type {
	AddressProblem,
	GeoCountry,
	GeoSubdivision,
	PinLookup,
	PostalAddressInput,
} from '@saha-textile/contracts';

/**
 * Address rules (`DEC-ADDRESS`, owner 2026-11-20): the chosen country limits the State list and
 * sets the phone code (changeable for the phone only); a mobile is required, 10 digits in India and
 * the country's own lengths abroad; in India the PIN code fills the city and State and the State
 * must match it. The country data comes from the repository's data file through `GeoDataPort`.
 */

export interface AddressRuleData {
	country: GeoCountry | null;
	subdivisions: readonly GeoSubdivision[];
	/** India only: what the PIN directory says about the typed PIN. */
	pin: PinLookup | null;
	/** Mobile lengths for the calling code typed (may differ from the country's). */
	mobileLengthsForCode: readonly number[] | null;
}

export interface CheckedAddress {
	problems: Array<{ field: string; problem: AddressProblem }>;
	/** The State's name and GST code, filled from the data (never trusted from the form). */
	state: string | null;
	gstStateCode: string | null;
}

/** Indian mobile numbers: 10 digits starting 6–9. */
export const INDIAN_MOBILE = /^[6-9]\d{9}$/;

export function checkAddress(address: PostalAddressInput, data: AddressRuleData): CheckedAddress {
	const problems: CheckedAddress['problems'] = [];
	const country = data.country;
	if (!country)
		return { problems: [{ field: 'countryCode', problem: 'unknown_country' }], state: null, gstStateCode: null };

	let state: string | null = address.state?.trim() || null;
	let gstStateCode: string | null = null;
	if (country.hasSubdivisions) {
		const code = address.subdivisionCode?.trim();
		if (!code) problems.push({ field: 'subdivisionCode', problem: 'state_required' });
		else {
			const match = data.subdivisions.find((row) => row.code === code);
			if (!match) problems.push({ field: 'subdivisionCode', problem: 'state_not_in_country' });
			else {
				state = match.name;
				gstStateCode = match.gstStateCode;
			}
		}
	}

	const postal = address.postalCode.trim();
	if (country.postalCodeRequired && !postal) problems.push({ field: 'postalCode', problem: 'postal_code_required' });
	else if (postal && country.postalCodePattern && !new RegExp(`^(?:${country.postalCodePattern})$`).test(postal)) {
		problems.push({ field: 'postalCode', problem: 'postal_code_shape' });
	}
	if (country.code === 'IN' && postal && /^\d{6}$/.test(postal) && data.pin) {
		if (!data.pin.found) problems.push({ field: 'postalCode', problem: 'pin_unknown' });
		else if (
			data.pin.subdivisionCode &&
			address.subdivisionCode &&
			data.pin.subdivisionCode !== address.subdivisionCode
		) {
			problems.push({ field: 'subdivisionCode', problem: 'pin_state_mismatch' });
		}
	}

	const mobile = address.mobile;
	if (mobile.countryCallingCode === '91') {
		if (!INDIAN_MOBILE.test(mobile.number)) problems.push({ field: 'mobile', problem: 'mobile_india_ten_digits' });
	} else if (data.mobileLengthsForCode && !data.mobileLengthsForCode.includes(mobile.number.length)) {
		problems.push({ field: 'mobile', problem: 'mobile_invalid' });
	}
	const alt = address.altMobile;
	if (alt) {
		const ok =
			alt.countryCallingCode === '91'
				? INDIAN_MOBILE.test(alt.number)
				: alt.number.length >= 6 && alt.number.length <= 15;
		if (!ok) problems.push({ field: 'altMobile', problem: 'alt_mobile_invalid' });
	}
	return { problems, state, gstStateCode };
}

/** The phone code a country form starts with; staff or the buyer may change it for the phone only. */
export function defaultCallingCode(country: GeoCountry): string {
	return country.callingCode;
}
