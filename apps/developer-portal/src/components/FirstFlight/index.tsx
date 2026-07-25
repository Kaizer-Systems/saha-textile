/* ============================================================================
 * NEXT-GEN-UI · First Flight Launch Bay
 * ----------------------------------------------------------------------------
 * WHAT: an interactive persona selector and pre-flight dossier for the four
 * governed onboarding paths.
 * WHY: a new contributor should understand the route, evidence state, expected
 * outcome, and stopping points before a route-spanning guide takes control.
 * HOW: the build-time compiler supplies every persona, stop, route, heading,
 * page title/status, and evidence path. React owns only the selected persona.
 * TUNING: layout/glow/trajectory treatment lives in styles.module.css; journey
 * facts belong only in docs/_data/instruments/first-flight.json.
 *
 * Pass boundary: Launch Bay begins or resumes the URL-carried route HUD and
 * offers explicit device-local persistence controls. It never auto-enrols a
 * persona, calls an API, writes the repository, or owns onboarding facts.
 * ========================================================================= */

import React, { useEffect, useMemo, useState } from 'react';
import Link from '@docusaurus/Link';

import {
	buildFirstFlightDestination,
	useFirstFlightData,
	type FirstFlightPersonaId,
	type FirstFlightStop,
} from '@site/src/data/first-flight';
import type { PortalPageStatus } from '@site/src/data/portal-data';
import styles from './styles.module.css';
import { getFirstFlightResumeIndex, useFirstFlightProgress } from './useFirstFlightProgress';

const STATUS_LABEL: Record<PortalPageStatus, string> = {
	implemented: 'Implemented',
	scaffolded: 'Scaffolded',
	planned: 'Planned',
	deferred: 'Deferred',
	deprecated: 'Deprecated',
};

function stopDestination(stop: FirstFlightStop): string {
	return `${stop.route}#${stop.anchor}`;
}

export function FirstFlight(): React.ReactNode {
	const { navigationPolicy, personas, progressPolicy } = useFirstFlightData();
	const [selectedId, setSelectedId] = useState<FirstFlightPersonaId | undefined>(personas[0]?.id);
	const [resetArmed, setResetArmed] = useState(false);
	const selected = personas.find((persona) => persona.id === selectedId) ?? personas[0];
	const progress = useFirstFlightProgress(progressPolicy, personas);
	const persistenceBlocked = progress.storageIssue === 'invalid' || progress.storageIssue === 'unavailable';

	useEffect(() => {
		if (!resetArmed) return;
		const timeout = window.setTimeout(() => setResetArmed(false), 8_000);
		return () => window.clearTimeout(timeout);
	}, [resetArmed]);

	const statusCounts = useMemo(() => {
		if (!selected) return [];
		const counts = new Map<PortalPageStatus, number>();
		for (const stop of selected.stops) {
			counts.set(stop.pageStatus, (counts.get(stop.pageStatus) ?? 0) + 1);
		}
		// Explicit Array.from is hydration-stable in the optimized client bundle.
		// A spread over Map iterators can be downlevelled as a single entry while
		// Node SSR still sees the full iterator, producing different markup.
		return Array.from(counts.entries());
	}, [selected]);

	if (!selected) return null;

	const firstStop = selected.stops[0];
	const selectedIndex = personas.findIndex((persona) => persona.id === selected.id);
	const totalStops = personas.reduce((sum, persona) => sum + persona.stops.length, 0);
	const selectedRecord = progress.records[selected.id];
	const resumeIndex = getFirstFlightResumeIndex(selected, selectedRecord);
	const launchIndex = selectedRecord?.completed ? selected.stops.length - 1 : resumeIndex;
	const launchStop = selected.stops[launchIndex] ?? firstStop;
	const launchLabel = !progress.hydrated
		? 'Checking saved flight…'
		: selectedRecord?.completed
			? 'Review Mission Debrief'
			: selectedRecord
				? `Resume checkpoint ${resumeIndex + 1}`
				: 'Begin guided flight';
	const guidanceState = !progress.hydrated
		? 'Checking device-local progress…'
		: selectedRecord?.completed
			? 'Completed on this device · debrief ready'
			: selectedRecord
				? `Resume at checkpoint ${resumeIndex + 1} of ${selected.stops.length}`
				: 'Route HUD ready · progress off';

	return (
		<section
			className={styles.launchBay}
			aria-labelledby="first-flight-title"
		>
			<div
				className={styles.scanline}
				aria-hidden="true"
			/>
			<header className={styles.header}>
				<div>
					<p className={styles.eyebrow}>First Flight · Launch Bay</p>
					<h2 id="first-flight-title">Choose a mission profile.</h2>
					<p className={styles.lede}>
						The portal will shape a verified reading flight around your role. Inspect the entire route
						before opening its first checkpoint.
					</p>
				</div>
				<div
					className={styles.contractReadout}
					aria-label="First Flight contract"
				>
					<span>
						<strong>{personas.length}</strong> personas
					</span>
					<span>
						<strong>{totalStops}</strong> governed stops
					</span>
					<span>
						<strong>{progressPolicy.telemetry ? 'On' : 'Off'}</strong> telemetry
					</span>
				</div>
			</header>

			<div
				className={styles.personaGrid}
				role="group"
				aria-label="Choose an onboarding persona"
			>
				{personas.map((persona, index) => {
					const active = persona.id === selected.id;
					return (
						<button
							key={persona.id}
							type="button"
							className={`${styles.personaButton} ${active ? styles.personaButtonActive : ''}`}
							aria-pressed={active}
							onClick={() => {
								setSelectedId(persona.id);
								setResetArmed(false);
							}}
						>
							<span className={styles.personaIndex}>{String(index + 1).padStart(2, '0')}</span>
							<span className={styles.personaCopy}>
								<strong>{persona.label}</strong>
								<small>
									{persona.durationMinutes} min · {persona.stops.length} stops
								</small>
							</span>
							<span
								className={styles.personaSignal}
								aria-hidden="true"
							/>
						</button>
					);
				})}
			</div>

			<div className={styles.instrumentBody}>
				<div className={styles.orbitStage}>
					<div
						className={styles.orbit}
						aria-hidden="true"
					>
						<div className={styles.orbitRingOuter} />
						<div className={styles.orbitRingInner} />
						<div className={styles.orbitCore}>
							<span>{String(selectedIndex + 1).padStart(2, '0')}</span>
							<strong>{selected.label}</strong>
							<small>{selected.durationMinutes} minute flight</small>
						</div>
						{selected.stops.map((stop, index) => {
							const angle = -90 + index * (360 / selected.stops.length);
							return (
								<span
									key={stop.id}
									className={styles.orbitNode}
									style={{ '--flight-node-angle': `${angle}deg` } as React.CSSProperties}
								>
									{index + 1}
								</span>
							);
						})}
					</div>
					<div className={styles.outcomeCard}>
						<span>Mission outcome</span>
						<p>{selected.outcome}</p>
					</div>
				</div>

				<div className={styles.dossier}>
					<div className={styles.dossierHeader}>
						<div>
							<span className={styles.dossierKicker}>
								Profile {String(selectedIndex + 1).padStart(2, '0')}
							</span>
							<h3>{selected.label}</h3>
						</div>
						<div
							className={styles.statusSummary}
							aria-label="Destination documentation states"
						>
							{statusCounts.map(([status, count]) => (
								<span
									key={status}
									data-status={status}
								>
									{count} {STATUS_LABEL[status]}
								</span>
							))}
						</div>
					</div>
					<p className={styles.summary}>{selected.summary}</p>

					<ol
						className={styles.stopList}
						aria-label={`${selected.label} flight checkpoints`}
					>
						{selected.stops.map((stop, index) => (
							<li key={stop.id}>
								<span
									className={styles.stopNumber}
									aria-hidden="true"
								>
									{String(index + 1).padStart(2, '0')}
								</span>
								<div className={styles.stopContent}>
									<div className={styles.stopTitleRow}>
										<Link to={stopDestination(stop)}>{stop.title}</Link>
										<span data-status={stop.pageStatus}>{STATUS_LABEL[stop.pageStatus]}</span>
									</div>
									<p>{stop.instruction}</p>
									<details>
										<summary>Why this checkpoint matters</summary>
										<p>{stop.why}</p>
										<code>{stop.sourcePath}</code>
									</details>
								</div>
							</li>
						))}
					</ol>

					<footer className={styles.dossierFooter}>
						<div className={styles.guidanceReadout}>
							<span>Guidance state</span>
							<strong
								role="status"
								aria-live="polite"
								aria-atomic="true"
							>
								{guidanceState}
							</strong>
							<label className={styles.progressToggle}>
								<input
									type="checkbox"
									checked={Boolean(selectedRecord)}
									disabled={!progress.hydrated || persistenceBlocked}
									onChange={(event) => {
										if (event.target.checked) progress.remember(selected, 0);
										else progress.forget(selected.id);
									}}
								/>
								<span>Remember this persona on this device</span>
							</label>
						</div>
						{launchStop ? (
							<Link
								className={styles.launchButton}
								to={buildFirstFlightDestination(navigationPolicy, selected.id, launchIndex, launchStop)}
								aria-disabled={!progress.hydrated}
								tabIndex={progress.hydrated ? undefined : -1}
								onClick={(event) => {
									if (!progress.hydrated) event.preventDefault();
								}}
							>
								{launchLabel}
								<span aria-hidden="true"> ↗</span>
							</Link>
						) : null}
					</footer>
					{progress.storageError ? (
						<p
							className={styles.storageError}
							role="status"
						>
							{progress.storageError}
						</p>
					) : null}
				</div>
			</div>

			<div className={styles.safetyStrip}>
				<div>
					<span>Local by design</span>
					{progress.canReset ? (
						<button
							type="button"
							className={resetArmed ? styles.resetButtonArmed : styles.resetButton}
							onClick={() => {
								if (!resetArmed) {
									setResetArmed(true);
									return;
								}
								progress.resetAll();
								setResetArmed(false);
							}}
						>
							{resetArmed ? 'Confirm reset all' : 'Reset all saved flights'}
						</button>
					) : null}
				</div>
				<strong>
					Explicit opt-in · {progressPolicy.resettable ? 'resettable' : 'fixed'} · no telemetry, API, or
					repository writes
				</strong>
			</div>
		</section>
	);
}
