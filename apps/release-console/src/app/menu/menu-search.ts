import type { ConsoleMenu } from './menu.types';

export interface SearchHit {
	screen: string;
	state: string | null;
	label: string;
	path: string;
	kind: 'screen' | 'tab';
	via: string;
	score: number;
}

/** Where each screen sits in the tree, e.g. “Watch › Performance”. */
export function placeOf(menu: ConsoleMenu): Map<string, string[]> {
	const place = new Map<string, string[]>([
		['overview', ['Overview']],
		['settings', ['Settings']],
	]);
	for (const g of menu.menu)
		for (const s of g.subs) for (const k of s.items) place.set(k, s.label ? [g.label, s.label] : [g.label]);
	return place;
}

const escapeRe = (q: string) => q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Full and partial matches of screen names, tab names and other words people use (aliases),
 * best first: starts-with, then word start, then anywhere, then aliases; tabs rank below screens.
 */
export function searchMenu(menu: ConsoleMenu, raw: string, limit = 8): SearchHit[] {
	const q = raw.trim().toLowerCase();
	if (!q) return [];
	const place = placeOf(menu);
	const word = new RegExp(`\\b${escapeRe(q)}`);
	const hits: SearchHit[] = [];
	for (const [key, s] of Object.entries(menu.screens)) {
		const path = (place.get(key) ?? []).join(' › ');
		const entries: { label: string; state: string | null; kind: 'screen' | 'tab'; aliases: string[] }[] = [
			{ label: s.label, state: null, kind: 'screen', aliases: menu.aliases[key] ?? [] },
		];
		const tabs = Object.entries(s.states);
		if (tabs.length > 1)
			for (const [state, label] of tabs) if (label) entries.push({ label, state, kind: 'tab', aliases: [] });
		for (const e of entries) {
			const l = e.label.toLowerCase();
			let score = l.startsWith(q) ? 4 : word.test(l) ? 3 : l.includes(q) ? 2 : 0;
			let via = '';
			if (!score) {
				const hit = e.aliases.find((a) => a.includes(q));
				if (hit) {
					score = e.aliases.includes(q) ? 1.8 : 1.5;
					via = hit;
				}
			}
			if (score)
				hits.push({
					screen: key,
					state: e.state,
					label: e.label,
					path: e.kind === 'tab' ? `${path} › ${s.label}` : path,
					kind: e.kind,
					via,
					score: score - (e.kind === 'tab' ? 0.5 : 0),
				});
		}
	}
	return hits.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label)).slice(0, limit);
}
