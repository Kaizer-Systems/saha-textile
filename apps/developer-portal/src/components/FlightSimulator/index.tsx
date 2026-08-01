/* ============================================================================
 * NEXT-GEN-UI · Request Flight Simulator
 * ----------------------------------------------------------------------------
 * A photon steps through one request (POST /orders) across the six boundaries.
 * A "Current execution ↔ Ratified target" toggle reveals GHOST stages. Request
 * correlation, error envelopes, cart ownership, and the order+cart transaction
 * are real. Idempotency and atomic inventory/payment/audit side effects remain
 * ghosts. Data comes from the governed build-time portal-data compiler; this
 * visual owns no project facts.
 *
 * Interaction: auto-play (photon loops the flow) + manual step (←/→ or click a
 * stage pauses and jumps). Space toggles play/pause.
 * Educational notes:
 * - The photon's x is measured from the selected stage's DOM node (refs), so it
 *   works regardless of responsive wrapping; recomputed on select + resize.
 * - In "current" mode the flow sequence skips ghost stages (they render dashed so
 *   you SEE what's missing); "target" mode includes them.
 * - Motion (auto-play + photon transition) is disabled under reduced-motion.
 * ========================================================================= */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { useRequestFlightData, type Stage } from '@site/src/data/request-flight';
import styles from './styles.module.css';

type Mode = 'current' | 'target';

export function FlightSimulator(): React.ReactNode {
	const requestFlight = useRequestFlightData();
	const { stages, method, path, title, summary } = requestFlight;
	const [mode, setMode] = useState<Mode>('current');
	const [selectedId, setSelectedId] = useState<string>(stages[0].id);
	const [playing, setPlaying] = useState(false);
	const [reduceMotion, setReduceMotion] = useState(false);

	const railRef = useRef<HTMLDivElement>(null);
	// Ref the DOT of each stage; the track + photon are derived from real dot
	// centers, so alignment is exact and works horizontal / vertical / wrapped.
	const dotRefs = useRef<Map<string, HTMLSpanElement>>(new Map());
	const [centers, setCenters] = useState<Array<{ id: string; x: number; y: number }>>([]);
	const [railSize, setRailSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
	// Signature of the last measurement — skip redundant setState so sub-pixel
	// ResizeObserver noise cannot loop.
	const measureSig = useRef('');
	// Photon: animated with requestAnimationFrame + direct DOM writes (a CSS
	// `left` transition restarts on every re-render and never settles).
	const photonRef = useRef<HTMLDivElement>(null);
	const photonPos = useRef<{ x: number; y: number } | null>(null);
	const photonRaf = useRef(0);

	// The ordered ids the photon flows through (ghosts only in target mode).
	const flowIds = useMemo(
		() => stages.filter((s) => mode === 'target' || s.kind === 'real').map((s) => s.id),
		[mode, stages],
	);

	const selected: Stage = useMemo(() => stages.find((s) => s.id === selectedId) ?? stages[0], [selectedId, stages]);

	useEffect(() => {
		const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		setReduceMotion(reduce);
		setPlaying(!reduce); // auto-play by default, unless reduced motion
	}, []);

	// If the selected stage falls outside the current flow (e.g. a ghost after
	// switching to current mode), snap selection back into the flow.
	useEffect(() => {
		if (!flowIds.includes(selectedId)) setSelectedId(flowIds[0]);
	}, [flowIds, selectedId]);

	// Auto-play: advance through the flow sequence on a loop.
	useEffect(() => {
		if (!playing || reduceMotion) return;
		const timer = window.setInterval(() => {
			setSelectedId((current) => {
				const i = flowIds.indexOf(current);
				return flowIds[(i + 1) % flowIds.length];
			});
		}, 2200);
		return () => window.clearInterval(timer);
	}, [playing, reduceMotion, flowIds]);

	// Measure every dot's center (relative to the rail) + the rail size, so the
	// SVG track/photon overlays map 1:1 to pixels. Re-runs on layout changes.
	const measure = useCallback(() => {
		const rail = railRef.current;
		if (!rail) return;
		const railBox = rail.getBoundingClientRect();
		const next: Array<{ id: string; x: number; y: number }> = [];
		for (const stage of stages) {
			const dot = dotRefs.current.get(stage.id);
			if (!dot) continue;
			const b = dot.getBoundingClientRect();
			next.push({
				id: stage.id,
				x: Math.round(b.left - railBox.left + b.width / 2),
				y: Math.round(b.top - railBox.top + b.height / 2),
			});
		}
		const w = Math.round(railBox.width);
		const h = Math.round(railBox.height);
		const sig = `${w}x${h}:${next.map((c) => `${c.x},${c.y}`).join('|')}`;
		if (sig === measureSig.current) return; // nothing changed → no re-render
		measureSig.current = sig;
		setCenters(next);
		setRailSize({ w, h });
	}, [stages]);

	useLayoutEffect(() => {
		measure();
	}, [measure, mode]);

	useEffect(() => {
		const rail = railRef.current;
		window.addEventListener('resize', measure);
		let ro: ResizeObserver | undefined;
		if (rail && typeof ResizeObserver !== 'undefined') {
			ro = new ResizeObserver(() => measure());
			ro.observe(rail);
		}
		return () => {
			window.removeEventListener('resize', measure);
			ro?.disconnect();
		};
	}, [measure]);

	// Glide the photon to the selected dot. It measures the target dot LIVE (not
	// from `centers` state) and depends ONLY on selectedId — so the ResizeObserver
	// churning `centers` can never cancel the rAF mid-glide. Snaps on window resize.
	useEffect(() => {
		const move = (animate: boolean) => {
			const el = photonRef.current;
			const rail = railRef.current;
			const dot = dotRefs.current.get(selectedId);
			if (!el || !rail || !dot) return;
			const railBox = rail.getBoundingClientRect();
			const dotBox = dot.getBoundingClientRect();
			const tx = dotBox.left - railBox.left + dotBox.width / 2;
			const ty = dotBox.top - railBox.top + dotBox.height / 2;
			window.cancelAnimationFrame(photonRaf.current);
			el.style.opacity = '1';
			const from = photonPos.current;
			if (!from || !animate) {
				photonPos.current = { x: tx, y: ty };
				el.style.left = `${tx}px`;
				el.style.top = `${ty}px`;
				return;
			}
			const start = { ...from };
			const duration = 850;
			const ease = (p: number) => 1 - Math.pow(1 - p, 3);
			let t0 = 0;
			const stepFn = (ts: number) => {
				if (!t0) t0 = ts;
				const p = Math.min(1, (ts - t0) / duration);
				const e = ease(p);
				const x = start.x + (tx - start.x) * e;
				const y = start.y + (ty - start.y) * e;
				el.style.left = `${x}px`;
				el.style.top = `${y}px`;
				photonPos.current = { x, y };
				if (p < 1) photonRaf.current = window.requestAnimationFrame(stepFn);
			};
			photonRaf.current = window.requestAnimationFrame(stepFn);
		};
		move(!reduceMotion);
		const onResize = () => move(false); // snap to the current dot on resize
		window.addEventListener('resize', onResize);
		return () => {
			window.removeEventListener('resize', onResize);
			window.cancelAnimationFrame(photonRaf.current);
		};
	}, [selectedId, reduceMotion]);

	const step = useCallback(
		(dir: 1 | -1) => {
			setPlaying(false);
			setSelectedId((current) => {
				const i = flowIds.indexOf(current);
				const base = i === -1 ? 0 : i;
				return flowIds[(base + dir + flowIds.length) % flowIds.length];
			});
		},
		[flowIds],
	);

	const onKeyDown = (event: React.KeyboardEvent) => {
		if (event.key === 'ArrowRight') {
			event.preventDefault();
			step(1);
		} else if (event.key === 'ArrowLeft') {
			event.preventDefault();
			step(-1);
		} else if (event.key === ' ') {
			event.preventDefault();
			setPlaying((p) => !p);
		}
	};

	return (
		<section
			className={styles.sim}
			aria-label={`Request flight simulator: ${method} ${path}`}
			onKeyDown={onKeyDown}
		>
			<div className={styles.head}>
				<div>
					<p className={styles.eyebrow}>Request Flight Simulator</p>
					<h2>
						<code className={styles.route}>
							<span className={styles.method}>{method}</span> {path}
						</code>{' '}
						· {title}
					</h2>
					<p className={styles.lede}>{summary}</p>
				</div>
			</div>

			<div className={styles.controls}>
				<div
					className={styles.modeToggle}
					role="tablist"
					aria-label="Execution lens"
				>
					{(['current', 'target'] as Mode[]).map((m) => (
						<button
							key={m}
							type="button"
							role="tab"
							aria-selected={mode === m}
							className={mode === m ? styles.modeActive : styles.mode}
							onClick={() => setMode(m)}
						>
							{m === 'current' ? 'Current execution' : 'Ratified target'}
						</button>
					))}
				</div>
				<div className={styles.transport}>
					<button
						type="button"
						className={styles.ctrl}
						onClick={() => step(-1)}
						aria-label="Previous stage"
					>
						‹
					</button>
					{!reduceMotion && (
						<button
							type="button"
							className={styles.ctrl}
							onClick={() => setPlaying((p) => !p)}
							aria-label={playing ? 'Pause' : 'Play'}
						>
							{playing ? '❚❚' : '►'}
						</button>
					)}
					<button
						type="button"
						className={styles.ctrl}
						onClick={() => step(1)}
						aria-label="Next stage"
					>
						›
					</button>
				</div>
			</div>

			<div
				className={styles.rail}
				ref={railRef}
				data-mode={mode}
			>
				{/* Track (behind the dots) — a polyline through the real dot centers. */}
				<svg
					className={styles.trackSvg}
					width={railSize.w}
					height={railSize.h}
					aria-hidden="true"
				>
					{centers.length > 1 && (
						<polyline
							className={styles.track}
							fill="none"
							points={centers.map((c) => `${c.x},${c.y}`).join(' ')}
						/>
					)}
				</svg>

				{stages.map((stage) => {
					const active = selectedId === stage.id;
					const inFlow = flowIds.includes(stage.id);
					return (
						<button
							key={stage.id}
							type="button"
							className={`${styles.node} ${stage.kind === 'ghost' ? styles.nodeGhost : ''} ${active ? styles.nodeActive : ''} ${!inFlow ? styles.nodeDimmed : ''}`}
							aria-pressed={active}
							aria-label={`${stage.label}: ${stage.sublabel}${stage.kind === 'ghost' ? ' (target only)' : ''}`}
							onClick={() => {
								setPlaying(false);
								setSelectedId(stage.id);
							}}
						>
							<span
								className={styles.nodeDot}
								aria-hidden="true"
								ref={(el) => {
									if (el) dotRefs.current.set(stage.id, el);
									else dotRefs.current.delete(stage.id);
								}}
							/>
							<span className={styles.nodeLabel}>{stage.label}</span>
							<span className={styles.nodeSub}>{stage.sublabel}</span>
							{stage.kind === 'ghost' && <span className={styles.ghostTag}>{stage.chunk}</span>}
						</button>
					);
				})}

				{/* Photon — position written directly by the rAF loop above. */}
				<div
					ref={photonRef}
					className={styles.photon}
					style={{ opacity: 0 }}
					aria-hidden="true"
				/>
			</div>

			<div
				className={styles.detail}
				aria-live="polite"
			>
				<div className={styles.detailHead}>
					<span className={styles.detailKicker}>
						{selected.label} · {selected.sublabel}
					</span>
					{selected.kind === 'ghost' && (
						<span className={styles.detailGhostBadge}>Target only · {selected.chunk}</span>
					)}
				</div>
				<code className={styles.detailFile}>{selected.file}</code>
				<div className={styles.lenses}>
					<div className={`${styles.lens} ${mode === 'current' ? styles.lensEmphasis : ''}`}>
						<span className={styles.lensLabel}>Current execution</span>
						<p>{selected.current}</p>
					</div>
					<div className={`${styles.lens} ${mode === 'target' ? styles.lensEmphasis : ''}`}>
						<span className={styles.lensLabel}>Ratified target</span>
						<p>{selected.target}</p>
					</div>
				</div>
			</div>
		</section>
	);
}
