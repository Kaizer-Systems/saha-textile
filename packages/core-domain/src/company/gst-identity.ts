/**
 * GSTIN helpers for the browser (core's ESM company build). The admin may import only types from
 * @saha-textile/contracts (its CommonJS build doesn't load in the browser), so the State list and the
 * check-character rule live here as well; test/gst-identity.test.ts keeps them equal to contracts/src/gst.ts.
 */

export const GST_STATES: ReadonlyArray<{ code: string; name: string; retired?: true }> = [
	{ code: '01', name: 'Jammu and Kashmir' },
	{ code: '02', name: 'Himachal Pradesh' },
	{ code: '03', name: 'Punjab' },
	{ code: '04', name: 'Chandigarh' },
	{ code: '05', name: 'Uttarakhand' },
	{ code: '06', name: 'Haryana' },
	{ code: '07', name: 'Delhi' },
	{ code: '08', name: 'Rajasthan' },
	{ code: '09', name: 'Uttar Pradesh' },
	{ code: '10', name: 'Bihar' },
	{ code: '11', name: 'Sikkim' },
	{ code: '12', name: 'Arunachal Pradesh' },
	{ code: '13', name: 'Nagaland' },
	{ code: '14', name: 'Manipur' },
	{ code: '15', name: 'Mizoram' },
	{ code: '16', name: 'Tripura' },
	{ code: '17', name: 'Meghalaya' },
	{ code: '18', name: 'Assam' },
	{ code: '19', name: 'West Bengal' },
	{ code: '20', name: 'Jharkhand' },
	{ code: '21', name: 'Odisha' },
	{ code: '22', name: 'Chhattisgarh' },
	{ code: '23', name: 'Madhya Pradesh' },
	{ code: '24', name: 'Gujarat' },
	{ code: '25', name: 'Daman and Diu', retired: true },
	{ code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu' },
	{ code: '27', name: 'Maharashtra' },
	{ code: '28', name: 'Andhra Pradesh (before 2014)', retired: true },
	{ code: '29', name: 'Karnataka' },
	{ code: '30', name: 'Goa' },
	{ code: '31', name: 'Lakshadweep' },
	{ code: '32', name: 'Kerala' },
	{ code: '33', name: 'Tamil Nadu' },
	{ code: '34', name: 'Puducherry' },
	{ code: '35', name: 'Andaman and Nicobar Islands' },
	{ code: '36', name: 'Telangana' },
	{ code: '37', name: 'Andhra Pradesh' },
	{ code: '38', name: 'Ladakh' },
	{ code: '97', name: 'Other Territory' },
];

const KNOWN_STATE_CODES = new Set(GST_STATES.map((state) => state.code));

/** The State's name for a code, or null for a code the list does not hold. */
export function gstStateName(code: string): string | null {
	return GST_STATES.find((state) => state.code === code)?.name ?? null;
}

const GSTIN_SHAPE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const GSTIN_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * The 15th character of a GSTIN, from its first 14 (the GSTN's base-36 Luhn variant): each
 * character's value is multiplied by 1 and 2 in turn, the product is split into its base-36
 * quotient and remainder and both are added, and the check character makes the sum a multiple
 * of 36.
 */
export function gstinCheckCharacter(first14: string): string {
	let sum = 0;
	for (let index = 0; index < 14; index += 1) {
		const value = GSTIN_ALPHABET.indexOf(first14[index] ?? '');
		if (value < 0) return '';
		const product = value * (index % 2 === 0 ? 1 : 2);
		sum += Math.floor(product / 36) + (product % 36);
	}
	return GSTIN_ALPHABET[(36 - (sum % 36)) % 36] ?? '';
}

export type GstinProblem = 'shape' | 'state' | 'check_digit';

/**
 * Why a GSTIN cannot be right, or null when it is. `expected` carries the right last character
 * when only the check digit is wrong, so a form can say which character it should be.
 */
export function gstinProblem(value: string): { problem: GstinProblem; expected?: string } | null {
	const gstin = value.trim().toUpperCase();
	if (!GSTIN_SHAPE.test(gstin)) return { problem: 'shape' };
	if (!KNOWN_STATE_CODES.has(gstin.slice(0, 2))) return { problem: 'state' };
	const expected = gstinCheckCharacter(gstin.slice(0, 14));
	if (gstin[14] !== expected) return { problem: 'check_digit', expected };
	return null;
}
