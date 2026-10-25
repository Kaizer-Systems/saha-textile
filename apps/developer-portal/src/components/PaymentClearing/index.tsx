/* ============================================================================
 * NEXT-GEN-UI · Payment clearing lanes
 * What: three gateway lanes. The current INR lane carries a traveling pulse.
 * Why: the payments landing needs its own instrument without joining the locked ten.
 * How: CSS pulse on the CCAvenue stops; later lanes stay dashed and still.
 * Tuning knobs: stop labels, lane hrefs, pulse duration in styles.module.css.
 * ========================================================================= */

import Link from '@docusaurus/Link';
import React, { useId, useRef, useState } from 'react';

import styles from './styles.module.css';

type LaneState = 'current' | 'later';

type Lane = {
	id: string;
	title: string;
	mark: string;
	state: LaneState;
	href: string;
	summary: string;
	stops: string[];
};

const lanes: Lane[] = [
	{
		id: 'ccavenue',
		title: 'CCAvenue',
		mark: 'INR · current preference',
		state: 'current',
		href: '/payments/ccavenue',
		summary: 'HDFC VAS hosted checkout, as printed in the bank guides.',
		stops: [
			'Stored merchant request',
			'AES-128 encRequest POST',
			'Hosted page',
			'encResp on the return URL',
			'orderStatusTracker',
			'Receipt from the database',
		],
	},
	{
		id: 'razorpay',
		title: 'Razorpay',
		mark: 'INR · later',
		state: 'later',
		href: '/payments/razorpay',
		summary: 'Preferred successor. DEC-INR-GATEWAY-TIMING is still open.',
		stops: [],
	},
	{
		id: 'paypal',
		title: 'PayPal',
		mark: 'Non-INR',
		state: 'later',
		href: '/payments/paypal',
		summary: 'International gateway role. Provider notes are not written yet.',
		stops: [],
	},
];

export function PaymentClearing(): React.ReactElement {
	const labelId = useId();
	const railRef = useRef<HTMLDivElement>(null);
	const [selected, setSelected] = useState(0);

	function move(next: number): void {
		const bounded = (next + lanes.length) % lanes.length;
		setSelected(bounded);
		const button = railRef.current?.querySelectorAll<HTMLButtonElement>('[data-lane]')[bounded];
		button?.focus();
	}

	function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
		if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
			event.preventDefault();
			move(selected + 1);
		}
		if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
			event.preventDefault();
			move(selected - 1);
		}
		if (event.key === 'Home') {
			event.preventDefault();
			move(0);
		}
		if (event.key === 'End') {
			event.preventDefault();
			move(lanes.length - 1);
		}
	}

	return (
		<section
			className={styles.clearing}
			aria-labelledby={labelId}
		>
			<div className={styles.headingRow}>
				<div>
					<p className={styles.kicker}>Clearing lanes</p>
					<h2 id={labelId}>Three gateway roles, one hosted handoff</h2>
				</div>
				<p className={styles.legend}>
					Solid lane is the current INR preference. Dashed lanes are recorded and not yet documented from a
					provider kit.
				</p>
			</div>
			<div
				ref={railRef}
				className={styles.lanes}
				role="listbox"
				aria-label="Payment gateways"
				aria-activedescendant={`payment-lane-${lanes[selected].id}`}
				onKeyDown={onKeyDown}
			>
				{lanes.map((lane, index) => {
					const active = index === selected;
					return (
						<article
							key={lane.id}
							id={`payment-lane-${lane.id}`}
							className={lane.state === 'current' ? styles.laneCurrent : styles.laneLater}
							role="option"
							aria-selected={active}
						>
							<div className={styles.laneHead}>
								<button
									type="button"
									data-lane=""
									className={active ? styles.laneButtonActive : styles.laneButton}
									aria-pressed={active}
									onClick={() => setSelected(index)}
								>
									<span className={styles.mark}>{lane.mark}</span>
									<span className={styles.laneTitle}>{lane.title}</span>
								</button>
								<Link
									className={styles.open}
									to={lane.href}
								>
									Open {lane.title}
								</Link>
							</div>
							<p className={styles.summary}>{lane.summary}</p>
							{lane.stops.length > 0 ? (
								<div className={styles.railScroll}>
									<ol className={styles.stops}>
										{lane.stops.map((stop, stopIndex) => (
											<li key={stop}>
												<span className={styles.stopIndex}>{stopIndex + 1}</span>
												{stop}
											</li>
										))}
										<span
											className={styles.pulse}
											aria-hidden="true"
										/>
									</ol>
								</div>
							) : (
								<p className={styles.waiting}>No provider steps are printed here yet.</p>
							)}
						</article>
					);
				})}
			</div>
		</section>
	);
}
