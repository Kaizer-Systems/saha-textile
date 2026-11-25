import { type DiffRow, diffRows } from '../pulls/pull-view';

import type { BlameRun, BranchRow, CodeChecks } from '@saha-textile/release-console-contracts';

/** The Code page's tabs (Q5 B: one menu item, its pages as tabs), in GitHub's order. */
export type CodeTab = 'files' | 'commits' | 'branches' | 'tags' | 'releases' | 'compare' | 'activity' | 'search';
/** The tabs drawn across the page; Search opens from the search box in the page's header. */
export const SHOWN_TABS: readonly CodeTab[] = [
	'files',
	'commits',
	'branches',
	'tags',
	'releases',
	'compare',
	'activity',
];
export const CODE_TABS: readonly CodeTab[] = [...SHOWN_TABS, 'search'];
export const CODE_TAB_LABELS: Record<CodeTab, string> = {
	files: 'Files',
	commits: 'Commits',
	branches: 'Branches',
	tags: 'Tags',
	releases: 'Releases',
	compare: 'Compare',
	activity: 'Activity',
	search: 'Search',
};

/** "apps/api/main.ts": each folder on the way, with where it leads, then the file. */
export function crumbsOf(path: string): Array<{ name: string; path: string }> {
	const parts = path ? path.split('/') : [];
	return parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join('/') }));
}
export const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/** A whole file's lines for the code view, each coloured by the file's type. */
export function fileLines(text: string, path: string): DiffRow[] {
	const lines = text.replace(/\n$/, '').split('\n');
	return diffRows(
		lines.map((t, i) => ({ kind: 'ctx' as const, old: i + 1, new: i + 1, text: t })),
		path,
	);
}

/** "#L35" or "#L35-L40": the lines marked in the address. */
export function linesOf(fragment: string | null): { start: number; end: number } | null {
	const m = /^L(\d+)(?:-L(\d+))?$/.exec(fragment ?? '');
	if (!m) return null;
	const a = Number(m[1]);
	const b = Number(m[2] ?? m[1]);
	return { start: Math.min(a, b), end: Math.max(a, b) };
}
export const linesFragment = (start: number, end: number) => (start === end ? `L${start}` : `L${start}-L${end}`);

/**
 * Go to file: the letters typed, in order, anywhere in the path, as GitHub's finder matches. A lower score is a
 * better match (letters close together, near the file's name); the matched places are kept to mark them.
 */
export function fuzzy(path: string, q: string): { score: number; at: number[] } | null {
	const text = path.toLowerCase();
	const want = q.toLowerCase().replace(/\s+/g, '');
	if (!want) return { score: 0, at: [] };
	const from = (start: number): number[] | null => {
		const at: number[] = [];
		let next = start;
		for (const ch of want) {
			const i = text.indexOf(ch, next);
			if (i < 0) return null;
			at.push(i);
			next = i + 1;
		}
		return at;
	};
	// Inside the file's own name first, as GitHub's finder ranks; anywhere in the path after.
	const inName = from(text.lastIndexOf('/') + 1);
	const at = inName ?? from(0);
	if (!at) return null;
	const spread = (at[at.length - 1] as number) - (at[0] as number);
	return { score: spread + (inName ? 0 : 100), at };
}

export function findFiles(paths: readonly string[], q: string, limit = 50) {
	return paths
		.map((path) => ({ path, hit: fuzzy(path, q) }))
		.filter((x): x is { path: string; hit: { score: number; at: number[] } } => x.hit !== null)
		.sort((a, b) => a.hit.score - b.hit.score || a.path.length - b.path.length || a.path.localeCompare(b.path))
		.slice(0, limit)
		.map((x) => ({ path: x.path, at: x.hit.at }));
}
/** A path cut into runs, the matched letters marked. */
export function marked(path: string, at: readonly number[]): Array<{ text: string; on: boolean }> {
	const hits = new Set(at);
	const out: Array<{ text: string; on: boolean }> = [];
	for (let i = 0; i < path.length; i += 1) {
		const on = hits.has(i);
		const last = out[out.length - 1];
		if (last && last.on === on) last.text += path[i];
		else out.push({ text: path[i] as string, on });
	}
	return out;
}

const DECODED: Record<string, string> = {
	'&amp;': '&',
	'&lt;': '<',
	'&gt;': '>',
	'&quot;': '"',
	'&#x27;': "'",
	'&#39;': "'",
};
const ENCODED: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' };
const decode = (t: string) => t.replace(/&(?:amp|lt|gt|quot|#x27|#39);/g, (e) => DECODED[e] as string);
const encode = (t: string) => t.replace(/[&<>"']/g, (c) => ENCODED[c] as string);

/**
 * Search's words marked in a coloured line (C11), any case, in the line's text only: each piece of text between the
 * colouring's tags gets its own `<mark>`, so a match that runs across two colours stays one mark to the eye.
 */
export function markWords(html: string, words: string): string {
	const w = words.toLowerCase();
	// Split on the tags: text at the even places, tags at the odd ones.
	const parts = html.split(/(<[^>]*>)/);
	const texts = parts.map((p, i) => (i % 2 ? '' : decode(p)));
	const plain = texts.join('').toLowerCase();
	const on = new Array<boolean>(plain.length).fill(false);
	for (let at = w ? plain.indexOf(w) : -1; at !== -1; at = plain.indexOf(w, at + w.length))
		on.fill(true, at, at + w.length);
	let start = 0;
	return parts
		.map((p, i) => {
			if (i % 2) return p;
			const t = texts[i] as string;
			const hits = Array.from({ length: t.length }, (_, k) => k).filter((k) => on[start + k]);
			start += t.length;
			return marked(t, hits)
				.map((s) => (s.on ? `<mark>${encode(s.text)}</mark>` : encode(s.text)))
				.join('');
		})
		.join('');
}

/** The Branches page's five views, as GitHub has them. */
export type BranchView = 'overview' | 'yours' | 'active' | 'stale' | 'all';
export const BRANCH_VIEWS: Array<{ key: BranchView; label: string }> = [
	{ key: 'overview', label: 'Overview' },
	{ key: 'yours', label: 'Yours' },
	{ key: 'active', label: 'Active' },
	{ key: 'stale', label: 'Stale' },
	{ key: 'all', label: 'All' },
];
/** A branch is stale after three months without a commit. */
export const STALE_DAYS = 90;

/** The sections one view shows, newest first, matching the words typed. */
export function branchSections(
	rows: readonly BranchRow[],
	view: BranchView,
	viewer: string,
	find: string,
	now = Date.now(),
): Array<{ title: string; rows: BranchRow[] }> {
	const q = find.trim().toLowerCase();
	const all = rows.filter((r) => !q || r.name.toLowerCase().includes(q)).sort((a, b) => b.date.localeCompare(a.date));
	const stale = (r: BranchRow) => now - Date.parse(r.date) > STALE_DAYS * 86_400_000;
	const others = all.filter((r) => !r.isDefault);
	const yours = others.filter((r) => r.login === viewer);
	const active = others.filter((r) => !stale(r));
	const sections: Record<BranchView, Array<{ title: string; rows: BranchRow[] }>> = {
		overview: [
			{ title: 'Default', rows: all.filter((r) => r.isDefault) },
			{ title: 'Your branches', rows: yours.slice(0, 5) },
			{ title: 'Active branches', rows: active.slice(0, 5) },
		],
		yours: [{ title: 'Your branches', rows: yours }],
		active: [{ title: 'Active branches', rows: active }],
		stale: [{ title: 'Stale branches', rows: others.filter(stale) }],
		all: [{ title: 'All branches', rows: all }],
	};
	return sections[view].filter((s, i) => s.rows.length || (view !== 'overview' && i === 0));
}

const RULE_WORDS: Record<string, string> = {
	creation: 'Restrict creations',
	update: 'Restrict updates',
	deletion: 'Restrict deletions',
	required_linear_history: 'Require linear history',
	required_deployments: 'Require deployments to succeed',
	required_signatures: 'Require signed commits',
	pull_request: 'Require a pull request before merging',
	required_status_checks: 'Require status checks to pass',
	non_fast_forward: 'Block force pushes',
	merge_queue: 'Require merge queue',
	code_scanning: 'Require code scanning results',
};
/** A rule's name as GitHub's ruleset page writes it. */
export const ruleWords = (type: string) => RULE_WORDS[type] ?? type.replace(/_/g, ' ');

/** A size as GitHub writes it: bytes, KB or MB. */
export function sizeSaid(bytes: number): string {
	if (bytes < 1024) return `${bytes} ${bytes === 1 ? 'Byte' : 'Bytes'}`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ACTIVITY: Record<string, string> = {
	push: 'Pushed',
	force_push: 'Force pushed',
	branch_creation: 'Created branch',
	branch_deletion: 'Deleted branch',
	pr_merge: 'Merged a pull request into',
	merge_queue_merge: 'Merged by the merge queue into',
};
export const activityWords = (kind: string) => ACTIVITY[kind] ?? kind.replace(/_/g, ' ');

/** Clone addresses: HTTPS, SSH and the GitHub CLI. */
export function cloneWays(owner: string, name: string): Array<{ label: string; text: string }> {
	return [
		{ label: 'HTTPS', text: `https://github.com/${owner}/${name}.git` },
		{ label: 'SSH', text: `git@github.com:${owner}/${name}.git` },
		{ label: 'GitHub CLI', text: `gh repo clone ${owner}/${name}` },
	];
}

/** A commit's checks as a mark and its colour; nothing when none ran. */
export const checkMark = (c: CodeChecks): { text: string; tone: string } =>
	({
		passed: { text: '✓', tone: 'ok' },
		failed: { text: '✕', tone: 'red' },
		running: { text: '◔', tone: 'amber' },
		none: { text: '', tone: 'muted' },
	})[c];

/** Blame's lines, each with its run's commit on the run's first line only (custom C8: the commit column). */
export function blameLines(
	lines: readonly string[],
	runs: readonly BlameRun[],
	path: string,
): Array<DiffRow & { run: BlameRun | null; first: boolean }> {
	const drawn = fileLines(lines.join('\n'), path);
	return drawn.map((row, i) => {
		const run = runs.find((r) => i + 1 >= r.start && i + 1 <= r.end) ?? null;
		return { ...row, run, first: run?.start === i + 1 };
	});
}

/** A new branch name for a change, as GitHub suggests one: "<you>-patch-1", the first free number. */
export function patchBranch(viewer: string, taken: readonly string[]): string {
	for (let n = 1; ; n += 1) {
		const name = `${viewer || 'console'}-patch-${n}`;
		if (!taken.includes(name)) return name;
	}
}

/** A picked file's bytes as base64, for a commit or a release file. */
export async function base64Of(file: Blob): Promise<string> {
	const bytes = new Uint8Array(await file.arrayBuffer());
	let text = '';
	for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(text);
}
/** Text as base64 (UTF-8), for an edited file. */
export const textBase64 = (text: string) => base64Of(new Blob([text]));

/**
 * A link GitHub drew into this repository's files (`https://github.com/o/r/blob/<ref>/<path>`, or `tree/`): where it
 * leads, so the Code page opens it here. The ref shown now is tried first, since a ref can hold slashes.
 */
export function codeLinkOf(
	href: string,
	repoUrl: string,
	ref: string,
): { ref: string; path: string; type: 'tree' | 'blob'; fragment: string | null } | null {
	const [where, fragment] = href.split('#') as [string, string | undefined];
	const m = new RegExp(`^${repoUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(blob|tree)/(.+)$`).exec(where);
	if (!m) return null;
	const type = m[1] as 'tree' | 'blob';
	const rest = decodeURIComponent(m[2] as string);
	const known = rest === ref || rest.startsWith(`${ref}/`);
	const at = known ? ref : (rest.split('/')[0] as string);
	return { ref: at, path: rest.slice(at.length + 1), type, fragment: fragment ?? null };
}
