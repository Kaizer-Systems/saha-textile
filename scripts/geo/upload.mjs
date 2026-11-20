#!/usr/bin/env node
/**
 * Publishes the country, State, phone and PIN data to one environment's Spaces bucket (owner, 2026-11-20:
 * "move all that data to spaces", published directly with no pull request).
 *
 *   node --env-file=<env file> scripts/geo/upload.mjs                  upload, check, publish
 *   node --env-file=<env file> scripts/geo/upload.mjs --pull-previous  save the bucket's current index locally
 *   node --env-file=<env file> scripts/geo/upload.mjs --check          does the bucket have every file its index names?
 *   node --env-file=<env file> scripts/geo/upload.mjs --rollback <v>   make an earlier published index current again
 *
 * Publishing: every file in the local index (`.geo-data/manifest.json`, from scripts/geo/build.mjs) that the
 * bucket lacks is uploaded as `geo/<sha256>.json` (each key is its own content hash, so it never changes);
 * then the safety checks run against the bucket's current index; only if they pass is the new index stored
 * as `geo/manifests/<version>.json` and made current as `geo/manifest.json`. The API re-reads the current
 * index every few hours, so new data goes live with no code change or release. Every object is private: only
 * the API reads it, with the bucket's own key.
 *
 * Credentials: SPACES_KEY, SPACES_SECRET, SPACES_BUCKET, SPACES_REGION (default sgp1), SPACES_ENDPOINT
 * (default https://<region>.digitaloceanspaces.com), the names the API uses. Nothing secret is printed.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..', '..');
const WORK = process.env.GEO_DATA_DIR ? resolve(process.env.GEO_DATA_DIR) : join(ROOT, '.geo-data');
const PREVIOUS = process.env.GEO_PREVIOUS_MANIFEST
	? resolve(process.env.GEO_PREVIOUS_MANIFEST)
	: join(ROOT, '.geo-previous-manifest.json');
const CURRENT_KEY = 'geo/manifest.json';
const historyKey = (version) => `geo/manifests/${version}.json`;
const keyOf = (entry) => `geo/${entry.sha256}.json`;
// The S3 client the Spaces storage adapter already depends on (one pinned version in the repo).
const require = createRequire(join(ROOT, 'packages/adapters-storage-spaces/package.json'));
const { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } = require('@aws-sdk/client-s3');

function client() {
	const { SPACES_KEY, SPACES_SECRET, SPACES_BUCKET } = process.env;
	if (!SPACES_KEY || !SPACES_SECRET || !SPACES_BUCKET) {
		throw new Error('SPACES_KEY, SPACES_SECRET and SPACES_BUCKET are needed (one environment at a time)');
	}
	const region = process.env.SPACES_REGION || 'sgp1';
	return {
		bucket: SPACES_BUCKET,
		s3: new S3Client({
			region,
			endpoint: process.env.SPACES_ENDPOINT || `https://${region}.digitaloceanspaces.com`,
			forcePathStyle: false,
			credentials: { accessKeyId: SPACES_KEY, secretAccessKey: SPACES_SECRET },
		}),
	};
}

const notFound = (error) => error?.$metadata?.httpStatusCode === 404 || ['NotFound', 'NoSuchKey'].includes(error?.name);

async function exists(s3, bucket, key) {
	try {
		await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
		return true;
	} catch (error) {
		if (notFound(error)) return false;
		throw new Error(`Spaces did not answer for ${key} (${error?.$metadata?.httpStatusCode ?? error?.name ?? 'unknown'})`);
	}
}

async function getJson(s3, bucket, key) {
	try {
		const answer = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
		return JSON.parse(await answer.Body.transformToString('utf8'));
	} catch (error) {
		if (notFound(error)) return null;
		throw new Error(`Spaces did not answer for ${key} (${error?.$metadata?.httpStatusCode ?? error?.name ?? 'unknown'})`);
	}
}

async function put(s3, bucket, key, body) {
	await s3.send(
		new PutObjectCommand({
			Bucket: bucket,
			Key: key,
			Body: body,
			ContentType: 'application/json',
			ACL: 'private',
			// Data files never change; the current index does, so it is never cached.
			CacheControl: key === CURRENT_KEY ? 'no-store' : 'private, max-age=31536000, immutable',
		}),
	);
}

/**
 * Refuses to publish data that looks broken against what is live now: far fewer countries or PIN codes,
 * or India's States without their GST codes. Returns the reasons; empty when the data may go live.
 */
export function publishProblems(next, current, india) {
	const problems = [];
	if (next.counts.countries < 200) problems.push(`only ${next.counts.countries} countries`);
	if (current && next.counts.countries < current.counts.countries * 0.95)
		problems.push(`countries fell from ${current.counts.countries} to ${next.counts.countries}`);
	if (!india || india.length < 30) problems.push(`India has ${india?.length ?? 0} States and Union Territories`);
	else if (india.some((row) => !/^\d{2}$/.test(row.gstStateCode ?? ''))) problems.push('an Indian State lost its GST code');
	if (current?.counts.pins && next.counts.pins < current.counts.pins * 0.9)
		problems.push(`PIN codes fell from ${current.counts.pins} to ${next.counts.pins}`);
	return problems;
}

async function publish() {
	const manifestPath = join(WORK, 'manifest.json');
	if (!existsSync(manifestPath)) throw new Error(`No ${manifestPath}: run scripts/geo/build.mjs first`);
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	const { s3, bucket } = client();
	const current = await getJson(s3, bucket, CURRENT_KEY);
	if (current?.version === manifest.version) {
		console.log(`${bucket}: index ${manifest.version} is already current; nothing to publish`);
		return;
	}
	const entries = Object.entries(manifest.files);
	let present = 0;
	let uploaded = 0;
	const missing = [];
	// A few at a time: about 700 small files, well inside Spaces' request limits.
	for (let index = 0; index < entries.length; index += 8) {
		await Promise.all(
			entries.slice(index, index + 8).map(async ([path, entry]) => {
				if (await exists(s3, bucket, keyOf(entry))) {
					present += 1;
					return;
				}
				const local = join(WORK, path);
				if (!existsSync(local)) {
					missing.push(path);
					return;
				}
				const body = readFileSync(local);
				if (createHash('sha256').update(body).digest('hex') !== entry.sha256) {
					throw new Error(`${path} in ${WORK} does not match the index; run scripts/geo/build.mjs again`);
				}
				await put(s3, bucket, keyOf(entry), body);
				uploaded += 1;
			}),
		);
	}
	console.log(`${bucket}: ${entries.length} files, ${present} already there, ${uploaded} uploaded, ${missing.length} missing`);
	if (missing.length) throw new Error(`not published: missing ${missing.slice(0, 10).join(', ')}`);
	const indiaPath = join(WORK, 'subdivisions/IN.json');
	const india = existsSync(indiaPath) ? JSON.parse(readFileSync(indiaPath, 'utf8')) : null;
	const problems = publishProblems(manifest, current, india);
	if (problems.length) throw new Error(`not published, the data looks wrong: ${problems.join('; ')}`);
	const text = `${JSON.stringify(manifest, null, '\t')}\n`;
	await put(s3, bucket, historyKey(manifest.version), text);
	await put(s3, bucket, CURRENT_KEY, text);
	console.log(`${bucket}: index ${manifest.version} published (was ${current?.version ?? 'none'}); the API picks it up within a few hours`);
}

async function pullPrevious() {
	const { s3, bucket } = client();
	const current = await getJson(s3, bucket, CURRENT_KEY);
	if (!current) {
		console.log(`${bucket}: no index published yet`);
		return;
	}
	writeFileSync(PREVIOUS, `${JSON.stringify(current, null, '\t')}\n`);
	console.log(`${bucket}: current index ${current.version} saved to ${PREVIOUS}`);
}

async function check() {
	const { s3, bucket } = client();
	const current = await getJson(s3, bucket, CURRENT_KEY);
	if (!current) throw new Error(`${bucket}: no index published yet`);
	const missing = [];
	for (const [path, entry] of Object.entries(current.files)) {
		if (!(await exists(s3, bucket, keyOf(entry)))) missing.push(path);
	}
	console.log(`${bucket}: index ${current.version}, ${Object.keys(current.files).length} files, ${missing.length} missing`);
	if (missing.length) throw new Error(`missing: ${missing.slice(0, 10).join(', ')}`);
}

async function rollback(version) {
	if (!/^[0-9a-f]{16}$/.test(version ?? '')) throw new Error('give the 16-character index version to go back to');
	const { s3, bucket } = client();
	const earlier = await getJson(s3, bucket, historyKey(version));
	if (!earlier) throw new Error(`${bucket}: no published index ${version}`);
	await put(s3, bucket, CURRENT_KEY, `${JSON.stringify(earlier, null, '\t')}\n`);
	console.log(`${bucket}: index ${version} is current again; the API picks it up within a few hours`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const args = process.argv.slice(2);
	const run = args.includes('--pull-previous')
		? pullPrevious()
		: args.includes('--check')
			? check()
			: args.includes('--rollback')
				? rollback(args[args.indexOf('--rollback') + 1])
				: publish();
	run.catch((error) => {
		console.error(`geo upload failed: ${error.message}`);
		process.exitCode = 1;
	});
}
