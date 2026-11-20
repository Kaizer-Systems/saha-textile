import { Injectable } from '@nestjs/common';
import {
	ALERT_RULES,
	type Alert,
	type AlertRule,
	type AlertRuleState,
	type AlertsView,
	type DockerSnapshot,
	type Job,
	type MacSnapshot,
	type Project,
} from '@saha-textile/release-console-contracts';

import { ConsoleStore } from '../store/console-store.js';

/** One thing wrong right now. */
export interface Finding {
	rule: AlertRule;
	subject: string;
	level: 'amber' | 'red';
	title: string;
	detail: string;
}

export interface Readings {
	mac: MacSnapshot | null;
	docker: DockerSnapshot | null;
	/** False when the Mac helper did not answer this time. */
	helper: boolean;
	jobs: Job[] | null;
	projects: Project[];
	/** Requests and server errors of the last 5 minutes from the edge's log; null without one. */
	requests?: { total: number; serverErrors: number } | null;
}

const GB = 1024 ** 3;
const DAY_MS = 86_400_000;
const KEEP_MS = 7 * DAY_MS;

/** The rules as the Alerts screen lists them; `errors-rising` waits for the edge's request log. */
export const RULES: Record<AlertRule, Omit<AlertRuleState, 'state' | 'note'>> = {
	disk: {
		rule: 'disk',
		label: 'Start-up disk filling',
		watches: 'this Mac',
		firesWhen: 'over 85% used (red over 95%)',
		sendsTo: 'Attention and this screen',
	},
	'container-down': {
		rule: 'container-down',
		label: 'A container stopped',
		watches: 'Docker on this Mac',
		firesWhen: 'a stack container stops or fails its health check for 30 s while the stack runs',
		sendsTo: 'Attention and this screen',
	},
	'helper-down': {
		rule: 'helper-down',
		label: 'Mac helper silent',
		watches: 'the console',
		firesWhen: 'no answer for 1 minute',
		sendsTo: 'Attention and this screen',
	},
	'run-failed': {
		rule: 'run-failed',
		label: 'Local run failed',
		watches: 'Live deploy',
		firesWhen: 'the latest local pipeline run failed',
		sendsTo: 'Attention and this screen',
	},
	'key-expiring': {
		rule: 'key-expiring',
		label: 'Key expiring',
		watches: 'Connections',
		firesWhen: 'a linked key expires within 14 days, has expired, or fails its check',
		sendsTo: 'Attention and this screen',
	},
	'errors-rising': {
		rule: 'errors-rising',
		label: 'Errors rising',
		watches: 'the edge’s request log',
		firesWhen: 'server errors over 5% of requests for 5 minutes',
		sendsTo: 'Attention and this screen',
	},
};

/** How many 5-second checks in a row a finding needs before it fires. */
const NEEDS: Record<AlertRule, number> = {
	disk: 1,
	'container-down': 6,
	'helper-down': 12,
	'run-failed': 1,
	'key-expiring': 1,
	'errors-rising': 1,
};

const pct = (part: number, whole: number) => Math.round((part / whole) * 100);
const gb = (bytes: number) => `${(bytes / GB).toFixed(1)} GB`;
const short = (name: string) => name.replace(/^saha-textile-(stack-)?/, '').replace(/-1$/, '');

/** What is wrong now, and which rules could be judged from these readings. */
export function findings(r: Readings): { found: Finding[]; judged: Set<AlertRule> } {
	const found: Finding[] = [];
	const judged = new Set<AlertRule>(['helper-down', 'key-expiring']);
	if (!r.helper)
		found.push({
			rule: 'helper-down',
			subject: 'Mac helper',
			level: 'red',
			title: 'The Mac helper is not answering',
			detail: 'This Mac’s figures, Docker and local runs are unknown until it answers.',
		});

	if (r.mac?.disk) {
		judged.add('disk');
		const { used, total, free } = r.mac.disk;
		const p = pct(used, total);
		if (p >= 85)
			found.push({
				rule: 'disk',
				subject: 'start-up disk',
				level: p >= 95 ? 'red' : 'amber',
				title: `Start-up disk ${p}% full`,
				detail: `${gb(free)} free of ${gb(total)}.`,
			});
	}

	if (r.docker) {
		judged.add('container-down');
		const stack = r.docker.containers.filter((c) => c.name.startsWith('saha-textile-stack-'));
		if (stack.some((c) => c.state === 'running'))
			for (const c of stack) {
				const unhealthy = c.status.includes('unhealthy');
				if (c.state !== 'running' || unhealthy)
					found.push({
						rule: 'container-down',
						subject: c.name,
						level: 'red',
						title: `${short(c.name)} ${unhealthy ? 'fails its health check' : `is ${c.state}`}`,
						detail: c.status,
					});
			}
	}

	if (r.jobs) {
		judged.add('run-failed');
		const last = r.jobs
			.filter((j) => j.kind === 'pipeline')
			.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
		if (last?.status === 'failed')
			found.push({
				rule: 'run-failed',
				subject: last.id,
				level: 'amber',
				title: 'The latest local run failed',
				detail: `${last.label}${last.finishedAt ? `, ended ${last.finishedAt.slice(11, 16)}` : ''}.`,
			});
	}

	if (r.requests) {
		judged.add('errors-rising');
		const { total, serverErrors } = r.requests;
		if (total >= 20 && serverErrors / total > 0.05)
			found.push({
				rule: 'errors-rising',
				subject: 'local stack',
				level: serverErrors / total > 0.2 ? 'red' : 'amber',
				title: `Server errors at ${Math.round((serverErrors / total) * 100)}% of requests`,
				detail: `${serverErrors} of ${total} requests in the last 5 minutes answered 5xx.`,
			});
	}

	for (const p of r.projects)
		for (const k of p.keys) {
			if (k.state !== 'expiring' && k.state !== 'expired' && k.state !== 'failed') continue;
			found.push({
				rule: 'key-expiring',
				subject: `${p.id}:${k.id}`,
				level: k.state === 'expiring' ? 'amber' : 'red',
				title: `${p.name} · ${k.label} ${k.state === 'failed' ? 'fails its check' : k.state === 'expired' ? 'has expired' : 'expires soon'}`,
				detail: k.expiresAt ? `Expiry ${k.expiresAt.slice(0, 10)}.` : k.note || 'See Connections.',
			});
		}
	return { found, judged };
}

interface AlertRow {
	id: number;
	rule: string;
	subject: string;
	level: string;
	title: string;
	detail: string;
	fired_at: string;
	resolved_at: string | null;
}

const toAlert = (r: AlertRow): Alert => ({
	id: r.id,
	rule: r.rule as AlertRule,
	subject: r.subject,
	level: r.level === 'red' ? 'red' : 'amber',
	title: r.title,
	detail: r.detail,
	firedAt: r.fired_at,
	resolvedAt: r.resolved_at,
});

/**
 * Local alerts: the rules above, checked on every reading of the stats collector. An alert fires
 * once its finding has held long enough, ends when the finding is gone, and stays listed for 7
 * days after it ends. Rules that a reading cannot judge (no answer from the helper) keep their state.
 */
@Injectable()
export class LocalAlerts {
	private readonly streak = new Map<string, number>();
	private checkedAt: string | null = null;
	private requestLog = false;

	constructor(private readonly store: ConsoleStore) {}

	evaluate(r: Readings, now = Date.now()): void {
		if (r.requests) this.requestLog = true;
		const at = new Date(now).toISOString();
		const { found, judged } = findings(r);
		const db = this.store.db();
		const open = db.prepare('SELECT * FROM alerts WHERE resolved_at IS NULL').all() as unknown as AlertRow[];
		const seen = new Set<string>();
		for (const f of found) {
			const key = `${f.rule}|${f.subject}`;
			seen.add(key);
			const n = (this.streak.get(key) ?? 0) + 1;
			this.streak.set(key, n);
			if (n < NEEDS[f.rule]) continue;
			const row = open.find((a) => a.rule === f.rule && a.subject === f.subject);
			if (row)
				db.prepare('UPDATE alerts SET level = ?, title = ?, detail = ? WHERE id = ?').run(
					f.level,
					f.title,
					f.detail,
					row.id,
				);
			else
				db.prepare(
					'INSERT INTO alerts (rule, subject, level, title, detail, fired_at) VALUES (?, ?, ?, ?, ?, ?)',
				).run(f.rule, f.subject, f.level, f.title, f.detail, at);
		}
		for (const key of [...this.streak.keys()])
			if (!seen.has(key) && judged.has(key.split('|')[0] as AlertRule)) this.streak.delete(key);
		for (const a of open)
			if (judged.has(a.rule as AlertRule) && !seen.has(`${a.rule}|${a.subject}`))
				db.prepare('UPDATE alerts SET resolved_at = ? WHERE id = ?').run(at, a.id);
		db.prepare('DELETE FROM alerts WHERE resolved_at IS NOT NULL AND resolved_at < ?').run(
			new Date(now - KEEP_MS).toISOString(),
		);
		this.checkedAt = at;
	}

	firing(): Alert[] {
		const rows = this.store
			.db()
			.prepare('SELECT * FROM alerts WHERE resolved_at IS NULL ORDER BY fired_at DESC')
			.all() as unknown as AlertRow[];
		return rows.map(toAlert);
	}

	view(): AlertsView {
		const firing = this.firing();
		const recent = (
			this.store
				.db()
				.prepare('SELECT * FROM alerts WHERE resolved_at IS NOT NULL ORDER BY resolved_at DESC LIMIT 50')
				.all() as unknown as AlertRow[]
		).map(toAlert);
		const rules = ALERT_RULES.map((rule): AlertRuleState => {
			if (rule === 'errors-rising' && !this.requestLog)
				return {
					...RULES[rule],
					state: 'waiting',
					note: 'Starts once the local stack’s edge is running and has served requests.',
				};
			return { ...RULES[rule], state: firing.some((a) => a.rule === rule) ? 'firing' : 'ok', note: null };
		});
		return { checkedAt: this.checkedAt, rules, firing, recent };
	}
}
