/* NEXT-GEN-UI · header loom-breaker control: color-mode adjacent local lock. */

import React, { useState } from 'react';

import { lockDeveloperPortal } from '../PortalSession/lockDeveloperPortal';
import styles from './styles.module.css';

export function PortalLockButton(): React.ReactNode {
	const [pending, setPending] = useState(false);
	const [error, setError] = useState('');

	async function lock(): Promise<void> {
		if (pending) return;
		setPending(true);
		setError('');
		try {
			await lockDeveloperPortal();
		} catch {
			setPending(false);
			setError('The local developer portal could not be locked.');
		}
	}

	return (
		<div className={styles.lockControl}>
			<button
				type="button"
				className={styles.lockButton}
				onClick={() => void lock()}
				disabled={pending}
				aria-label="Lock developer portal"
				title="Lock developer portal"
			>
				<svg
					viewBox="0 0 28 28"
					aria-hidden="true"
				>
					<path
						className={styles.circuitFrame}
						d="M5 4h10l4 4v4M5 24h10l4-4v-4"
					/>
					<path
						className={styles.portalDoor}
						d="M9 8h7v12H9"
					/>
					<path
						className={styles.retractingThread}
						d="M2 14h17"
					/>
					<path
						className={styles.shuttleArrow}
						d="m16 10 4 4-4 4"
					/>
					<circle
						className={styles.signalNode}
						cx="23"
						cy="14"
						r="1.5"
					/>
				</svg>
			</button>
			{error && (
				<span
					className={styles.status}
					role="status"
				>
					{error}
				</span>
			)}
		</div>
	);
}
