import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { GeoCountry, GeoSubdivision, type GeoCountryDetail, type PinLookup } from '@saha-textile/contracts';
import type { GeoDataPort } from '@saha-textile/core-domain';
import { isValidPhoneNumber } from 'libphonenumber-js/max';

/**
 * Country, State, phone and PIN data (owner decisions `DEC-ADDRESS`, 2026-11-20, and "move all that
 * data to spaces", 2026-11-20).
 *
 * The data lives in object storage (DigitalOcean Spaces), one small file per question:
 * - `countries.json`: every country with its phone code and address labels;
 * - `subdivisions/<CC>.json`: one country's States or regions;
 * - `pins/<first 3 digits>.json`: one slice of India Post's PIN directory.
 *
 * Each file is stored once under its own content hash (`geo/<sha256>.json`). The repository keeps only
 * `data/manifest.json`, which names each file's hash: the monthly refresh uploads new files and opens a
 * pull request that changes the manifest, so new data goes live only when a person merges it. A file is
 * read the first time it is asked for, checked against the manifest's hash, and kept in memory.
 */

export interface GeoManifestEntry {
	sha256: string;
	bytes: number;
}

export interface GeoManifest {
	schema: 1;
	/** A short hash of the whole file set: the same data always has the same version. */
	version: string;
	counts: { countries: number; withSubdivisions: number; pins: number };
	sources: Record<string, unknown>;
	files: Record<string, GeoManifestEntry>;
}

/** Reads one file's bytes, given its path in the manifest and its entry. */
export type GeoFileReader = (path: string, entry: GeoManifestEntry) => Promise<Uint8Array>;

/** The object-storage key a file is stored under. */
export const geoObjectKey = (entry: GeoManifestEntry): string => `geo/${entry.sha256}.json`;

/** Reads from object storage (the API passes its StoragePort's `download`). */
export function storageGeoReader(download: (key: string) => Promise<Uint8Array>): GeoFileReader {
	return (_path, entry) => download(geoObjectKey(entry));
}

/** Reads from a folder laid out like the manifest (`scripts/geo/build.mjs` writes one; tests use one). */
export function folderGeoReader(dir: string): GeoFileReader {
	return async (path) => new Uint8Array(await readFile(join(dir, path)));
}

/** The manifest shipped with this package (`data/manifest.json`). */
export function loadGeoManifest(path = resolve(__dirname, '..', 'data', 'manifest.json')): GeoManifest {
	return JSON.parse(readFileSync(path, 'utf8')) as GeoManifest;
}

/** Thrown when a file is missing from storage or its bytes don't match the manifest. */
export class GeoDataUnavailableError extends Error {
	constructor(readonly path: string, reason: string) {
		super(`Geo data file ${path} is unavailable: ${reason}`);
		this.name = 'GeoDataUnavailableError';
	}
}

interface PinRow {
	city: string | null;
	district: string | null;
	subdivisionCode: string | null;
	gstStateCode: string | null;
}

export class ManifestGeoDataAdapter implements GeoDataPort {
	readonly #manifest: GeoManifest;
	readonly #read: GeoFileReader;
	readonly #cache = new Map<string, Promise<unknown>>();

	constructor(options: { manifest: GeoManifest; read: GeoFileReader }) {
		this.#manifest = options.manifest;
		this.#read = options.read;
	}

	get version(): string {
		return this.#manifest.version;
	}

	async countries(): Promise<GeoCountry[]> {
		const raw = (await this.#file('countries.json')) as unknown[] | null;
		return (raw ?? []).map((row) => GeoCountry.parse(row));
	}

	async country(code: string): Promise<GeoCountryDetail | null> {
		const upper = code.toUpperCase();
		if (!/^[A-Z]{2}$/.test(upper)) return null;
		const country = (await this.countries()).find((row) => row.code === upper);
		if (!country) return null;
		return { ...country, subdivisions: await this.#subdivisionsOf(upper) };
	}

	/** One PIN: reads only its slice of the directory (`pins/700.json` for 700029). Null: no PIN data at all. */
	async pin(pin: string): Promise<PinLookup | null> {
		if (!this.#manifest.counts.pins) return null;
		const valid = /^\d{6}$/.test(pin);
		const slice = valid ? ((await this.#file(`pins/${pin.slice(0, 3)}.json`)) as Record<string, PinRow> | null) : null;
		const row = slice?.[pin];
		const state = row?.subdivisionCode
			? (await this.#subdivisionsOf('IN')).find((sub) => sub.code === row.subdivisionCode)
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

	async #subdivisionsOf(code: string): Promise<GeoSubdivision[]> {
		const raw = (await this.#file(`subdivisions/${code}.json`)) as unknown[] | null;
		return (raw ?? []).map((row) => GeoSubdivision.parse(row));
	}

	/** A file's parsed contents, null when the manifest has no such file. Loaded once, then kept. */
	#file(path: string): Promise<unknown> {
		const entry = this.#manifest.files[path];
		if (!entry) return Promise.resolve(null);
		let loading = this.#cache.get(path);
		if (!loading) {
			loading = this.#load(path, entry);
			this.#cache.set(path, loading);
			// A failed read is not kept: the next request tries again.
			loading.catch(() => this.#cache.delete(path));
		}
		return loading;
	}

	async #load(path: string, entry: GeoManifestEntry): Promise<unknown> {
		let bytes: Uint8Array;
		try {
			bytes = await this.#read(path, entry);
		} catch (error) {
			throw new GeoDataUnavailableError(path, error instanceof Error ? error.message : 'not readable');
		}
		const hash = createHash('sha256').update(bytes).digest('hex');
		if (hash !== entry.sha256) throw new GeoDataUnavailableError(path, 'its contents do not match the manifest');
		return JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
	}
}
