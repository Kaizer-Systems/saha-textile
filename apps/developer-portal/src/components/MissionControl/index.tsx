/* ============================================================================
 * NEXT-GEN-UI · Mission Control (Chunk Constellation)
 * ----------------------------------------------------------------------------
 * The live dashboard of the API/DB build: roadmap chunks A–J as orbital stations
 * around a central core, each glowing by status, with dependency chords + a
 * traveling build-flow pulse, and a click-to-open "flight plan" panel. Reuses
 * the ArchitectureReactor grammar (ring, spokes, SMIL pulses, inspect panel) so
 * it reads as the same portal, not a bolt-on. Data is compiled from governed
 * docs/_data + the KB truth snapshot; this component owns no project facts.
 *
 * `variant="teaser"` renders the compact homepage strip instead of the orbital.
 * Educational notes:
 * - GEOMETRY: 10 nodes on a ring, positions computed once (deterministic → SSR
 *   and client markup match). The ring path is the closed polyline through them.
 * - PULSES: SVG SMIL <animateMotion>, enabled only after mount when motion is
 *   welcome (server + first client render start with animate=false → no
 *   hydration mismatch), disabled under prefers-reduced-motion.
 * - A11Y: nodes are role="button" + tabIndex; the chip row mirrors them as real
 *   <button>s; the panel is aria-live.
 * ========================================================================= */

import React, { useEffect, useMemo, useState } from 'react';
import Link from '@docusaurus/Link';

import { useMissionControlData, type Chunk, type ChunkStatus, type Gate } from '@site/src/data/mission-control';
import styles from './styles.module.css';

const CENTER = { x: 240, y: 240 };
const RADIUS = 176;

const STATUS_LABEL: Record<ChunkStatus, string> = {
	done: 'Done',
	partial: 'In progress',
	next: 'Ready next',
	planned: 'Planned',
};

type PlacedChunk = Chunk & { x: number; y: number; angle: number };

function placeChunks(chunks: Chunk[]): PlacedChunk[] {
	return chunks.map((chunk, index) => {
		const angle = -90 + index * (360 / chunks.length);
		const rad = (angle * Math.PI) / 180;
		return {
			...chunk,
			angle,
			x: CENTER.x + RADIUS * Math.cos(rad),
			y: CENTER.y + RADIUS * Math.sin(rad),
		};
	});
}

const isGated = (chunk: Chunk, gateById: Map<string, Gate>): boolean =>
	chunk.blockingGates.some((id) => gateById.get(id)?.status === 'open');

function statusClass(chunk: Chunk): string {
	if (chunk.status === 'done') return styles.nodeDone;
	if (chunk.status === 'partial') return styles.nodePartial;
	if (chunk.status === 'next') return styles.nodeNext;
	return styles.nodePlanned;
}

export function MissionControl({ variant = 'full' }: { variant?: 'full' | 'teaser' }): React.ReactNode {
	const { chunks, gates } = useMissionControlData();
	const nodes = useMemo(() => placeChunks(chunks), [chunks]);
	const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
	const gateById = useMemo(() => new Map(gates.map((gate) => [gate.id, gate])), [gates]);
	const ringPath = useMemo(
		() => `M ${nodes.map((node) => `${node.x.toFixed(1)},${node.y.toFixed(1)}`).join(' L ')} Z`,
		[nodes],
	);
	const counts = useMemo(
		() => ({
			done: chunks.filter((chunk) => chunk.status === 'done').length,
			partial: chunks.filter((chunk) => chunk.status === 'partial').length,
			next: chunks.filter((chunk) => chunk.status === 'next').length,
			gated: chunks.filter((chunk) => isGated(chunk, gateById)).length,
		}),
		[chunks, gateById],
	);

	// Default focus = the current build frontier (first partial, else first next).
	const defaultId = useMemo(
		() => (chunks.find((c) => c.status === 'partial') ?? chunks.find((c) => c.status === 'next') ?? chunks[0]).id,
		[chunks],
	);
	const [selectedId, setSelectedId] = useState<string>(defaultId);
	const [animate, setAnimate] = useState(false);

	useEffect(() => {
		if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) setAnimate(true);
	}, []);

	const selected = useMemo(() => nodeById.get(selectedId) ?? nodes[0], [nodeById, nodes, selectedId]);
	const selectedDeps = selected.deps.map((id) => nodeById.get(id)).filter(Boolean) as PlacedChunk[];
	const selectedGates = selected.blockingGates.map((id) => gateById.get(id)).filter(Boolean);

	if (variant === 'teaser') {
		return (
			<section
				className={styles.teaser}
				aria-label="Build progress"
			>
				<div className={styles.teaserHead}>
					<span className={styles.eyebrow}>Mission Control</span>
					<Link
						className={styles.teaserLink}
						to="/mission-control"
					>
						Open the live dashboard<span aria-hidden="true"> →</span>
					</Link>
				</div>
				<ol
					className={styles.teaserTrack}
					aria-label="Roadmap chunks A–J"
				>
					{chunks.map((chunk) => (
						<li
							key={chunk.id}
							className={`${styles.teaserPill} ${statusClass(chunk)} ${isGated(chunk, gateById) ? styles.teaserGated : ''}`}
							title={`${chunk.id} · ${chunk.title} — ${STATUS_LABEL[chunk.status]}${isGated(chunk, gateById) ? ' · gated' : ''}`}
						>
							{chunk.id}
						</li>
					))}
				</ol>
				<p className={styles.teaserLegend}>
					{counts.done} done · {counts.partial} in progress · {counts.next} ready · {counts.gated}{' '}
					gate-blocked · {chunks.length} chunks A–J
				</p>
			</section>
		);
	}

	return (
		<section
			className={styles.mission}
			aria-label="Mission Control — roadmap chunk constellation"
		>
			<div className={styles.head}>
				<p className={styles.eyebrow}>Mission Control</p>
				<h2>The build, in orbit.</h2>
				<p className={styles.lede}>
					Every API/DB roadmap chunk (A–J) as a station around the core. Colour is status; a ring pulse is
					build flow; an amber halo means an open decision gate blocks part of the chunk. Hover, tap, or use
					the arrow keys to open its flight plan. Status is compiled from the roadmap and progress log.
				</p>
				<div
					className={styles.legend}
					aria-hidden="true"
				>
					<span className={styles.legDone}>Done</span>
					<span className={styles.legPartial}>In progress</span>
					<span className={styles.legNext}>Ready next</span>
					<span className={styles.legPlanned}>Planned</span>
					<span className={styles.legGated}>Gate-blocked</span>
				</div>
			</div>

			<div className={styles.body}>
				<div
					className={styles.stage}
					data-animate={animate ? 'on' : 'off'}
				>
					<svg
						viewBox="0 0 480 480"
						className={styles.svg}
						role="presentation"
					>
						<defs>
							<radialGradient
								id="missionCoreGlow"
								cx="50%"
								cy="50%"
								r="50%"
							>
								<stop
									offset="0%"
									stopColor="var(--portal-accent)"
									stopOpacity="0.34"
								/>
								<stop
									offset="100%"
									stopColor="var(--portal-accent)"
									stopOpacity="0"
								/>
							</radialGradient>
						</defs>

						<circle
							className={styles.coreGlow}
							cx={CENTER.x}
							cy={CENTER.y}
							r="176"
							fill="url(#missionCoreGlow)"
						/>
						<circle
							className={styles.spinRing}
							cx={CENTER.x}
							cy={CENTER.y}
							r="132"
							fill="none"
							strokeDasharray="2 12"
						/>
						<circle
							className={styles.spinRingReverse}
							cx={CENTER.x}
							cy={CENTER.y}
							r="200"
							fill="none"
							strokeDasharray="1 22"
						/>

						{/* Faint spokes core → every station */}
						{nodes.map((node) => (
							<line
								key={`spoke-${node.id}`}
								className={styles.spoke}
								x1={CENTER.x}
								y1={CENTER.y}
								x2={node.x}
								y2={node.y}
							/>
						))}

						{/* Dependency chords for the selected chunk (lit) */}
						{selectedDeps.map((dep) => (
							<line
								key={`chord-${dep.id}`}
								className={styles.chordActive}
								x1={dep.x}
								y1={dep.y}
								x2={selected.x}
								y2={selected.y}
							/>
						))}

						<path
							className={styles.ring}
							d={ringPath}
							fill="none"
						/>

						{animate && (
							<>
								{[0, 1].map((i) => (
									<circle
										key={`ring-pulse-${i}`}
										r="3.4"
										className={styles.ringPulse}
									>
										<animateMotion
											dur="9s"
											begin={`${-i * 4.5}s`}
											repeatCount="indefinite"
											rotate="auto"
											path={ringPath}
										/>
									</circle>
								))}
								{/* Flow pulses along the selected chunk's dependency chords */}
								{selectedDeps.map((dep, i) => (
									<circle
										key={`chord-pulse-${dep.id}`}
										r="2.8"
										className={styles.chordPulse}
									>
										<animateMotion
											dur="2.4s"
											begin={`${-i * 0.5}s`}
											repeatCount="indefinite"
											path={`M ${dep.x.toFixed(1)},${dep.y.toFixed(1)} L ${selected.x.toFixed(1)},${selected.y.toFixed(1)}`}
										/>
									</circle>
								))}
							</>
						)}

						{/* Core */}
						<g className={styles.core}>
							<circle
								cx={CENTER.x}
								cy={CENTER.y}
								r="46"
								className={styles.coreDisc}
							/>
							<text
								x={CENTER.x}
								y={CENTER.y - 4}
								className={styles.coreLabel}
							>
								{counts.done}/{chunks.length}
							</text>
							<text
								x={CENTER.x}
								y={CENTER.y + 12}
								className={styles.coreSub}
							>
								chunks
							</text>
						</g>

						{/* Stations */}
						{nodes.map((node) => {
							const active = selectedId === node.id;
							const gated = isGated(node, gateById);
							return (
								<g
									key={node.id}
									className={`${styles.node} ${statusClass(node)} ${active ? styles.nodeActive : ''}`}
									role="button"
									tabIndex={0}
									aria-label={`Chunk ${node.id}: ${node.title} — ${STATUS_LABEL[node.status]}${gated ? ', gate-blocked' : ''}`}
									aria-pressed={active}
									onMouseEnter={() => setSelectedId(node.id)}
									onFocus={() => setSelectedId(node.id)}
									onClick={() => setSelectedId(node.id)}
									onKeyDown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											setSelectedId(node.id);
										}
									}}
								>
									{gated && (
										<circle
											className={styles.gateHalo}
											cx={node.x}
											cy={node.y}
											r="26"
											fill="none"
										/>
									)}
									<circle
										className={styles.nodeDisc}
										cx={node.x}
										cy={node.y}
										r="22"
									/>
									<text
										x={node.x}
										y={node.y + 5}
										className={styles.nodeLabel}
									>
										{node.id}
									</text>
								</g>
							);
						})}
					</svg>
				</div>

				<aside
					className={styles.panel}
					aria-live="polite"
				>
					<div className={styles.chips}>
						{nodes.map((node) => (
							<button
								key={node.id}
								type="button"
								className={`${styles.chip} ${statusClass(node)} ${selectedId === node.id ? styles.chipActive : ''}`}
								aria-pressed={selectedId === node.id}
								onMouseEnter={() => setSelectedId(node.id)}
								onClick={() => setSelectedId(node.id)}
							>
								{node.id}
							</button>
						))}
					</div>

					<div className={styles.card}>
						<div className={styles.cardHead}>
							<span className={styles.cardKicker}>Chunk {selected.id}</span>
							<span className={`${styles.statusPill} ${statusClass(selected)}`}>
								{STATUS_LABEL[selected.status]}
							</span>
						</div>
						<h3 className={styles.cardTitle}>{selected.title}</h3>
						<p className={styles.cardBody}>{selected.summary}</p>

						{selected.deps.length > 0 && (
							<p className={styles.cardMeta}>
								<span>Depends on</span> {selected.deps.join(' · ')}
							</p>
						)}

						{selectedGates.length > 0 && (
							<div className={styles.gateNotice}>
								<span
									className={styles.gateDot}
									aria-hidden="true"
								/>
								<span>
									Gate-blocked by{' '}
									{selectedGates.map((g) => (
										<Link
											key={g!.id}
											className={styles.gateLink}
											to="/mission-control#gates"
										>
											{g!.id}
										</Link>
									))}{' '}
									— foundations and seams may proceed; the final policy waits on the decision.
								</span>
							</div>
						)}

						<p className={styles.cardDod}>
							<span>Definition of done</span>
							{selected.dod}
						</p>
					</div>
				</aside>
			</div>

			<div
				className={styles.gates}
				id="gates"
			>
				<p className={styles.gatesHead}>Governed decision gates</p>
				<div className={styles.gateGrid}>
					{gates.map((gate) => (
						<div
							key={gate.id}
							className={`${styles.gateItem} ${gate.status === 'open' ? styles.gateOpen : styles.gateResolved}`}
						>
							<span className={styles.gateItemId}>{gate.id}</span>
							<span className={styles.gateItemLabel}>{gate.label}</span>
							<span className={styles.gateItemStatus}>
								{gate.status === 'open' ? 'Open' : 'Resolved'}
							</span>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}
