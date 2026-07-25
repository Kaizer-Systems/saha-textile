/* ============================================================================
 * NEXT-GEN-UI · First Flight Mission Debrief
 * ----------------------------------------------------------------------------
 * WHAT: the third-act completion surface for a governed persona flight.
 * WHY: a contributor needs a concise handoff from guided reading back to
 * independent work without the portal pretending that reading proves mastery.
 * HOW: checkpoint count, lifecycle mix, evidence cautions, and mission outcome
 * are derived exclusively from the compiled persona dataset. Persistence copy
 * reflects the validated device-local record supplied by the progress adapter.
 * TUNING: layout and responsive treatment live in hud.module.css.
 * ========================================================================= */

import React, { useEffect, useMemo, useRef } from 'react';

import type { FirstFlightPersona } from '@site/src/data/first-flight';
import type { PortalPageStatus } from '@site/src/data/portal-data';
import styles from './hud.module.css';
import type { FirstFlightProgressRecord } from './useFirstFlightProgress';

const STATUS_LABEL: Record<PortalPageStatus, string> = {
	implemented: 'Implemented',
	scaffolded: 'Scaffolded',
	planned: 'Planned',
	deferred: 'Deferred',
	deprecated: 'Deprecated',
};

type MissionDebriefProps = {
	persona: FirstFlightPersona;
	record?: FirstFlightProgressRecord;
	onReturnToLaunchBay: () => void;
	onRestart: () => void;
	onExit: () => void;
};

export function MissionDebrief({
	persona,
	record,
	onReturnToLaunchBay,
	onRestart,
	onExit,
}: MissionDebriefProps): React.ReactNode {
	const dialogRef = useRef<HTMLElement>(null);
	const lifecycleMix = useMemo(() => {
		const counts = new Map<PortalPageStatus, number>();
		for (const stop of persona.stops) {
			counts.set(stop.pageStatus, (counts.get(stop.pageStatus) ?? 0) + 1);
		}
		return Array.from(counts.entries());
	}, [persona]);
	const cautionCount = persona.stops.filter((stop) => stop.pageStatus !== 'implemented').length;
	const completionTime =
		record?.completed && record.completedAt ? new Date(record.completedAt).toLocaleString() : null;

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;
		dialog.focus({ preventScroll: true });

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				onExit();
				return;
			}
			if (event.key !== 'Tab') return;

			const focusable = Array.from(
				dialog.querySelectorAll<HTMLElement>(
					'a[href], button:not([disabled]), summary, input:not([disabled]), [tabindex]:not([tabindex="-1"])',
				),
			).filter((element) => !element.hasAttribute('hidden') && element.getClientRects().length > 0);
			if (focusable.length === 0) {
				event.preventDefault();
				dialog.focus();
				return;
			}

			const first = focusable[0];
			const last = focusable.at(-1);
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last?.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first?.focus();
			} else if (document.activeElement === dialog) {
				event.preventDefault();
				(event.shiftKey ? last : first)?.focus();
			}
		};

		dialog.addEventListener('keydown', onKeyDown);
		return () => dialog.removeEventListener('keydown', onKeyDown);
	}, [onExit]);

	return (
		<>
			<div
				className={styles.debriefScrim}
				aria-hidden="true"
			/>
			<aside
				ref={dialogRef}
				className={`${styles.hud} ${styles.debriefHud}`}
				role="dialog"
				aria-modal="true"
				aria-labelledby="first-flight-debrief-title"
				aria-describedby="first-flight-debrief-description"
				tabIndex={-1}
			>
				<header className={styles.debriefHeader}>
					<div>
						<p className={styles.eyebrow}>First Flight · Mission Debrief</p>
						<span className={styles.counter}>{persona.label}</span>
					</div>
					<span
						className={styles.debriefSeal}
						aria-hidden="true"
					>
						✓
					</span>
				</header>

				<div className={styles.debriefHero}>
					<span>Final checkpoint reached</span>
					<h2 id="first-flight-debrief-title">Your guided route is ready for handoff.</h2>
					<p id="first-flight-debrief-description">
						This closes the current reading route. It does not prove that every checkpoint was studied, or
						grant implementation approval, production readiness, or mastery of the linked surfaces.
					</p>
				</div>

				<div className={styles.debriefTelemetry}>
					<div>
						<strong>{persona.stops.length}</strong>
						<span>checkpoints in route</span>
					</div>
					<div>
						<strong>{lifecycleMix.length}</strong>
						<span>lifecycle states</span>
					</div>
					<div>
						<strong>{cautionCount}</strong>
						<span>evidence cautions</span>
					</div>
				</div>

				<div className={styles.debriefGrid}>
					<section className={styles.debriefOutcome}>
						<span>Mission outcome</span>
						<p>{persona.outcome}</p>
						<div
							className={styles.debriefRecord}
							data-persisted={record?.completed ? 'true' : 'false'}
						>
							<strong>{record?.completed ? 'Saved on this device' : 'Session-only completion'}</strong>
							<span>
								{completionTime
									? `Completed ${completionTime}`
									: 'No completion record was written. The debrief disappears when this session ends.'}
							</span>
						</div>
					</section>

					<section className={styles.debriefEvidence}>
						<span>Evidence encountered</span>
						<div className={styles.debriefStatusMix}>
							{lifecycleMix.map(([status, count]) => (
								<span
									key={status}
									data-status={status}
								>
									<strong>{count}</strong> {STATUS_LABEL[status]}
								</span>
							))}
						</div>
						<p>
							Re-check lifecycle status and provenance whenever you return: documentation and runtime
							evidence can advance after this local record was created.
						</p>
					</section>
				</div>

				<details className={styles.debriefManifest}>
					<summary>Review the route checkpoint manifest</summary>
					<ol>
						{persona.stops.map((stop, index) => (
							<li key={stop.id}>
								<span>{String(index + 1).padStart(2, '0')}</span>
								<strong>{stop.title}</strong>
								<small data-status={stop.pageStatus}>{STATUS_LABEL[stop.pageStatus]}</small>
							</li>
						))}
					</ol>
				</details>

				<footer className={styles.debriefActions}>
					<button
						type="button"
						className={styles.primaryButton}
						onClick={onReturnToLaunchBay}
					>
						Return to Launch Bay
					</button>
					<button
						type="button"
						className={styles.secondaryButton}
						onClick={onRestart}
					>
						Fly this path again
					</button>
					<button
						type="button"
						className={styles.secondaryButton}
						onClick={onExit}
					>
						Exit guide
					</button>
				</footer>
			</aside>
		</>
	);
}
