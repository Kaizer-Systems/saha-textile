#!/usr/bin/env node
/**
 * Builds the repository's country, State and phone data file (owner decisions `DEC-ADDRESS` and
 * `DEC-GEO-REFRESH`, 2026-11-20) into `packages/adapters-geo/data/`.
 *
 * Sources, pinned (change a pin by hand, in a reviewed pull request):
 * - Phone codes and mobile lengths: libphonenumber-js, the version in packages/adapters-geo/package.json
 *   (MIT licence).
 * - States and regions: dr5hn countries-states-cities-database, release DR5HN_TAG (ODbL licence; the
 *   credit line is in the developer portal). Cities are dropped.
 * - India's States: matched by name to our GST State list (packages/contracts/src/gst.ts), which adds
 *   each State's GST code.
 * - PIN codes: India Post's all-India PIN code directory on data.gov.in (Government Open Data Licence),
 *   read through its API with DATA_GOV_IN_API_KEY. Without the key this step is skipped quietly and
 *   the existing PIN file (if any) is kept.
 *
 * Output files are sorted so that a refresh with no change in the sources writes identical bytes; the
 * monthly GitHub Actions job (.github/workflows/geo-refresh.yml) opens a pull request only when they
 * differ. Run locally:  node scripts/geo/build.mjs   (add DATA_GOV_IN_API_KEY=… for the PIN step).
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..', '..');
const GEO_PACKAGE = join(ROOT, 'packages/adapters-geo');
const OUT = join(GEO_PACKAGE, 'data');

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

function writeIfChanged(path, text) {
	const before = existsSync(path) ? readFileSync(path, 'utf8') : null;
	if (before === text) return false;
	writeFileSync(path, text);
	return true;
}

async function fetchJson(url, init) {
	const response = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
	if (!response.ok) throw new Error(`${url.split('?')[0]} answered HTTP ${response.status}`);
	return response.json();
}

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

/** PIN → city, district, State (data.gov.in, paged). Null without the key. */
async function buildPins(indiaSubdivisions) {
	const key = process.env.DATA_GOV_IN_API_KEY?.trim();
	if (!key) return null;
	const byName = new Map(indiaSubdivisions.map((row) => [normaliseName(row.name), row]));
	const pins = {};
	const limit = 1000;
	for (let offset = 0; ; offset += limit) {
		const url = `${PIN_API_URL}?api-key=${encodeURIComponent(key)}&format=json&limit=${limit}&offset=${offset}`;
		const page = await fetchJson(url);
		const records = Array.isArray(page.records) ? page.records : [];
		for (const record of records) {
			const pin = String(record.pincode ?? '').trim();
			if (!/^\d{6}$/.test(pin) || pins[pin]) continue;
			const state = byName.get(normaliseName(String(record.statename ?? '')));
			pins[pin] = {
				city: String(record.divisionname ?? record.district ?? '').trim() || null,
				district: String(record.district ?? '').trim() || null,
				subdivisionCode: state?.code ?? null,
				gstStateCode: state?.gstStateCode ?? null,
			};
		}
		if (records.length < limit) break;
	}
	return Object.fromEntries(Object.entries(pins).sort(([a], [b]) => a.localeCompare(b)));
}

async function main() {
	mkdirSync(join(OUT, 'subdivisions'), { recursive: true });
	const { countries, subdivisionFiles, unmatchedIndia } = await buildCountriesAndStates();
	const changed = [];
	if (writeIfChanged(join(OUT, 'countries.json'), stableJson(countries))) changed.push('countries.json');
	const keep = new Set([...subdivisionFiles.keys()].map((code) => `${code}.json`));
	for (const file of readdirSync(join(OUT, 'subdivisions'))) {
		if (!keep.has(file)) {
			rmSync(join(OUT, 'subdivisions', file));
			changed.push(`subdivisions/${file} (gone)`);
		}
	}
	for (const [code, rows] of subdivisionFiles) {
		if (writeIfChanged(join(OUT, 'subdivisions', `${code}.json`), stableJson(rows)))
			changed.push(`subdivisions/${code}.json`);
	}
	const pins = await buildPins(subdivisionFiles.get('IN') ?? []);
	if (pins) {
		if (writeIfChanged(join(OUT, 'india-pins.json'), `${JSON.stringify(pins)}\n`)) changed.push('india-pins.json');
	} else {
		console.log('PIN step skipped: DATA_GOV_IN_API_KEY is not set (the existing PIN file, if any, is kept).');
	}
	const sources = {
		libphonenumber: JSON.parse(readFileSync(require.resolve('libphonenumber-js/package.json'), 'utf8')).version,
		dr5hn: { tag: DR5HN_TAG, commit: DR5HN_COMMIT },
		pins: pins ? { resource: PIN_RESOURCE_ID, count: Object.keys(pins).length } : null,
	};
	if (unmatchedIndia.length) console.warn(`India: no GST code matched for ${unmatchedIndia.join(', ')}`);
	console.log(`countries: ${countries.length}, with subdivisions: ${subdivisionFiles.size}`);
	console.log(changed.length ? `changed: ${changed.join(', ')}` : 'no change');
	console.log(`sources: ${JSON.stringify(sources)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error(`geo build failed: ${error.message}`);
		process.exitCode = 1;
	});
}
