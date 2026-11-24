import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import { GeoGateway, injectGeoCountryQuery } from '@core/geo/geo.gateway';

import type { PinLookup, PostalAddressInput } from '@saha-textile/contracts';

/** Countries English names with "the": the United Kingdom, the United States… */
const THE_COUNTRIES = new Set([
	'GB',
	'US',
	'AE',
	'NL',
	'PH',
	'BS',
	'CZ',
	'DO',
	'GM',
	'CF',
	'KM',
	'MV',
	'MH',
	'SB',
	'VA',
	'CD',
	'CG',
]);

/** A country's flag from its two letters (regional indicator symbols). */
export const flagOf = (code: string): string =>
	/^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : '';

/** The form's fields as typed; `value()` turns them into the address the API checks. */
export interface PostalAddressDraft {
	fullName: string;
	countryCode: string;
	callingCode: string;
	/** Whose flag the mobile's code picker shows (several countries share +1, +7, +44…). */
	phoneCountry: string;
	mobile: string;
	altCallingCode: string;
	altPhoneCountry: string;
	altMobile: string;
	line1: string;
	line2: string;
	landmark: string;
	postalCode: string;
	city: string;
	subdivisionCode: string;
}

export const EMPTY_ADDRESS: PostalAddressDraft = {
	fullName: '',
	countryCode: 'IN',
	callingCode: '91',
	phoneCountry: 'IN',
	mobile: '',
	altCallingCode: '91',
	altPhoneCountry: 'IN',
	altMobile: '',
	line1: '',
	line2: '',
	landmark: '',
	postalCode: '',
	city: '',
	subdivisionCode: '',
};

const digits = (text: string): string => text.replace(/\D/g, '').replace(/^0+/, '');

/**
 * One postal address with the country's rules (brief shop15, shop16, ad05, ad07; DEC-ADDRESS): the
 * country picks the State list, the phone code (still changeable) and what the postal code is called;
 * in India the PIN code fills the city and State. Only the chosen country's States are fetched. The
 * server checks the address again on save; this form only helps.
 */
@Component({
	selector: 'app-postal-address-form',
	templateUrl: './postal-address-form.html',
	imports: [TranslocoModule],
})
export class PostalAddressForm {
	private readonly geo = inject(GeoGateway);
	private readonly transloco = inject(TranslocoService);

	readonly idPrefix = input('address');
	/** The admin checkout's new address (brief ad07): no second number, area or landmark. */
	readonly compact = input(false);
	readonly initial = input<Partial<PostalAddressDraft> | null>(null);
	/** Emits the address whenever it is complete enough to send, else null. */
	readonly changed = output<PostalAddressInput | null>();

	readonly draft = signal<PostalAddressDraft>({ ...EMPTY_ADDRESS });
	readonly pinNote = signal<'found' | 'unknown' | null>(null);
	/** The PIN directory's answer, for the "Kolkata, West Bengal · couriers deliver here" line. */
	readonly pinFound = signal<PinLookup | null>(null);

	readonly countries = toSignal(this.geo.countries(), { initialValue: [] });
	readonly country = injectGeoCountryQuery(() => this.draft().countryCode || null);
	readonly states = computed(() => this.country.data()?.subdivisions ?? []);
	readonly subdivisionLabel = computed(() => this.country.data()?.subdivisionLabel ?? 'state');
	readonly postalLabel = computed(() => this.country.data()?.postalCodeLabel ?? 'postal');
	readonly countryRows = computed(() => {
		const lang = this.transloco.getActiveLang() === 'bn' ? 'bn' : 'en';
		// Both languages are built into every browser, and the default fallback ('code') never answers undefined.
		const names = new Intl.DisplayNames([lang], { type: 'region' });
		return this.countries()
			.map((row) => ({
				code: row.code,
				callingCode: row.callingCode,
				flag: flagOf(row.code),
				name: names.of(row.code) as string,
			}))
			.sort((a, b) => (a.code === 'IN' ? -1 : b.code === 'IN' ? 1 : a.name.localeCompare(b.name)));
	});

	/** Which flag each code picker shows: the chosen country when its code matches, else the first with that code. */
	readonly mobilePick = computed(() => this.pickFor(this.draft().phoneCountry, this.draft().callingCode));
	readonly altPick = computed(() => this.pickFor(this.draft().altPhoneCountry, this.draft().altCallingCode));

	private pickFor(country: string, callingCode: string): string {
		const rows = this.countries();
		const code = digits(callingCode);
		return (
			rows.find((row) => row.code === country && row.callingCode === code)?.code ??
			rows.find((row) => row.callingCode === code)?.code ??
			country
		);
	}

	/** Under the State list (ad04, ad05): which list it is; in India, that the PIN code fills it. */
	readonly statesHelp = computed(() => {
		const d = this.draft();
		if (d.countryCode === 'IN')
			return this.transloco.translate('addr_states_help_in', { count: this.states().length });
		const country = this.countryRows().find((row) => row.code === d.countryCode)?.name ?? d.countryCode;
		// "Only the United Kingdom’s counties are listed." (ad05): English names a few countries with "the".
		return this.transloco.translate(
			THE_COUNTRIES.has(d.countryCode) ? 'addr_states_help_the' : 'addr_states_help',
			{
				country,
				kind: this.transloco.translate(`addr_sub_plural_${this.subdivisionLabel()}`),
			},
		);
	});

	readonly value = computed<PostalAddressInput | null>(() => {
		const d = this.draft();
		const mobile = digits(d.mobile);
		if (!d.fullName.trim() || !d.line1.trim() || !d.city.trim() || !d.countryCode || mobile.length < 4) return null;
		if (this.states().length && !d.subdivisionCode) return null;
		const state = this.states().find((row) => row.code === d.subdivisionCode);
		const alt = digits(d.altMobile);
		return {
			fullName: d.fullName.trim(),
			line1: d.line1.trim(),
			...(d.line2.trim() ? { line2: d.line2.trim() } : {}),
			...(d.landmark.trim() ? { landmark: d.landmark.trim() } : {}),
			city: d.city.trim(),
			...(state ? { state: state.name, subdivisionCode: state.code } : {}),
			postalCode: d.postalCode.trim(),
			countryCode: d.countryCode,
			mobile: { countryCallingCode: digits(d.callingCode) || '91', number: mobile },
			...(alt ? { altMobile: { countryCallingCode: digits(d.altCallingCode) || '91', number: alt } } : {}),
		} as PostalAddressInput;
	});

	constructor() {
		effect(() => {
			const start = this.initial();
			if (!start) return;
			const countryCode = start.countryCode ?? EMPTY_ADDRESS.countryCode;
			this.draft.set({
				...EMPTY_ADDRESS,
				phoneCountry: countryCode,
				altPhoneCountry: countryCode,
				altCallingCode: start.callingCode ?? EMPTY_ADDRESS.callingCode,
				...start,
			});
		});
		effect(() => this.changed.emit(this.value()));
	}

	set<K extends keyof PostalAddressDraft>(field: K, value: PostalAddressDraft[K]): void {
		this.draft.update((d) => ({ ...d, [field]: value }));
	}

	/** A new country brings its own phone code and State list; the old State no longer applies. */
	setCountry(code: string): void {
		const row = this.countries().find((country) => country.code === code);
		this.draft.update((d) => ({
			...d,
			countryCode: code,
			callingCode: row?.callingCode ?? d.callingCode,
			phoneCountry: row ? code : d.phoneCountry,
			altCallingCode: row?.callingCode ?? d.altCallingCode,
			altPhoneCountry: row ? code : d.altPhoneCountry,
			subdivisionCode: '',
		}));
		this.pinNote.set(null);
		this.pinFound.set(null);
	}

	/** The code picker beside a phone number: "The code follows the country; you can change it for the phone only." */
	setPhoneCountry(which: 'mobile' | 'alt', code: string): void {
		const row = this.countries().find((country) => country.code === code);
		if (!row) return;
		this.draft.update((d) =>
			which === 'mobile'
				? { ...d, phoneCountry: code, callingCode: row.callingCode }
				: { ...d, altPhoneCountry: code, altCallingCode: row.callingCode },
		);
	}

	/** In India a full PIN code fills the city and State from India Post's directory. */
	async setPostalCode(text: string): Promise<void> {
		this.set('postalCode', text);
		this.pinNote.set(null);
		this.pinFound.set(null);
		const pin = text.trim();
		if (this.draft().countryCode !== 'IN' || !/^\d{6}$/.test(pin)) return;
		try {
			const found = await firstValueFrom(this.geo.pin(pin));
			if (pin !== this.draft().postalCode.trim() || !found) return;
			if (!found.found) {
				this.pinNote.set('unknown');
				return;
			}
			this.draft.update((d) => ({
				...d,
				subdivisionCode: found.subdivisionCode ?? d.subdivisionCode,
				city: d.city.trim() ? d.city : (found.city ?? d.city),
			}));
			this.pinNote.set('found');
			this.pinFound.set(found);
		} catch {
			// The lookup only helps; the server checks the PIN on save.
		}
	}
}
