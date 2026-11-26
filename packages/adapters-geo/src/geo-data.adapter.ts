import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

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
 * Each file is stored once under its own content hash (`geo/<sha256>.json`). The index naming each file's
 * hash, the manifest, is in Spaces too (`geo/manifest.json`; every published one is kept under
 * `geo/manifests/<version>.json`), so the monthly refresh publishes new data with no code change or
 * release (owner, 2026-11-20). The manifest is read on first use and again in the background every few
 * hours; a file is read the first time it is asked for, checked against the manifest's hash, and kept.
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

/** Where the current manifest is kept in object storage. */
export const GEO_MANIFEST_KEY = 'geo/manifest.json';

/** Reads from object storage (the API passes its StoragePort's `download`). */
export function storageGeoReader(download: (key: string) => Promise<Uint8Array>): GeoFileReader {
	return (_path, entry) => download(geoObjectKey(entry));
}

/** The current manifest from object storage. */
export function storageGeoManifest(download: (key: string) => Promise<Uint8Array>): () => Promise<GeoManifest> {
	return async () => parseManifest(await download(GEO_MANIFEST_KEY));
}

/** Reads from a folder laid out like the manifest (`scripts/geo/build.mjs` writes one; tests use one). */
export function folderGeoReader(dir: string): GeoFileReader {
	return async (path) => new Uint8Array(await readFile(join(dir, path)));
}

/** The manifest in a local folder (`<dir>/manifest.json`, as scripts/geo/build.mjs writes it). */
export function folderGeoManifest(dir: string): () => Promise<GeoManifest> {
	return async () => parseManifest(new Uint8Array(await readFile(join(dir, 'manifest.json'))));
}

function parseManifest(bytes: Uint8Array): GeoManifest {
	const manifest = JSON.parse(Buffer.from(bytes).toString('utf8')) as GeoManifest;
	if (manifest?.schema !== 1 || typeof manifest.version !== 'string' || typeof manifest.files !== 'object') {
		throw new Error('the geo manifest could not be read');
	}
	return manifest;
}

/** How long a loaded manifest is used before it is read again in the background. */
export const GEO_MANIFEST_REFRESH_MS = 6 * 60 * 60 * 1000;

/** Thrown when a file is missing from storage or its bytes don't match the manifest. */
export class GeoDataUnavailableError extends Error {
	constructor(
		readonly path: string,
		reason: string,
	) {
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

type GeoManifestLoader = () => Promise<GeoManifest>;
type LoadedManifest = { manifest: GeoManifest; at: number };

export class ManifestGeoDataAdapter implements GeoDataPort {
	readonly #source: GeoManifest | GeoManifestLoader;
	readonly #read: GeoFileReader;
	readonly #now: () => number;
	#current: LoadedManifest | null = null;
	#first: Promise<GeoManifest> | null = null;
	#refreshing = false;
	#cache = new Map<string, Promise<unknown>>();

	/** `manifest` (a fixed one) or `loadManifest` (read now and again every few hours). */
	constructor(
		options: { read: GeoFileReader; now?: () => number } & (
			{ manifest: GeoManifest } | { loadManifest: GeoManifestLoader }
		),
	) {
		this.#read = options.read;
		this.#now = options.now ?? Date.now;
		this.#source = 'manifest' in options ? options.manifest : options.loadManifest;
	}

	/** The manifest in use, read on first use; later reads happen in the background and swap only on success. */
	async manifest(): Promise<GeoManifest> {
		const source = this.#source;
		if (typeof source !== 'function') return source;
		const current = this.#current;
		if (current) {
			if (this.#now() - current.at > GEO_MANIFEST_REFRESH_MS && !this.#refreshing)
				void this.#refresh(current, source);
			return current.manifest;
		}
		if (!this.#first) {
			this.#first = source().then(
				(manifest) => {
					this.#current = { manifest, at: this.#now() };
					return manifest;
				},
				(error: unknown) => {
					this.#first = null;
					throw new GeoDataUnavailableError(
						'manifest.json',
						error instanceof Error ? error.message : 'not readable',
					);
				},
			);
		}
		return this.#first;
	}

	async #refresh(current: LoadedManifest, load: GeoManifestLoader): Promise<void> {
		this.#refreshing = true;
		try {
			const next = await load();
			if (next.version !== current.manifest.version) this.#cache = new Map();
			this.#current = { manifest: next, at: this.#now() };
		} catch {
			// Keep serving the manifest already loaded; the next request tries again.
			this.#current = { ...current, at: this.#now() - GEO_MANIFEST_REFRESH_MS + 60_000 };
		} finally {
			this.#refreshing = false;
		}
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
		if (!(await this.manifest()).counts.pins) return null;
		const valid = /^\d{6}$/.test(pin);
		const slice = valid
			? ((await this.#file(`pins/${pin.slice(0, 3)}.json`)) as Record<string, PinRow> | null)
			: null;
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
	async #file(path: string): Promise<unknown> {
		const entry = (await this.manifest()).files[path];
		if (!entry) return null;
		const cache = this.#cache;
		const key = `${path}@${entry.sha256}`;
		let loading = cache.get(key);
		if (!loading) {
			loading = this.#fetch(path, entry);
			cache.set(key, loading);
			// A failed read is not kept: the next request tries again.
			loading.catch(() => cache.delete(key));
		}
		return loading;
	}

	async #fetch(path: string, entry: GeoManifestEntry): Promise<unknown> {
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
