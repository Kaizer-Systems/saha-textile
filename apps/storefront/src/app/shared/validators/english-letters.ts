import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/** Bengali digits (০–৯) as English digits (BN-3): the same conversion the API applies. */
export const toLatinDigits = (value: string): string =>
	value.replace(/[\u09E6-\u09EF]/g, (digit) => String(digit.charCodeAt(0) - 0x09e6));

const NAME = /^[A-Za-z][A-Za-z .'-]*$/;
const DELIVERY = /^[A-Za-z0-9 .,'’\-/#&()]*$/;

/**
 * Names and delivery details in English letters (BN-12), checked as the API checks them, so the
 * form says so before the request is refused. Couriers, invoices and staff searches read them.
 */
export function englishLetters(kind: 'name' | 'delivery'): ValidatorFn {
	return (control: AbstractControl): ValidationErrors | null => {
		const value = typeof control.value === 'string' ? toLatinDigits(control.value.trim().replace(/\s+/g, ' ')) : '';
		if (!value) return null;
		return (kind === 'name' ? NAME : DELIVERY).test(value) ? null : { englishLetters: true };
	};
}
