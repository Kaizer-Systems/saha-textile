/**
 * Every key the console reads from its key file, which `pnpm console:env` writes from Infisical
 * (dev project, folder /release-console). The two change keys are made later and may stay blank.
 * Kept in step with `scripts/release-console/env.mjs` by its test.
 */
export const CONSOLE_KEY_NAMES = [
	'CONSOLE_CF_READ_TOKEN',
	'CONSOLE_CF_WRITE_TOKEN',
	'CONSOLE_DO_READ_TOKEN',
	'CONSOLE_DO_WRITE_TOKEN',
	'CONSOLE_GITHUB_TOKEN',
	'CONSOLE_SPACES_ACCESS_KEY',
	'CONSOLE_SPACES_SECRET_KEY',
] as const;

export const OPTIONAL_KEY_NAMES: readonly string[] = ['CONSOLE_CF_WRITE_TOKEN', 'CONSOLE_DO_WRITE_TOKEN'];

/** Pairs where either key will do: the console reads with the change key when there is no read key. */
export const EITHER_ONE: readonly (readonly string[])[] = [
	['CONSOLE_DO_READ_TOKEN', 'CONSOLE_DO_WRITE_TOKEN'],
	['CONSOLE_CF_READ_TOKEN', 'CONSOLE_CF_WRITE_TOKEN'],
];
