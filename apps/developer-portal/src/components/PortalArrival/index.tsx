/* ============================================================================
 * NEXT-GEN-UI · Identity Loom cross-document aperture
 * ----------------------------------------------------------------------------
 * WHAT: completes the standalone login ceremony over the authenticated route
 *       and provides the command-palette replay of the full loom sequence.
 * WHY: the destination must emerge through the reactor instead of appearing
 *      after a branded loading spinner.
 * HOW: the login sets a session handoff flag; the mounted portal cuts a growing
 *      transparent aperture through this overlay. Replay uses the same five
 *      timed visual phases without re-authenticating.
 * ========================================================================== */

import React, { useCallback, useEffect, useRef, useState } from 'react';

import styles from './styles.module.css';

const arrivalStorageKey = 'saha_textile_developer_portal_arrival';
const mutedStorageKey = 'saha_textile_developer_portal_sound_muted';
const replayEvent = 'portal:replay-identity-loom';
const strandCount = 72;
const punchCellCount = 48;

type ArrivalMode = 'handoff' | 'replay' | null;

type AudioWindow = Window &
	typeof globalThis & {
		webkitAudioContext?: typeof AudioContext;
	};

function playReplayAudio(): void {
	if (window.localStorage.getItem(mutedStorageKey) === 'true') return;
	const AudioConstructor = window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
	if (!AudioConstructor) return;

	const audio = new AudioConstructor();
	const master = audio.createGain();
	const compressor = audio.createDynamicsCompressor();
	const ceremony = audio.createGain();
	master.gain.value = 0.82;
	compressor.threshold.value = -18;
	compressor.knee.value = 14;
	compressor.ratio.value = 8;
	compressor.attack.value = 0.003;
	compressor.release.value = 0.22;
	ceremony.gain.value = 0.72;
	ceremony.connect(compressor);
	compressor.connect(master);
	master.connect(audio.destination);

	function tone(
		frequency: number,
		endFrequency: number,
		duration: number,
		gain: number,
		delay: number,
		type: OscillatorType,
	): void {
		const start = audio.currentTime + delay;
		const oscillator = audio.createOscillator();
		const envelope = audio.createGain();
		oscillator.type = type;
		oscillator.frequency.setValueAtTime(frequency, start);
		oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
		envelope.gain.setValueAtTime(0.0001, start);
		envelope.gain.exponentialRampToValueAtTime(gain, start + Math.min(0.02, duration * 0.2));
		envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
		oscillator.connect(envelope);
		envelope.connect(ceremony);
		oscillator.start(start);
		oscillator.stop(start + duration + 0.03);
	}

	[55, 82.41, 110].forEach((frequency, index) => {
		tone(
			frequency,
			frequency * 1.5,
			4.7,
			index === 0 ? 0.082 : 0.047,
			0.08 + index * 0.04,
			index === 0 ? 'sine' : 'triangle',
		);
	});
	tone(118, 620, 1.15, 0.052, 0.82, 'sawtooth');

	for (let index = 0; index < 11; index += 1) {
		tone(260 + index * 39, 300 + index * 42, 0.13, 0.04, 2.02 + index * 0.105, 'triangle');
	}

	[146.83, 220, 293.66, 440].forEach((frequency, index) => {
		tone(frequency, frequency * 1.04, 1.18, 0.068, 3.2 + index * 0.035, index < 2 ? 'triangle' : 'sine');
	});

	[293.66, 440, 587.33, 880].forEach((frequency, index) => {
		tone(frequency, frequency * 1.12, 0.58, 0.074 - index * 0.007, 4.4 + index * 0.025, 'sine');
	});

	window.setTimeout(() => void audio.close(), 5_300);
}

function ReactorGeometry(): React.ReactNode {
	return (
		<div className={styles.reactor}>
			<svg
				viewBox="0 0 640 640"
				aria-hidden="true"
			>
				<g className={styles.outerOrbit}>
					<circle
						cx="320"
						cy="320"
						r="280"
					/>
					<polygon points="320,38 564,179 564,461 320,602 76,461 76,179" />
				</g>
				<g className={styles.middleOrbit}>
					<circle
						cx="320"
						cy="320"
						r="205"
					/>
					<polygon points="320,114 498,217 498,423 320,526 142,423 142,217" />
				</g>
				<g className={styles.innerOrbit}>
					<circle
						cx="320"
						cy="320"
						r="128"
					/>
					<polygon points="320,190 432,255 432,385 320,450 208,385 208,255" />
				</g>
				<g className={styles.conduits}>
					<path d="M320 38V190M564 179L432 255M564 461L432 385M320 602V450M76 461L208 385M76 179L208 255" />
					<path d="M40 320H192M448 320H600M320 40V192M320 448V600" />
				</g>
			</svg>
			<div className={styles.core}>
				<img
					src="/img/logo.svg"
					alt=""
					width="72"
					height="72"
				/>
			</div>
		</div>
	);
}

export function PortalArrival(): React.ReactNode {
	const [mode, setMode] = useState<ArrivalMode>(null);
	const timer = useRef<number | undefined>(undefined);

	const play = useCallback((nextMode: Exclude<ArrivalMode, null>) => {
		window.clearTimeout(timer.current);
		setMode(null);
		window.requestAnimationFrame(() => {
			setMode(nextMode);
			const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
			const duration = reduced ? 180 : nextMode === 'replay' ? 5_000 : 900;
			if (nextMode === 'replay' && !reduced) playReplayAudio();
			timer.current = window.setTimeout(() => setMode(null), duration);
		});
	}, []);

	useEffect(() => {
		if (window.sessionStorage.getItem(arrivalStorageKey) === 'granted') {
			window.sessionStorage.removeItem(arrivalStorageKey);
			play('handoff');
		}

		const replay = () => play('replay');
		window.addEventListener(replayEvent, replay);
		return () => {
			window.clearTimeout(timer.current);
			window.removeEventListener(replayEvent, replay);
		};
	}, [play]);

	if (!mode) return null;

	return (
		<div
			className={styles.arrival}
			data-mode={mode}
			aria-hidden="true"
		>
			<div className={styles.veil}></div>
			<div className={styles.coordinateField}></div>
			<div className={styles.warp}>
				{Array.from({ length: strandCount }, (_, index) => (
					<i
						key={index}
						style={{ '--strand-index': index } as React.CSSProperties}
					/>
				))}
			</div>
			<div className={styles.compiler}>
				<header>
					<span>Jacquard computation matrix</span>
					<output>Pattern resolving</output>
				</header>
				<div className={styles.punchGrid}>
					{Array.from({ length: punchCellCount }, (_, index) => (
						<i
							key={index}
							style={{ '--punch-index': index } as React.CSSProperties}
						/>
					))}
				</div>
				<div className={styles.shuttle}></div>
			</div>
			<ReactorGeometry />
			<div className={styles.aperture}>
				<i></i>
				<i></i>
				<i></i>
			</div>
			<div className={styles.phaseReadout}>
				<span>01 / 05 · Credential lock</span>
				<span>02 / 05 · Warp tension</span>
				<span>03 / 05 · Jacquard compile</span>
				<span>04 / 05 · Architecture fold</span>
				<span>05 / 05 · Portal breach</span>
			</div>
		</div>
	);
}

export { replayEvent };
