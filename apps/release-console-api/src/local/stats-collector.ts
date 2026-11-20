import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { DockerSnapshot, MacSnapshot, Series } from '@saha-textile/release-console-contracts';

import { RunnerClient } from '../runner/runner-client.js';
import { ConsoleStore } from '../store/console-store.js';

const EVERY_MS = 5000;
const RAW_KEEP_MS = 2 * 60 * 60 * 1000;
const MINUTE_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

type Counters = Record<string, number>;

/** Rate per second between two counter readings; `null` when there is no earlier reading or it went back. */
export function rate(prev: number | undefined, now: number, seconds: number): number | null {
	if (prev === undefined || seconds <= 0 || now < prev) return null;
	return (now - prev) / seconds;
}

/** The figures one reading adds to the history: `[source, name, value]`. */
export function samplesOf(
	mac: MacSnapshot | null,
	docker: DockerSnapshot | null,
	prev: Counters,
	seconds: number,
): { rows: [string, string, number][]; counters: Counters } {
	const rows: [string, string, number][] = [];
	const counters: Counters = {};
	const add = (source: string, name: string, v: number | null | undefined) => {
		if (typeof v === 'number' && Number.isFinite(v)) rows.push([source, name, v]);
	};
	const counted = (source: string, name: string, v: number | null) => {
		if (v === null) return;
		const key = `${source}|${name}`;
		counters[key] = v;
		add(source, `${name}_rate`, rate(prev[key], v, seconds));
	};
	if (mac) {
		add('mac', 'cpu', mac.cpu?.used);
		add('mac', 'mem_used', mac.memory.used);
		add('mac', 'swap_used', mac.swapUsed);
		add('mac', 'disk_used', mac.disk?.used);
		add('mac', 'load1', mac.load?.one);
		counted('mac', 'net_rx', mac.network.rx);
		counted('mac', 'net_tx', mac.network.tx);
	}
	for (const s of docker?.stats ?? []) {
		const source = `container:${s.name}`;
		add(source, 'cpu', s.cpuPercent);
		add(source, 'mem', s.memoryBytes);
		counted(source, 'net_rx', s.netRxBytes);
		counted(source, 'net_tx', s.netTxBytes);
		counted(source, 'block_read', s.blockReadBytes);
		counted(source, 'block_write', s.blockWriteBytes);
	}
	return { rows, counters };
}

/**
 * Reads the Mac and Docker through the Mac helper every 5 seconds and keeps the history in the
 * console's database: 5-second points for 2 hours, minute averages for 7 days. Off when
 * `CONSOLE_COLLECT=off` (tests) or while the helper does not answer.
 */
@Injectable()
export class StatsCollector implements OnModuleInit, OnModuleDestroy {
	private timer: NodeJS.Timeout | null = null;
	private prev: Counters = {};
	private prevAt = 0;
	private lastMinute = 0;
	private busy = false;
	latest: { mac: MacSnapshot | null; docker: DockerSnapshot | null; at: number; helper: boolean } = {
		mac: null,
		docker: null,
		at: 0,
		helper: false,
	};

	constructor(
		private readonly runner: RunnerClient,
		private readonly store: ConsoleStore,
	) {}

	onModuleInit(): void {
		if (process.env['CONSOLE_COLLECT'] === 'off') return;
		this.timer = setInterval(() => void this.tick(), EVERY_MS);
		this.timer.unref();
	}

	onModuleDestroy(): void {
		if (this.timer) clearInterval(this.timer);
	}

	async tick(now = Date.now()): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		try {
			const [mac, docker] = await Promise.all([
				this.runner.call<MacSnapshot>('GET', '/mac', undefined, 10_000),
				this.runner.call<DockerSnapshot>('GET', '/docker', undefined, 30_000),
			]);
			this.latest = { mac, docker, at: now, helper: true };
			const { rows, counters } = samplesOf(mac, docker, this.prev, (now - this.prevAt) / 1000);
			this.prev = counters;
			this.prevAt = now;
			this.save(rows, now);
		} catch {
			this.latest = { ...this.latest, helper: false };
		} finally {
			this.busy = false;
		}
	}

	save(rows: [string, string, number][], now: number): void {
		const db = this.store.db();
		const insert = db.prepare('INSERT INTO samples (ts, source, name, value) VALUES (?, ?, ?, ?)');
		db.exec('BEGIN');
		for (const [source, name, value] of rows) insert.run(now, source, name, value);
		db.exec('COMMIT');
		const minute = Math.floor(now / 60_000) * 60_000;
		if (minute > this.lastMinute) {
			if (this.lastMinute) {
				db.prepare(
					`INSERT INTO samples (ts, source, name, value)
					 SELECT ?, 'm:' || source, name, AVG(value) FROM samples
					 WHERE ts >= ? AND ts < ? AND source NOT LIKE 'm:%' GROUP BY source, name`,
				).run(this.lastMinute, this.lastMinute, minute);
			}
			db.prepare(`DELETE FROM samples WHERE source NOT LIKE 'm:%' AND ts < ?`).run(now - RAW_KEEP_MS);
			db.prepare(`DELETE FROM samples WHERE source LIKE 'm:%' AND ts < ?`).run(now - MINUTE_KEEP_MS);
			this.lastMinute = minute;
		}
	}

	/** One source's figures over the last `minutes`: 5-second points up to 2 hours, minute averages beyond. */
	history(source: string, names: string[], minutes: number, now = Date.now()): Series[] {
		const span = Math.min(Math.max(minutes, 1), 7 * 24 * 60) * 60_000;
		const fromRaw = span <= RAW_KEEP_MS;
		const src = fromRaw ? source : `m:${source}`;
		const stmt = this.store
			.db()
			.prepare('SELECT ts, value FROM samples WHERE source = ? AND name = ? AND ts >= ? ORDER BY ts');
		return names.map((name) => ({
			source,
			name,
			points: (stmt.all(src, name, now - span) as { ts: number; value: number }[]).map(
				(r) => [r.ts, r.value] as [number, number],
			),
		}));
	}
}
