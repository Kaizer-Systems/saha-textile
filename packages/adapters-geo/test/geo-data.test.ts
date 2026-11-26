import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	GeoDataUnavailableError,
	GEO_MANIFEST_KEY,
	GEO_MANIFEST_REFRESH_MS,
	ManifestGeoDataAdapter,
	folderGeoManifest,
	folderGeoReader,
	geoObjectKey,
	storageGeoManifest,
	storageGeoReader,
	type GeoFileReader,
	type GeoManifest,
} from '../src/index';

const COUNTRIES = [
	{
		code: 'IN',
		name: 'India',
		callingCode: '91',
		mobileLengths: [10],
		postalCodeLabel: 'pin',
		postalCodePattern: '\\d{6}',
		postalCodeRequired: true,
		subdivisionLabel: 'state',
		hasSubdivisions: true,
	},
	{
		code: 'GB',
		name: 'United Kingdom',
		callingCode: '44',
		mobileLengths: [10],
		postalCodeLabel: 'postcode',
		postalCodePattern: '[A-Z]{1,2}\\d[A-Z\\d]? ?\\d[A-Z]{2}',
		postalCodeRequired: true,
		subdivisionLabel: 'county',
		hasSubdivisions: true,
	},
];

function deferred<T>() {
	// The Promise executor sets both callbacks synchronously.
	let resolve!: (value: T) => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<T>((settle, refuse) => {
		resolve = settle;
		reject = refuse;
	});
	return { promise, resolve, reject };
}

const roots: string[] = [];

afterEach(() => {
	for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A data folder and its manifest, as scripts/geo/build.mjs writes them. */
function fixture(withPins = true, overrides: Record<string, unknown> = {}): { dir: string; manifest: GeoManifest } {
	const dir = mkdtempSync(join(tmpdir(), 'geo-'));
	roots.push(dir);
	const files: Record<string, unknown> = {
		'countries.json': COUNTRIES,
		'subdivisions/IN.json': [{ code: 'WB', name: 'West Bengal', gstStateCode: '19' }],
		'subdivisions/GB.json': [{ code: 'KEN', name: 'Kent', gstStateCode: null }],
	};
	if (withPins) {
		files['pins/700.json'] = {
			'700029': { city: 'Kolkata', district: 'Kolkata', subdivisionCode: 'WB', gstStateCode: '19' },
		};
	}
	const entries: GeoManifest['files'] = {};
	for (const [path, data] of Object.entries({ ...files, ...overrides })) {
		const text = JSON.stringify(data);
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), text);
		entries[path] = { sha256: createHash('sha256').update(text).digest('hex'), bytes: Buffer.byteLength(text) };
	}
	return {
		dir,
		manifest: {
			schema: 1,
			version: 'test',
			counts: { countries: 2, withSubdivisions: 2, pins: withPins ? 1 : 0 },
			sources: {},
			files: entries,
		},
	};
}

describe('country, State, phone and PIN data from object storage (DEC-ADDRESS)', () => {
	it('lists countries, and gives one country its own States only', async () => {
		const { dir, manifest } = fixture();
		const read = vi.fn(folderGeoReader(dir));
		const geo = new ManifestGeoDataAdapter({ manifest, read });
		expect((await geo.countries()).find((row) => row.code === 'IN')).toMatchObject({ callingCode: '91' });
		const india = await geo.country('in');
		expect(india?.subdivisions).toEqual([expect.objectContaining({ name: 'West Bengal', gstStateCode: '19' })]);
		expect(await geo.country('ZZ')).toBeNull();
		// Only what was asked for is read, and each file once.
		await geo.countries();
		expect(read.mock.calls.map(([path]) => path).sort()).toEqual(['countries.json', 'subdivisions/IN.json']);
	});

	it('looks a PIN up in its own slice; "not loaded" while there is no PIN data', async () => {
		const { dir, manifest } = fixture();
		const read = vi.fn(folderGeoReader(dir));
		const geo = new ManifestGeoDataAdapter({ manifest, read });
		expect(await geo.pin('700029')).toMatchObject({ found: true, city: 'Kolkata', state: 'West Bengal' });
		expect(await geo.pin('999999')).toMatchObject({ found: false });
		expect(read.mock.calls.map(([path]) => path)).toContain('pins/700.json');
		const none = fixture(false);
		expect(
			await new ManifestGeoDataAdapter({ manifest: none.manifest, read: folderGeoReader(none.dir) }).pin(
				'700029',
			),
		).toBeNull();
	});

	it('refuses a file whose contents do not match the manifest, and tries again next time', async () => {
		const { dir, manifest } = fixture();
		const geo = new ManifestGeoDataAdapter({ manifest, read: async () => new TextEncoder().encode('[]') });
		await expect(geo.countries()).rejects.toBeInstanceOf(GeoDataUnavailableError);
		const fixed = new ManifestGeoDataAdapter({ manifest, read: folderGeoReader(dir) });
		expect((await fixed.countries()).length).toBe(2);
	});

	it('reads from storage by content hash', async () => {
		const { dir, manifest } = fixture();
		const keys: string[] = [];
		const local = folderGeoReader(dir);
		const byKey = new Map(Object.entries(manifest.files).map(([path, entry]) => [geoObjectKey(entry), path]));
		const geo = new ManifestGeoDataAdapter({
			manifest,
			read: storageGeoReader(async (key) => {
				keys.push(key);
				const path = byKey.get(key) as string;
				return local(path, manifest.files[path] as never);
			}),
		});
		await geo.countries();
		expect(keys).toEqual([`geo/${manifest.files['countries.json']?.sha256}.json`]);
	});

	it('checks mobile numbers with libphonenumber’s rules', async () => {
		const { dir, manifest } = fixture();
		const geo = new ManifestGeoDataAdapter({ manifest, read: folderGeoReader(dir) });
		expect(await geo.isValidMobile('91', '9830012345')).toBe(true);
		expect(await geo.isValidMobile('91', '98300123')).toBe(false);
		expect(await geo.mobileLengths('91')).toEqual([10]);
	});

	it('loads the same validated manifest from disk and from storage', async () => {
		const { dir, manifest } = fixture();
		const json = JSON.stringify(manifest);
		const path = join(dir, 'manifest.json');
		writeFileSync(path, json);
		await expect(folderGeoManifest(dir)()).resolves.toEqual(manifest);
		const download = vi.fn(async () => Buffer.from(json));
		await expect(storageGeoManifest(download)()).resolves.toEqual(manifest);
		expect(download).toHaveBeenCalledExactlyOnceWith(GEO_MANIFEST_KEY);
		for (const badManifest of [
			null,
			{ ...manifest, schema: 2 },
			{ ...manifest, version: 1 },
			{ ...manifest, files: 1 },
		]) {
			writeFileSync(path, JSON.stringify(badManifest));
			await expect(folderGeoManifest(dir)()).rejects.toThrow('the geo manifest could not be read');
		}
	});

	it('shares the first manifest request and retries after a temporary failure', async () => {
		const { dir, manifest } = fixture();
		const pending = deferred<GeoManifest>();
		const loadManifest = vi
			.fn<() => Promise<GeoManifest>>()
			.mockReturnValueOnce(pending.promise)
			.mockRejectedValueOnce('storage closed')
			.mockResolvedValueOnce(manifest);
		const geo = new ManifestGeoDataAdapter({ read: folderGeoReader(dir), loadManifest });
		const first = Promise.allSettled([geo.manifest(), geo.manifest()]);
		expect(loadManifest).toHaveBeenCalledTimes(1);
		pending.reject(new Error('storage unavailable'));
		for (const result of await first) {
			expect(result).toMatchObject({ status: 'rejected', reason: { path: 'manifest.json' } });
		}
		await expect(geo.manifest()).rejects.toThrow('manifest.json is unavailable: not readable');
		await expect(geo.manifest()).resolves.toEqual(manifest);
		expect(loadManifest).toHaveBeenCalledTimes(3);
	});

	it('serves stale data during refresh, backs off on failure, and replaces its cache when the version changes', async () => {
		const original = fixture();
		const updated = fixture(true, { 'countries.json': [COUNTRIES[1]] });
		const refreshed = deferred<GeoManifest>();
		const loadManifest = vi
			.fn<() => Promise<GeoManifest>>()
			.mockResolvedValueOnce(original.manifest)
			.mockRejectedValueOnce(new Error('temporarily unavailable'))
			.mockReturnValueOnce(refreshed.promise)
			.mockResolvedValueOnce({ ...updated.manifest, version: 'updated' });
		const read = vi.fn<GeoFileReader>(async (path, entry) => {
			const dir = updated.manifest.files[path]?.sha256 === entry.sha256 ? updated.dir : original.dir;
			return folderGeoReader(dir)(path, entry);
		});
		let now = 0;
		const geo = new ManifestGeoDataAdapter({ read, loadManifest, now: () => now });
		expect(await geo.countries()).toHaveLength(2);
		now += GEO_MANIFEST_REFRESH_MS + 1;
		expect(await geo.countries()).toHaveLength(2);
		expect(loadManifest).toHaveBeenCalledTimes(2);
		await geo.manifest();
		expect(loadManifest).toHaveBeenCalledTimes(2);
		now += 60_001;
		expect(await geo.manifest()).toBe(original.manifest);
		expect(await geo.manifest()).toBe(original.manifest);
		expect(loadManifest).toHaveBeenCalledTimes(3);
		refreshed.resolve(original.manifest);
		await geo.manifest();
		await geo.countries();
		expect(read).toHaveBeenCalledTimes(1);
		now += GEO_MANIFEST_REFRESH_MS + 1;
		await geo.manifest();
		expect(await geo.countries()).toMatchObject([{ code: 'GB' }]);
		expect(read).toHaveBeenCalledTimes(2);
	});

	it('handles incomplete datasets and rejects malformed lookups before reading slices', async () => {
		const { dir, manifest } = fixture(true, { 'subdivisions/GB.json': null });
		const geo = new ManifestGeoDataAdapter({ manifest, read: folderGeoReader(dir) });
		await expect(geo.country('gbr')).resolves.toBeNull();
		await expect(geo.country('GB')).resolves.toMatchObject({ subdivisions: [] });
		await expect(geo.pin('700')).resolves.toMatchObject({ found: false });
		await expect(geo.isValidMobile('IN', '9830012345')).resolves.toBe(false);
		await expect(geo.isValidMobile('91', 'abc')).resolves.toBe(false);
		await expect(geo.mobileLengths('999')).resolves.toBeNull();
		const empty = new ManifestGeoDataAdapter({ manifest: { ...manifest, files: {} }, read: folderGeoReader(dir) });
		await expect(empty.countries()).resolves.toEqual([]);
	});

	it('sorts and deduplicates multiple lengths for a shared calling code', async () => {
		const { dir, manifest } = fixture(true, {
			'countries.json': [
				{ ...COUNTRIES[0], mobileLengths: [10, 8] },
				{ ...COUNTRIES[1], callingCode: '91' },
			],
		});
		const geo = new ManifestGeoDataAdapter({ manifest, read: folderGeoReader(dir) });
		await expect(geo.mobileLengths('91')).resolves.toEqual([8, 10]);
	});

	it('wraps a failed data read, then serves the same file once it becomes available', async () => {
		const { dir, manifest } = fixture();
		const read = vi
			.fn(folderGeoReader(dir))
			.mockRejectedValueOnce('store disconnected')
			.mockRejectedValueOnce(new Error('file closed'));
		const geo = new ManifestGeoDataAdapter({ manifest, read });
		await expect(geo.countries()).rejects.toThrow('countries.json is unavailable: not readable');
		await expect(geo.countries()).rejects.toThrow('countries.json is unavailable: file closed');
		await expect(geo.countries()).resolves.toHaveLength(2);
	});
});

describe('the index from Spaces, re-read every few hours', () => {
	it('loads it on first use, swaps to a new version later, and keeps the old one when a re-read fails', async () => {
		const first = fixture();
		const second = fixture();
		second.manifest.version = 'second';
		let clock = 0;
		let fail = false;
		const loadManifest = vi.fn(async () => {
			if (fail) throw new Error('Spaces down');
			return loadManifest.mock.calls.length === 1 ? first.manifest : second.manifest;
		});
		const geo = new ManifestGeoDataAdapter({ read: folderGeoReader(first.dir), loadManifest, now: () => clock });
		expect((await geo.manifest()).version).toBe('test');
		clock = 7 * 60 * 60 * 1000;
		await geo.manifest();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect((await geo.manifest()).version).toBe('second');
		fail = true;
		clock = 14 * 60 * 60 * 1000;
		await geo.manifest();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect((await geo.manifest()).version).toBe('second');
	});

	it('says the data is unavailable when there is no index yet, and tries again next time', async () => {
		const { dir, manifest } = fixture();
		let calls = 0;
		const geo = new ManifestGeoDataAdapter({
			read: folderGeoReader(dir),
			loadManifest: async () => {
				calls += 1;
				if (calls === 1) throw new Error('NoSuchKey');
				return manifest;
			},
		});
		await expect(geo.countries()).rejects.toBeInstanceOf(GeoDataUnavailableError);
		expect((await geo.countries()).length).toBe(2);
	});
});
