/**
 * Stage 4 of `pnpm pipeline:local` (plan step 6, owner decision L2 = A+): a full release folder made
 * from the dev project's REAL values, laid out exactly like a droplet's, so `deploy.sh --check-only`
 * can refuse a blank, missing or disagreeing value on this Mac before any staging deploy.
 *
 * The release describes the full local stack, where stage 5 runs these images: the stack's hosts and
 * HTTPS port, its services, and the proxy header it forwards (CLIENT_IP_HEADER, which stays blank in
 * the dev project because nothing sits in front of `pnpm dev`). The CDN, Spaces and payment hosts
 * are read from the matching `/api` addresses. Anything filled in the dev project's `/deployment`
 * folder must agree with these, or the release is refused.
 *
 * Folders are kept in the gitignored `.local-release/releases/`, the newest three, as on a droplet.
 * Nothing here prints a value.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { ROOT, SecretsError } from './inventory.mjs';
import { buildRelease, writeFiles } from './render.mjs';
import {
	ADMIN_HOST,
	API_HOST,
	STOREFRONT_HOST,
	stackAddresses,
	stackApiSettings,
	stackServiceSecrets,
} from './stack.mjs';

export const LOCAL_RELEASE_DIR = '.local-release';
export const RELEASES_DIR = `${LOCAL_RELEASE_DIR}/releases`;
export const IMAGES_FILE = `${LOCAL_RELEASE_DIR}/images.env`;
export const IMAGE_NAMES = ['API_IMAGE', 'STOREFRONT_IMAGE', 'ADMIN_IMAGE', 'OPS_IMAGE'];
const KEEP_RELEASES = 3;

/** The host of an address, or '' when it is blank or not an address. */
function hostOf(address) {
	if (!address) return '';
	try {
		return new URL(address).hostname;
	} catch {
		return '';
	}
}

/**
 * The release settings and the API settings laid over `/api` for one local release.
 * @param {Map<string, string>} api              the dev project's /api folder
 * @param {Map<string, string>} infrastructure   its /infrastructure folder
 * @param {{ port: string, images: Map<string, string> }} options
 */
export function localReleaseInputs(api, infrastructure, { port, images }) {
	for (const name of IMAGE_NAMES) {
		if (!images.get(name)?.includes('@sha256:')) {
			throw new SecretsError(`${name} is missing or not pinned by digest. Run the images stage first.`);
		}
	}
	const addresses = stackAddresses(port);
	const services = stackServiceSecrets(api, infrastructure, 'the dev project /api');
	const apiOverrides = stackApiSettings(addresses, {
		redisPassword: services.redisPassword,
		searchKey: services.masterKey,
		mongo: services.mongo,
	});
	const release = new Map([
		...IMAGE_NAMES.map((name) => [name, /** @type {string} */ (images.get(name))]),
		['DEPLOY_ENV', 'local'],
		['EDGE_PORT', port],
		['STOREFRONT_HOST', STOREFRONT_HOST],
		['ADMIN_HOST', ADMIN_HOST],
		['API_HOST', API_HOST],
		['SITE_URL', addresses.shop],
		['ADMIN_URL', addresses.admin],
		['API_URL', addresses.api],
		['CDN_HOST', hostOf(api.get('SPACES_CDN_URL'))],
		[
			'SPACES_HOST',
			hostOf(api.get('SPACES_ENDPOINT')) || `${api.get('SPACES_REGION') || 'sgp1'}.digitaloceanspaces.com`,
		],
		// The API's default payment address when CCAVENUE_BASE_URL is unset.
		['CCAVENUE_HOST', hostOf(api.get('CCAVENUE_BASE_URL')) || 'test.ccavenue.com'],
	]);
	return { release, apiOverrides };
}

/**
 * Writes one release folder: the rendered files plus the droplet's compose file, Nginx config,
 * required-secrets list and scripts, as a deploy job copies them. Then keeps the newest three.
 * @param {object} options
 * @param {string} options.root
 * @param {Record<string, Map<string, string>>} options.folders   the dev project's four folders
 * @param {import('./inventory.mjs').Inventory} options.inventory
 * @param {string} options.source
 * @param {string} options.port
 * @param {Map<string, string>} options.images
 * @param {string} options.id      the folder name, e.g. 20261120-101500-0952c679
 * @returns {{ dir: string, notes: string[] }}
 */
export function writeLocalRelease({ root, folders, inventory, source, port, images, id }) {
	const { release, apiOverrides } = localReleaseInputs(
		folders.api ?? new Map(),
		folders.infrastructure ?? new Map(),
		{
			port,
			images,
		},
	);
	const { files, notes } = buildRelease(folders, { tier: 'dev', inventory, source, release, apiOverrides });
	const releases = join(root, RELEASES_DIR);
	mkdirSync(join(root, LOCAL_RELEASE_DIR), { recursive: true, mode: 0o700 });
	mkdirSync(releases, { recursive: true, mode: 0o700 });
	const dir = join(releases, id);
	if (existsSync(dir)) throw new SecretsError(`${RELEASES_DIR}/${id} already exists. Nothing was written.`);
	writeFiles(dir, files);
	// From this checkout, as a deploy job copies them from the commit it deploys.
	const production = join(ROOT, 'docker/production');
	for (const part of ['compose.yaml', 'nginx', 'required-secrets.txt', 'bin']) {
		cpSync(join(production, part), join(dir, part), { recursive: true });
	}
	pruneReleases(releases, KEEP_RELEASES);
	return { dir, notes };
}

/**
 * Keeps the newest `keep` release folders.
 * @param {string} releases
 * @param {number} keep
 */
export function pruneReleases(releases, keep) {
	const folders = readdirSync(releases)
		.map((name) => ({ name, time: statSync(join(releases, name)).mtimeMs }))
		.sort((a, b) => b.time - a.time || (a.name < b.name ? 1 : -1));
	for (const { name } of folders.slice(keep)) rmSync(join(releases, name), { recursive: true, force: true });
}
