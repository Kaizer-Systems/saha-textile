/* ============================================================================
 * NEXT-GEN-UI · CommandPalette (⌘K warp navigator)
 * ----------------------------------------------------------------------------
 * A keyboard-first quick-navigator over the curated `commandIndex`. Educational
 * notes (see docs/frontend/portal-experience-layer.md, grep `NEXT-GEN-UI`):
 *
 * - OPEN/CLOSE: a single window keydown listener handles ⌘K / Ctrl-K anywhere,
 *   "/" when not typing in a field, and Escape. Body scroll is locked while open.
 * - RANKING: `rank()` scores each entry with the subsequence fuzzy scorer in
 *   commandIndex.ts, weighting title matches over keyword matches, then slices
 *   the top results. Empty query lists everything.
 * - NAV: selection pushes onto the Docusaurus SPA history (no full reload).
 * - The launcher pill is the discoverable/mobile entry point to the same dialog.
 * ========================================================================= */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHistory } from '@docusaurus/router';
import { usePluginData } from '@docusaurus/useGlobalData';

import { fuzzyScore, type CommandEntry } from './commandIndex';
import styles from './styles.module.css';

type Ranked = CommandEntry & { score: number };

function rank(query: string, entries: CommandEntry[]): Ranked[] {
	const list = Array.isArray(entries) ? entries : [];
	const trimmed = query.trim();
	if (trimmed.length === 0) {
		return list.map((entry) => ({ ...entry, score: 0 }));
	}

	const ranked: Ranked[] = [];
	for (const entry of list) {
		const haystack = `${entry.title} ${entry.section} ${entry.keywords ?? ''}`;
		const titleScore = fuzzyScore(trimmed, entry.title);
		const anyScore = fuzzyScore(trimmed, haystack);
		const best = Math.max(titleScore ?? -Infinity, (anyScore ?? -Infinity) * 0.6);
		if (Number.isFinite(best)) ranked.push({ ...entry, score: best });
	}
	return ranked.sort((a, b) => b.score - a.score).slice(0, 24);
}

export function CommandPalette(): React.ReactNode {
	const history = useHistory();
	// DYNAMIC INDEX: built at build time by portal-search-plugin from every page's
	// frontmatter, so new pages appear here automatically (no code change).
	const pluginData = usePluginData('portal-search-plugin') as { index?: CommandEntry[] } | undefined;
	const entries = useMemo<CommandEntry[]>(() => pluginData?.index ?? [], [pluginData]);
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState('');
	const [active, setActive] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);

	const results = useMemo(() => rank(query, entries), [query, entries]);

	const close = useCallback(() => {
		setOpen(false);
		setQuery('');
		setActive(0);
	}, []);

	const go = useCallback(
		(entry: CommandEntry | undefined) => {
			if (!entry) return;
			close();
			history.push(entry.path);
		},
		[close, history],
	);

	// Global open/close shortcuts: ⌘K / Ctrl-K anywhere, "/" outside inputs.
	useEffect(() => {
		function onKey(event: KeyboardEvent) {
			const target = event.target as HTMLElement | null;
			const typing =
				!!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

			if ((event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				setOpen((value) => !value);
				return;
			}
			if (event.key === '/' && !typing && !open) {
				event.preventDefault();
				setOpen(true);
				return;
			}
			if (event.key === 'Escape' && open) {
				event.preventDefault();
				close();
			}
		}
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [open, close]);

	// Focus the field and lock body scroll while open.
	useEffect(() => {
		if (!open) return;
		const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			window.clearTimeout(timer);
			document.body.style.overflow = previousOverflow;
		};
	}, [open]);

	useEffect(() => {
		setActive(0);
	}, [query]);

	// Keep the active row scrolled into view.
	useEffect(() => {
		if (!open) return;
		const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
		node?.scrollIntoView({ block: 'nearest' });
	}, [active, open]);

	const onInputKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			setActive((value) => (results.length ? (value + 1) % results.length : 0));
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			setActive((value) => (results.length ? (value - 1 + results.length) % results.length : 0));
		} else if (event.key === 'Enter') {
			event.preventDefault();
			go(results[active]);
		}
	};

	return (
		<>
			<button
				type="button"
				className={styles.launcher}
				onClick={() => setOpen(true)}
				aria-label="Open command palette"
			>
				<span
					className={styles.launcherIcon}
					aria-hidden="true"
				/>
				<span className={styles.launcherLabel}>Search</span>
				<kbd className={styles.launcherKbd}>⌘K</kbd>
			</button>

			{open && (
				<div
					className={styles.paletteScrim}
					role="presentation"
					onClick={(event) => {
						if (event.target === event.currentTarget) close();
					}}
				>
					<div
						className={styles.palette}
						role="dialog"
						aria-modal="true"
						aria-label="Command palette"
					>
						<div className={styles.paletteInputRow}>
							<span
								className={styles.paletteSearchIcon}
								aria-hidden="true"
							/>
							<input
								ref={inputRef}
								className={styles.paletteInput}
								type="text"
								value={query}
								placeholder="Jump to any page — try “mongo rs0”, “csrf”, “config.json”…"
								spellCheck={false}
								autoComplete="off"
								aria-label="Search the developer portal"
								aria-controls="command-palette-results"
								onChange={(event) => setQuery(event.target.value)}
								onKeyDown={onInputKey}
							/>
							<kbd className={styles.paletteEsc}>Esc</kbd>
						</div>

						<div
							id="command-palette-results"
							className={styles.paletteResults}
							ref={listRef}
							role="listbox"
							aria-label="Results"
						>
							{results.length === 0 && (
								<div className={styles.paletteEmpty}>No pages match “{query.trim()}”.</div>
							)}
							{results.map((entry, index) => (
								<button
									key={entry.path}
									type="button"
									data-index={index}
									role="option"
									aria-selected={index === active}
									className={index === active ? styles.paletteRowActive : styles.paletteRow}
									onMouseMove={() => setActive(index)}
									onClick={() => go(entry)}
								>
									<span className={styles.paletteRowTitle}>{entry.title}</span>
									<span className={styles.paletteRowSection}>{entry.section}</span>
									<span
										className={styles.paletteRowArrow}
										aria-hidden="true"
									>
										↵
									</span>
								</button>
							))}
						</div>

						<div className={styles.paletteFooter}>
							<span>
								<kbd>↑</kbd>
								<kbd>↓</kbd> navigate
							</span>
							<span>
								<kbd>↵</kbd> open
							</span>
							<span>
								<kbd>esc</kbd> close
							</span>
							<span className={styles.paletteFooterBrand}>Saha Textile · warp nav</span>
						</div>
					</div>
				</div>
			)}
		</>
	);
}
