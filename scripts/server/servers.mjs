#!/usr/bin/env node
/**
 * Creates and removes a Saha Textile server on DigitalOcean (production-deployment-plan.mdx §5),
 * from the owner's Mac with the owner's own `doctl` sign-in. Nothing here runs by itself: `plan`
 * touches no account, and `create` / `destroy` need `--yes`.
 *
 *   pnpm server:plan -- staging              what would be created; touches nothing
 *   pnpm server:create -- staging --yes      droplet + Cloud Firewall, first boot from first-boot.yaml
 *   pnpm server:destroy -- staging --yes     staging or a development server only, never production
 *
 * `create` reads, from the environment of the terminal it runs in (never printed):
 *   SERVER_ADMIN_SSH_KEY_FILE   the admin's public key (default ~/.ssh/id_ed25519.pub)
 *   SERVER_DEPLOY_SSH_KEY_FILE  the deploy job's public key (its private half goes to the GitHub environment)
 *   SERVER_OBSERVER_SSH_KEY_FILE  the Release Console's read-only key (observe.sh only)
 *   SERVER_ADMIN_PASSWORD_HASH  `openssl passwd -6` of the admin password kept in NordPass (Recovery Console)
 *   SERVER_TUNNEL_TOKEN         the Cloudflare tunnel's token for this server
 *   SERVER_ADMIN_USER           optional, default saha-textile-admin
 */
import { execFile } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const run = promisify(execFile);

/** One server per environment; sizes from the plan (§5). A development server is sized like staging. */
export const SERVERS = {
	production: { size: 's-4vcpu-8gb', removable: false },
	staging: { size: 's-2vcpu-4gb', removable: true },
	development: { size: 's-2vcpu-4gb', removable: true },
};
export const REGION = 'blr1';
export const IMAGE = 'ubuntu-26-04-x64';
export const CLOUDFLARE_RANGES = ['https://www.cloudflare.com/ips-v4', 'https://www.cloudflare.com/ips-v6'];

export class ServerError extends Error {}

/** @param {string} environment */
export function serverOf(environment) {
	const server = SERVERS[/** @type {keyof typeof SERVERS} */ (environment)];
	if (!server)
		throw new ServerError(
			`No server is planned for ${environment}. Use one of: ${Object.keys(SERVERS).join(', ')}.`,
		);
	return {
		environment,
		name: `saha-textile-${environment}`,
		tags: ['saha-textile', `saha-textile-${environment}`],
		region: REGION,
		image: IMAGE,
		...server,
	};
}

/**
 * The droplet's user data: first-boot.yaml with every @@NAME@@ marker filled. Values that could
 * break out of their YAML quotes or line are refused, and so is a marker left unfilled.
 * @param {string} template
 * @param {Record<string, string>} values
 */
export function renderFirstBoot(template, values) {
	for (const [name, value] of Object.entries(values)) {
		if (!/^[A-Z0-9_]+$/.test(name)) throw new ServerError(`${name} is not a marker name.`);
		if (typeof value !== 'string' || !value || /[\r\n']/.test(value))
			throw new ServerError(`${name} is empty or holds a line break or a quote.`);
	}
	const out = template.replace(/@@([A-Z0-9_]+)@@/g, (whole, name) => (name in values ? values[name] : whole));
	const left = [...new Set([...out.matchAll(/@@([A-Z0-9_]+)@@/g)].map((m) => m[1]))];
	if (left.length) throw new ServerError(`first-boot.yaml still has ${left.join(', ')} unfilled.`);
	return out;
}

/** The first-boot values from the terminal's environment; checks their shape, never prints them. */
export function firstBootValues(env = process.env, read = (/** @type {string} */ p) => readFileSync(p, 'utf8')) {
	const adminUser = env.SERVER_ADMIN_USER || 'saha-textile-admin';
	if (!/^[a-z][a-z0-9-]{1,30}$/.test(adminUser)) throw new ServerError('SERVER_ADMIN_USER is not a valid user name.');
	const key = (/** @type {string} */ file, /** @type {string} */ what) => {
		const text = read(file).trim();
		if (!/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256) [A-Za-z0-9+/=]+( [^\r\n']*)?$/.test(text))
			throw new ServerError(`${what} is not one public SSH key.`);
		return text;
	};
	const hash = env.SERVER_ADMIN_PASSWORD_HASH ?? '';
	if (!/^\$6\$[^\s']+$/.test(hash))
		throw new ServerError('SERVER_ADMIN_PASSWORD_HASH must be a SHA-512 crypt hash (openssl passwd -6).');
	const tunnel = env.SERVER_TUNNEL_TOKEN ?? '';
	if (!/^[A-Za-z0-9+/=_-]{40,}$/.test(tunnel))
		throw new ServerError('SERVER_TUNNEL_TOKEN is missing or not a tunnel token.');
	return {
		ADMIN_USER: adminUser,
		ADMIN_SSH_KEY: key(env.SERVER_ADMIN_SSH_KEY_FILE || join(homedir(), '.ssh/id_ed25519.pub'), 'The admin key'),
		DEPLOY_SSH_KEY: key(env.SERVER_DEPLOY_SSH_KEY_FILE || '', 'SERVER_DEPLOY_SSH_KEY_FILE'),
		OBSERVER_SSH_KEY: key(env.SERVER_OBSERVER_SSH_KEY_FILE || '', 'SERVER_OBSERVER_SSH_KEY_FILE'),
		ADMIN_PASSWORD_HASH: hash,
		TUNNEL_TOKEN: tunnel,
		RECEIVE_RELEASE_B64: Buffer.from(read(join(ROOT, 'docker/production/bin/receive-release.sh'))).toString(
			'base64',
		),
		OBSERVE_B64: Buffer.from(read(join(ROOT, 'docker/production/bin/observe.sh'))).toString('base64'),
	};
}

/**
 * The Cloud Firewall: inbound 443 from Cloudflare's ranges only (no SSH: it goes through the
 * tunnel), everything outbound. In doctl's rule syntax.
 * @param {string[]} ranges
 */
export function firewallRules(ranges) {
	const cidrs = ranges.map((r) => r.trim()).filter((r) => /^[0-9a-f.:]+\/\d{1,3}$/i.test(r));
	if (cidrs.length < 5) throw new ServerError("Cloudflare's address ranges could not be read.");
	const everywhere = 'address:0.0.0.0/0,address:::/0';
	return {
		inbound: `protocol:tcp,ports:443,${cidrs.map((c) => `address:${c}`).join(',')}`,
		outbound: [
			`protocol:tcp,ports:all,${everywhere}`,
			`protocol:udp,ports:all,${everywhere}`,
			`protocol:icmp,${everywhere}`,
		].join(' '),
		count: cidrs.length,
	};
}

/** What `create` would do, in words; holds no value from the terminal. */
export function describePlan(environment) {
	const s = serverOf(environment);
	return [
		`Server for ${environment}: droplet ${s.name}, ${s.size}, ${s.region}, ${s.image}, tags ${s.tags.join(', ')}, DigitalOcean metrics agent on.`,
		`Cloud Firewall ${s.name}: inbound 443 from Cloudflare's address ranges only (read at create time), nothing else inbound; all outbound.`,
		'First boot (docker/production/first-boot.yaml): admin user with sudo and the Recovery Console password, deploy user forced to receive-release.sh, SSH on 127.0.0.1 only behind the Cloudflare tunnel, Docker with local logs and live-restore, cloudflared service, UFW, 4 GiB swap, UTC, security patches with the 7-day reboot rule, /opt/saha-textile.',
		'Not done here: the tunnel itself, Cloudflare Access, DNS, the Origin Certificate and Authenticated Origin Pulls (docker/production/README.md, "A new server").',
		s.removable
			? `Can be removed with: pnpm server:destroy -- ${environment} --yes`
			: 'Production is never removed by a script.',
	];
}

/** @typedef {(cmd: string, args: string[]) => Promise<{ stdout: string }>} Runner */

/** @type {Runner} */
const doctl = (cmd, args) => run(cmd, args, { encoding: 'utf8', timeout: 600_000, maxBuffer: 8 * 1024 * 1024 });

/**
 * Creates the droplet and its firewall. Refuses when a droplet of that name exists.
 * @param {string} environment
 * @param {{ values: Record<string, string>, ranges: string[], exec?: Runner, template?: string }} input
 */
export async function createServer(environment, { values, ranges, exec = doctl, template }) {
	const s = serverOf(environment);
	const userData = renderFirstBoot(
		template ?? readFileSync(join(ROOT, 'docker/production/first-boot.yaml'), 'utf8'),
		values,
	);
	const rules = firewallRules(ranges);
	const existing = JSON.parse(
		(await exec('doctl', ['compute', 'droplet', 'list', '--tag-name', s.tags[1], '--output', 'json'])).stdout ||
			'[]',
	);
	if (Array.isArray(existing) && existing.length)
		throw new ServerError(`${s.name} already exists; nothing was created.`);
	const dir = mkdtempSync(join(tmpdir(), 'saha-textile-server-'));
	const file = join(dir, 'first-boot.yaml');
	try {
		writeFileSync(file, userData, { mode: 0o600 });
		const keys = JSON.parse(
			(await exec('doctl', ['compute', 'ssh-key', 'list', '--output', 'json'])).stdout || '[]',
		);
		const adminKey = values.ADMIN_SSH_KEY.split(' ').slice(0, 2).join(' ');
		const known = Array.isArray(keys) ? keys.find((k) => String(k.public_key).startsWith(adminKey)) : undefined;
		const fingerprint = known
			? String(known.fingerprint)
			: JSON.parse(
					(
						await exec('doctl', [
							'compute',
							'ssh-key',
							'create',
							`${s.name}-admin`,
							'--public-key',
							adminKey,
							'--output',
							'json',
						])
					).stdout,
				)[0].fingerprint;
		await exec('doctl', [
			'compute',
			'droplet',
			'create',
			s.name,
			'--region',
			s.region,
			'--size',
			s.size,
			'--image',
			s.image,
			'--tag-names',
			s.tags.join(','),
			'--enable-monitoring',
			'--ssh-keys',
			fingerprint,
			'--user-data-file',
			file,
			'--wait',
			'--output',
			'json',
		]);
		const firewalls = JSON.parse(
			(await exec('doctl', ['compute', 'firewall', 'list', '--output', 'json'])).stdout || '[]',
		);
		const firewall = Array.isArray(firewalls) ? firewalls.find((f) => f.name === s.name) : undefined;
		const ruleArgs = [
			'--inbound-rules',
			rules.inbound,
			'--outbound-rules',
			rules.outbound,
			'--tag-names',
			s.tags[1],
		];
		if (firewall)
			await exec('doctl', ['compute', 'firewall', 'update', String(firewall.id), '--name', s.name, ...ruleArgs]);
		else await exec('doctl', ['compute', 'firewall', 'create', '--name', s.name, ...ruleArgs]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
	return [
		`${s.name} created and its firewall set (443 from ${rules.count} Cloudflare ranges). First boot takes a few minutes.`,
	];
}

/**
 * Removes a staging or development server and its firewall. Production is never removed here.
 * @param {string} environment
 * @param {{ exec?: Runner }} [io]
 */
export async function destroyServer(environment, { exec = doctl } = {}) {
	const s = serverOf(environment);
	if (!s.removable) throw new ServerError('Production is never removed by a script.');
	await exec('doctl', ['compute', 'droplet', 'delete', s.name, '--force']);
	const firewalls = JSON.parse(
		(await exec('doctl', ['compute', 'firewall', 'list', '--output', 'json'])).stdout || '[]',
	);
	const firewall = Array.isArray(firewalls) ? firewalls.find((f) => f.name === s.name) : undefined;
	if (firewall) await exec('doctl', ['compute', 'firewall', 'delete', String(firewall.id), '--force']);
	return [`${s.name} and its firewall were removed; the data on that server is gone.`];
}

/** Cloudflare's published address ranges, read when a server is created. */
async function cloudflareRanges() {
	const lists = await Promise.all(CLOUDFLARE_RANGES.map((u) => fetch(u).then((r) => (r.ok ? r.text() : ''))));
	return lists.join('\n').split('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const [action, environment = ''] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
	const yes = process.argv.includes('--yes');
	try {
		if (action === 'plan') console.log(describePlan(environment).join('\n'));
		else if (action === 'create' || action === 'destroy') {
			if (!yes)
				throw new ServerError(`Nothing was done. ${action} changes your DigitalOcean account: add --yes.`);
			const lines =
				action === 'create'
					? await createServer(environment, { values: firstBootValues(), ranges: await cloudflareRanges() })
					: await destroyServer(environment);
			console.log(lines.join('\n'));
		} else throw new ServerError('Use: plan|create|destroy <production|staging|development> [--yes]');
	} catch (error) {
		console.error(
			error instanceof ServerError ? error.message : 'doctl failed; run `doctl auth list` to check the sign-in.',
		);
		process.exitCode = 1;
	}
}
