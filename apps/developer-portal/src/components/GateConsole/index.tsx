/* ============================================================================
 * NEXT-GEN-UI · Decision Gate Console
 * ----------------------------------------------------------------------------
 * Governed decision gates as a cockpit of sealed switches. Selecting/hovering a
 * gate lights its blast radius — the roadmap chunks AND DB collections whose
 * FINAL behaviour it blocks — on the impact board, which ripples in warning.
 * Makes "decision debt" visceral. Data is compiled from governed docs/_data and
 * cross-checked against the roadmap + decision log before this component renders.
 *
 * A switch is a STATUS indicator, not a control: open = sealed (amber, locked),
 * resolved = cleared (green). Selecting inspects; it never resolves a decision.
 * Educational notes:
 * - blast radius is pure data (blocksChunks / blocksCollections); the impact
 *   board reads data-blocked and animates via CSS.
 * - a11y: switches are role="button" + aria-pressed; the board is aria-live.
 * - ripple animation is disabled under prefers-reduced-motion.
 * ========================================================================= */

import React, { useEffect, useMemo, useState } from 'react';
import Link from '@docusaurus/Link';
import { useLocation } from '@docusaurus/router';

import { useDecisionGateData, type Gate } from '@site/src/data/decision-gates';
import styles from './styles.module.css';

export function GateConsole(): React.ReactNode {
	const { gates, decisionRegister, impactChunks, impactCollections } = useDecisionGateData();
	const location = useLocation();
	const openGateCount = useMemo(() => gates.filter((gate) => gate.status === 'open').length, [gates]);
	const [selectedId, setSelectedId] = useState<string>(gates.find((g) => g.status === 'open')?.id ?? gates[0].id);
	const selected: Gate = useMemo(() => gates.find((g) => g.id === selectedId) ?? gates[0], [gates, selectedId]);

	// ⌘K Verbs deep-link contract: `gate numbering` resolves to this page with a
	// validated governed gate id. The first render stays deterministic for SSR;
	// the client selects the requested gate after hydration.
	useEffect(() => {
		const requestedGate = new URLSearchParams(location.search).get('gate');
		if (requestedGate && gates.some((gate) => gate.id === requestedGate)) {
			setSelectedId(requestedGate);
		}
	}, [gates, location.search]);

	const blockedChunks = new Set(selected.blocksChunks);
	const blockedCollections = new Set(selected.blocksCollections);

	return (
		<section
			className={styles.console}
			aria-label="Decision gate console"
		>
			<div className={styles.head}>
				<p className={styles.eyebrow}>Decision Gate Console</p>
				<h2>Decisions that still constrain implementation.</h2>
				<p className={styles.lede}>
					Each switch is a governed decision gate. Sealed (amber) gates block a slice of the build until
					resolved; cleared (green) gates are complete. Select a gate to light its blast radius—the roadmap
					chunks and database collections whose final behaviour waits on it. Foundations and seams still
					proceed.
				</p>
				<p className={styles.summary}>
					<strong>{openGateCount}</strong> of {gates.length} gates open · compiled from the roadmap and
					decision log.
				</p>
				<p className={styles.summary}>
					<strong>{decisionRegister.openCount}</strong> open decisions · recently resolved:{' '}
					{decisionRegister.newlyLocked.join(' · ')}.
				</p>
			</div>

			<div className={styles.body}>
				{/* Cockpit of switches */}
				<div
					className={styles.switches}
					role="listbox"
					aria-label="Decision gates"
				>
					{gates.map((gate) => {
						const active = selectedId === gate.id;
						return (
							<button
								key={gate.id}
								type="button"
								role="option"
								aria-selected={active}
								className={`${styles.switchUnit} ${gate.status === 'open' ? styles.sealed : styles.cleared} ${active ? styles.switchActive : ''}`}
								onMouseEnter={() => setSelectedId(gate.id)}
								onFocus={() => setSelectedId(gate.id)}
								onClick={() => setSelectedId(gate.id)}
							>
								<span
									className={styles.switchTrack}
									aria-hidden="true"
								>
									<span className={styles.switchKnob} />
								</span>
								<span className={styles.switchText}>
									<span className={styles.switchId}>{gate.id}</span>
									<span className={styles.switchLabel}>{gate.label}</span>
								</span>
								<span className={styles.switchState}>
									{gate.status === 'open' ? 'Sealed' : 'Cleared'}
								</span>
							</button>
						);
					})}
				</div>

				{/* Selected gate detail */}
				<aside
					className={styles.detail}
					aria-live="polite"
				>
					<div className={styles.detailHead}>
						<span className={styles.detailId}>{selected.id}</span>
						<span
							className={`${styles.badge} ${selected.status === 'open' ? styles.badgeOpen : styles.badgeResolved}`}
						>
							{selected.status === 'open' ? 'Sealed' : 'Cleared'}
						</span>
					</div>
					<h3 className={styles.detailTitle}>{selected.label}</h3>
					<p className={styles.detailQuestion}>{selected.question}</p>

					{selected.resolvedNote && <p className={styles.resolvedNote}>{selected.resolvedNote}</p>}

					{selected.blocksFeatures.length > 0 && (
						<div className={styles.blockList}>
							<span className={styles.blockLabel}>Blocks</span>
							<ul>
								{selected.blocksFeatures.map((f) => (
									<li key={f}>{f}</li>
								))}
							</ul>
						</div>
					)}

					<p className={styles.seams}>
						<span>May proceed</span>
						{selected.seamsOk}
					</p>
					<p className={styles.source}>Source · {selected.source}</p>
				</aside>
			</div>

			{/* Impact board */}
			<div className={styles.board}>
				<div className={styles.boardCol}>
					<p className={styles.boardHead}>Roadmap chunks</p>
					<div className={styles.chips}>
						{impactChunks.map((c) => (
							<Link
								key={c}
								to="/mission-control"
								className={styles.chip}
								data-blocked={blockedChunks.has(c) ? 'true' : 'false'}
								title={`Chunk ${c}`}
							>
								{c}
							</Link>
						))}
					</div>
				</div>
				<div className={styles.boardCol}>
					<p className={styles.boardHead}>Database collections</p>
					<div className={styles.chips}>
						{impactCollections.map((c) => (
							<span
								key={c}
								className={styles.chipWide}
								data-blocked={blockedCollections.has(c) ? 'true' : 'false'}
							>
								{c}
							</span>
						))}
					</div>
				</div>
			</div>
		</section>
	);
}
