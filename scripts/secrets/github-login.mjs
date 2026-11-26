#!/usr/bin/env node
/**
 * Plan step 8: signs a GitHub Actions job in to Infisical as its deploy identity, with no stored
 * secret (owner decision L4). The job needs `permissions: id-token: write` and runs in its GitHub
 * environment (`staging` or `production`), whose name is in the token's subject; Infisical accepts
 * the token only for the matching identity (docker/infisical/README.md, "Deploy identities").
 *
 *   node scripts/secrets/github-login.mjs <machine identity id>
 *
 * It asks GitHub for a short-lived token (audience https://github.com/<owner>), exchanges it with
 * `infisical login --method=oidc-auth` for a 15-minute Infisical token, masks that token in the log
 * and writes it to $GITHUB_ENV as INFISICAL_TOKEN, which the CLI (and so exportFolder) reads in the
 * job's later steps. Nothing else is printed.
 */
import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SecretsError } from './inventory.mjs';

/**
 * @param {object} options
 * @param {string} options.identityId
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {typeof spawnSync} [options.run]
 * @param {(line: string) => void} [options.write]   stdout, for the ::add-mask:: command
 */
export async function githubLogin({
	identityId,
	env = process.env,
	fetchImpl = fetch,
	run = spawnSync,
	write = (line) => process.stdout.write(line),
}) {
	if (!/^[0-9a-f-]{36}$/.test(identityId ?? '')) throw new SecretsError('Give the machine identity id (a UUID).');
	const url = env.ACTIONS_ID_TOKEN_REQUEST_URL;
	const bearer = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
	if (!url || !bearer) {
		throw new SecretsError('No GitHub token service here: the job needs permissions: id-token: write.');
	}
	if (!env.GITHUB_ENV) throw new SecretsError('GITHUB_ENV is not set: run this inside a GitHub Actions job.');
	const audience = `https://github.com/${env.GITHUB_REPOSITORY_OWNER ?? ''}`;
	const response = await fetchImpl(`${url}&audience=${encodeURIComponent(audience)}`, {
		headers: { Authorization: `bearer ${bearer}` },
	});
	if (!response.ok) throw new SecretsError(`GitHub refused the token request (${response.status}).`);
	const jwt = /** @type {{ value?: string }} */ (await response.json()).value;
	if (!jwt) throw new SecretsError('GitHub returned no token.');
	const login = run(
		'infisical',
		['login', '--method=oidc-auth', `--machine-identity-id=${identityId}`, `--jwt=${jwt}`, '--plain', '--silent'],
		{ encoding: 'utf8', env, timeout: 30_000 },
	);
	const token = String(login.stdout ?? '').trim();
	if (login.status !== 0 || token === '') {
		throw new SecretsError(
			`Infisical refused the sign-in (exit ${login.status}). Check the identity's subject, audience and project.`,
		);
	}
	write(`::add-mask::${token}\n`);
	appendFileSync(env.GITHUB_ENV, `INFISICAL_TOKEN=${token}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	githubLogin({ identityId: process.argv[2] })
		.then(() => process.stderr.write('Signed in to Infisical as the deploy identity (token masked).\n'))
		.catch((error) => {
			process.stderr.write(`${error instanceof SecretsError ? error.message : 'Sign-in failed.'}\n`);
			process.exitCode = 1;
		});
}
