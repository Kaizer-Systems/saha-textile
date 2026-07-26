/**
 * NEXT-GEN-UI · Child tool gateways
 * ----------------------------------------------------------------------------
 * WHAT: symbolic, accessible launch sequences between Docusaurus and generated
 * child tools.
 * WHY: the child mount and the Docusaurus fallback bridge intentionally share a
 * route. A full document navigation is required so the composite static server,
 * rather than the Docusaurus client router, resolves the generated child.
 * HOW: each gateway owns a tool-specific SVG metaphor and calls
 * window.location.assign after a short reduced-motion-aware transition.
 * TUNING: timing is shared with the CSS --gateway-launch-duration custom
 * property. Keep it below one second so symbolism never becomes a delay tax.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

import styles from './styles.module.css';

export type ChildToolSymbol = 'component-forge' | 'type-lattice';

type ChildToolGatewayProps = {
	toolName: string;
	target: string;
	eyebrow: string;
	title: string;
	description: string;
	launchLabel: string;
	symbol: ChildToolSymbol;
};

const LAUNCH_DURATION_MS = 760;

function resolveChildEntry(target: string): string {
	return `${target.replace(/\/+$/u, '')}/index.html`;
}

function ComponentForgeSymbol({ active }: { active: boolean }) {
	return (
		<svg
			className={styles.symbol}
			data-active={active ? 'true' : 'false'}
			viewBox="0 0 520 300"
			role="img"
			aria-label="Interface primitives orbiting and assembling into a component block"
		>
			<defs>
				<radialGradient id="forge-core">
					<stop
						offset="0"
						stopColor="var(--portal-accent)"
						stopOpacity="0.68"
					/>
					<stop
						offset="1"
						stopColor="var(--portal-accent)"
						stopOpacity="0"
					/>
				</radialGradient>
				<filter
					id="forge-glow"
					x="-80%"
					y="-80%"
					width="260%"
					height="260%"
				>
					<feGaussianBlur
						stdDeviation="5"
						result="blur"
					/>
					<feMerge>
						<feMergeNode in="blur" />
						<feMergeNode in="SourceGraphic" />
					</feMerge>
				</filter>
			</defs>
			<circle
				className={styles.orbit}
				cx="260"
				cy="150"
				r="112"
			/>
			<circle
				className={styles.orbit}
				cx="260"
				cy="150"
				r="76"
			/>
			<circle
				className={styles.coreHalo}
				cx="260"
				cy="150"
				r="76"
				fill="url(#forge-core)"
			/>
			<g className={`${styles.primitive} ${styles.primitiveOne}`}>
				<rect
					x="62"
					y="60"
					width="84"
					height="38"
					rx="8"
				/>
				<circle
					cx="81"
					cy="79"
					r="6"
				/>
				<path d="M96 79h32" />
			</g>
			<g className={`${styles.primitive} ${styles.primitiveTwo}`}>
				<rect
					x="384"
					y="52"
					width="72"
					height="72"
					rx="12"
				/>
				<path d="M402 72h36M402 87h26M402 102h31" />
			</g>
			<g className={`${styles.primitive} ${styles.primitiveThree}`}>
				<rect
					x="388"
					y="210"
					width="82"
					height="36"
					rx="18"
				/>
				<path d="M410 228h38" />
			</g>
			<g className={`${styles.primitive} ${styles.primitiveFour}`}>
				<rect
					x="55"
					y="202"
					width="94"
					height="50"
					rx="8"
				/>
				<path d="m75 233 17-17 15 12 16-15" />
			</g>
			<g
				className={styles.forgeBlock}
				filter="url(#forge-glow)"
			>
				<rect
					x="191"
					y="93"
					width="138"
					height="114"
					rx="16"
				/>
				<path d="M212 119h96M212 143h58M212 181h96" />
				<circle
					cx="295"
					cy="143"
					r="13"
				/>
				<path
					className={styles.forgePulse}
					d="M174 150h17M329 150h17"
				/>
			</g>
			<g className={styles.connectionLines}>
				<path d="M145 84 191 119M384 90l-55 29M149 225l42-44M388 228l-59-47" />
			</g>
		</svg>
	);
}

function TypeLatticeSymbol({ active }: { active: boolean }) {
	return (
		<svg
			className={styles.symbol}
			data-active={active ? 'true' : 'false'}
			viewBox="0 0 520 300"
			role="img"
			aria-label="Typed source glyphs resolving through a lattice into a contract prism"
		>
			<defs>
				<linearGradient
					id="lattice-prism"
					x1="0"
					y1="0"
					x2="1"
					y2="1"
				>
					<stop
						offset="0"
						stopColor="var(--portal-accent)"
						stopOpacity="0.62"
					/>
					<stop
						offset="0.52"
						stopColor="var(--portal-success)"
						stopOpacity="0.3"
					/>
					<stop
						offset="1"
						stopColor="var(--portal-warning)"
						stopOpacity="0.18"
					/>
				</linearGradient>
				<filter
					id="lattice-glow"
					x="-70%"
					y="-70%"
					width="240%"
					height="240%"
				>
					<feGaussianBlur
						stdDeviation="4"
						result="blur"
					/>
					<feMerge>
						<feMergeNode in="blur" />
						<feMergeNode in="SourceGraphic" />
					</feMerge>
				</filter>
			</defs>
			<g className={styles.latticeLines}>
				<path d="M74 72 260 150 446 72M74 228l186-78 186 78M74 72v156M446 72v156" />
				<path d="M151 104v92M369 104v92M151 104l218 92M369 104 151 196" />
			</g>
			<g className={styles.typeGlyphs}>
				<text
					x="56"
					y="64"
				>
					{'<'}
				</text>
				<text
					x="444"
					y="64"
				>
					{'>'}
				</text>
				<text
					x="52"
					y="254"
				>
					{'{'}
				</text>
				<text
					x="448"
					y="254"
				>
					{'}'}
				</text>
				<text
					x="132"
					y="100"
				>
					T
				</text>
				<text
					x="370"
					y="100"
				>
					?
				</text>
			</g>
			<g className={styles.latticeNodes}>
				{[
					[74, 72],
					[446, 72],
					[74, 228],
					[446, 228],
					[151, 104],
					[369, 104],
					[151, 196],
					[369, 196],
				].map(([cx, cy]) => (
					<circle
						key={`${cx}-${cy}`}
						cx={cx}
						cy={cy}
						r="5"
					/>
				))}
			</g>
			<g
				className={styles.prism}
				filter="url(#lattice-glow)"
			>
				<path
					d="m260 72 72 42v76l-72 42-72-42v-76Z"
					fill="url(#lattice-prism)"
				/>
				<path d="m260 72 72 42-72 42-72-42Zm0 84v76M188 114v76l72 42 72-42v-76" />
				<text
					x="234"
					y="164"
				>
					TS
				</text>
			</g>
		</svg>
	);
}

export function ChildToolGateway({
	toolName,
	target,
	eyebrow,
	title,
	description,
	launchLabel,
	symbol,
}: ChildToolGatewayProps) {
	const [launching, setLaunching] = useState(false);
	const navigationTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	useEffect(
		() => () => {
			if (navigationTimer.current) {
				clearTimeout(navigationTimer.current);
			}
		},
		[],
	);

	const launch = useCallback(() => {
		if (launching || typeof window === 'undefined') {
			return;
		}
		setLaunching(true);
		const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		navigationTimer.current = setTimeout(
			() => window.location.assign(resolveChildEntry(target)),
			reduceMotion ? 0 : LAUNCH_DURATION_MS,
		);
	}, [launching, target]);

	return (
		<section
			className={`${styles.gateway}${launching ? ` ${styles.gatewayLaunching}` : ''}`}
			aria-label={`${toolName} launch gateway`}
			aria-busy={launching}
		>
			<div
				className={styles.starField}
				aria-hidden="true"
			/>
			<div className={styles.visual}>
				{symbol === 'component-forge' ? (
					<ComponentForgeSymbol active={launching} />
				) : (
					<TypeLatticeSymbol active={launching} />
				)}
				<div
					className={styles.coordinates}
					aria-hidden="true"
				>
					<span>CHILD SURFACE</span>
					<span>VERIFIED BUILD</span>
				</div>
			</div>
			<div className={styles.copy}>
				<p className={styles.eyebrow}>{eyebrow}</p>
				<h2>{title}</h2>
				<p>{description}</p>
				<button
					className={styles.launchButton}
					type="button"
					onClick={launch}
					disabled={launching}
				>
					<span
						className={styles.buttonGlyph}
						aria-hidden="true"
					>
						{symbol === 'component-forge' ? '⬡' : '⌁'}
					</span>
					<span>{launching ? 'Aligning portal…' : launchLabel}</span>
					<span
						className={styles.buttonVector}
						aria-hidden="true"
					>
						→
					</span>
				</button>
				<p className={styles.runtimeNote}>
					Requires the composite <code>portal:persistent</code> runtime.
				</p>
			</div>
			<div
				className={styles.transitionVeil}
				aria-hidden="true"
			>
				<span />
				<span />
				<span />
			</div>
		</section>
	);
}
