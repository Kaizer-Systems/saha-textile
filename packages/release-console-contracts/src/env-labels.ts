/**
 * Which environment a resource belongs to, worked out from what the console already knows (owner,
 * 23 Nov, "Yes, as planned"): pages without the Local / Staging / Production switch label each row.
 * A host follows the environments' domains, a branch the environments' branches, and a volume, firewall
 * or address the servers it is attached to (their stored tags). Shared by the API and the app.
 */

/** The fields of an environment these rules read. */
export interface EnvShape {
	name: string;
	label?: string;
	domains?: string[];
	branch?: string;
}

/** The label for several environments at once (a firewall on two servers, a branch two use). */
export const MIXED = 'mixed';

const label = (envs: EnvShape[], names: string[]): string | null => {
	const unique = [...new Set(names)];
	if (!unique.length) return null;
	const named = unique.map((n) => envs.find((e) => e.name === n)?.label || n);
	return unique.length === 1 ? (named[0] ?? null) : `${MIXED}: ${named.join(', ')}`;
};

/** A host as written in a record, route or rule: no scheme, path, port or trailing dot. */
const bare = (raw: string): string =>
	raw
		.trim()
		.toLowerCase()
		.replace(/^[a-z]+:\/\//, '')
		.replace(/[/:].*$/, '')
		.replace(/\.$/, '');

/** The environment names a host belongs to: one, or several for a wildcard over them (see envOfHost). */
function envNamesOfHost(envs: EnvShape[], raw: string): string[] {
	const host = bare(raw);
	if (!host) return [];
	const domains = (e: EnvShape) => (e.domains ?? []).map((d) => d.toLowerCase()).filter((d) => d !== 'localhost');
	if (host.startsWith('*.')) {
		const base = host.slice(2);
		return [
			...envNamesOfHost(envs, base),
			...envs.filter((e) => domains(e).some((d) => d.endsWith(`.${base}`))).map((e) => e.name),
		];
	}
	const exact = envs.find((e) => (e.domains ?? []).some((d) => d.toLowerCase() === host));
	if (exact) return [exact.name];
	const ssh = /^ssh-([a-z0-9-]+)\./.exec(host)?.[1];
	if (ssh && envs.some((e) => e.name === ssh)) return [ssh];
	let best: { name: string; length: number } | null = null;
	for (const e of envs)
		for (const dom of domains(e))
			if (host.endsWith(`.${dom}`) && (!best || dom.length > best.length))
				best = { name: e.name, length: dom.length };
	return best ? [best.name] : [];
}

/**
 * A host name's environment: an exact domain first, then the server's SSH host (`ssh-<env>.<zone>`),
 * then the longest domain it sits under. A route like `staging.example.com/*` counts as its host; a
 * wildcard like `*.example.com` covers every environment under it ("mixed"). Hosts under no
 * environment's domain answer null.
 */
export function envOfHost(envs: EnvShape[], host: string): string | null {
	return label(envs, envNamesOfHost(envs, host));
}

/** Several hosts (a certificate's names, an Access application's domains): one label, or mixed. */
export function envOfHosts(envs: EnvShape[], hosts: string[]): string | null {
	return label(
		envs,
		hosts.flatMap((h) => envNamesOfHost(envs, h)),
	);
}

/** The host names inside free text: a rule's expression, a list of names separated by commas. */
export function hostsIn(text: string): string[] {
	return [...text.matchAll(/(?:\*\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}/gi)].map((m) => m[0]);
}

/**
 * The environments that deploy from a branch (a pull request's target, a run's branch). An environment
 * with no branch of its own deploys from the repository's default branch.
 */
export function envOfBranch(envs: EnvShape[], branch: string, defaultBranch = ''): string | null {
	const b = branch.trim();
	if (!b) return null;
	return label(
		envs,
		envs.filter((e) => (e.branch || defaultBranch) === b).map((e) => e.name),
	);
}

/** Resources attached to servers: the stored tags of those droplets (`do:droplet:<id>`). */
export function envOfDroplets(envs: EnvShape[], tags: Record<string, string>, ids: unknown[]): string | null {
	return label(
		envs,
		ids.map((id) => tags[`do:droplet:${String(id)}`]).filter((x): x is string => typeof x === 'string' && !!x),
	);
}

/** A line of text that names one environment (an audit entry): the environment it names, if exactly one. */
export function envOfText(envs: EnvShape[], text: string): string | null {
	const hits = envs.filter((e) => new RegExp(`(^|[^a-z0-9])${e.name}([^a-z0-9]|$)`, 'i').test(text));
	return hits.length === 1
		? label(
				envs,
				hits.map((e) => e.name),
			)
		: null;
}
