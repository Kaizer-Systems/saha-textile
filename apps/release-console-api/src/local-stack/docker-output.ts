/**
 * Turns `docker ps` and `docker stats` JSON lines into the console's service rows.
 * Kept free of I/O so it is tested with real Docker output captured as text.
 */
import type { ServiceStatus } from '@saha-textile/release-console-contracts';

const STATES = new Set<ServiceStatus['state']>([
	'running',
	'restarting',
	'paused',
	'exited',
	'created',
	'dead',
	'removing',
]);
const UNITS: Record<string, number> = {
	B: 1,
	KB: 1e3,
	KIB: 1024,
	MB: 1e6,
	MIB: 1024 ** 2,
	GB: 1e9,
	GIB: 1024 ** 3,
	TB: 1e12,
	TIB: 1024 ** 4,
};

/** `"52.3MiB"` → bytes; `null` when Docker prints something we do not understand. */
export function parseSize(text: string): number | null {
	const m = /^\s*([\d.]+)\s*([a-zA-Z]+)\s*$/.exec(text);
	if (!m) return null;
	const unit = UNITS[(m[2] ?? '').toUpperCase()];
	const value = Number(m[1]);
	return unit === undefined || Number.isNaN(value) ? null : Math.round(value * unit);
}

function parseLines(raw: string): Record<string, unknown>[] {
	return raw
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean)
		.flatMap((l) => {
			try {
				const v: unknown = JSON.parse(l);
				return v && typeof v === 'object' ? [v as Record<string, unknown>] : [];
			} catch {
				return [];
			}
		});
}
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function healthOf(status: string): ServiceStatus['health'] {
	if (status.includes('(healthy)')) return 'healthy';
	if (status.includes('(unhealthy)')) return 'unhealthy';
	if (status.includes('(health: starting)')) return 'starting';
	return 'none';
}

/** Joins `docker ps -a --format '{{json .}}'` with `docker stats --no-stream --format '{{json .}}'`. */
export function toServices(psOutput: string, statsOutput: string, namePrefix: string): ServiceStatus[] {
	const stats = new Map(parseLines(statsOutput).map((s) => [str(s['Name']), s]));
	return parseLines(psOutput)
		.filter((c) => str(c['Names']).startsWith(namePrefix))
		.map((c) => {
			const name = str(c['Names']);
			const rawState = str(c['State']) as ServiceStatus['state'];
			const status = str(c['Status']);
			const s = stats.get(name);
			const [used = '', limit = ''] = str(s?.['MemUsage']).split('/');
			const cpu = Number.parseFloat(str(s?.['CPUPerc']).replace('%', ''));
			return {
				name,
				image: str(c['Image']),
				state: STATES.has(rawState) ? rawState : 'dead',
				health: healthOf(status),
				uptime: status,
				cpuPercent: s && !Number.isNaN(cpu) ? cpu : null,
				memoryBytes: s ? parseSize(used) : null,
				memoryLimitBytes: s ? parseSize(limit) : null,
			};
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}
