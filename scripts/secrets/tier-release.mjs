/**
 * Plan step 8: the release folder a server deploy job (development, staging or production) ships to
 * its droplet, written from that project's values. The job signs in as its deploy identity first (github-login.mjs), so
 * `exportProject` reads the project with that identity's read-only token. Then the job runs
 * `deploy.sh --check-only` on the folder before anything leaves the runner.
 *
 *   pnpm secrets:release -- staging --images images.env --out <empty folder>
 *
 * `images.env` names the four images pinned by digest (API_IMAGE, STOREFRONT_IMAGE, ADMIN_IMAGE,
 * OPS_IMAGE). Every other release setting comes from the project's /deployment folder. Names only
 * in every message.
 *
 * `--allow-blank NAME` (repeatable) lets a server come up while a provider key is still missing
 * (owner, 2026-11-21: the Release Console's "deploy with these blank"). Only names tagged
 * `may-deploy-blank` in required-secrets.txt qualify; the release records the ones it really left
 * blank in allowed-blank.txt and in the API's RELEASE_ALLOWED_BLANK.
 *
 * `--rotate` lets the server change its database, Redis and search secrets to this release's (owner,
 * 2026-11-23, Release Path brief); `--restart-database` (only with it) also restarts MongoDB for a new
 * keyfile. Both are written to rotation.txt, which deploy.sh reads; without them a release whose
 * data-service secrets differ from the server's is refused before anything changes.
 */
import { cpSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ROOT, SERVER_TIERS, SecretsError } from './inventory.mjs';
import { IMAGE_NAMES } from './release.mjs';
import { buildRelease, writeFiles } from './render.mjs';

/** Where a droplet keeps its releases (docker/production/README.md). */
export const DROPLET_ROOT = '/opt/saha-textile';

/**
 * Reads the deploy job's images file: one `NAME=<image>@sha256:<digest>` line per image, blank lines
 * and `#` comments allowed. Needs no installed package, because the deploy job runs this in a bare
 * checkout. Image references are not secrets, but messages still name the line, not its value.
 * @param {string} text
 * @returns {Map<string, string>}
 */
export function parseImagesFile(text) {
	const images = new Map();
	for (const [index, raw] of text.split('\n').entries()) {
		const line = raw.trim();
		if (line === '' || line.startsWith('#')) continue;
		const match = /^([A-Z_]+)=(\S+)$/.exec(line);
		if (!match) throw new SecretsError(`Images file line ${index + 1} is not NAME=<image>@sha256:<digest>.`);
		const [, name, image] = match;
		if (!IMAGE_NAMES.includes(name)) {
			throw new SecretsError(`Images file line ${index + 1}: ${name} is not one of ${IMAGE_NAMES.join(', ')}.`);
		}
		if (images.has(name)) throw new SecretsError(`Images file: ${name} is given twice.`);
		images.set(name, image);
	}
	return images;
}

const RELEASE_USAGE =
	'Usage: pnpm secrets:release -- <development|staging|production> --images <file> --out <empty folder> [--allow-blank NAME ...] [--rotate [--restart-database]]';

/** Flags that take no value. */
const SWITCHES = /** @type {const} */ ({ '--rotate': 'rotate', '--restart-database': 'restartDatabase' });

/**
 * The release command's arguments: the tier first, then `--images`, `--out`, any number of
 * `--allow-blank NAME`, and the switches `--rotate` and `--restart-database`; each once except
 * `--allow-blank`.
 * @param {string[]} args
 */
export function parseReleaseArgs(args) {
	const [tier, ...rest] = args.filter((arg) => arg !== '--');
	/** @type {{ tier: string | undefined, imagesFile?: string, out?: string, allowBlank: string[], rotate: boolean, restartDatabase: boolean }} */
	const parsed = { tier, allowBlank: [], rotate: false, restartDatabase: false };
	for (let index = 0; index < rest.length;) {
		const switchName = SWITCHES[/** @type {keyof typeof SWITCHES} */ (rest[index])];
		if (switchName) {
			if (parsed[switchName]) throw new SecretsError(RELEASE_USAGE);
			parsed[switchName] = true;
			index += 1;
			continue;
		}
		const [flag, value] = [rest[index], rest[index + 1]];
		index += 2;
		if (value === undefined || value.startsWith('--')) throw new SecretsError(RELEASE_USAGE);
		if (flag === '--allow-blank') parsed.allowBlank.push(value);
		else if (flag === '--images' && parsed.imagesFile === undefined) parsed.imagesFile = value;
		else if (flag === '--out' && parsed.out === undefined) parsed.out = value;
		else throw new SecretsError(RELEASE_USAGE);
	}
	if (!SERVER_TIERS.includes(/** @type {string} */ (tier)) || !parsed.imagesFile || !parsed.out) {
		throw new SecretsError(RELEASE_USAGE);
	}
	if (parsed.restartDatabase && !parsed.rotate) throw new SecretsError('--restart-database goes only with --rotate.');
	return parsed;
}

/**
 * The settings a deploy job adds to the project's /deployment values.
 * @param {'development' | 'staging' | 'production'} tier
 * @param {Map<string, string>} images
 */
export function tierReleaseSettings(tier, images) {
	if (!SERVER_TIERS.includes(tier)) {
		throw new SecretsError(`A deploy release is for ${SERVER_TIERS.join(', ')}, not ${tier}.`);
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
 * @param {'development' | 'staging' | 'production'} options.tier
 * @param {Map<string, string>} options.images
 * @param {string} options.source
 * @param {Set<string>} [options.allowBlank]   required names this deploy may leave blank (`--allow-blank`)
 * @param {{ rotate: boolean, restartDatabase: boolean }} [options.rotation]   `--rotate`, `--restart-database`
 * @returns {{ dir: string, notes: string[], deployedBlank: string[] }}
 */
export function writeTierRelease({
	out,
	folders,
	inventory,
	tier,
	images,
	source,
	allowBlank = new Set(),
	rotation = { rotate: false, restartDatabase: false },
}) {
	if (existsSync(out) && readdirSync(out).length > 0) {
		throw new SecretsError('The output folder must be empty: a release folder is written once.');
	}
	const release = tierReleaseSettings(tier, images);
	const { files, notes, deployedBlank } = buildRelease(folders, { tier, inventory, source, release, allowBlank });
	writeFiles(out, files);
	const production = join(ROOT, 'docker/production');
	for (const part of ['compose.yaml', 'nginx', 'required-secrets.txt', 'bin']) {
		cpSync(join(production, part), join(out, part), { recursive: true });
	}
	if (rotation.restartDatabase && !rotation.rotate)
		throw new SecretsError('--restart-database goes only with --rotate.');
	if (rotation.rotate) {
		writeFileSync(join(out, 'rotation.txt'), `rotate\n${rotation.restartDatabase ? 'restart-database\n' : ''}`);
	}
	return { dir: out, notes, deployedBlank };
}

/**
 * The names given with `--allow-blank`, checked against the name list before Infisical is asked for
 * anything, so a wrong name costs no sign-in. Whether each is blank is known only after the read.
 * @param {string[]} names
 * @param {import('./inventory.mjs').Inventory} inventory
 * @returns {Set<string>}
 */
export function checkAllowBlankNames(names, inventory) {
	const problems = [];
	for (const name of names) {
		if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(name)) problems.push('An --allow-blank name is not a setting name.');
		else if (!inventory.requiredForRelease.includes(name)) {
			problems.push(`${name} is not required for a release, so a deploy never stops on it: nothing to allow.`);
		} else if (!inventory.mayDeployBlank.has(name)) {
			problems.push(
				`${name} can never be deployed blank. Only these can: ${[...inventory.mayDeployBlank].sort().join(', ')}.`,
			);
		}
	}
	if (new Set(names).size !== names.length) problems.push('An --allow-blank name is given twice.');
	if (problems.length > 0) throw new SecretsError(problems.join('\n'));
	return new Set(names);
}
