/**
 * The first-boot file for a server the Release Console creates (DigitalOcean › Droplets › create,
 * brief v7), filled in on this Mac by the helper, the same way `pnpm server:create` fills it
 * (scripts/server/servers.mjs). Nothing here prints or keeps a value, except the deploy key pair:
 * its private half stays on this Mac, in a folder only the owner can read, until the console writes
 * it to the GitHub environment.
 *
 *   ~/.release-console/servers/<project>-<environment>/deploy_key(.pub)
 */
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { renderFirstBoot } from '../server/servers.mjs';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const TEMPLATE = 'docker/production/first-boot.yaml';
const SLUG = /^[a-z0-9][a-z0-9-]{0,40}$/;
const PUBLIC_KEY = /^(ssh-ed25519|ecdsa-sha2-nistp(256|384|521)|ssh-rsa) [A-Za-z0-9+/=]{40,1200}( [^\r\n']{0,100})?$/;

export class FirstBootError extends Error {}

/** Where a server's deploy key pair lives on this Mac. */
export function keyFolder(project, environment, home = homedir()) {
	if (
		typeof project !== 'string' ||
		typeof environment !== 'string' ||
		!SLUG.test(project) ||
		!SLUG.test(environment)
	)
		throw new FirstBootError('That is not a project and environment.');
	return join(home, '.release-console', 'servers', `${project}-${environment}`);
}

/** The deploy key pair for this server: made once (ed25519, no passphrase), reused after. */
export async function deployKey(project, environment, { home = homedir(), exec = run } = {}) {
	const folder = keyFolder(project, environment, home);
	const file = join(folder, 'deploy_key');
	if (!existsSync(file)) {
		mkdirSync(folder, { recursive: true, mode: 0o700 });
		await exec('ssh-keygen', [
			'-q',
			'-t',
			'ed25519',
			'-N',
			'',
			'-C',
			`deploy@${project}-${environment}`,
			'-f',
			file,
		]);
	}
	return { file, publicKey: readFileSync(`${file}.pub`, 'utf8').trim() };
}

/** A SHA-512 crypt hash of the admin's Recovery Console password (`openssl passwd -6`), on stdin. */
export function passwordHash(password, { command = 'openssl' } = {}) {
	if (typeof password !== 'string' || password.length < 12 || password.length > 128 || /[\r\n]/.test(password))
		return Promise.reject(new FirstBootError('The admin password must be 12 to 128 characters on one line.'));
	return new Promise((resolve, reject) => {
		const child = spawn(command, ['passwd', '-6', '-stdin'], { stdio: ['pipe', 'pipe', 'ignore'] });
		let out = '';
		child.stdout.on('data', (c) => (out += c));
		child.on('error', () => reject(new FirstBootError('openssl could not start on this Mac.')));
		child.on('close', (code) => {
			const hash = out.trim();
			if (code === 0 && /^\$6\$[^\s$]+\$[^\s$]+$/.test(hash)) resolve(hash);
			else reject(new FirstBootError('openssl could not hash the password.'));
		});
		child.stdin.end(password);
	});
}

/**
 * The filled first-boot file. `adminKey` is the public half of the admin's own key (one of the
 * DigitalOcean account's keys the owner picked); `tunnelToken` comes from the Cloudflare tunnel the
 * console made for this server.
 */
export async function prepareFirstBoot(
	{ project, environment, adminKey, password, tunnelToken, adminUser = 'saha-textile-admin' },
	{ root = ROOT, home = homedir(), exec = run, hash = passwordHash } = {},
) {
	if (!/^[a-z][a-z0-9-]{1,30}$/.test(adminUser)) throw new FirstBootError('That is not a user name.');
	if (typeof adminKey !== 'string' || !PUBLIC_KEY.test(adminKey.trim()))
		throw new FirstBootError('The admin key is not an SSH public key.');
	if (typeof tunnelToken !== 'string' || !/^[A-Za-z0-9+/=_-]{40,}$/.test(tunnelToken))
		throw new FirstBootError('The tunnel token is missing or not a tunnel token.');
	const deploy = await deployKey(project, environment, { home, exec });
	const values = {
		ADMIN_USER: adminUser,
		ADMIN_PASSWORD_HASH: await hash(password),
		ADMIN_SSH_KEY: adminKey.trim(),
		DEPLOY_SSH_KEY: deploy.publicKey,
		TUNNEL_TOKEN: tunnelToken,
	};
	const userData = renderFirstBoot(readFileSync(join(root, TEMPLATE), 'utf8'), values);
	if (Buffer.byteLength(userData) > 64 * 1024) throw new FirstBootError('The first-boot file is over 64 KB.');
	return { userData, deployPublicKey: deploy.publicKey, deployKeyFile: deploy.file };
}

/** The template itself, markers unfilled, for the Network step's preview. */
export function firstBootTemplate(root = ROOT) {
	return readFileSync(join(root, TEMPLATE), 'utf8');
}
