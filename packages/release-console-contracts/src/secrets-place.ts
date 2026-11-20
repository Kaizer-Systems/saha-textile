import type { Repository, SecretsVendor } from './projects.js';

/**
 * Where an environment's secrets sit inside its manager, as typed in the wizard's "Where each
 * environment reads its secrets" table: `project · environment · /folder`. The folder may be left
 * out, which means the whole environment (`/`).
 */
export interface SecretsPlace {
	/** The Infisical project's name (or slug), e.g. `saha-textile-dev`. */
	project: string;
	/** The environment's slug inside that project, e.g. `dev`, `staging`, `prod`. */
	environment: string;
	/** `/` for the whole environment, else a folder such as `/api` or `/backend/api`. */
	folder: string;
}

export const SECRETS_PLACE_HINT = 'project · environment · /folder';

const PROJECT = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/;
const ENVIRONMENT = /^[a-z0-9][a-z0-9-]{0,63}$/;
const FOLDER = /^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/;

/**
 * Reads the place text. Parts are split by `·` or `|`; anything else (an empty box, a typo, a
 * leading dash) gives `null`, so nothing odd ever reaches the Infisical command line.
 */
export function parseSecretsPlace(text: string): SecretsPlace | null {
	const parts = text
		.split(/[·|]/)
		.map((p) => p.trim())
		.filter(Boolean);
	if (parts.length < 2 || parts.length > 3) return null;
	const [project = '', rawEnvironment = '', rawFolder = '/'] = parts;
	const environment = rawEnvironment.toLowerCase();
	const folder = rawFolder.length > 1 ? rawFolder.replace(/\/+$/, '') : rawFolder;
	if (!PROJECT.test(project) || !ENVIRONMENT.test(environment) || !FOLDER.test(folder)) return null;
	return { project, environment, folder };
}

/** The place written back as the wizard shows it; the folder is left out when it is the whole environment. */
export function formatSecretsPlace(place: SecretsPlace): string {
	return [place.project, place.environment, ...(place.folder === '/' ? [] : [place.folder])].join(' · ');
}

/** Managers whose names the Secrets screen can read today: Infisical Cloud, with the owner's CLI login. */
export const READABLE_SECRETS_VENDORS: readonly SecretsVendor[] = ['infisical'];

/**
 * What one environment's Secrets tab reads, from its own setting in the repository:
 * - `none`: it reads no manager (files kept by hand), or its environment is not in the repository;
 * - `later`: a manager whose Secrets screen comes later;
 * - `no-place`: Infisical, but the place is empty or cannot be read;
 * - `infisical`: Infisical Cloud at `place`.
 */
export type SecretsSource =
	| { kind: 'none' }
	| { kind: 'later'; vendor: SecretsVendor; place: string }
	| { kind: 'no-place'; vendor: SecretsVendor; text: string }
	| { kind: 'infisical'; vendor: SecretsVendor; place: SecretsPlace };

export function secretsSourceOf(repo: Repository, environment: string): SecretsSource {
	const env = repo.environments.find((e) => e.name === environment);
	const slot = env?.secretsId ? repo.secrets.find((s) => s.id === env.secretsId) : undefined;
	if (!env || !slot) return { kind: 'none' };
	if (!READABLE_SECRETS_VENDORS.includes(slot.vendor))
		return { kind: 'later', vendor: slot.vendor, place: env.secretsPath };
	const place = parseSecretsPlace(env.secretsPath);
	return place
		? { kind: 'infisical', vendor: slot.vendor, place }
		: { kind: 'no-place', vendor: slot.vendor, text: env.secretsPath };
}
