#!/usr/bin/env node
/**
 * Builds the country, State, phone and PIN data (owner decisions `DEC-ADDRESS` and `DEC-GEO-REFRESH`,
 * 2026-11-20; "move all that data to spaces", 2026-11-20).
 *
 * Sources, pinned (change a pin by hand, in a reviewed pull request):
 * - Phone codes and mobile lengths: libphonenumber-js, the version in packages/adapters-geo/package.json
 *   (MIT licence).
 * - States and regions: dr5hn countries-states-cities-database, release DR5HN_TAG (ODbL licence; the
 *   credit line is in the developer portal). Cities are dropped.
 * - India's States: matched by name to our GST State list (packages/contracts/src/gst.ts), which adds
 *   each State's GST code.
 * - PIN codes: India Post's all-India PIN code directory on data.gov.in (Government Open Data Licence),
 *   read through its API with DATA_GOV_IN_API_KEY. Without the key this step is skipped and the PIN
 *   files already named in the manifest are kept as they are.
 *
 * Output: small files in a local working folder (`.geo-data/`, not committed; GEO_DATA_DIR overrides it):
 * `countries.json`, `subdivisions/<CC>.json`, `pins/<first 3 digits>.json`, and `manifest.json`, the
 * index naming each file's SHA-256. `scripts/geo/upload.mjs` stores each file in Spaces as
 * `geo/<sha256>.json` and publishes the index as `geo/manifest.json` (owner, 2026-11-20: published
 * directly, no pull request). The previous index (`.geo-previous-manifest.json`, or GEO_PREVIOUS_MANIFEST;
 * `upload.mjs --pull-previous` fetches it) tells this build what changed and which PIN files to keep when
 * the PIN step is skipped. Files are sorted, so the same sources give the same index version.
 * Run locally:  node scripts/geo/build.mjs   (add DATA_GOV_IN_API_KEY=… for the PIN step).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..', '..');
const GEO_PACKAGE = join(ROOT, 'packages/adapters-geo');
/** The local working folder the files are written to (uploaded from by scripts/geo/upload.mjs). */
export const WORK = process.env.GEO_DATA_DIR ? resolve(process.env.GEO_DATA_DIR) : join(ROOT, '.geo-data');
/** The index of the files last published, the starting point for this build. */
export const PREVIOUS = process.env.GEO_PREVIOUS_MANIFEST
	? resolve(process.env.GEO_PREVIOUS_MANIFEST)
	: join(ROOT, '.geo-previous-manifest.json');

export const DR5HN_TAG = 'v5.2.0-export.1';
export const DR5HN_COMMIT = '9b255c45fc53e02a8dff547d88558d4fe91784d5';
export const DR5HN_URL = `https://raw.githubusercontent.com/dr5hn/countries-states-cities-database/${DR5HN_COMMIT}/json/states.json`;
/** data.gov.in resource: "All India Pincode Directory" (India Post). */
export const PIN_RESOURCE_ID = '5c2f62fe-5afa-4119-a499-fec9d604d5bd';
export const PIN_API_URL = `https://api.data.gov.in/resource/${PIN_RESOURCE_ID}`;

const require = createRequire(join(GEO_PACKAGE, 'package.json'));

/** What each country calls its subdivision and postal code, and the postal code's shape. */
const POSTAL = {
	IN: { label: 'pin', pattern: '\\d{6}', required: true, sub: 'state' },
	US: { label: 'zip', pattern: '\\d{5}(-\\d{4})?', required: true, sub: 'state' },
	GB: { label: 'postcode', pattern: '[A-Z]{1,2}\\d[A-Z\\d]? ?\\d[A-Z]{2}', required: true, sub: 'county' },
	CA: { label: 'postal', pattern: '[A-Z]\\d[A-Z] ?\\d[A-Z]\\d', required: true, sub: 'province' },
	AU: { label: 'postcode', pattern: '\\d{4}', required: true, sub: 'state' },
	NZ: { label: 'postcode', pattern: '\\d{4}', required: true, sub: 'region' },
	SG: { label: 'postal', pattern: '\\d{6}', required: true, sub: 'none' },
	AE: { label: 'none', pattern: null, required: false, sub: 'emirate' },
	HK: { label: 'none', pattern: null, required: false, sub: 'district' },
	QA: { label: 'none', pattern: null, required: false, sub: 'none' },
	JP: { label: 'postal', pattern: '\\d{3}-?\\d{4}', required: true, sub: 'prefecture' },
	DE: { label: 'postal', pattern: '\\d{5}', required: true, sub: 'state' },
	FR: { label: 'postal', pattern: '\\d{5}', required: true, sub: 'region' },
	NP: { label: 'postal', pattern: '\\d{5}', required: false, sub: 'province' },
	BD: { label: 'postal', pattern: '\\d{4}', required: false, sub: 'district' },
	LK: { label: 'postal', pattern: '\\d{5}', required: false, sub: 'province' },
};
const NO_SUBDIVISION_FORMS = new Set(['SG', 'QA', 'MC', 'VA', 'SM', 'LI', 'BH', 'KW']);

const normaliseName = (name) =>
	name
		.toLowerCase()
		.replace(/&/g, 'and')
		.replace(/[^a-z]/g, '');

function gstStates() {
	const source = readFileSync(join(ROOT, 'packages/contracts/src/gst.ts'), 'utf8');
	return [...source.matchAll(/\{ code: '(\d{2})', name: '([^']+)'( , retired: true|, retired: true)? \}/g)]
		.filter((match) => !match[3])
		.map((match) => ({ code: match[1], name: match[2] }));
}

function stableJson(value) {
	return `${JSON.stringify(value, null, '\t')}\n`;
}

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

export function readManifest(path = PREVIOUS) {
	return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

/** PIN rows (PIN → city, district, State) split into one file per first three digits. */
export function pinSlices(pins) {
	const slices = new Map();
	for (const [pin, row] of Object.entries(pins)) {
		const key = pin.slice(0, 3);
		if (!slices.has(key)) slices.set(key, {});
		slices.get(key)[pin] = row;
	}
	return new Map([...slices].sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Writes the files into `work` and returns the manifest. `pins` null keeps the previous manifest's PIN
 * files (already in Spaces) without rebuilding them.
 */
export function writeGeoOutput({ countries, subdivisionFiles, pins, sources, previous, work = WORK }) {
	rmSync(work, { recursive: true, force: true });
	const files = new Map();
	const add = (path, text) => {
		mkdirSync(dirname(join(work, path)), { recursive: true });
		writeFileSync(join(work, path), text);
		files.set(path, { sha256: sha256(text), bytes: Buffer.byteLength(text) });
	};
	add('countries.json', stableJson(countries));
	for (const [code, rows] of [...subdivisionFiles].sort(([a], [b]) => a.localeCompare(b)))
		add(`subdivisions/${code}.json`, stableJson(rows));
	let pinCount = 0;
	if (pins) {
		for (const [key, rows] of pinSlices(pins)) add(`pins/${key}.json`, `${JSON.stringify(rows)}\n`);
		pinCount = Object.keys(pins).length;
	} else if (previous) {
		for (const [path, entry] of Object.entries(previous.files)) if (path.startsWith('pins/')) files.set(path, entry);
		pinCount = previous.counts?.pins ?? 0;
	}
	const sorted = Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b)));
	return {
		schema: 1,
		version: sha256(JSON.stringify(sorted)).slice(0, 16),
		counts: { countries: countries.length, withSubdivisions: subdivisionFiles.size, pins: pinCount },
		sources,
		files: sorted,
	};
}

/** What changed between two manifests, by file path. */
export function manifestChanges(before, after) {
	const was = before?.files ?? {};
	const now = after.files;
	const changed = [];
	for (const path of Object.keys(now)) if (was[path]?.sha256 !== now[path].sha256) changed.push(was[path] ? path : `${path} (new)`);
	for (const path of Object.keys(was)) if (!now[path]) changed.push(`${path} (gone)`);
	return changed;
}

/** Never echoes a secret: the query string is dropped, and `secret` is cut out of the answer's text. */
async function fetchJson(url, { secret = null, ...init } = {}) {
	const response = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
	if (!response.ok) {
		let said = (await response.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 300);
		if (secret) said = said.split(secret).join('<key>');
		throw new Error(`${url.split('?')[0]} answered HTTP ${response.status}${said ? `: ${said}` : ''}`);
	}
	return response.json();
}

/** `SOUTH 24 PARGANAS` → `South 24 Parganas`. */
const titleCase = (text) =>
	text
		.toLowerCase()
		.replace(/(^|[\s(\-/])([a-z])/g, (_, before, letter) => `${before}${letter.toUpperCase()}`)
		.trim();

export function mobileLengthsFor(metadata, country) {
	try {
		metadata.selectNumberingPlan(country);
		const mobile = metadata.numberingPlan.type('MOBILE');
		const lengths = mobile?.possibleLengths?.() ?? metadata.numberingPlan.possibleLengths?.() ?? [];
		return [...new Set(lengths)].sort((a, b) => a - b);
	} catch {
		return [];
	}
}

async function buildCountriesAndStates() {
	const { getCountries, getCountryCallingCode } = require('libphonenumber-js/max');
	const { Metadata } = require('libphonenumber-js/core');
	const metadata = new Metadata(require('libphonenumber-js/metadata.max.json'));
	const names = new Intl.DisplayNames(['en'], { type: 'region' });
	const dr5hn = await fetchJson(DR5HN_URL);
	// Top-level subdivisions (States, provinces, regions); for the UK its counties, the level below the
	// four nations (brief shop16: "County with only UK counties"). Cities are dropped.
	const SECOND_LEVEL = new Set(['GB']);
	const byIso = new Map();
	for (const state of dr5hn) {
		const topLevel = state.parent_id === null || state.parent_id === undefined;
		if (SECOND_LEVEL.has(state.country_code) ? topLevel : !topLevel) continue;
		const list = byIso.get(state.country_code) ?? [];
		list.push({ name: state.name, state_code: state.iso2, type: state.type ?? '' });
		byIso.set(state.country_code, list);
	}
	const gst = gstStates();
	const gstByName = new Map(gst.map((state) => [normaliseName(state.name), state.code]));
	const unmatchedIndia = [];

	const countries = [];
	const subdivisionFiles = new Map();
	for (const code of getCountries().sort()) {
		const name = names.of(code);
		if (!name || name === code) continue;
		const postal = POSTAL[code] ?? { label: 'postal', pattern: null, required: false, sub: 'region' };
		const states = NO_SUBDIVISION_FORMS.has(code) ? [] : (byIso.get(code) ?? []);
		const subdivisions = states
			.filter((state) => state.state_code && state.name)
			.map((state) => {
				let gstStateCode = null;
				if (code === 'IN') {
					gstStateCode = gstByName.get(normaliseName(state.name)) ?? null;
					if (!gstStateCode) unmatchedIndia.push(state.name);
				}
				return { code: String(state.state_code), name: state.name, gstStateCode };
			})
			.filter((row, index, all) => all.findIndex((other) => other.code === row.code) === index)
			.sort((a, b) => a.name.localeCompare(b.name, 'en'));
		countries.push({
			code,
			name,
			callingCode: String(getCountryCallingCode(code)),
			subdivisionLabel: subdivisions.length ? (postal.sub === 'none' ? 'region' : postal.sub) : 'none',
			postalCodeLabel: postal.label,
			postalCodeRequired: postal.required,
			postalCodePattern: postal.pattern,
			mobileLengths: mobileLengthsFor(metadata, code),
			hasSubdivisions: subdivisions.length > 0,
		});
		if (subdivisions.length) subdivisionFiles.set(code, subdivisions);
	}
	return { countries, subdivisionFiles, unmatchedIndia };
}

/** data.gov.in refuses bursts (HTTP 429): one page every PIN_PAGE_PAUSE_MS, and a few spaced retries. */
const PIN_PAGE_PAUSE_MS = 1_500;
const PIN_RETRY_WAITS_MS = [15_000, 30_000, 60_000, 120_000];
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

async function politeFetchJson(url, key) {
	await pause(PIN_PAGE_PAUSE_MS);
	for (let attempt = 0; ; attempt += 1) {
		try {
			return await fetchJson(url, { secret: key });
		} catch (error) {
			const busy = / answered HTTP (429|5\d\d)/.test(error.message);
			if (!busy || attempt >= PIN_RETRY_WAITS_MS.length) throw error;
			console.log(
				`PIN directory: ${error.message.split(': ')[0]}; waiting ${PIN_RETRY_WAITS_MS[attempt] / 1000} s`,
			);
			await pause(PIN_RETRY_WAITS_MS[attempt]);
		}
	}
}

/** India Post writes "NA" where it has no value. */
const known = (value) => {
	const text = String(value ?? '').trim();
	return /^(n\.?a\.?|null|-)$/i.test(text) ? '' : text;
};

/** PIN → city, district, State (data.gov.in, paged). Null without the key. */
async function buildPins(indiaSubdivisions) {
	const key = process.env.DATA_GOV_IN_API_KEY?.trim();
	if (!key) return null;
	const byName = new Map(indiaSubdivisions.map((row) => [normaliseName(row.name), row]));
	const pins = {};
	const unmatchedStates = new Set();
	const limit = 1000;
	for (let offset = 0; ; offset += limit) {
		const url = `${PIN_API_URL}?api-key=${encodeURIComponent(key)}&format=json&limit=${limit}&offset=${offset}`;
		const page = await politeFetchJson(url, key);
		if (offset && offset % 20_000 === 0) console.log(`PIN directory: ${offset} of ${page.total ?? '?'} rows read`);
		const records = Array.isArray(page.records) ? page.records : [];
		for (const record of records) {
			const pin = String(record.pincode ?? '').trim();
			if (!/^\d{6}$/.test(pin)) continue;
			// A PIN serves several post offices: the first that names a State and district wins.
			if (pins[pin]?.subdivisionCode && pins[pin]?.district) continue;
			const stateName = known(record.statename).replace(/^the\s+/i, '');
			const state = byName.get(normaliseName(stateName));
			if (!state && stateName) unmatchedStates.add(stateName);
			// India Post names a postal division ("Kolkata North Division"), not a city; the district
			// is what a buyer writes as the city ("Kolkata", "South 24 Parganas").
			const district = titleCase(known(record.district));
			// Fill only what the earlier post offices of this PIN left empty.
			const before = pins[pin];
			const place = before?.district || district || null;
			pins[pin] = {
				city: place,
				district: place,
				subdivisionCode: before?.subdivisionCode ?? state?.code ?? null,
				gstStateCode: before?.subdivisionCode ? before.gstStateCode : (state?.gstStateCode ?? null),
			};
		}
		if (records.length < limit) break;
	}
	if (unmatchedStates.size) console.warn(`PIN directory: no State matched for ${[...unmatchedStates].join(', ')}`);
	return Object.fromEntries(Object.entries(pins).sort(([a], [b]) => a.localeCompare(b)));
}

async function main() {
	const previous = readManifest();
	const { countries, subdivisionFiles, unmatchedIndia } = await buildCountriesAndStates();
	const pins = await buildPins(subdivisionFiles.get('IN') ?? []);
	if (!pins) console.log('PIN step skipped: DATA_GOV_IN_API_KEY is not set (the PIN files in the manifest are kept).');
	const sources = {
		libphonenumber: JSON.parse(readFileSync(require.resolve('libphonenumber-js/package.json'), 'utf8')).version,
		dr5hn: { tag: DR5HN_TAG, commit: DR5HN_COMMIT },
		pins: pins ? { resource: PIN_RESOURCE_ID } : (previous?.sources?.pins ?? null),
	};
	const manifest = writeGeoOutput({ countries, subdivisionFiles, pins, sources, previous });
	const changed = manifestChanges(previous, manifest);
	writeFileSync(join(WORK, 'manifest.json'), stableJson(manifest));
	if (unmatchedIndia.length) console.warn(`India: no GST code matched for ${unmatchedIndia.join(', ')}`);
	console.log(`countries: ${manifest.counts.countries}, with subdivisions: ${manifest.counts.withSubdivisions}, PINs: ${manifest.counts.pins}`);
	console.log(changed.length ? `changed (${changed.length}): ${changed.slice(0, 20).join(', ')}${changed.length > 20 ? ' …' : ''}` : 'no change');
	if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `changed=${changed.length ? 'true' : 'false'}\n`, { flag: 'a' });
	console.log(`files in ${WORK}; manifest version ${manifest.version}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error(`geo build failed: ${error.message}`);
		process.exitCode = 1;
	});
}
