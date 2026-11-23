/**
 * Ship › Code › Coverage (brief CRmpBdP3ce62g1JoCAhh23, approved 24 Nov 2026): what the screen works out
 * in the browser. Only what is open: the rows to show, the map's boxes and the code's colours. The API
 * already added up every folder.
 */
import {
	COVERAGE_METRICS,
	type CoverageBand,
	type CoverageMetric,
	type CoverageNode,
	type Counts,
	coverageBand,
	metricShare,
} from '@saha-textile/release-console-contracts';
import hljs from 'highlight.js/lib/core';
import css from 'highlight.js/lib/languages/css';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import scss from 'highlight.js/lib/languages/scss';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';

hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('scss', scss);
hljs.registerLanguage('css', css);
hljs.registerLanguage('json', json);

/** One row of the tree as drawn. */
export interface CoverageRow {
	path: string;
	name: string;
	depth: number;
	folder: boolean;
	open: boolean;
	counts: Counts | null;
}
export interface RowFilters {
	expanded: ReadonlySet<string>;
	/** Hide what is at 100% on all four. */
	below: boolean;
	/** Hide files with no code the tests run. */
	measured: boolean;
	/** Folders first, then the lowest statements share first. */
	low: boolean;
	/** Only files whose name holds this text, with the folders above them opened. */
	query: string;
	/** Only these files (a change), with the folders above them opened. */
	only: ReadonlySet<string> | null;
}

/** A metric's share and band, or nothing for something not measured. */
export function shareOf(counts: Counts | null, metric: CoverageMetric): { share: number; band: CoverageBand } | null {
	if (!counts) return null;
	const share = metricShare(counts, metric);
	return { share, band: coverageBand(share) };
}
/** A share as text: 100 stays whole, anything less keeps one decimal so 99.9 never reads as 100. */
export function shareText(share: number): string {
	return share >= 100 ? '100' : share.toFixed(1);
}
/** How low a node's statements are, for “Lowest first”; nothing measured sorts last. */
const lowness = (n: CoverageNode) => (n.c ? metricShare(n.c, 'statements') : 101);
const full = (c: Counts | null) => !!c && COVERAGE_METRICS.every((m) => metricShare(c, m) >= 100);

/** Every path under a node that matches, with the folders above each one. */
function matching(root: CoverageNode, keep: (path: string, node: CoverageNode) => boolean): Set<string> {
	const out = new Set<string>();
	const walk = (node: CoverageNode, path: string, above: string[]) => {
		if (!node.k) {
			if (keep(path, node)) for (const p of [...above, path]) out.add(p);
			return;
		}
		for (const k of node.k) walk(k, path ? `${path}/${k.n}` : k.n, [...above, path]);
	};
	walk(root, '', []);
	return out;
}

/** The rows to draw, top to bottom: the whole codebase first, then every open folder's children. */
export function visibleRows(root: CoverageNode, f: RowFilters): CoverageRow[] {
	const q = f.query.trim().toLowerCase();
	const only = f.only;
	const pick =
		q || only
			? matching(root, (path, node) => (!q || node.n.toLowerCase().includes(q)) && (!only || only.has(path)))
			: null;
	const rows: CoverageRow[] = [];
	const show = (node: CoverageNode, path: string): boolean => {
		if (pick && !pick.has(path)) return false;
		if (f.measured && !node.c) return false;
		if (f.below && full(node.c)) return false;
		return true;
	};
	const walk = (node: CoverageNode, path: string, depth: number) => {
		const open = !!node.k && (f.expanded.has(path) || (!!pick && pick.has(path)));
		rows.push({ path, name: node.n, depth, folder: !!node.k, open, counts: node.c });
		if (!open) return;
		const kids = (node.k as CoverageNode[])
			.map((k) => ({ k, p: path ? `${path}/${k.n}` : k.n }))
			.filter((x) => show(x.k, x.p));
		if (f.low) kids.sort((a, b) => Number(!!b.k.k) - Number(!!a.k.k) || lowness(a.k) - lowness(b.k));
		for (const x of kids) walk(x.k, x.p, depth + 1);
	};
	walk(root, '', 0);
	return rows;
}

/** The node at a path; null when there is none. */
export function nodeAt(root: CoverageNode, path: string): CoverageNode | null {
	if (!path) return root;
	let at: CoverageNode | undefined = root;
	for (const part of path.split('/')) at = at?.k?.find((k) => k.n === part);
	return at ?? null;
}

/** Every folder that holds something below 100%: “Open every gap”. */
export function foldersWithGaps(root: CoverageNode): Set<string> {
	const out = new Set<string>();
	const walk = (node: CoverageNode, path: string) => {
		if (!node.k || !node.c || full(node.c)) return;
		out.add(path);
		for (const k of node.k) walk(k, path ? `${path}/${k.n}` : k.n);
	};
	walk(root, '');
	return out;
}

/** The folders above a path, root first: opened so a linked file shows in the tree. */
export function foldersAbove(path: string): string[] {
	const parts = path.split('/');
	return ['', ...parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'))];
}

/* ===== The map ===== */

export interface MapBox<T> {
	item: T;
	x: number;
	y: number;
	w: number;
	h: number;
}
/** Boxes sized by value, as square as they can be (squarified treemap), filling the rectangle. */
export function squarify<T>(
	items: readonly { value: number; item: T }[],
	x: number,
	y: number,
	w: number,
	h: number,
): MapBox<T>[] {
	const total = items.reduce((a, b) => a + b.value, 0);
	if (!total || w <= 0 || h <= 0) return [];
	let rest = [...items]
		.filter((i) => i.value > 0)
		.sort((a, b) => b.value - a.value)
		.map((i) => ({ ...i, area: (i.value / total) * w * h }));
	const out: MapBox<T>[] = [];
	const worst = (row: typeof rest, side: number) => {
		const s = row.reduce((a, b) => a + b.area, 0);
		const areas = row.map((r) => r.area);
		return Math.max((side * side * Math.max(...areas)) / (s * s), (s * s) / (side * side * Math.min(...areas)));
	};
	while (rest.length) {
		const side = Math.min(w, h);
		let row = [rest[0] as (typeof rest)[number]];
		let best = worst(row, side);
		let i = 1;
		for (; i < rest.length; i++) {
			const next = [...row, rest[i] as (typeof rest)[number]];
			const score = worst(next, side);
			if (score > best) break;
			row = next;
			best = score;
		}
		rest = rest.slice(i);
		const s = row.reduce((a, b) => a + b.area, 0);
		if (w >= h) {
			const cw = s / h;
			let cy = y;
			for (const r of row) {
				out.push({ item: r.item, x, y: cy, w: cw, h: r.area / cw });
				cy += r.area / cw;
			}
			x += cw;
			w -= cw;
		} else {
			const ch = s / w;
			let cx = x;
			for (const r of row) {
				out.push({ item: r.item, x: cx, y, w: r.area / ch, h: ch });
				cx += r.area / ch;
			}
			y += ch;
			h -= ch;
		}
	}
	return out;
}

/* ===== Code colours ===== */

/** The language highlight.js reads a file in, by its ending; null for text it has no colours for. */
export function languageOf(path: string): string | null {
	const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
	const map: Record<string, string> = {
		ts: 'typescript',
		mts: 'typescript',
		cts: 'typescript',
		js: 'javascript',
		mjs: 'javascript',
		cjs: 'javascript',
		html: 'xml',
		svg: 'xml',
		scss: 'scss',
		css: 'css',
		json: 'json',
	};
	return map[ext] ?? null;
}
const escape = (s: string) =>
	s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

/**
 * A file's lines with syntax colours as HTML, one entry per line: highlighted as a whole (so comments and
 * template strings that span lines keep their colour), then cut at each line, reopening open spans.
 */
export function highlightedLines(text: readonly string[], path: string): string[] {
	const lang = languageOf(path);
	if (!lang) return text.map(escape);
	const html = hljs.highlight(text.join('\n'), { language: lang, ignoreIllegals: true }).value;
	const out: string[] = [];
	const open: string[] = [];
	let line = '';
	for (const token of html.match(/<span[^>]*>|<\/span>|\n|[^<\n]+/g) ?? []) {
		if (token === '\n') {
			out.push(line + '</span>'.repeat(open.length));
			line = open.join('');
		} else {
			if (token.startsWith('<span')) open.push(token);
			else if (token === '</span>') open.pop();
			line += token;
		}
	}
	out.push(line);
	return out.slice(0, text.length);
}
