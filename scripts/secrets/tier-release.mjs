/**
 * Plan step 8: the release folder a staging or production deploy job ships to its droplet, written
 * from that project's values. The job signs in as its deploy identity first (github-login.mjs), so
 * `exportProject` reads the project with that identity's read-only token. Then the job runs
 * `deploy.sh --check-only` on the folder before anything leaves the runner.
 *
 *   pnpm secrets:release -- staging --images images.env --out <empty folder>
 *
 * `images.env` names the four images pinned by digest (API_IMAGE, STOREFRONT_IMAGE, ADMIN_IMAGE,
 * OPS_IMAGE). Every other release setting comes from the project's /deployment folder. Names only
 * in every message.
 */
import { cpSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { ROOT, SecretsError } from './inventory.mjs';
import { IMAGE_NAMES } from './release.mjs';
import { buildRelease, writeFiles } from './render.mjs';

/** Where a droplet keeps its releases (docker/production/README.md). */
export const DROPLET_ROOT = '/opt/saha-textile';

/**
 * The settings a deploy job adds to the project's /deployment values.
 * @param {'staging' | 'production'} tier
 * @param {Map<string, string>} images
 */
export function tierReleaseSettings(tier, images) {
	if (tier !== 'staging' && tier !== 'production') {
		throw new SecretsError(`A deploy release is for staging or production, not ${tier}.`);
	}
	for (const name of IMAGE_NAMES) {
		if (!images.get(name)?.includes('@sha256:')) {
			throw new SecretsError(`${name} is missing or not pinned by digest.`);
		}
	}
	return new Map([
		...IMAGE_NAMES.map((name) => [name, /** @type {string} */ (images.get(name))]),
		['DEPLOY_ENV', tier],
		// Cloudflare reaches the droplet's origin on 443.
		['EDGE_PORT', '443'],
		['SAHA_TEXTILE_ROOT', DROPLET_ROOT],
	]);
}

/**
 * Writes the release folder into an empty (or new) folder.
 * @param {object} options
 * @param {string} options.out
 * @param {Record<string, Map<string, string>>} options.folders
 * @param {import('./inventory.mjs').Inventory} options.inventory
 * @param {'staging' | 'production'} options.tier
 * @param {Map<string, string>} options.images
 * @param {string} options.source
 * @returns {{ dir: string, notes: string[] }}
 */
export function writeTierRelease({ out, folders, inventory, tier, images, source }) {
	if (existsSync(out) && readdirSync(out).length > 0) {
		throw new SecretsError('The output folder must be empty: a release folder is written once.');
	}
	const release = tierReleaseSettings(tier, images);
	const { files, notes } = buildRelease(folders, { tier, inventory, source, release });
	writeFiles(out, files);
	const production = join(ROOT, 'docker/production');
	for (const part of ['compose.yaml', 'nginx', 'required-secrets.txt', 'bin']) {
		cpSync(join(production, part), join(out, part), { recursive: true });
	}
	return { dir: out, notes };
}
