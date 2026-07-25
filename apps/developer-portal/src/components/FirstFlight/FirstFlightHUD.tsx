/* ============================================================================
 * NEXT-GEN-UI · First Flight route-spanning spotlight HUD
 * ----------------------------------------------------------------------------
 * WHAT: a global, URL-driven guide that follows one governed persona across
 * documentation routes and highlights the current stable heading target.
 * WHY: contributors need instruction, evidence state, and safe next/back/exit
 * controls without duplicating or rewriting the documentation being taught.
 * HOW: PortalExperience mounts this browser-only component once. The governed
 * query policy resolves persona + step; Docusaurus navigation carries that
 * state to the next route. A requestAnimationFrame measurement loop writes the
 * spotlight frame directly from the target element's viewport rectangle.
 * TUNING: dim strength, HUD position, frame padding, and mobile collapse live
 * in hud.module.css. Facts and anchors remain in the governed JSON dataset.
 *
 * Pass boundary: optional progress is explicit, versioned, device-local, and
 * resettable. Mission Debrief derives from compiled flight facts. There is no
 * telemetry, application API call, repository write, or browsing-history log.
 * ========================================================================= */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHistory, useLocation } from '@docusaurus/router';

import {
	buildFirstFlightDestination,
	useFirstFlightData,
	type FirstFlightNavigationPolicy,
	type FirstFlightPersona,
	type FirstFlightStop,
} from '@site/src/data/first-flight';
import type { PortalPageStatus } from '@site/src/data/portal-data';
import styles from './hud.module.css';
import { MissionDebrief } from './MissionDebrief';
import { useFirstFlightProgress } from './useFirstFlightProgress';

const STATUS_LABEL: Record<PortalPageStatus, string> = {
	implemented: 'Implemented',
	scaffolded: 'Scaffolded',
	planned: 'Planned',
	deferred: 'Deferred',
	deprecated: 'Deprecated',
};

const STATUS_GUIDANCE: Record<PortalPageStatus, string> = {
	implemented: 'Evidence-backed checkpoint. Confirm the linked source before changing behavior.',
	scaffolded: 'Partial implementation. Separate working seams from guarantees that are still missing.',
	planned: 'Locked intent only. Do not describe this checkpoint as working runtime behavior.',
	deferred: 'Approved but deliberately postponed. Do not implement it through this tour.',
	deprecated: 'Historical or transitional surface. Follow its replacement guidance before editing.',
};

type FlightResolution =
	| { kind: 'idle' }
	| { kind: 'invalid'; reason: string }
	| {
			kind: 'active';
			persona: FirstFlightPersona;
			stepIndex: number;
			stop: FirstFlightStop;
	  };

type TargetState = 'idle' | 'locating' | 'found' | 'missing';

function normalizePathname(pathname: string): string {
	const withoutHtml = pathname.replace(/\.html$/, '');
	if (withoutHtml.length > 1) return withoutHtml.replace(/\/+$/, '');
	return withoutHtml || '/';
}

function resolveFlight(
	search: string,
	personas: FirstFlightPersona[],
	policy: FirstFlightNavigationPolicy,
): FlightResolution {
	const params = new URLSearchParams(search);
	const personaId = params.get(policy.personaParam);
	if (!personaId) return { kind: 'idle' };

	const persona = personas.find((candidate) => candidate.id === personaId);
	if (!persona) {
		return { kind: 'invalid', reason: `Unknown First Flight persona “${personaId}”.` };
	}

	const rawStep = params.get(policy.stepParam) ?? '0';
	if (!/^\d+$/.test(rawStep)) {
		return { kind: 'invalid', reason: `Invalid First Flight step “${rawStep}”.` };
	}
	const stepIndex = Number(rawStep);
	const stop = persona.stops[stepIndex];
	if (!stop) {
		return {
			kind: 'invalid',
			reason: `Step ${stepIndex + 1} is outside the ${persona.stops.length}-checkpoint ${persona.label} flight.`,
		};
	}
	return { kind: 'active', persona, stepIndex, stop };
}

function findTarget(stop: FirstFlightStop, enhancementAttribute: string): HTMLElement | null {
	const heading = document.getElementById(stop.anchor);
	if (heading instanceof HTMLElement) return heading;
	for (const candidate of document.querySelectorAll<HTMLElement>(`[${enhancementAttribute}]`)) {
		if (candidate.getAttribute(enhancementAttribute) === stop.anchor) return candidate;
	}
	return null;
}

function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}

export function FirstFlightHUD(): React.ReactNode {
	const { navigationPolicy, personas, progressPolicy, route, targetContract } = useFirstFlightData();
	const location = useLocation();
	const history = useHistory();
	const progressStore = useFirstFlightProgress(progressPolicy, personas);
	const resolution = useMemo(
		() => resolveFlight(location.search, personas, navigationPolicy),
		[location.search, navigationPolicy, personas],
	);
	const frameRef = useRef<HTMLDivElement>(null);
	const targetRef = useRef<HTMLElement | null>(null);
	const measureFrameRef = useRef<number | null>(null);
	const beaconRef = useRef<HTMLButtonElement>(null);
	const minimizeButtonRef = useRef<HTMLButtonElement>(null);
	const previousMinimizedRef = useRef(false);
	const [targetState, setTargetState] = useState<TargetState>('idle');
	const [minimized, setMinimized] = useState(false);
	const [debriefPersonaId, setDebriefPersonaId] = useState<string | null>(null);
	const onCourse = resolution.kind === 'active' && normalizePathname(location.pathname) === resolution.stop.route;
	const activeRecord = resolution.kind === 'active' ? progressStore.records[resolution.persona.id] : undefined;
	const showDebrief =
		resolution.kind === 'active' &&
		onCourse &&
		debriefPersonaId === resolution.persona.id &&
		resolution.stepIndex === resolution.persona.stops.length - 1;

	useEffect(() => {
		if (resolution.kind !== 'active') {
			setMinimized(false);
			setDebriefPersonaId(null);
			return;
		}
		const atFinalStop = resolution.stepIndex === resolution.persona.stops.length - 1;
		if (!atFinalStop) {
			setDebriefPersonaId(null);
		} else if (activeRecord?.completed) {
			setDebriefPersonaId(resolution.persona.id);
		}
	}, [activeRecord?.completed, resolution]);

	const measureSpotlight = useCallback(() => {
		const frame = frameRef.current;
		const target = targetRef.current;
		if (!frame || !target) return;

		const rect = target.getBoundingClientRect();
		if (rect.bottom < 48 || rect.top > window.innerHeight - 20 || rect.width === 0 || rect.height === 0) {
			frame.style.opacity = '0';
			return;
		}

		const padding = 11;
		const left = Math.max(8, rect.left - padding);
		const top = Math.max(54, rect.top - padding);
		const right = Math.min(window.innerWidth - 8, rect.right + padding);
		const bottom = Math.min(window.innerHeight - 8, rect.bottom + padding);
		frame.style.left = `${left}px`;
		frame.style.top = `${top}px`;
		frame.style.width = `${Math.max(24, right - left)}px`;
		frame.style.height = `${Math.max(24, bottom - top)}px`;
		frame.style.opacity = '1';
	}, []);

	const scheduleMeasure = useCallback(() => {
		if (measureFrameRef.current !== null) return;
		measureFrameRef.current = window.requestAnimationFrame(() => {
			measureFrameRef.current = null;
			measureSpotlight();
		});
	}, [measureSpotlight]);

	const exitFlight = useCallback(() => {
		setDebriefPersonaId(null);
		if (resolution.kind === 'active' && onCourse) {
			const target = findTarget(resolution.stop, targetContract.enhancementAttribute);
			if (target) {
				const needsTemporaryTabIndex = !target.hasAttribute('tabindex');
				if (needsTemporaryTabIndex) {
					target.setAttribute('tabindex', '-1');
					target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
				}
				target.focus({ preventScroll: true });
			}
		}
		const params = new URLSearchParams(location.search);
		params.delete(navigationPolicy.personaParam);
		params.delete(navigationPolicy.stepParam);
		const remaining = params.toString();
		history.replace(`${location.pathname}${remaining ? `?${remaining}` : ''}${location.hash}`);
	}, [
		history,
		location.hash,
		location.pathname,
		location.search,
		navigationPolicy,
		onCourse,
		resolution,
		targetContract.enhancementAttribute,
	]);

	const goToStep = useCallback(
		(persona: FirstFlightPersona, stepIndex: number) => {
			const stop = persona.stops[stepIndex];
			if (!stop) return;
			setDebriefPersonaId(null);
			history.push(buildFirstFlightDestination(navigationPolicy, persona.id, stepIndex, stop));
		},
		[history, navigationPolicy],
	);

	const recenter = useCallback(() => {
		const target = targetRef.current;
		if (!target) return;
		const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
		window.requestAnimationFrame(measureSpotlight);
	}, [measureSpotlight]);

	const returnToLaunchBay = useCallback(() => {
		setDebriefPersonaId(null);
		history.push(route);
	}, [history, route]);

	const restartFlight = useCallback(() => {
		if (resolution.kind !== 'active') return;
		if (activeRecord) progressStore.remember(resolution.persona, 0);
		goToStep(resolution.persona, 0);
	}, [activeRecord, goToStep, progressStore.remember, resolution]);

	const completeFlight = useCallback(() => {
		if (resolution.kind !== 'active') return;
		progressStore.complete(resolution.persona);
		setMinimized(false);
		setDebriefPersonaId(resolution.persona.id);
	}, [progressStore.complete, resolution]);

	useEffect(() => {
		if (previousMinimizedRef.current === minimized) return;
		previousMinimizedRef.current = minimized;
		const focusFrame = window.requestAnimationFrame(() => {
			if (minimized) beaconRef.current?.focus();
			else minimizeButtonRef.current?.focus();
		});
		return () => window.cancelAnimationFrame(focusFrame);
	}, [minimized]);

	useEffect(() => {
		if (resolution.kind !== 'active' || !onCourse || !activeRecord || showDebrief) return;
		progressStore.recordReached(resolution.persona, resolution.stepIndex);
	}, [activeRecord, onCourse, progressStore.recordReached, resolution, showDebrief]);

	useEffect(() => {
		const frame = frameRef.current;
		targetRef.current = null;
		if (frame) frame.style.opacity = '0';
		if (resolution.kind !== 'active' || !onCourse || showDebrief) {
			setTargetState(resolution.kind === 'idle' ? 'idle' : 'missing');
			return;
		}

		setTargetState('locating');
		let cancelled = false;
		let locateFrame: number | null = null;
		let attempts = 0;
		let resizeObserver: ResizeObserver | null = null;
		let previousTabIndex: string | null = null;
		let previousDescribedBy: string | null = null;
		let activeTarget: HTMLElement | null = null;

		const locate = () => {
			if (cancelled) return;
			const target = findTarget(resolution.stop, targetContract.enhancementAttribute);
			if (!target && attempts < 11) {
				attempts += 1;
				locateFrame = window.requestAnimationFrame(locate);
				return;
			}
			if (!target) {
				setTargetState('missing');
				return;
			}

			activeTarget = target;
			targetRef.current = target;
			previousTabIndex = target.getAttribute('tabindex');
			previousDescribedBy = target.getAttribute('aria-describedby');
			target.setAttribute('tabindex', '-1');
			target.setAttribute(
				'aria-describedby',
				previousDescribedBy ? `${previousDescribedBy} first-flight-guidance` : 'first-flight-guidance',
			);
			target.setAttribute('data-first-flight-active', 'true');

			const rect = target.getBoundingClientRect();
			if (rect.bottom < 76 || rect.top > window.innerHeight - 120) {
				const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
				target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
			}
			target.focus({ preventScroll: true });
			setTargetState('found');
			scheduleMeasure();
			if (typeof ResizeObserver !== 'undefined') {
				resizeObserver = new ResizeObserver(scheduleMeasure);
				resizeObserver.observe(target);
			}
		};

		locateFrame = window.requestAnimationFrame(locate);
		window.addEventListener('scroll', scheduleMeasure, { passive: true });
		window.addEventListener('resize', scheduleMeasure);

		return () => {
			cancelled = true;
			if (locateFrame !== null) window.cancelAnimationFrame(locateFrame);
			if (measureFrameRef.current !== null) {
				window.cancelAnimationFrame(measureFrameRef.current);
				measureFrameRef.current = null;
			}
			window.removeEventListener('scroll', scheduleMeasure);
			window.removeEventListener('resize', scheduleMeasure);
			resizeObserver?.disconnect();
			if (activeTarget) {
				activeTarget.removeAttribute('data-first-flight-active');
				if (previousTabIndex === null) activeTarget.removeAttribute('tabindex');
				else activeTarget.setAttribute('tabindex', previousTabIndex);
				if (previousDescribedBy === null) activeTarget.removeAttribute('aria-describedby');
				else activeTarget.setAttribute('aria-describedby', previousDescribedBy);
			}
			if (targetRef.current === activeTarget) targetRef.current = null;
		};
	}, [onCourse, resolution, scheduleMeasure, showDebrief, targetContract.enhancementAttribute]);

	useEffect(() => {
		if (resolution.kind !== 'active') return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (isTypingTarget(event.target)) return;
			if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
			if (showDebrief) {
				if (event.key === 'Escape') {
					event.preventDefault();
					exitFlight();
				}
				return;
			}

			if (
				event.altKey &&
				event.key === 'ArrowRight' &&
				resolution.stepIndex < resolution.persona.stops.length - 1
			) {
				event.preventDefault();
				goToStep(resolution.persona, resolution.stepIndex + 1);
			} else if (event.altKey && event.key === 'ArrowLeft' && resolution.stepIndex > 0) {
				event.preventDefault();
				goToStep(resolution.persona, resolution.stepIndex - 1);
			} else if (event.key === 'Escape') {
				event.preventDefault();
				exitFlight();
			} else if (event.key.toLocaleLowerCase('en') === 'r' && !event.metaKey && !event.ctrlKey) {
				event.preventDefault();
				recenter();
			} else if (event.key.toLocaleLowerCase('en') === 'm' && !event.metaKey && !event.ctrlKey) {
				event.preventDefault();
				setMinimized((value) => !value);
			}
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [exitFlight, goToStep, recenter, resolution, showDebrief]);

	if (resolution.kind === 'idle') return null;

	if (resolution.kind === 'invalid') {
		return (
			<aside
				className={`${styles.hud} ${styles.hudWarning}`}
				role="alert"
				aria-label="Invalid First Flight link"
			>
				<p className={styles.eyebrow}>First Flight · Link rejected</p>
				<h2>Guidance could not start.</h2>
				<p>{resolution.reason}</p>
				<button
					type="button"
					className={styles.primaryButton}
					onClick={exitFlight}
				>
					Clear flight parameters
				</button>
			</aside>
		);
	}

	if (!onCourse) {
		return (
			<aside
				className={`${styles.hud} ${styles.hudWarning}`}
				role="status"
				aria-live="polite"
				aria-label="First Flight course correction"
			>
				<p className={styles.eyebrow}>First Flight · Off course</p>
				<h2>{resolution.stop.title}</h2>
				<p>This URL carries a valid flight step, but the current page is not its governed destination.</p>
				<div className={styles.warningActions}>
					<button
						type="button"
						className={styles.primaryButton}
						onClick={() => goToStep(resolution.persona, resolution.stepIndex)}
					>
						Return to checkpoint
					</button>
					<button
						type="button"
						className={styles.secondaryButton}
						onClick={exitFlight}
					>
						Exit
					</button>
				</div>
			</aside>
		);
	}

	if (showDebrief) {
		return (
			<MissionDebrief
				persona={resolution.persona}
				record={activeRecord}
				onReturnToLaunchBay={returnToLaunchBay}
				onRestart={restartFlight}
				onExit={exitFlight}
			/>
		);
	}

	const atFirst = resolution.stepIndex === 0;
	const atLast = resolution.stepIndex === resolution.persona.stops.length - 1;
	const progress = ((resolution.stepIndex + 1) / resolution.persona.stops.length) * 100;

	return (
		<>
			<div
				ref={frameRef}
				className={styles.spotlightFrame}
				aria-hidden="true"
			/>
			{minimized ? (
				<button
					ref={beaconRef}
					id="first-flight-guidance"
					type="button"
					className={styles.beacon}
					onClick={() => setMinimized(false)}
					aria-label={`Restore First Flight guidance, checkpoint ${resolution.stepIndex + 1} of ${resolution.persona.stops.length}`}
				>
					<span
						className={styles.beaconSignal}
						aria-hidden="true"
					/>
					<strong>First Flight</strong>
					<span>
						{resolution.stepIndex + 1}/{resolution.persona.stops.length}
					</span>
				</button>
			) : (
				<aside
					id="first-flight-guidance"
					className={styles.hud}
					aria-labelledby="first-flight-guidance-title"
				>
					<header className={styles.hudHeader}>
						<div>
							<p className={styles.eyebrow}>First Flight · {resolution.persona.label}</p>
							<span className={styles.counter}>
								Checkpoint {resolution.stepIndex + 1} of {resolution.persona.stops.length}
							</span>
						</div>
						<div className={styles.headerActions}>
							<button
								ref={minimizeButtonRef}
								type="button"
								onClick={() => setMinimized(true)}
								aria-label="Minimize First Flight guidance"
								aria-keyshortcuts="M"
							>
								Minimize
							</button>
							<button
								type="button"
								onClick={exitFlight}
								aria-label="Exit First Flight"
								aria-keyshortcuts="Escape"
							>
								Exit
							</button>
						</div>
					</header>

					<div
						className={styles.progressTrack}
						role="progressbar"
						aria-label="First Flight checkpoint progress"
						aria-valuemin={0}
						aria-valuemax={resolution.persona.stops.length}
						aria-valuenow={resolution.stepIndex + 1}
						aria-valuetext={`Checkpoint ${resolution.stepIndex + 1} of ${resolution.persona.stops.length}`}
					>
						<span style={{ width: `${progress}%` }} />
					</div>

					<div className={styles.statusRow}>
						<span data-status={resolution.stop.pageStatus}>{STATUS_LABEL[resolution.stop.pageStatus]}</span>
						<span>{resolution.stop.pageTitle}</span>
						<span
							data-target-state={targetState}
							role="status"
							aria-live="polite"
							aria-atomic="true"
						>
							{targetState === 'found'
								? 'Target locked'
								: targetState === 'missing'
									? 'Target unavailable'
									: 'Acquiring target'}
						</span>
					</div>
					<div className={styles.resumeControl}>
						<span data-persisted={activeRecord ? 'true' : 'false'}>
							{activeRecord ? 'Device resume on' : 'Session-only flight'}
						</span>
						<button
							type="button"
							disabled={
								progressStore.storageIssue === 'invalid' || progressStore.storageIssue === 'unavailable'
							}
							onClick={() => {
								if (activeRecord) progressStore.forget(resolution.persona.id);
								else progressStore.remember(resolution.persona, resolution.stepIndex);
							}}
						>
							{activeRecord ? 'Forget saved progress' : 'Enable device resume'}
						</button>
					</div>
					{progressStore.storageError ? (
						<p
							className={styles.resumeError}
							role="status"
						>
							{progressStore.storageError}
						</p>
					) : null}

					<h2 id="first-flight-guidance-title">{resolution.stop.title}</h2>
					<p className={styles.instruction}>{resolution.stop.instruction}</p>
					<div
						className={styles.statusGuidance}
						data-status={resolution.stop.pageStatus}
					>
						<strong>{STATUS_LABEL[resolution.stop.pageStatus]} evidence boundary</strong>
						<span>{STATUS_GUIDANCE[resolution.stop.pageStatus]}</span>
					</div>
					<details className={styles.whyPanel}>
						<summary>Why this checkpoint matters</summary>
						<p>{resolution.stop.why}</p>
						<code>{resolution.stop.sourcePath}</code>
					</details>

					<footer className={styles.hudFooter}>
						<div className={styles.navigationActions}>
							<button
								type="button"
								className={styles.secondaryButton}
								disabled={atFirst}
								onClick={() => goToStep(resolution.persona, resolution.stepIndex - 1)}
								aria-keyshortcuts="Alt+ArrowLeft"
							>
								<span aria-hidden="true">← </span>Previous
							</button>
							<button
								type="button"
								className={styles.secondaryButton}
								disabled={targetState !== 'found'}
								onClick={recenter}
								aria-keyshortcuts="R"
							>
								Recenter
							</button>
							<button
								type="button"
								className={styles.primaryButton}
								onClick={
									atLast
										? completeFlight
										: () => goToStep(resolution.persona, resolution.stepIndex + 1)
								}
								aria-keyshortcuts={atLast ? undefined : 'Alt+ArrowRight'}
							>
								{atLast ? 'Complete flight' : 'Next'}
								{atLast ? null : <span aria-hidden="true"> →</span>}
							</button>
						</div>
						<p className={styles.keyHints}>
							<kbd>Alt</kbd>+<kbd>←</kbd>/<kbd>→</kbd> move · <kbd>R</kbd> recenter · <kbd>M</kbd>{' '}
							minimize · <kbd>Esc</kbd> exit
						</p>
						{atLast ? (
							<p className={styles.debriefNotice}>
								Final checkpoint. Complete the flight to open Mission Debrief.
							</p>
						) : null}
					</footer>
				</aside>
			)}
		</>
	);
}
