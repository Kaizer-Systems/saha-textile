/**
 * Read-only looks inside this Mac's stack for the console's Run and Watch screens: processes,
 * connections, networks, MongoDB, Redis, Meilisearch, patches, and a terminal of fixed commands.
 * Only containers named saha-textile-* are touched, every command is fixed here (never text from the
 * browser), and passwords are read inside their own container, so they never reach this process.
 */
import { execFile } from 'node:child_process';

export const STACK = /^saha-textile-[a-z0-9-]+$/;
export class InspectError extends Error {}

const run = (cmd, args, timeout = 20_000) =>
	new Promise((resolve) => {
		execFile(cmd, args, { encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) =>
			resolve({ ok: !error, out: String(stdout ?? ''), err: String(stderr ?? '').slice(0, 400) }),
		);
	});

function container(name) {
	if (typeof name !== 'string' || !STACK.test(name)) throw new InspectError('Name a saha-textile-* container.');
	return name;
}

const lines = (text) => text.split('\n').filter((l) => l.trim());

/** Processes inside one container. */
export async function topOf(name) {
	const r = await run('docker', ['top', container(name), '-eo', 'pid,ppid,pcpu,pmem,rss,etime,comm,args']);
	if (!r.ok) throw new InspectError(`docker top failed: ${r.err || 'container not running'}`);
	const [, ...rows] = lines(r.out);
	return rows.map((l) => {
		const p = l.trim().split(/\s+/);
		return {
			pid: Number(p[0]),
			ppid: Number(p[1]),
			cpu: Number(p[2]),
			mem: Number(p[3]),
			rssKb: Number(p[4]),
			elapsed: p[5] ?? '',
			command: p[6] ?? '',
			args: p.slice(7).join(' ').slice(0, 300),
		};
	});
}

/** One container's facts, without its environment values. */
export async function factsOf(name) {
	const r = await run('docker', ['inspect', container(name)]);
	if (!r.ok) throw new InspectError(`docker inspect failed: ${r.err}`);
	const c = JSON.parse(r.out)[0] ?? {};
	return {
		name,
		image: c.Config?.Image ?? '',
		started: c.State?.StartedAt ?? null,
		status: c.State?.Status ?? '',
		restarts: c.RestartCount ?? 0,
		oomKilled: !!c.State?.OOMKilled,
		health: c.State?.Health?.Status ?? 'none',
		healthLog: (c.State?.Health?.Log ?? [])
			.slice(-5)
			.map((h) => ({ at: h.End, code: h.ExitCode, out: String(h.Output ?? '').slice(0, 200) })),
		ports: Object.entries(c.NetworkSettings?.Ports ?? {}).map(
			([k, v]) => `${k} → ${(v ?? []).map((b) => `${b.HostIp}:${b.HostPort}`).join(', ') || 'not published'}`,
		),
		networks: Object.entries(c.NetworkSettings?.Networks ?? {}).map(([n, v]) => `${n} ${v.IPAddress ?? ''}`),
		mounts: (c.Mounts ?? []).map((m) => `${m.Type} ${m.Destination}`),
		envNames: (c.Config?.Env ?? []).map((e) => String(e).split('=')[0]),
	};
}

const hexIp = (h) => {
	const [ip, port] = h.split(':');
	if (!ip || ip.length !== 8) return `${h}`;
	const parts = ip
		.match(/../g)
		.reverse()
		.map((x) => parseInt(x, 16));
	return `${parts.join('.')}:${parseInt(port ?? '0', 16)}`;
};
const TCP_STATES = { '01': 'established', '02': 'syn-sent', '06': 'time-wait', '0A': 'listening', '08': 'close-wait' };

/** Open TCP connections of one container, from /proc/net/tcp (IPv4). */
export async function connectionsOf(name) {
	const r = await run('docker', ['exec', container(name), 'cat', '/proc/net/tcp']);
	if (!r.ok) throw new InspectError(`Could not read connections: ${r.err}`);
	const [, ...rows] = lines(r.out);
	return rows.map((l) => {
		const p = l.trim().split(/\s+/);
		return { local: hexIp(p[1] ?? ''), remote: hexIp(p[2] ?? ''), state: TCP_STATES[p[3] ?? ''] ?? p[3] ?? '' };
	});
}

/** The stack's Docker networks and who is on them. */
export async function networks() {
	const ls = await run('docker', ['network', 'ls', '--format', '{{.Name}}']);
	const names = lines(ls.out).filter((n) => n.startsWith('saha-textile') || n.startsWith('stack'));
	const out = [];
	for (const n of names) {
		const r = await run('docker', ['network', 'inspect', n]);
		const j = r.ok ? (JSON.parse(r.out)[0] ?? {}) : {};
		out.push({
			name: n,
			driver: j.Driver ?? '',
			subnet: j.IPAM?.Config?.[0]?.Subnet ?? '',
			members: Object.values(j.Containers ?? {}).map(
				(c) => `${c.Name} ${String(c.IPv4Address ?? '').split('/')[0]}`,
			),
		});
	}
	return out;
}

const MONGO_DB = /^saha_textile_[a-z0-9_]+$/;
/** The fixed report the MongoDB screens read; runs inside the Mongo container with its own login. */
const MONGO_REPORT = `
const name = process.env.REPORT_DB;
const d = db.getSiblingDB(name);
const out = { db: name };
out.dbs = db.adminCommand({ listDatabases: 1 }).databases.map((x) => ({ name: x.name, size: x.sizeOnDisk }));
out.stats = d.stats();
out.collections = d.getCollectionNames().sort().map((c) => {
	let s = {};
	try { s = d.getCollection(c).aggregate([{ $collStats: { storageStats: {} } }]).toArray()[0]?.storageStats ?? {}; } catch (e) {}
	return { name: c, count: s.count ?? d.getCollection(c).estimatedDocumentCount(), size: s.size ?? 0, storage: s.storageSize ?? 0, indexSize: s.totalIndexSize ?? 0, indexes: d.getCollection(c).getIndexes().map((i) => ({ name: i.name, key: JSON.stringify(i.key), unique: !!i.unique, ttl: i.expireAfterSeconds ?? null })) };
});
const ss = db.serverStatus();
out.server = { version: ss.version, uptime: ss.uptime, connections: ss.connections, opcounters: ss.opcounters, memMb: ss.mem };
out.ops = db.currentOp({ active: true }).inprog.filter((o) => o.op !== 'none' && o.ns).map((o) => ({ op: o.op, ns: o.ns, secs: o.secs_running ?? 0, plan: o.planSummary ?? '' }));
out.profile = d.getProfilingStatus();
// A query's shape only: every value becomes ?, so an email or a token in a filter never leaves.
const shape = (v) => (Array.isArray(v) ? v.slice(0, 5).map(shape) : v && typeof v === 'object' && !(v instanceof Date) ? Object.fromEntries(Object.entries(v).slice(0, 20).map(([k, x]) => [k, x && typeof x === 'object' ? shape(x) : '?'])) : '?');
out.slow = d.getCollectionNames().includes('system.profile') ? d.system.profile.find().sort({ ts: -1 }).limit(60).toArray().map((p) => ({ at: p.ts, op: p.op, ns: p.ns, ms: p.millis, plan: p.planSummary ?? '', keys: p.keysExamined ?? 0, docs: p.docsExamined ?? 0, returned: p.nreturned ?? 0, shape: JSON.stringify(shape(p.command?.filter ?? p.command?.pipeline ?? p.query ?? {})).slice(0, 240) })) : [];
try { out.rs = rs.status().members.map((m) => ({ name: m.name, state: m.stateStr, health: m.health })); } catch (e) { out.rs = []; }
out.migrations = d.releaseMigrations.find({}, { description: 1, result: 1, ranAt: 1, ms: 1 }).sort({ ranAt: -1 }).limit(100).toArray();
out.switches = d.communicationSwitches.find({}, { _id: 0 }).limit(200).toArray();
out.settings = d.siteSettings.find({}, { _id: 0, key: 1, updatedAt: 1 }).limit(100).toArray();
const since = new Date(Date.now() - 30 * 86400000);

out.orders = d.orders.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, n: { $sum: 1 }, inr: { $sum: { $ifNull: ['$totals.grandTotal', { $ifNull: ['$total', 0] }] } } } }, { $sort: { _id: 1 } }]).toArray();
out.payments = d.payments.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]).toArray();
out.stuckAttempts = d.paymentAttempts.countDocuments({ status: { $in: ['pending', 'created', 'initiated'] }, createdAt: { $lt: new Date(Date.now() - 30 * 60000) } });
out.admins = d.adminUsers.find({}, { _id: 0, email: 1, status: 1, lastLoginAt: 1, createdAt: 1 }).limit(100).toArray();
out.sessions = d.authSessions.aggregate([{ $match: { expiresAt: { $gt: new Date() } } }, { $group: { _id: { $ifNull: ['$kind', '$audience'] }, n: { $sum: 1 } } }]).toArray();
out.consent = d.consentEvents.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: { $ifNull: ['$decision', '$action'] }, n: { $sum: 1 } } }]).toArray();
print(EJSON.stringify(out, { relaxed: true }));
`;

export async function mongoReport(name, dbName) {
	if (!MONGO_DB.test(dbName ?? '')) throw new InspectError('Name a saha_textile_* database.');
	const r = await run(
		'docker',
		[
			'exec',
			'-e',
			`REPORT_DB=${dbName}`,
			container(name),
			'sh',
			'-c',
			'mongosh -u "$(cat /run/secrets/mongo-root-username)" -p "$(cat /run/secrets/mongo-root-password)" --authenticationDatabase admin --quiet --eval "$0"',
			MONGO_REPORT,
		],
		45_000,
	);
	if (!r.ok) throw new InspectError(`mongosh failed: ${r.err || 'no answer'}`);
	const text = r.out.trim().split('\n').pop() ?? '{}';
	return JSON.parse(text);
}

/** Turns slow-query profiling on (100 ms) or off for one local database. */
export async function mongoProfile(name, dbName, on) {
	if (!MONGO_DB.test(dbName ?? '')) throw new InspectError('Name a saha_textile_* database.');
	const script = `db.getSiblingDB(process.env.REPORT_DB).setProfilingLevel(${on ? 1 : 0}, { slowms: 100 }); print('ok')`;
	const r = await run('docker', [
		'exec',
		'-e',
		`REPORT_DB=${dbName}`,
		container(name),
		'sh',
		'-c',
		'mongosh -u "$(cat /run/secrets/mongo-root-username)" -p "$(cat /run/secrets/mongo-root-password)" --authenticationDatabase admin --quiet --eval "$0"',
		script,
	]);
	if (!r.ok) throw new InspectError(`mongosh failed: ${r.err}`);
	return { on };
}

/** Redis INFO and the job queues' sizes (BullMQ keys), read with the password inside its container. */
export async function redisReport(name) {
	const cli = (args) =>
		run('docker', [
			'exec',
			container(name),
			'sh',
			'-c',
			`redis-cli -a "$(cat /run/secrets/redis-password)" --no-auth-warning ${args}`,
		]);
	const [info, keys] = await Promise.all([cli('INFO'), cli("--scan --pattern 'bull:*:meta' --count 1000")]);
	if (!info.ok) throw new InspectError(`redis-cli failed: ${info.err}`);
	const fields = Object.fromEntries(
		lines(info.out)
			.filter((l) => l.includes(':'))
			.map((l) => l.split(':').map((x) => x.trim())),
	);
	const queues = [...new Set(lines(keys.out).map((k) => k.replace(/^bull:/, '').replace(/:meta$/, '')))].slice(0, 40);
	const sizes = [];
	for (const q of queues) {
		const r = await cli(
			`EVAL "return {redis.call('LLEN','bull:'..ARGV[1]..':wait'),redis.call('ZCARD','bull:'..ARGV[1]..':active') + redis.call('LLEN','bull:'..ARGV[1]..':active'),redis.call('ZCARD','bull:'..ARGV[1]..':delayed'),redis.call('ZCARD','bull:'..ARGV[1]..':failed'),redis.call('ZCARD','bull:'..ARGV[1]..':completed'),redis.call('ZCARD','bull:'..ARGV[1]..':repeat')}" 0 ${q.replace(/[^a-zA-Z0-9:_-]/g, '')}`,
		);
		const n = lines(r.out).map(Number);
		sizes.push({
			queue: q,
			waiting: n[0] ?? 0,
			active: n[1] ?? 0,
			delayed: n[2] ?? 0,
			failed: n[3] ?? 0,
			completed: n[4] ?? 0,
			repeat: n[5] ?? 0,
		});
	}
	const failedJobs = [];
	const schedules = [];
	for (const q of sizes) {
		const qn = q.queue.replace(/[^a-zA-Z0-9:_-]/g, '');
		if (q.failed) {
			const ids = lines((await cli(`ZREVRANGE bull:${qn}:failed 0 19`)).out);
			for (const id of ids) {
				const f = lines(
					(
						await cli(
							`HMGET bull:${qn}:${id.replace(/[^a-zA-Z0-9:_-]/g, '')} name failedReason finishedOn attemptsMade`,
						)
					).out,
				);
				failedJobs.push({
					queue: q.queue,
					id,
					name: f[0] ?? '',
					reason: (f[1] ?? '').slice(0, 300),
					at: Number(f[2] ?? 0),
					attempts: Number(f[3] ?? 0),
				});
			}
		}
		if (q.repeat) {
			const r = lines((await cli(`ZRANGE bull:${qn}:repeat 0 49 WITHSCORES`)).out);
			for (let i = 0; i + 1 < r.length; i += 2)
				schedules.push({ queue: q.queue, key: (r[i] ?? '').slice(0, 200), next: Number(r[i + 1] ?? 0) });
		}
	}
	return {
		failedJobs,
		schedules,
		version: fields.redis_version ?? '',
		uptime: Number(fields.uptime_in_seconds ?? 0),
		memory: fields.used_memory_human ?? '',
		clients: Number(fields.connected_clients ?? 0),
		keys: lines(info.out).filter((l) => /^db\d+:/.test(l)),
		evicted: Number(fields.evicted_keys ?? 0),
		queues: sizes,
	};
}

/** Meilisearch health, indexes, stats and failed tasks, asked inside its container with its key. */
export async function meiliReport(name) {
	const get = (path) =>
		run('docker', [
			'exec',
			container(name),
			'sh',
			'-c',
			`KEY=$(sed -n 's/^master_key *= *"\\(.*\\)"/\\1/p' "$MEILI_CONFIG_FILE_PATH"); curl -s -H "Authorization: Bearer $KEY" http://127.0.0.1:7700${path}`,
		]);
	const [health, version, stats, indexes, failed] = await Promise.all([
		get('/health'),
		get('/version'),
		get('/stats'),
		get('/indexes?limit=100'),
		get('/tasks?statuses=failed&limit=20'),
	]);
	const parse = (r) => {
		try {
			return JSON.parse(r.out);
		} catch {
			return {};
		}
	};
	return {
		health: parse(health).status ?? 'unknown',
		version: parse(version).pkgVersion ?? '',
		stats: parse(stats),
		indexes: parse(indexes).results ?? [],
		failed: (parse(failed).results ?? []).map((t) => ({
			uid: t.uid,
			index: t.indexUid,
			type: t.type,
			error: t.error?.message ?? '',
			at: t.finishedAt,
		})),
	};
}

/** Outdated Homebrew packages and how old the stack's images are. */
export async function patches() {
	const [brew, images] = await Promise.all([
		run('brew', ['outdated', '--json=v2'], 60_000),
		run('docker', ['images', '--format', '{{json .}}']),
	]);
	const outdated = (() => {
		try {
			const j = JSON.parse(brew.out || '{}');
			return [...(j.formulae ?? []), ...(j.casks ?? [])].map((f) => ({
				name: f.name,
				now: (f.installed_versions ?? [f.installed_versions])[0] ?? '',
				next: f.current_version ?? '',
			}));
		} catch {
			return [];
		}
	})();
	const imgs = lines(images.out)
		.map((l) => JSON.parse(l))
		.filter((i) => /saha-textile|mongo|redis|meilisearch|nginx|node/.test(String(i.Repository)))
		.map((i) => ({
			image: `${i.Repository}:${i.Tag}`,
			created: i.CreatedSince ?? i.CreatedAt ?? '',
			size: i.Size ?? '',
		}));
	return { outdated, images: imgs };
}

/** The terminal's fixed commands; nothing else can be run from the console. */
export const COMMANDS = {
	'disk-free': { label: 'Disk space (df -h)', args: (c) => ['exec', c, 'df', '-h'] },
	memory: {
		label: 'Memory (free -m)',
		args: (c) => ['exec', c, 'sh', '-c', 'free -m 2>/dev/null || cat /proc/meminfo | head -5'],
	},
	uptime: {
		label: 'Uptime and load',
		args: (c) => ['exec', c, 'sh', '-c', 'uptime 2>/dev/null || cat /proc/loadavg'],
	},
	processes: { label: 'Processes (ps)', args: (c) => ['exec', c, 'sh', '-c', 'ps aux 2>/dev/null || ps'] },
	'logs-200': { label: 'Last 200 log lines', args: (c) => ['logs', '--tail', '200', c] },
	'env-names': {
		label: 'Environment names (never values)',
		args: (c) => ['exec', c, 'sh', '-c', 'env | cut -d= -f1 | sort'],
	},
	'mongo-ping': {
		label: 'MongoDB ping',
		args: (c) => [
			'exec',
			c,
			'sh',
			'-c',
			'mongosh -u "$(cat /run/secrets/mongo-root-username)" -p "$(cat /run/secrets/mongo-root-password)" --authenticationDatabase admin --quiet --eval "JSON.stringify(db.adminCommand({ping:1}))"',
		],
	},
	'redis-ping': {
		label: 'Redis ping',
		args: (c) => [
			'exec',
			c,
			'sh',
			'-c',
			'redis-cli -a "$(cat /run/secrets/redis-password)" --no-auth-warning PING',
		],
	},
	'meili-health': {
		label: 'Meilisearch health',
		args: (c) => ['exec', c, 'curl', '-s', 'http://127.0.0.1:7700/health'],
	},
};

export async function terminal(name, command) {
	const cmd = COMMANDS[command];
	if (!cmd) throw new InspectError('Choose one of the listed commands.');
	const r = await run('docker', cmd.args(container(name)), 30_000);
	const text = `${r.out}${r.ok ? '' : `\n${r.err}`}`;
	return { command: cmd.label, container: name, ok: r.ok, lines: text.split('\n').slice(-400) };
}

/** Every command the terminal offers, for the picker. */
export const commandList = () => Object.entries(COMMANDS).map(([id, c]) => ({ id, label: c.label }));

/** Restarts one stack container (the console asks for the PIN first). */
export async function restart(name) {
	const r = await run('docker', ['restart', container(name)], 60_000);
	if (!r.ok) throw new InspectError(`docker restart failed: ${r.err}`);
	return { restarted: name };
}
