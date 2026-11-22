/**
 * Cloudflare writes for a new server (brief v7): its tunnel and the environment's DNS records.
 * A record that already points somewhere else is never overwritten: the step stops and says so.
 */
import { VendorError, arr, getJson, rec, sendJson, str } from './http.js';

const API = 'https://api.cloudflare.com/client/v4';

async function call(
	method: 'GET' | 'POST' | 'PUT' | 'DELETE',
	path: string,
	key: string,
	body?: unknown,
): Promise<unknown> {
	const url = `${API}${path}`;
	const a =
		method === 'GET'
			? await getJson(url, key)
			: method === 'DELETE'
				? await (async () => {
						const res = await fetch(url, {
							method: 'DELETE',
							headers: { authorization: `Bearer ${key}`, 'user-agent': 'release-console' },
							signal: AbortSignal.timeout(15_000),
						});
						return { status: res.status, body: (await res.json().catch(() => null)) as unknown };
					})()
				: await sendJson(method, url, key, body);
	const answer = rec(a.body);
	if (a.status >= 400 || answer['success'] === false) {
		const first = rec(arr(answer['errors'])[0]);
		throw new VendorError(
			`Cloudflare answered ${a.status}${first['message'] ? `: ${str(first['message'])}` : ''}.`,
			a.status,
		);
	}
	return answer['result'];
}

export interface ZoneRef {
	id: string;
	name: string;
	accountId: string;
}

export interface TunnelRef {
	id: string;
	name: string;
}

/** The zone that holds a host name (the longest zone name it ends with). */
export function zoneFor(host: string, zones: string[]): string | null {
	const h = host.toLowerCase().replace(/\.$/, '');
	return (
		[...zones]
			.sort((a, b) => b.length - a.length)
			.find((z) => h === z.toLowerCase() || h.endsWith(`.${z.toLowerCase()}`)) ?? null
	);
}

export const cfWrites = {
	async zone(key: string, name: string): Promise<ZoneRef> {
		const z = rec(arr(await call('GET', `/zones?name=${encodeURIComponent(name)}`, key))[0]);
		if (!str(z['id'])) throw new VendorError(`The Cloudflare key does not see the zone ${name}.`, 404);
		return { id: str(z['id']), name: str(z['name']), accountId: str(rec(z['account'])['id']) };
	},
	async tunnelNamed(key: string, accountId: string, name: string): Promise<TunnelRef | null> {
		const list = arr(
			await call(
				'GET',
				`/accounts/${accountId}/cfd_tunnel?name=${encodeURIComponent(name)}&is_deleted=false`,
				key,
			),
		).map(rec);
		const t = list.find((x) => str(x['name']) === name);
		return t ? { id: str(t['id']), name } : null;
	},
	/** A remotely managed tunnel (its settings live at Cloudflare), the kind `cloudflared service install` joins. */
	async createTunnel(key: string, accountId: string, name: string): Promise<TunnelRef> {
		const t = rec(await call('POST', `/accounts/${accountId}/cfd_tunnel`, key, { name, config_src: 'cloudflare' }));
		return { id: str(t['id']), name };
	},
	/** The token the server's cloudflared joins with; passed straight to the first-boot file, never kept. */
	async tunnelToken(key: string, accountId: string, id: string): Promise<string> {
		const token = await call('GET', `/accounts/${accountId}/cfd_tunnel/${id}/token`, key);
		if (typeof token !== 'string' || !token) throw new VendorError('Cloudflare gave no token for the tunnel.', 502);
		return token;
	},
	async tunnelConnections(key: string, accountId: string, id: string): Promise<number> {
		const t = rec(await call('GET', `/accounts/${accountId}/cfd_tunnel/${id}`, key));
		return arr(t['connections']).length;
	},
	async deleteTunnel(key: string, accountId: string, id: string): Promise<void> {
		await call('DELETE', `/accounts/${accountId}/cfd_tunnel/${id}/connections`, key).catch(() => undefined);
		await call('DELETE', `/accounts/${accountId}/cfd_tunnel/${id}`, key);
	},
	/**
	 * Points `host` at `ip` through Cloudflare's proxy. Creates the record when missing, leaves it
	 * when it already points there, and refuses when it points anywhere else.
	 */
	async pointHost(key: string, zoneId: string, host: string, ip: string): Promise<'created' | 'kept'> {
		const existing = arr(
			await call('GET', `/zones/${zoneId}/dns_records?name=${encodeURIComponent(host)}&per_page=50`, key),
		).map(rec);
		const same = existing.find((r) => str(r['type']) === 'A' && str(r['content']) === ip);
		if (same) return 'kept';
		const other = existing.find((r) => ['A', 'AAAA', 'CNAME'].includes(str(r['type'])));
		if (other)
			throw new VendorError(
				`${host} already points to ${str(other['content'])} (${str(other['type'])}); the console does not overwrite it.`,
				409,
			);
		await call('POST', `/zones/${zoneId}/dns_records`, key, {
			type: 'A',
			name: host,
			content: ip,
			proxied: true,
			ttl: 1,
			comment: 'Release Console: server created from the console',
		});
		return 'created';
	},
	/** Whether Cloudflare Zero Trust (Access) is switched on for the account; servers need it for SSH. */
	async accessEnabled(key: string, accountId: string): Promise<boolean> {
		try {
			await call('GET', `/accounts/${accountId}/access/organizations`, key);
			return true;
		} catch (err) {
			if (err instanceof VendorError && /not.?enabled/i.test(err.message)) return false;
			throw err;
		}
	},
	/** The tunnel's routes: SSH on its own host name, nothing else (plan §5). */
	async routeSsh(key: string, accountId: string, id: string, sshHost: string): Promise<void> {
		await call('PUT', `/accounts/${accountId}/cfd_tunnel/${id}/configurations`, key, {
			config: {
				ingress: [{ hostname: sshHost, service: 'ssh://localhost:22' }, { service: 'http_status:404' }],
				// WARP devices reach the server's private address through this tunnel (owner, 21 Nov).
				'warp-routing': { enabled: true },
			},
		});
	},
	/** Points `host` at the tunnel (CNAME, proxied); refuses a record that points anywhere else. */
	async pointTunnel(key: string, zoneId: string, host: string, tunnelId: string): Promise<'created' | 'kept'> {
		const target = `${tunnelId}.cfargotunnel.com`;
		const existing = arr(
			await call('GET', `/zones/${zoneId}/dns_records?name=${encodeURIComponent(host)}&per_page=50`, key),
		).map(rec);
		if (existing.some((r) => str(r['type']) === 'CNAME' && str(r['content']) === target)) return 'kept';
		const other = existing.find((r) => ['A', 'AAAA', 'CNAME'].includes(str(r['type'])));
		if (other)
			throw new VendorError(
				`${host} already points to ${str(other['content'])} (${str(other['type'])}); the console does not overwrite it.`,
				409,
			);
		await call('POST', `/zones/${zoneId}/dns_records`, key, {
			type: 'CNAME',
			name: host,
			content: target,
			proxied: true,
			ttl: 1,
			comment: 'Release Console: SSH through the server tunnel',
		});
		return 'created';
	},
	/** A service token for the deploy job; its secret is shown once, here, and goes straight to GitHub. */
	async serviceToken(key: string, accountId: string, name: string) {
		const t = rec(
			await call('POST', `/accounts/${accountId}/access/service_tokens`, key, { name, duration: '8760h' }),
		);
		return { id: str(t['id']), clientId: str(t['client_id']), clientSecret: str(t['client_secret']) };
	},
	async serviceTokensNamed(key: string, accountId: string, name: string): Promise<string[]> {
		return arr(await call('GET', `/accounts/${accountId}/access/service_tokens?per_page=100`, key))
			.map(rec)
			.filter((t) => str(t['name']) === name)
			.map((t) => str(t['id']));
	},
	async deleteServiceToken(key: string, accountId: string, id: string): Promise<void> {
		await call('DELETE', `/accounts/${accountId}/access/service_tokens/${id}`, key);
	},
	/** The Access application on the SSH host, if there is one. */
	async accessAppFor(key: string, accountId: string, host: string): Promise<{ id: string } | null> {
		const app = arr(await call('GET', `/accounts/${accountId}/access/apps?domain=${encodeURIComponent(host)}`, key))
			.map(rec)
			.find((a) => str(a['domain']) === host);
		return app ? { id: str(app['id']) } : null;
	},
	/**
	 * The SSH host's Access application with exactly two rules: the deploy job's service token, and
	 * the people on the project's list (a one-time code to their email). Made, or rewritten in place.
	 */
	async accessApp(
		key: string,
		accountId: string,
		input: { name: string; host: string; tokenId: string | null; emails: string[] },
	): Promise<string> {
		const policies = [
			...(input.tokenId
				? [
						{
							name: 'Deploy job',
							decision: 'non_identity',
							include: [{ service_token: { token_id: input.tokenId } }],
						},
					]
				: []),
			{
				name: 'People on the project list',
				decision: 'allow',
				include: input.emails.map((email) => ({ email: { email } })),
			},
		].map((p, n) => ({ ...p, precedence: n + 1 }));
		const body = {
			name: input.name,
			domain: input.host,
			// `ssh`: a self-hosted app that also draws an SSH terminal in the browser (owner, 21 Nov).
			type: 'ssh',
			session_duration: '24h',
			app_launcher_visible: false,
			policies,
		};
		const existing = await cfWrites.accessAppFor(key, accountId, input.host);
		const app = rec(
			existing
				? await call('PUT', `/accounts/${accountId}/access/apps/${existing.id}`, key, body)
				: await call('POST', `/accounts/${accountId}/access/apps`, key, body),
		);
		return str(app['id']);
	},
	async deleteAccessApp(key: string, accountId: string, id: string): Promise<void> {
		await call('DELETE', `/accounts/${accountId}/access/apps/${id}`, key);
	},
	/** Cloudflare's Origin CA signs the CSR made on the console's machine: 15 years, these hosts. */
	async originCertificate(key: string, csr: string, hosts: string[]): Promise<string> {
		const r = rec(
			await call('POST', '/certificates', key, {
				hostnames: hosts,
				requested_validity: 5475,
				request_type: 'origin-rsa',
				csr,
			}),
		);
		const cert = str(r['certificate']);
		if (!cert.includes('BEGIN CERTIFICATE')) throw new VendorError('Cloudflare returned no certificate.', 502);
		return cert;
	},
	/** Our own origin-pulls client certificate, uploaded for per-host Authenticated Origin Pulls. */
	async uploadOriginPulls(key: string, zoneId: string, certificate: string, privateKey: string): Promise<string> {
		const r = rec(
			await call('POST', `/zones/${zoneId}/origin_tls_client_auth/hostnames/certificates`, key, {
				certificate,
				private_key: privateKey,
			}),
		);
		return str(r['id']);
	},
	/** Whether every host already presents a client certificate to the origin. */
	async originPullsOn(key: string, zoneId: string, hosts: string[]): Promise<boolean> {
		for (const host of hosts) {
			const r = rec(
				await call(
					'GET',
					`/zones/${zoneId}/origin_tls_client_auth/hostnames/${encodeURIComponent(host)}`,
					key,
				).catch(() => null),
			);
			if (r['enabled'] !== true) return false;
		}
		return true;
	},
	async setOriginPulls(key: string, zoneId: string, hosts: string[], certId: string | null, enabled: boolean) {
		await call('PUT', `/zones/${zoneId}/origin_tls_client_auth/hostnames`, key, {
			config: hosts.map((hostname) => ({ hostname, enabled, ...(certId ? { cert_id: certId } : {}) })),
		});
	},
	/** Removes the tunnel CNAME of `host` (only when it points at this tunnel). */
	async unpointTunnel(key: string, zoneId: string, host: string, tunnelId: string): Promise<number> {
		const target = `${tunnelId}.cfargotunnel.com`;
		const ours = arr(
			await call(
				'GET',
				`/zones/${zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(host)}&per_page=50`,
				key,
			),
		)
			.map(rec)
			.filter((r) => str(r['content']) === target);
		for (const r of ours) await call('DELETE', `/zones/${zoneId}/dns_records/${str(r['id'])}`, key);
		return ours.length;
	},
	/** The server's private address, carried by its tunnel to WARP devices. */
	async privateRoute(
		key: string,
		accountId: string,
		tunnelId: string,
		network: string,
		comment: string,
	): Promise<void> {
		const routes = arr(
			await call('GET', `/accounts/${accountId}/teamnet/routes?is_deleted=false&per_page=100`, key),
		).map(rec);
		if (routes.some((r) => str(r['network']) === network && str(r['tunnel_id']) === tunnelId)) return;
		await call('POST', `/accounts/${accountId}/teamnet/routes`, key, { network, tunnel_id: tunnelId, comment });
	},
	async deletePrivateRoutes(key: string, accountId: string, tunnelId: string): Promise<number> {
		const ours = arr(await call('GET', `/accounts/${accountId}/teamnet/routes?is_deleted=false&per_page=100`, key))
			.map(rec)
			.filter((r) => str(r['tunnel_id']) === tunnelId);
		for (const r of ours) await call('DELETE', `/accounts/${accountId}/teamnet/routes/${str(r['id'])}`, key);
		return ours.length;
	},
	/** Who may sign a device into WARP: the project's SSH list (the account's WARP login app). */
	async warpEnrollment(key: string, accountId: string, emails: string[]): Promise<void> {
		const policies = [
			{
				name: 'People on the SSH list',
				decision: 'allow',
				include: emails.map((email) => ({ email: { email } })),
				precedence: 1,
			},
		];
		const app = arr(await call('GET', `/accounts/${accountId}/access/apps?per_page=100`, key))
			.map(rec)
			.find((a) => str(a['type']) === 'warp');
		const body = { type: 'warp', name: 'Warp Login App', session_duration: '720h', policies };
		if (app) await call('PUT', `/accounts/${accountId}/access/apps/${str(app['id'])}`, key, body);
		else await call('POST', `/accounts/${accountId}/access/apps`, key, body);
	},
	/**
	 * Sign-in by a one-time code sent to the person's email, for the SSH terminal in the browser and
	 * WARP. Zero Trust accounts made since June 2026 start with only "sign in with Cloudflare" (account
	 * members only), so it is added when missing. Answers whether it was added.
	 */
	async emailCodeSignIn(key: string, accountId: string): Promise<boolean> {
		const methods = arr(await call('GET', `/accounts/${accountId}/access/identity_providers`, key)).map(rec);
		if (methods.some((m) => str(m['type']) === 'onetimepin')) return false;
		await call('POST', `/accounts/${accountId}/access/identity_providers`, key, {
			name: 'One-time PIN',
			type: 'onetimepin',
			config: {},
		});
		return true;
	},
	/**
	 * WARP carries only these networks (include mode), so nothing else on a device changes. A new
	 * account starts in exclude mode, which sends everything through Cloudflare except private ranges
	 * (the servers' among them); setting the include list switches the mode, which is checked after.
	 */
	async warpInclude(key: string, accountId: string, networks: string[]): Promise<void> {
		const current = arr(
			await call('GET', `/accounts/${accountId}/devices/policy/include`, key).catch(() => []),
		).map(rec);
		const have = new Set(current.map((r) => str(r['address'])));
		const add = networks
			.filter((n) => !have.has(n))
			.map((address) => ({ address, description: 'Release Console: servers' }));
		if (add.length)
			await call('PUT', `/accounts/${accountId}/devices/policy/include`, key, [
				...current.map((r) => ({ address: str(r['address']), description: str(r['description']) })),
				...add,
			]);
		const policy = rec(await call('GET', `/accounts/${accountId}/devices/policy`, key));
		if (!arr(policy['include']).length || arr(policy['exclude']).length)
			throw new VendorError(
				'WARP is still in exclude mode, so it would send all of a device’s traffic through Cloudflare. Set Split Tunnels to Include in the default device profile on Cloudflare One.',
				409,
			);
	},
	/** Removes `host`'s A records that point at `ip` only. */
	async unpointHost(key: string, zoneId: string, host: string, ip: string): Promise<number> {
		const ours = arr(
			await call('GET', `/zones/${zoneId}/dns_records?type=A&name=${encodeURIComponent(host)}&per_page=50`, key),
		)
			.map(rec)
			.filter((r) => str(r['content']) === ip);
		for (const r of ours) await call('DELETE', `/zones/${zoneId}/dns_records/${str(r['id'])}`, key);
		return ours.length;
	},
};
