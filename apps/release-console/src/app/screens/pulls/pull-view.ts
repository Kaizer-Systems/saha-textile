import { highlightedLines } from '../coverage-view';

import type {
	CheckCounts,
	DiffLine,
	PullCheck,
	PullCommit,
	PullEvent,
	PullFile,
	PullPage,
	ReviewState,
} from '@saha-textile/release-console-contracts';

/** A colour word the console's pills, dots and text already have. */
export type Tone = 'ok' | 'amber' | 'red' | 'cy' | 'muted';
export interface Said {
	tone: Tone;
	text: string;
}

const n = (x: number) => x.toLocaleString('en-IN');

/** The list's Checks column: what is running, failed, or that all passed. */
export function checksSaid(c: CheckCounts | null): Said {
	if (!c || !c.total) return { tone: 'muted', text: 'no checks' };
	if (c.failed) return { tone: 'red', text: `${n(c.failed)} failed` };
	if (c.running) return { tone: 'amber', text: `${n(c.running)} running` };
	return { tone: 'ok', text: `${n(c.passed)} passed` };
}

const REVIEW_SAID: Record<ReviewState, Said> = {
	approved: { tone: 'ok', text: 'approved' },
	changes: { tone: 'red', text: 'changes asked for' },
	required: { tone: 'muted', text: 'needs review' },
	none: { tone: 'muted', text: '—' },
};
/** The list's Review column. */
export const reviewSaid = (r: ReviewState): Said => REVIEW_SAID[r];

/** The merge status at the top of every tab, as GitHub's new pull request page puts it there. */
export interface MergeStatus {
	tone: Tone;
	items: Said[];
	/** GitHub will take a merge now. */
	canMerge: boolean;
	/** Why Merge stays off, in words; empty when it can merge. */
	why: string;
	/** Offer Merge when ready: the repository allows it and it is not on yet. */
	offerAuto: boolean;
}

const day = (iso: string) =>
	new Date(iso).toLocaleDateString('en-GB', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		timeZone: 'Asia/Kolkata',
	});

export function mergeStatus(p: PullPage): MergeStatus {
	if (p.state === 'merged')
		return {
			tone: 'ok',
			items: [{ tone: 'ok', text: `Merged by ${p.mergedBy} on ${day(String(p.mergedAt))}` }],
			canMerge: false,
			why: 'It is merged.',
			offerAuto: false,
		};
	if (p.state === 'closed')
		return {
			tone: 'muted',
			items: [{ tone: 'muted', text: `Closed without merging on ${day(String(p.closedAt))}` }],
			canMerge: false,
			why: 'It is closed.',
			offerAuto: false,
		};
	const c = p.checks;
	const items: Said[] = [];
	const why: string[] = [];
	if (p.draft) {
		items.push({ tone: 'amber', text: '● Draft' });
		why.push('it is a draft');
	}
	if (c.running) {
		items.push({ tone: 'amber', text: `◔ ${n(c.running)} of ${n(c.total)} checks running` });
		why.push('checks are running');
	}
	if (c.total) items.push({ tone: 'ok', text: `✓ ${n(c.passed)} passed` });
	if (c.failed) {
		items.push({ tone: 'red', text: `✕ ${n(c.failed)} failed` });
		why.push(`${n(c.failed)} ${c.failed === 1 ? 'check' : 'checks'} failed`);
	} else if (c.total) items.push({ tone: 'muted', text: '0 failed' });
	if (p.review === 'approved') items.push({ tone: 'ok', text: '✓ Approved' });
	if (p.review === 'changes') {
		items.push({ tone: 'red', text: '● Changes asked for' });
		why.push('changes were asked for');
	}
	if (p.review === 'required') {
		items.push({ tone: 'amber', text: '● Review required' });
		why.push('a review is required');
	}
	if (p.mergeable === false) {
		items.push({ tone: 'red', text: `✕ Conflicts with ${p.base}` });
		why.push(`it conflicts with ${p.base}`);
	} else if (p.mergeable === null) items.push({ tone: 'muted', text: 'Checking for conflicts…' });
	else items.push({ tone: 'ok', text: `✓ No conflicts with ${p.base}` });
	if (p.mergeableState === 'behind') {
		items.push({ tone: 'amber', text: `${p.base} has moved on: bring the branch up to date` });
		why.push(`it is behind ${p.base}`);
	}
	if (p.autoMerge) items.push({ tone: 'cy', text: '⟳ Merges itself when ready' });
	const canMerge = p.mergeable === true && ['clean', 'unstable', 'has_hooks'].includes(p.mergeableState) && !p.draft;
	if (!canMerge && !why.length) why.push('GitHub does not allow it yet');
	const red = items.some((i) => i.tone === 'red');
	return {
		tone: red ? 'red' : canMerge ? 'ok' : 'amber',
		items,
		canMerge,
		why: canMerge ? '' : `Merge is off: ${why.join(', ')}.`,
		offerAuto: p.canAutoMerge && !p.autoMerge && !canMerge && !p.draft,
	};
}

/** Commits by day, newest first, as GitHub lists them. */
export function byDay(commits: readonly PullCommit[]): Array<{ day: string; commits: PullCommit[] }> {
	const out: Array<{ day: string; commits: PullCommit[] }> = [];
	for (const c of commits) {
		const d = day(c.date);
		const last = out[out.length - 1];
		if (last && last.day === d) last.commits.push(c);
		else out.push({ day: d, commits: [c] });
	}
	return out;
}

/** One row of the Files changed tree: a folder with the totals of everything under it, or a file. */
export interface FileRow {
	path: string;
	name: string;
	depth: number;
	folder: boolean;
	open: boolean;
	additions: number;
	deletions: number;
	file: PullFile | null;
}

/**
 * The changed files as a tree (the Coverage tree's rows): each folder adds up its files' added and removed lines.
 * Rows show when every folder above them is open; with a search, only matching files and the folders above them.
 */
export function fileRows(files: readonly PullFile[], open: ReadonlySet<string>, find: string): FileRow[] {
	const q = find.trim().toLowerCase();
	const shown = q ? files.filter((f) => f.path.toLowerCase().includes(q)) : files;
	const folders = new Map<string, FileRow>();
	const rows: FileRow[] = [];
	for (const f of [...shown].sort((a, b) => a.path.localeCompare(b.path))) {
		const parts = f.path.split('/');
		for (let i = 1; i < parts.length; i += 1) {
			const path = parts.slice(0, i).join('/');
			let folder = folders.get(path);
			if (!folder) {
				folder = {
					path,
					name: parts[i - 1] as string,
					depth: i - 1,
					folder: true,
					open: !!q || open.has(path),
					additions: 0,
					deletions: 0,
					file: null,
				};
				folders.set(path, folder);
				rows.push(folder);
			}
			folder.additions += f.additions;
			folder.deletions += f.deletions;
		}
		rows.push({
			path: f.path,
			name: parts[parts.length - 1] as string,
			depth: parts.length - 1,
			folder: false,
			open: false,
			additions: f.additions,
			deletions: f.deletions,
			file: f,
		});
	}
	// A row shows when every folder above it is open.
	return rows.filter((r) => {
		const parts = r.path.split('/');
		for (let i = 1; i < parts.length; i += 1) if (!folders.get(parts.slice(0, i).join('/'))?.open) return false;
		return true;
	});
}

/** The files in tree order (what j and k step through). */
export const filesInOrder = (files: readonly PullFile[]): PullFile[] =>
	[...files].sort((a, b) => a.path.localeCompare(b.path));

/** The description's headings, each given an id the outline can jump to; with fewer than three, none. */
export function headingsIn(root: ParentNode): Array<{ id: string; level: number; text: string }> {
	const found = [...root.querySelectorAll('h1, h2, h3')].map((h, i) => {
		h.id = `pr-h-${i + 1}`;
		return { id: h.id, level: Number(h.tagName.charAt(1)), text: String(h.textContent).trim() };
	});
	return found.length >= 3 ? found : [];
}

/** A changed line drawn: its kind, old and new numbers, and its text with syntax colours. */
export interface DiffRow extends DiffLine {
	html: string;
}

/** Changed lines with syntax colours; section heads (@@) keep their text plain. */
export function diffRows(lines: readonly DiffLine[], path: string): DiffRow[] {
	const html = highlightedLines(
		lines.map((l) => (l.kind === 'hunk' ? '' : l.text)),
		path,
	);
	return lines.map((l, i) => ({ ...l, html: l.kind === 'hunk' ? '' : (html[i] as string) }));
}

/** Where each change starts (n and p step through them): the first added or removed line after unchanged ones. */
export function changeStarts(lines: readonly DiffLine[]): number[] {
	const out: number[] = [];
	lines.forEach((l, i) => {
		const changed = l.kind === 'add' || l.kind === 'del';
		const before = lines[i - 1];
		if (changed && !(before && (before.kind === 'add' || before.kind === 'del'))) out.push(i);
	});
	return out;
}

/** A changed file of more than this many lines opens folded, with Show all. */
export const FOLD_AT = 400;

/** How long a check ran, or has been running. */
export function tookSaid(c: PullCheck, now = Date.now()): string {
	if (!c.startedAt) return c.status === 'queued' ? 'queued' : '—';
	const end = c.completedAt ? Date.parse(c.completedAt) : now;
	const s = Math.max(0, Math.round((end - Date.parse(c.startedAt)) / 1000));
	const took = s < 60 ? `${s} s` : `${Math.floor(s / 60)} m ${s % 60} s`;
	return c.completedAt ? took : `running ${took}`;
}

const CHECK_ICON: Record<PullCheck['status'], Said> = {
	queued: { tone: 'muted', text: '◌' },
	running: { tone: 'amber', text: '◔' },
	passed: { tone: 'ok', text: '✓' },
	skipped: { tone: 'muted', text: '⤼' },
	neutral: { tone: 'muted', text: '○' },
	cancelled: { tone: 'muted', text: '⊘' },
	failed: { tone: 'red', text: '✕' },
};
/** A check's icon and its colour. */
export const checkIcon = (s: PullCheck['status']): Said => CHECK_ICON[s];

const EVENT_ICON: Record<PullEvent['kind'], string> = {
	opened: '↗',
	commented: '✎',
	reviewed: '◉',
	pushed: '⟳',
	'force-pushed': '⟳',
	labeled: '#',
	unlabeled: '#',
	'review-requested': '?',
	renamed: '✎',
	merged: '⇥',
	closed: '✕',
	reopened: '↺',
	ready: '●',
	'checks-started': '◔',
	'check-failed': '✕',
	'checks-passed': '✓',
	other: '…',
};
/** A conversation event's icon. */
export const eventIcon = (k: PullEvent['kind']): string => EVENT_ICON[k];

/** The pull request number a link in the description points to, when it is this repository's. */
export function pullNumberOf(href: string, repoUrl: string): number | null {
	const base = repoUrl.replace(/\/pull\/\d+$/, '');
	const m = /^(.*)\/pull\/(\d+)(?:[/?#].*)?$/.exec(href);
	return m && m[1] === base ? Number(m[2]) : null;
}
