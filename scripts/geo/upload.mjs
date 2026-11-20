#!/usr/bin/env node
/**
 * Stores the geo data files named in packages/adapters-geo/data/manifest.json in one environment's
 * Spaces bucket, as `geo/<sha256>.json` (owner, 2026-11-20: "move all that data to spaces").
 *
 * - Files already in the bucket are left alone (each key is its own content hash, so it never changes).
 * - Missing files are read from the local working folder that scripts/geo/build.mjs wrote (`.geo-data/`,
 *   or GEO_DATA_DIR), checked against the manifest's hash, and stored private (the API reads them with
 *   the bucket's own key; browsers never fetch them).
 * - `--check` only reports what is missing and exits 1 if anything is, uploading nothing (for a deploy
 *   or the monthly job to confirm an environment has the data its manifest names).
 *
 * Credentials come from the environment, the same names the API uses: SPACES_KEY, SPACES_SECRET,
 * SPACES_BUCKET, SPACES_REGION (default sgp1), SPACES_ENDPOINT (default https://<region>.digitaloceanspaces.com).
 * Nothing secret is printed. Run for one environment at a time, for example:
 *   node --env-file=apps/api/.env scripts/geo/upload.mjs
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..', '..');
const MANIFEST = join(ROOT, 'packages/adapters-geo/data/manifest.json');
const WORK = process.env.GEO_DATA_DIR ? resolve(process.env.GEO_DATA_DIR) : join(ROOT, '.geo-data');
// The S3 client the Spaces storage adapter already depends on (one pinned version in the repo).
const require = createRequire(join(ROOT, 'packages/adapters-storage-spaces/package.json'));
const { HeadObjectCommand, PutObjectCommand, S3Client } = require('@aws-sdk/client-s3');

const keyOf = (entry) => `geo/${entry.sha256}.json`;

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

async function exists(s3, bucket, key) {
	try {
		await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
		return true;
	} catch (error) {
		const status = error?.$metadata?.httpStatusCode;
		if (status === 404 || error?.name === 'NotFound') return false;
		throw new Error(`Spaces did not answer for ${key} (${status ?? error?.name ?? 'unknown'})`);
	}
}

export async function upload({ check = false } = {}) {
	if (!existsSync(MANIFEST)) throw new Error('No manifest: run scripts/geo/build.mjs first');
	const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
	const { s3, bucket } = client();
	const entries = Object.entries(manifest.files);
	let present = 0;
	let uploaded = 0;
	const missing = [];
	// A few at a time: about 700 small files, well inside Spaces' request limits.
	for (let index = 0; index < entries.length; index += 8) {
		await Promise.all(
			entries.slice(index, index + 8).map(async ([path, entry]) => {
				const key = keyOf(entry);
				if (await exists(s3, bucket, key)) {
					present += 1;
					return;
				}
				if (check) {
					missing.push(path);
					return;
				}
				const local = join(WORK, path);
				if (!existsSync(local)) {
					missing.push(`${path} (not in ${WORK} either)`);
					return;
				}
				const body = readFileSync(local);
				if (createHash('sha256').update(body).digest('hex') !== entry.sha256) {
					throw new Error(`${path} in ${WORK} does not match the manifest; run scripts/geo/build.mjs again`);
				}
				await s3.send(
					new PutObjectCommand({
						Bucket: bucket,
						Key: key,
						Body: body,
						ContentType: 'application/json',
						ACL: 'private',
						CacheControl: 'private, max-age=31536000, immutable',
					}),
				);
				uploaded += 1;
			}),
		);
	}
	console.log(
		`manifest ${manifest.version}: ${entries.length} files, ${present} already in ${bucket}, ${uploaded} uploaded, ${missing.length} missing`,
	);
	if (missing.length) {
		console.error(`missing: ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? ' …' : ''}`);
		process.exitCode = 1;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	upload({ check: process.argv.includes('--check') }).catch((error) => {
		console.error(`geo upload failed: ${error.message}`);
		process.exitCode = 1;
	});
}
