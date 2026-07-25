/* ============================================================================
 * NEXT-GEN-UI · Command palette fuzzy scorer + types
 * ----------------------------------------------------------------------------
 * The palette's DATA is no longer a hand-maintained list — it is built at build
 * time by the `portal-search-plugin` (plugins/portal-search) from every page's
 * frontmatter and read via usePluginData in CommandPalette.tsx, so new pages
 * appear in ⌘K automatically. This file only holds the shared entry type and the
 * fuzzy matcher. Grep `NEXT-GEN-UI`.
 * ========================================================================= */

export type CommandEntry = {
	title: string;
	path: string;
	section: string;
	keywords?: string;
	status?: 'implemented' | 'scaffolded' | 'planned' | 'deferred' | 'deprecated';
};

/**
 * Lightweight fuzzy scorer: subsequence match with contiguity + word-boundary
 * bonuses. Returns null when the query does not match. Higher score = better.
 */
export function fuzzyScore(query: string, target: string): number | null {
	const q = query.toLowerCase();
	const t = target.toLowerCase();
	if (q.length === 0) return 0;

	let score = 0;
	let ti = 0;
	let streak = 0;
	let prevBoundary = true;

	for (let qi = 0; qi < q.length; qi += 1) {
		const ch = q[qi];
		let found = -1;
		for (let k = ti; k < t.length; k += 1) {
			if (t[k] === ch) {
				found = k;
				break;
			}
		}
		if (found === -1) return null;

		const isBoundary = found === 0 || /[\s\-/&·.]/.test(t[found - 1] ?? '');
		score += 1;
		if (found === ti) streak += 1;
		else streak = 0;
		score += streak * 2;
		if (isBoundary) score += 3;
		if (prevBoundary && found === ti) score += 1;

		prevBoundary = isBoundary;
		ti = found + 1;
	}

	score += Math.max(0, 12 - t.length) * 0.1;
	return score;
}
