/**
 * The parts of a new server's setup that happen on the console's own machine (owner, 21 Nov: "key
 * and csr made on the device that triggers it"), run by its helper:
 *
 * - the Origin Certificate's key and CSR (Cloudflare signs the CSR; the key never leaves this
 *   machine except into Infisical);
 * - our own Authenticated Origin Pulls CA and client certificate (plan §9: not Cloudflare's shared
 *   one), so the server's edge accepts only Cloudflare's calls made for this environment;
 * - the four certificate files saved to the environment's Infisical /infrastructure, which every
 *   release then installs (render.mjs, deploy.sh);
 * - the GitHub environment's variables and secrets, set with the gh CLI (it encrypts secrets);
 * - the server's SSH host key, read once through its tunnel with cloudflared.
 *
 * Working files live in ~/.release-console/servers/<project>-<environment>/ (mode 0700) and the
 * private keys are deleted once saved. Nothing here prints a value.
 */
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { keyFolder } from './first-boot.mjs';

const run = promisify(execFile);
const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const NAME = /^[A-Z][A-Z0-9_]{0,99}$/;
/** Cloudflare's published Origin CA root, which the shop's containers trust for API calls. */
export const ORIGIN_CA_URL = 'https://developers.cloudflare.com/ssl/static/origin_ca_rsa_root.pem';

export class SetupError extends Error {}

function hostsOf(list) {
	const hosts = Array.isArray(list) ? list.map(String) : [];
	if (!hosts.length || hosts.some((h) => !HOST.test(h))) throw new SetupError('The host names are not valid.');
	return hosts;
}

/** The Origin Certificate's private key and CSR; the key stays in the server's folder until saved. */
export async function originCsr({ project, environment, hosts }, { exec = run } = {}) {
	const names = hostsOf(hosts);
	const folder = keyFolder(project, environment);
	await exec('mkdir', ['-p', '-m', '700', folder]);
	const key = join(folder, 'origin.key');
	const csr = join(folder, 'origin.csr');
	await exec('openssl', [
		'req',
		'-new',
		'-newkey',
		'rsa:2048',
		'-nodes',
		'-keyout',
		key,
		'-out',
		csr,
		'-subj',
		`/CN=${names[0]}`,
	]);
	await exec('chmod', ['600', key]);
	return { csr: readFileSync(csr, 'utf8') };
}

/**
 * Our own Authenticated Origin Pulls pair: a CA (its key is thrown away; a new pair is made when
 * this one is replaced) and a client certificate it signs, which Cloudflare presents to the server.
 */
export async function aopPair({ project, environment }, { exec = run } = {}) {
	keyFolder(project, environment);
	const dir = mkdtempSync(join(tmpdir(), 'rc-aop-'));
	try {
		const p = (f) => join(dir, f);
		writeFileSync(p('client.ext'), 'extendedKeyUsage = clientAuth\nkeyUsage = digitalSignature, keyEncipherment\n');
		await exec('openssl', [
			'req',
			'-x509',
			'-newkey',
			'rsa:2048',
			'-nodes',
			'-days',
			'5475',
			'-keyout',
			p('ca.key'),
			'-out',
			p('ca.pem'),
			'-subj',
			`/CN=${project}-${environment} origin pulls CA`,
			'-addext',
			'basicConstraints=critical,CA:TRUE',
			'-addext',
			'keyUsage=critical,keyCertSign,cRLSign',
		]);
		await exec('openssl', [
			'req',
			'-new',
			'-newkey',
			'rsa:2048',
			'-nodes',
			'-keyout',
			p('client.key'),
			'-out',
			p('client.csr'),
			'-subj',
			`/CN=${project}-${environment} Cloudflare`,
		]);
		await exec('openssl', [
			'x509',
			'-req',
			'-in',
			p('client.csr'),
			'-CA',
			p('ca.pem'),
			'-CAkey',
			p('ca.key'),
			'-CAcreateserial',
			'-days',
			'5475',
			'-out',
			p('client.pem'),
			'-extfile',
			p('client.ext'),
		]);
		return {
			caCertificate: readFileSync(p('ca.pem'), 'utf8'),
			clientCertificate: readFileSync(p('client.pem'), 'utf8'),
			clientKey: readFileSync(p('client.key'), 'utf8'),
		};
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/**
 * The certificate files for /infrastructure that changed: the Origin Certificate Cloudflare signed
 * with its key from this machine, Cloudflare's Origin CA root, and our origin-pulls CA. Any of them
 * may be left out (a kept Origin Certificate, a kept CA). The key file is deleted after a save.
 */
export async function certificateFiles(
	{ project, environment, certificate, aopCa, originCa },
	{ fetchText = async (u) => (await fetch(u, { signal: AbortSignal.timeout(15_000) })).text() } = {},
) {
	/** @type {Record<string, string>} */
	const files = {};
	let keyFile = null;
	if (certificate !== undefined && certificate !== null) {
		if (typeof certificate !== 'string' || !certificate.includes('BEGIN CERTIFICATE'))
			throw new SetupError('The Origin Certificate is not a certificate.');
		keyFile = join(keyFolder(project, environment), 'origin.key');
		if (!existsSync(keyFile))
			throw new SetupError('The Origin Certificate key is not on this machine: make the CSR again.');
		files['origin.pem'] = certificate;
		files['origin.key'] = readFileSync(keyFile, 'utf8');
	}
	if (aopCa !== undefined && aopCa !== null) {
		if (typeof aopCa !== 'string' || !aopCa.includes('BEGIN CERTIFICATE'))
			throw new SetupError('The origin-pulls CA is not a certificate.');
		files['cloudflare-client-ca.pem'] = aopCa;
	}
	if (originCa === true) {
		const root = await fetchText(ORIGIN_CA_URL);
		if (!root.includes('BEGIN CERTIFICATE')) throw new SetupError("Cloudflare's Origin CA root could not be read.");
		files['origin-ca.pem'] = root;
	}
	if (!Object.keys(files).length) throw new SetupError('There is no certificate to save.');
	return { keyFile, files };
}

/** gh with a value on stdin (secrets), never on the command line. */
function gh(args, stdin, spawnFn = spawn) {
	return new Promise((resolve, reject) => {
		const child = spawnFn('gh', args, { stdio: ['pipe', 'ignore', 'pipe'] });
		let err = '';
		child.stderr.on('data', (c) => (err += c));
		child.on('error', () => reject(new SetupError('The GitHub CLI could not start on this machine.')));
		child.on('close', (code) =>
			code === 0
				? resolve()
				: reject(new SetupError(`gh ${args[0]} ${args[1]} failed: ${err.trim().split('\n').pop() ?? ''}`)),
		);
		child.stdin.end(stdin ?? '');
	});
}

/**
 * The GitHub environment deploy.yml reads: made when missing (an existing one keeps its approval
 * rules), then each variable and secret set. The deploy key's private half is read here from this
 * machine and never sent anywhere but GitHub.
 */
export async function githubEnvironment(
	{ repository, environment, variables = {}, secrets = {}, deployKeyOf },
	{ exec = run, spawnFn = spawn } = {},
) {
	if (!REPOSITORY.test(String(repository))) throw new SetupError('Write the repository as owner/name.');
	if (!/^[a-z0-9-]{1,40}$/.test(String(environment))) throw new SetupError('That is not an environment name.');
	const exists = await exec('gh', ['api', `repos/${repository}/environments/${environment}`]).then(
		() => true,
		() => false,
	);
	if (!exists) await exec('gh', ['api', '-X', 'PUT', `repos/${repository}/environments/${environment}`]);
	const all = { ...secrets };
	if (deployKeyOf) {
		const file = join(keyFolder(deployKeyOf.project, deployKeyOf.environment), 'deploy_key');
		if (!existsSync(file)) throw new SetupError('The deploy key is not on this machine.');
		all.DEPLOY_SSH_KEY = readFileSync(file, 'utf8');
	}
	const set = [];
	for (const [name, value] of Object.entries(variables)) {
		if (!NAME.test(name) || typeof value !== 'string' || !value)
			throw new SetupError(`${name} is not a variable to set.`);
		await exec('gh', ['variable', 'set', name, '--env', environment, '--repo', repository, '--body', value]);
		set.push(name);
	}
	for (const [name, value] of Object.entries(all)) {
		if (!NAME.test(name) || typeof value !== 'string' || !value)
			throw new SetupError(`${name} is not a secret to set.`);
		await gh(['secret', 'set', name, '--env', environment, '--repo', repository], value, spawnFn);
		set.push(name);
	}
	return { environmentMade: !exists, set };
}

/**
 * The GitHub environment's protection rules (Release Path brief 1.7 and C5, approved 23 Nov). The
 * deploy branch and the release-tag pattern (`<environment>-*`, for Deploy an older version) are
 * added when missing; whether a required reviewer is set is read and never changed, because who
 * approves a deploy is the owner's own setting. A rule change keeps the reviewers and wait timer.
 */
export async function environmentRules({ repository, environment, branch }, { exec = run, spawnFn = spawn } = {}) {
	if (!REPOSITORY.test(String(repository))) throw new SetupError('Write the repository as owner/name.');
	if (!/^[a-z0-9-]{1,40}$/.test(String(environment))) throw new SetupError('That is not an environment name.');
	if (!/^[A-Za-z0-9._/-]{1,100}$/.test(String(branch))) throw new SetupError('That is not a branch name.');
	const base = `repos/${repository}/environments/${environment}`;
	const read = async (path) => JSON.parse((await exec('gh', ['api', path])).stdout || 'null');
	const env = await read(base);
	const rules = Array.isArray(env?.protection_rules) ? env.protection_rules : [];
	const reviewerRule = rules.find((r) => r.type === 'required_reviewers');
	const reviewers = Array.isArray(reviewerRule?.reviewers) ? reviewerRule.reviewers : [];
	const set = [];
	if (!env?.deployment_branch_policy?.custom_branch_policies) {
		// Keep what the environment already has; only the branch policy changes to a list of its own.
		const timer = rules.find((r) => r.type === 'wait_timer')?.wait_timer ?? 0;
		const body = JSON.stringify({
			wait_timer: timer,
			prevent_self_review: !!reviewerRule?.prevent_self_review,
			reviewers: reviewers.map((r) => ({ type: r.type, id: r.reviewer?.id })).filter((r) => r.id),
			deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
		});
		await gh(['api', '-X', 'PUT', base, '--input', '-'], body, spawnFn);
		set.push('branch rules: only the listed branches and tags');
	}
	const policies = (await read(`${base}/deployment-branch-policies?per_page=100`))?.branch_policies ?? [];
	const want = [
		{ name: String(branch), type: 'branch' },
		{ name: `${environment}-*`, type: 'tag' },
	];
	for (const w of want) {
		if (policies.some((p) => p.name === w.name && (p.type ?? 'branch') === w.type)) continue;
		await exec('gh', [
			'api',
			'-X',
			'POST',
			`${base}/deployment-branch-policies`,
			'-f',
			`name=${w.name}`,
			'-f',
			`type=${w.type}`,
		]);
		set.push(`${w.type} ${w.name}`);
	}
	return { reviewers: reviewers.length, set };
}

/**
 * Keeps the console's observer token beside the observer key on this Mac (0600), for the read-only
 * requests below; the create job hands it over once and never keeps it.
 */
export function saveObserverToken({ project, environment, clientId, clientSecret }) {
	if (!/^[\w.-]{8,200}$/.test(String(clientId)) || !/^[\w.-]{16,400}$/.test(String(clientSecret)))
		throw new SetupError('That is not a service token.');
	const folder = keyFolder(project, environment);
	mkdirSync(folder, { recursive: true, mode: 0o700 });
	writeFileSync(join(folder, 'observer_token.json'), JSON.stringify({ clientId, clientSecret }), { mode: 0o600 });
	return { saved: true };
}

/** The requests observe.sh answers (the Infisical chat's M9); anything else is refused here first. */
export const OBSERVE_REQUEST =
	/^(containers|releases|disk|logs [a-z0-9][a-z0-9_-]{0,40}( --since ([1-9]|[1-5][0-9]|60))?( --errors)?)$/;

/**
 * One read-only request to a server's observer login, through its Cloudflare tunnel with the
 * console's observer token (Release Path brief Q8): no open port, and the key can only run
 * observe.sh. Answers observe.sh's JSON.
 */
export async function observe({ project, environment, host, request }, { exec = run } = {}) {
	if (!HOST.test(String(host))) throw new SetupError('That is not a host name.');
	if (!OBSERVE_REQUEST.test(String(request))) throw new SetupError('observe.sh does not answer that request.');
	const folder = keyFolder(project, environment);
	const key = join(folder, 'observer_key');
	const tokenFile = join(folder, 'observer_token.json');
	if (!existsSync(key) || !existsSync(tokenFile))
		throw new SetupError(
			'This Mac has no observer key or token for that server: create it from the console, or Finish setup.',
		);
	const token = JSON.parse(readFileSync(tokenFile, 'utf8'));
	// The token goes in cloudflared's own environment variables, never on a command line.
	const env = {
		...process.env,
		TUNNEL_SERVICE_TOKEN_ID: String(token.clientId),
		TUNNEL_SERVICE_TOKEN_SECRET: String(token.clientSecret),
	};
	const { stdout } = await exec(
		'ssh',
		[
			'-i',
			key,
			'-o',
			'IdentitiesOnly=yes',
			'-o',
			'BatchMode=yes',
			'-o',
			'StrictHostKeyChecking=accept-new',
			'-o',
			`UserKnownHostsFile=${join(folder, 'known_hosts')}`,
			'-o',
			'ProxyCommand=cloudflared access ssh --hostname %h',
			`observer@${host}`,
			String(request),
		],
		{ env, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
	).catch((err) => {
		const said =
			String(err?.stdout ?? '').trim() ||
			String(err?.stderr ?? '')
				.trim()
				.split('\n')
				.pop();
		throw new SetupError(`The observer login answered: ${said || 'nothing'}`);
	});
	return JSON.parse(stdout);
}

/**
 * The server's SSH host key line for SERVER_SSH_KNOWN_HOSTS, read once through the tunnel with the
 * deploy job's service token. Needs cloudflared on this machine.
 */
export async function knownHosts({ host, tokenId, tokenSecret }, { exec = run } = {}) {
	if (!HOST.test(String(host))) throw new SetupError('That is not a host name.');
	const found = await exec('which', ['cloudflared']).then(
		() => true,
		() => false,
	);
	if (!found)
		throw new SetupError(
			'cloudflared is not on this machine: install it (brew install cloudflared), then read the host key again.',
		);
	const dir = mkdtempSync(join(tmpdir(), 'rc-known-'));
	const file = join(dir, 'known_hosts');
	try {
		// The token goes in cloudflared's own environment variables, never on a command line.
		const env = {
			...process.env,
			TUNNEL_SERVICE_TOKEN_ID: String(tokenId),
			TUNNEL_SERVICE_TOKEN_SECRET: String(tokenSecret),
		};
		const proxy = 'cloudflared access ssh --hostname %h';
		// Only the key exchange matters: the host key is written before sign-in, which then fails on purpose.
		await exec(
			'ssh',
			[
				'-o',
				`ProxyCommand=${proxy}`,
				'-o',
				'StrictHostKeyChecking=accept-new',
				'-o',
				`UserKnownHostsFile=${file}`,
				'-o',
				'BatchMode=yes',
				'-o',
				'ConnectTimeout=30',
				'-o',
				'PreferredAuthentications=none',
				`nobody@${host}`,
				'true',
			],
			{ env },
		).catch(() => undefined);
		const line = existsSync(file)
			? readFileSync(file, 'utf8')
					.split('\n')
					.find((l) => l.startsWith(host))
			: undefined;
		if (!line) throw new SetupError('The host key could not be read through the tunnel yet.');
		return { line: line.trim() };
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
