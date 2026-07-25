/* ============================================================================
 * NEXT-GEN-UI · CommandPalette (⌘K warp navigator + governed verbs)
 * ----------------------------------------------------------------------------
 * A keyboard-first quick-navigator over the dynamic frontmatter index, extended
 * with the governed trace/gate/status action grammar. Educational notes (see
 * docs/frontend/portal-experience-layer.md, grep `NEXT-GEN-UI`):
 *
 * - OPEN/CLOSE: a single window keydown listener handles ⌘K / Ctrl-K anywhere,
 *   "/" when not typing in a field, and Escape. Body scroll is locked while open.
 * - PAGE RANKING: `rankPages()` fuzzy-scores the build-derived search index.
 *   Adding a documentation page still needs no palette code or registry edit.
 * - VERB RANKING: an exact first token activates a compiled target set. Journey
 *   targets come from pages, gates from governed gate data, and status targets
 *   from each page's lifecycle frontmatter—React owns none of those facts.
 * - DISPATCH: every verb remains read-only navigation. Gate results add a
 *   validated query parameter so the existing console selects that gate.
 * - The launcher pill is the discoverable/mobile entry point to the same dialog.
 * ========================================================================= */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHistory } from '@docusaurus/router';
import { usePluginData } from '@docusaurus/useGlobalData';

import { useCommandVerbData, type CommandVerb, type CommandVerbTarget } from '@site/src/data/command-verbs';
import { fuzzyScore, type CommandEntry } from './commandIndex';
import styles from './styles.module.css';

type Ranked = CommandEntry & { score: number };
type RankedTarget = CommandVerbTarget & { score: number };
type VerbMode = {
	verb: CommandVerb;
	argument: string;
};
type PaletteResult = { kind: 'page'; entry: Ranked } | { kind: 'verb-target'; entry: RankedTarget };

function rankPages(query: string, entries: CommandEntry[]): Ranked[] {
	const list = Array.isArray(entries) ? entries : [];
	const trimmed = query.trim();
	if (trimmed.length === 0) {
		return list.slice(0, 24).map((entry) => ({ ...entry, score: 0 }));
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

function parseVerbMode(query: string, verbs: CommandVerb[]): VerbMode | null {
	const trimmed = query.trimStart();
	const tokenEnd = trimmed.search(/\s/);
	const token = (tokenEnd === -1 ? trimmed : trimmed.slice(0, tokenEnd)).toLocaleLowerCase('en');
	const verb = verbs.find((candidate) => candidate.token === token);
	if (!verb) return null;
	return {
		verb,
		argument: tokenEnd === -1 ? '' : trimmed.slice(tokenEnd).trim(),
	};
}

function rankTargets(argument: string, targets: CommandVerbTarget[]): RankedTarget[] {
	const trimmed = argument.trim();
	if (trimmed.length === 0) {
		return targets.slice(0, 24).map((target) => ({ ...target, score: 0 }));
	}

	const ranked: RankedTarget[] = [];
	for (const target of targets) {
		const haystack = `${target.title} ${target.id} ${target.section} ${target.status} ${target.keywords}`;
		const titleScore = fuzzyScore(trimmed, target.title);
		const anyScore = fuzzyScore(trimmed, haystack);
		const best = Math.max(titleScore ?? -Infinity, (anyScore ?? -Infinity) * 0.62);
		if (Number.isFinite(best)) ranked.push({ ...target, score: best });
	}
	return ranked.sort((left, right) => right.score - left.score).slice(0, 24);
}

export function CommandPalette(): React.ReactNode {
	const history = useHistory();
	const { verbs } = useCommandVerbData();
	// DYNAMIC INDEX: built at build time by portal-search-plugin from every page's
	// frontmatter, so new pages appear here automatically (no code change).
	const pluginData = usePluginData('portal-search-plugin') as { index?: CommandEntry[] } | undefined;
	const entries = useMemo<CommandEntry[]>(() => pluginData?.index ?? [], [pluginData]);
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState('');
	const [active, setActive] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);

	const verbMode = useMemo(() => parseVerbMode(query, verbs), [query, verbs]);
	const results = useMemo<PaletteResult[]>(
		() =>
			verbMode
				? rankTargets(verbMode.argument, verbMode.verb.targets).map((entry) => ({
						kind: 'verb-target',
						entry,
					}))
				: rankPages(query, entries).map((entry) => ({ kind: 'page', entry })),
		[entries, query, verbMode],
	);

	const close = useCallback(() => {
		setOpen(false);
		setQuery('');
		setActive(0);
	}, []);

	const go = useCallback(
		(result: PaletteResult | undefined) => {
			if (!result) return;
			close();
			history.push(result.entry.path);
		},
		[close, history],
	);

	const chooseVerb = useCallback((verb: CommandVerb) => {
		setQuery(`${verb.token} `);
		requestAnimationFrame(() => inputRef.current?.focus());
	}, []);

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
				<span className={styles.launcherLabel}>Search · act</span>
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
								placeholder="Search pages or act — try “trace checkout”, “gate numbering”, “status api”…"
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
							className={styles.verbRail}
							role="group"
							aria-label="Command verbs"
						>
							<span className={styles.verbRailLabel}>Action grammar</span>
							{verbs.map((verb) => (
								<button
									key={verb.id}
									type="button"
									className={verbMode?.verb.id === verb.id ? styles.verbChipActive : styles.verbChip}
									aria-pressed={verbMode?.verb.id === verb.id}
									aria-label={`Use ${verb.label}: ${verb.example}`}
									onClick={() => chooseVerb(verb)}
								>
									<span>{verb.token}</span>
									<code>{verb.example.slice(verb.token.length).trim()}</code>
								</button>
							))}
						</div>

						{verbMode && (
							<div
								className={styles.verbContext}
								role="status"
							>
								<span className={styles.verbPrompt}>&gt;</span>
								<span className={styles.verbToken}>{verbMode.verb.token}</span>
								<div>
									<strong>{verbMode.verb.label}</strong>
									<span>{verbMode.verb.description}</span>
								</div>
								<output>{results.length} targets</output>
							</div>
						)}

						<div
							id="command-palette-results"
							className={styles.paletteResults}
							ref={listRef}
							role="listbox"
							aria-label="Results"
						>
							{results.length === 0 && (
								<div className={styles.paletteEmpty}>
									{verbMode
										? `No ${verbMode.verb.token} target matches “${verbMode.argument}”.`
										: `No pages match “${query.trim()}”.`}
								</div>
							)}
							{results.map((result, index) => {
								const entry = result.entry;
								return (
									<button
										key={
											result.kind === 'page'
												? `page:${result.entry.id}`
												: `verb-target:${result.entry.id}`
										}
										type="button"
										data-index={index}
										role="option"
										aria-selected={index === active}
										className={index === active ? styles.paletteRowActive : styles.paletteRow}
										onMouseMove={() => setActive(index)}
										onClick={() => go(result)}
									>
										<span className={styles.paletteRowTitle}>{entry.title}</span>
										<span className={styles.paletteRowMeta}>
											<span className={styles.paletteRowSection}>{entry.section}</span>
											{entry.status && (
												<span
													className={styles.paletteRowStatus}
													data-status={entry.status}
												>
													{entry.status}
												</span>
											)}
											{'documentRole' in entry && entry.documentRole === 'canonical' && (
												<span
													className={styles.paletteRowStatus}
													data-status="canonical"
												>
													{entry.kind === 'heading' ? 'live heading' : 'canonical'}
												</span>
											)}
										</span>
										<span
											className={styles.paletteRowArrow}
											aria-hidden="true"
										>
											↵
										</span>
									</button>
								);
							})}
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
							<span className={styles.paletteFooterBrand}>
								Saha Textile · {verbMode ? `${verbMode.verb.token} mode` : 'warp nav'}
							</span>
						</div>
					</div>
				</div>
			)}
		</>
	);
}
