import type { Repository, SecretsVendor } from './projects.js';

/**
 * Where an environment's secrets sit inside its manager, as typed in the wizard's "Where each
 * environment reads its secrets" table: `project/environment`, or `project/environment/folder` for
 * one folder (owner, 20 Nov: the earlier `·` cannot be typed on a keyboard). The folder left out
 * means the whole environment (`/`). The older `project · environment · /folder` still reads.
 */
export interface SecretsPlace {
	/** The Infisical project's name (or slug), e.g. `saha-textile-dev`. */
	project: string;
	/** The environment's slug inside that project, e.g. `dev`, `staging`, `prod`. */
	environment: string;
	/** `/` for the whole environment, else a folder such as `/api` or `/backend/api`. */
	folder: string;
}

export const SECRETS_PLACE_HINT = 'project/environment, e.g. saha-textile-dev/dev';

/**
 * Infisical's three default environments by their names (owner, 20 Nov: the dashboard shows
 * Development, Staging and Production), so either the name or the short name can be typed; the
 * command line only takes the short name.
 */
export const INFISICAL_DEFAULT_ENVIRONMENTS: Readonly<Record<string, string>> = {
	development: 'dev',
	staging: 'staging',
	production: 'prod',
};

const PROJECT = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/;
const ENVIRONMENT = /^[a-z0-9][a-z0-9-]{0,63}$/;
const FOLDER = /^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/;

/**
 * Reads the place text: `project/environment[/folder/…]`, or the older form split by `·` or `|`.
 * Anything else (an empty box, a typo, a leading dash) gives `null`, so nothing odd ever reaches
 * the Infisical command line.
 */
export function parseSecretsPlace(text: string): SecretsPlace | null {
	if (/[·|]/.test(text)) return parseOlder(text);
	const parts = text
		.split('/')
		.map((p) => p.trim())
		.filter(Boolean);
	if (parts.length < 2) return null;
	const [project = '', rawEnvironment = '', ...folders] = parts;
	return checked(project, rawEnvironment, `/${folders.join('/')}`);
}

function parseOlder(text: string): SecretsPlace | null {
	const parts = text
		.split(/[·|]/)
		.map((p) => p.trim())
		.filter(Boolean);
	if (parts.length < 2 || parts.length > 3) return null;
	const [project = '', rawEnvironment = '', rawFolder = '/'] = parts;
	return checked(project, rawEnvironment, rawFolder);
}

function checked(project: string, rawEnvironment: string, rawFolder: string): SecretsPlace | null {
	const typed = rawEnvironment.toLowerCase();
	const environment = INFISICAL_DEFAULT_ENVIRONMENTS[typed] ?? typed;
	const folder = rawFolder.length > 1 ? rawFolder.replace(/\/+$/, '') : rawFolder;
	if (!PROJECT.test(project) || !ENVIRONMENT.test(environment) || !FOLDER.test(folder)) return null;
	return { project, environment, folder };
}

/** The place written back as it is typed; the folder is left out when it is the whole environment. */
export function formatSecretsPlace(place: SecretsPlace): string {
	return [place.project, place.environment, ...(place.folder === '/' ? [] : [place.folder.slice(1)])].join('/');
}

/** Managers whose names the Secrets screen can read today: Infisical Cloud, with the owner's CLI login. */
export const READABLE_SECRETS_VENDORS: readonly SecretsVendor[] = ['infisical'];

/**
 * What one environment's Secrets tab reads, from its own setting in the repository:
 * - `none`: it reads no manager (env files written by hand), or its environment is not in the repository;
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
