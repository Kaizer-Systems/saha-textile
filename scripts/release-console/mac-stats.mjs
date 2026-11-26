/**
 * Parsers for the Mac's own tools (`top`, `vm_stat`, `sysctl`, `df`, `netstat`) and Docker's JSON
 * output. Kept free of I/O so they are tested with captured text.
 */

/** `top -l 1 -n 0` → CPU split in percent. */
export function parseTopCpu(text) {
	const m = /CPU usage:\s*([\d.]+)% user,\s*([\d.]+)% sys,\s*([\d.]+)% idle/.exec(text);
	if (!m) return null;
	const [user, sys, idle] = [Number(m[1]), Number(m[2]), Number(m[3])];
	return { user, sys, idle, used: Math.round((100 - idle) * 100) / 100 };
}

/** `vm_stat` → bytes by kind; `pageSize` from its first line. */
export function parseVmStat(text) {
	const size = Number(/page size of (\d+) bytes/.exec(text)?.[1] ?? 16384);
	const pages = (label) => Number(new RegExp(`${label}:\\s+(\\d+)`).exec(text)?.[1] ?? 0);
	return {
		free: pages('Pages free') * size,
		active: pages('Pages active') * size,
		inactive: pages('Pages inactive') * size,
		speculative: pages('Pages speculative') * size,
		wired: pages('Pages wired down') * size,
		compressed: pages('Pages occupied by compressor') * size,
		purgeable: pages('Pages purgeable') * size,
	};
}

/** Memory in use the way Activity Monitor counts it: app memory (active − purgeable) + wired + compressed. */
export function memoryUsed(vm) {
	return Math.max(0, vm.active - vm.purgeable) + vm.wired + vm.compressed;
}

/** `sysctl -n vm.loadavg` → `{ 0.53 0.61 0.70 }`. */
export function parseLoad(text) {
	const nums = (text.match(/[\d.]+/g) ?? []).map(Number);
	return nums.length >= 3 ? { one: nums[0], five: nums[1], fifteen: nums[2] } : null;
}

/** `sysctl -n vm.swapusage` → used bytes. */
export function parseSwapUsed(text) {
	const m = /used = ([\d.]+)([MG])/.exec(text);
	if (!m) return 0;
	return Math.round(Number(m[1]) * (m[2] === 'G' ? 1024 ** 3 : 1024 ** 2));
}

/** `df -k /` → bytes of the start-up disk. On APFS, “used” counts this volume only, so used = total − available. */
export function parseDf(text) {
	const line = text.trim().split('\n')[1];
	if (!line) return null;
	const cols = line.trim().split(/\s+/);
	const total = Number(cols[1]) * 1024;
	const free = Number(cols[3]) * 1024;
	return Number.isFinite(total) && Number.isFinite(free) ? { total, free, used: total - free } : null;
}

/** `netstat -ib` → total bytes in and out over the physical interfaces (en*), counted once each. */
export function parseNetstat(text) {
	const seen = new Set();
	let rx = 0;
	let tx = 0;
	for (const line of text.split('\n').slice(1)) {
		const c = line.trim().split(/\s+/);
		const name = c[0] ?? '';
		if (!/^en\d+$/.test(name) || seen.has(name) || !(c[2] ?? '').startsWith('<Link#')) continue;
		seen.add(name);
		// Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll
		const ib = Number(c[c.length - 5]);
		const ob = Number(c[c.length - 2]);
		if (Number.isFinite(ib)) rx += ib;
		if (Number.isFinite(ob)) tx += ob;
	}
	return { rx, tx };
}

const UNITS = { B: 1, KB: 1e3, KIB: 1024, MB: 1e6, MIB: 1024 ** 2, GB: 1e9, GIB: 1024 ** 3, TB: 1e12, TIB: 1024 ** 4 };
/** `"52.3MiB"` → bytes; `null` when unreadable. */
export function parseSize(text) {
	const m = /^\s*([\d.]+)\s*([a-zA-Z]+)\s*$/.exec(text ?? '');
	if (!m) return null;
	const unit = UNITS[m[2].toUpperCase()];
	return unit === undefined ? null : Math.round(Number(m[1]) * unit);
}

/** Docker JSON lines (`--format '{{json .}}'`) → objects; bad lines are skipped. */
export function jsonLines(text) {
	return text
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean)
		.flatMap((l) => {
			try {
				return [JSON.parse(l)];
			} catch {
				return [];
			}
		});
}

/** One `docker stats --no-stream` row → numbers. */
export function containerStats(row) {
	const [memUsed = '', memLimit = ''] = String(row.MemUsage ?? '').split('/');
	const [netIn = '', netOut = ''] = String(row.NetIO ?? '').split('/');
	const [blockIn = '', blockOut = ''] = String(row.BlockIO ?? '').split('/');
	const cpu = Number.parseFloat(String(row.CPUPerc ?? '').replace('%', ''));
	return {
		name: String(row.Name ?? ''),
		cpuPercent: Number.isFinite(cpu) ? cpu : null,
		memoryBytes: parseSize(memUsed),
		memoryLimitBytes: parseSize(memLimit),
		netRxBytes: parseSize(netIn),
		netTxBytes: parseSize(netOut),
		blockReadBytes: parseSize(blockIn),
		blockWriteBytes: parseSize(blockOut),
		pids: Number(row.PIDs ?? 0) || 0,
	};
}
