import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { GeoCountry, GeoSubdivision, type GeoCountryDetail, type PinLookup } from '@saha-textile/contracts';
import type { GeoDataPort } from '@saha-textile/core-domain';
import { isValidPhoneNumber } from 'libphonenumber-js/max';

/**
 * Country, State and phone data from the repository's own data file (owner decision `DEC-ADDRESS`,
 * 2026-11-20): built by `scripts/geo/build.mjs` from libphonenumber-js, dr5hn countries-states-cities
 * and India Post's PIN directory, refreshed monthly by a reviewed pull request. No outside service is
 * called while someone types. Files are read once and kept in memory.
 */
interface PinRow {
	city: string | null;
	district: string | null;
	subdivisionCode: string | null;
	gstStateCode: string | null;
}

export class FileGeoDataAdapter implements GeoDataPort {
	readonly #dir: string;
	#countries: GeoCountry[] | null = null;
	readonly #subdivisions = new Map<string, GeoSubdivision[]>();
	#pins: Record<string, PinRow> | null | undefined;

	constructor(dataDir = resolve(__dirname, '..', 'data')) {
		this.#dir = dataDir;
	}

	async countries(): Promise<GeoCountry[]> {
		if (!this.#countries) {
			const raw = JSON.parse(readFileSync(join(this.#dir, 'countries.json'), 'utf8')) as unknown[];
			this.#countries = raw.map((row) => GeoCountry.parse(row));
		}
		return this.#countries;
	}

	async country(code: string): Promise<GeoCountryDetail | null> {
		const upper = code.toUpperCase();
		if (!/^[A-Z]{2}$/.test(upper)) return null;
		const country = (await this.countries()).find((row) => row.code === upper);
		if (!country) return null;
		return { ...country, subdivisions: this.subdivisionsOf(upper) };
	}

	async pin(pin: string): Promise<PinLookup | null> {
		if (this.#pins === undefined) {
			const path = join(this.#dir, 'india-pins.json');
			this.#pins = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, PinRow>) : null;
		}
		if (!this.#pins) return null;
		const row = /^\d{6}$/.test(pin) ? this.#pins[pin] : undefined;
		const state = row?.subdivisionCode
			? this.subdivisionsOf('IN').find((sub) => sub.code === row.subdivisionCode)
			: undefined;
		return {
			pin,
			found: !!row,
			city: row?.city ?? null,
			subdivisionCode: row?.subdivisionCode ?? null,
			state: state?.name ?? null,
			gstStateCode: row?.gstStateCode ?? null,
			deliverable: null,
		};
	}

	async mobileLengths(callingCode: string): Promise<number[] | null> {
		const matches = (await this.countries()).filter((row) => row.callingCode === callingCode);
		if (!matches.length) return null;
		return [...new Set(matches.flatMap((row) => row.mobileLengths))].sort((a, b) => a - b);
	}

	async isValidMobile(callingCode: string, number: string): Promise<boolean> {
		if (!/^\d{1,4}$/.test(callingCode) || !/^\d{4,15}$/.test(number)) return false;
		return isValidPhoneNumber(`+${callingCode}${number}`);
	}

	private subdivisionsOf(code: string): GeoSubdivision[] {
		if (!this.#subdivisions.has(code)) {
			const path = join(this.#dir, 'subdivisions', `${code}.json`);
			const rows = existsSync(path)
				? (JSON.parse(readFileSync(path, 'utf8')) as unknown[]).map((row) => GeoSubdivision.parse(row))
				: [];
			this.#subdivisions.set(code, rows);
		}
		return this.#subdivisions.get(code) ?? [];
	}
}
