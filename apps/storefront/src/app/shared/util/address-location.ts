/**
 * Resolving a saved address back onto the country / state / dial-code pickers.
 *
 * ## Country first, always
 *
 * A dial code does not identify a country and a state code does not either. `+1` belongs to the
 * United States, Canada, American Samoa, the US Minor Outlying Islands and most of the Caribbean;
 * `TN` is Tamil Nadu in India and Tennessee in the United States. Our own `country.json` has
 * three entries with `calling_code: "1"` before "United States" in id order, American Samoa
 * among them — so any lookup that starts from the dial code or the state resolves the wrong
 * country and then shows the wrong flag, which is a real defect that has shipped on real
 * airline sites.
 *
 * So the country is resolved FIRST, from the country name, and everything else is derived from
 * the country that was found:
 *
 *   1. country name  → the country record (its id, its ISO code, its calling code)
 *   2. that country's id → the candidate states → the state by name WITHIN that country
 *   3. that country's `calling_code` → the dial code
 *
 * Nothing here searches the state table or the dial-code table globally, because that is the
 * step where the ambiguity gets in.
 */

export interface CountryRecord {
	id: number;
	name: string;
	calling_code?: string;
	iso_3166_2?: string;
}

export interface StateRecord {
	id: number;
	name: string;
	/** The fixture types this as a string; ours as a number. Compared loosely on purpose. */
	country_id: string | number;
}

export interface ResolvedLocation {
	countryId: number | null;
	stateId: number | null;
	/** Digits only, no `+`, as the pickers and E.164 assembly both expect. */
	callingCode: string | null;
	/** ISO-3166-2, which is what actually disambiguates a shared dial code. */
	isoCode: string | null;
}

const normalise = (value: string | null | undefined): string => (value ?? '').trim().toLowerCase();

/** Exact name match, case- and whitespace-insensitive. Never a partial or prefix match. */
export function findCountryByName(
	countries: readonly CountryRecord[],
	name: string | null | undefined,
): CountryRecord | null {
	const wanted = normalise(name);
	if (!wanted) return null;
	return countries.find((country) => normalise(country.name) === wanted) ?? null;
}

/**
 * The state, searched ONLY within the given country.
 *
 * Scoping is the entire point: "Georgia" is a US state and a country, and a global search for a
 * state name is how an address in one lands in the other.
 */
export function findStateByName(
	states: readonly StateRecord[],
	countryId: number | null,
	name: string | null | undefined,
): StateRecord | null {
	const wanted = normalise(name);
	if (!wanted || countryId === null) return null;
	return states.find((state) => Number(state.country_id) === countryId && normalise(state.name) === wanted) ?? null;
}

/**
 * Country, then state, then dial code — in that order and never any other.
 *
 * Returns nulls rather than guesses when the country cannot be matched: a picker left empty is
 * an obvious prompt to choose, while a wrong flag silently claims the person lives somewhere
 * else.
 */
export function resolveAddressLocation(input: {
	countries: readonly CountryRecord[];
	states: readonly StateRecord[];
	countryName: string | null | undefined;
	stateName: string | null | undefined;
}): ResolvedLocation {
	const country = findCountryByName(input.countries, input.countryName);
	if (!country) return { countryId: null, stateId: null, callingCode: null, isoCode: null };

	const state = findStateByName(input.states, country.id, input.stateName);

	return {
		countryId: country.id,
		stateId: state?.id ?? null,
		// From the COUNTRY record, not from a dial-code table keyed by an ambiguous number.
		callingCode: country.calling_code ?? null,
		isoCode: country.iso_3166_2 ?? null,
	};
}
