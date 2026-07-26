/**
 * NEXT-GEN-UI · Child tool gateways
 * ----------------------------------------------------------------------------
 * WHAT: symbolic, accessible launch sequences between Docusaurus and generated
 * child tools.
 * WHY: every portal route lands on a unique Docusaurus bridge before handing
 * off to a separately mounted generated child. A full document navigation lets
 * the composite static server resolve that child entry.
 * HOW: each gateway owns a tool-specific SVG metaphor, responds to pointer
 * position, and awakens a full-viewport living-system sequence before the
 * document handoff.
 * TUNING: keep LAUNCH_DURATION_MS synchronized with
 * --gateway-launch-duration. Reduced-motion users bypass the cinematic delay.
 */

import React, { type PointerEvent, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import styles from './styles.module.css';

export type ChildToolSymbol = 'component-forge' | 'type-lattice' | 'request-wormhole' | 'schema-observatory';

type ChildToolGatewayProps = {
	toolName: string;
	target: string;
	eyebrow: string;
	title: string;
	description: string;
	launchLabel: string;
	symbol: ChildToolSymbol;
};

const LAUNCH_DURATION_MS = 3000;

type GatewayPersona = {
	mode: string;
	awakening: string;
	phases: [string, string, string];
};

function gatewayPersona(symbol: ChildToolSymbol): GatewayPersona {
	switch (symbol) {
		case 'component-forge':
			return {
				mode: 'PRIMITIVE MATRIX',
				awakening: 'Component Forge is alive',
				phases: ['Capturing interface atoms', 'Forging application contexts', 'Releasing the component matrix'],
			};
		case 'type-lattice':
			return {
				mode: 'CONTRACT INTELLIGENCE',
				awakening: 'Type Lattice is resolving',
				phases: [
					'Reading exported glyphs',
					'Crystallizing contract edges',
					'Opening the typed knowledge field',
				],
			};
		case 'request-wormhole':
			return {
				mode: 'GOVERNED REQUEST CHANNEL',
				awakening: 'Request Wormhole is opening',
				phases: [
					'Locking the OpenAPI vector',
					'Bending the request corridor',
					'Stabilizing the flight console',
				],
			};
		case 'schema-observatory':
			return {
				mode: 'PERSISTENCE TELEMETRY',
				awakening: 'Schema Observatory has sight',
				phases: ['Acquiring model signals', 'Resolving schema constellations', 'Focusing the evidence field'],
			};
	}
}

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

function RequestWormholeSymbol({ active }: { active: boolean }) {
	return (
		<svg
			className={styles.symbol}
			data-active={active ? 'true' : 'false'}
			viewBox="0 0 520 300"
			role="img"
			aria-label="An API request packet traversing an OpenAPI wormhole"
		>
			<defs>
				<radialGradient id="wormhole-core">
					<stop
						offset="0"
						stopColor="var(--portal-canvas)"
					/>
					<stop
						offset="0.42"
						stopColor="var(--portal-accent)"
						stopOpacity="0.34"
					/>
					<stop
						offset="1"
						stopColor="var(--portal-accent)"
						stopOpacity="0"
					/>
				</radialGradient>
			</defs>
			<g className={styles.wormholeRings}>
				{[114, 90, 66, 42].map((radius) => (
					<ellipse
						key={radius}
						cx="260"
						cy="150"
						rx={radius}
						ry={Math.round(radius * 0.48)}
					/>
				))}
			</g>
			<circle
				className={styles.wormholeCore}
				cx="260"
				cy="150"
				r="82"
				fill="url(#wormhole-core)"
			/>
			<path
				className={styles.requestTrajectory}
				d="M44 214C132 214 146 158 222 151s118-49 254-56"
			/>
			<g className={styles.requestPacket}>
				<rect
					x="48"
					y="194"
					width="98"
					height="42"
					rx="10"
				/>
				<text
					x="67"
					y="220"
				>
					POST /orders
				</text>
			</g>
			<g className={styles.responsePacket}>
				<rect
					x="388"
					y="74"
					width="86"
					height="42"
					rx="10"
				/>
				<text
					x="411"
					y="100"
				>
					201
				</text>
			</g>
			<text
				className={styles.openapiLabel}
				x="217"
				y="156"
			>
				OPENAPI
			</text>
		</svg>
	);
}

function SchemaObservatorySymbol({ active }: { active: boolean }) {
	const modelStars = [
		[186, 88],
		[264, 66],
		[336, 104],
		[350, 182],
		[276, 224],
		[194, 207],
		[158, 146],
	];
	return (
		<svg
			className={styles.symbol}
			data-active={active ? 'true' : 'false'}
			viewBox="0 0 520 300"
			role="img"
			aria-label="A schema telescope resolving seven current MongoDB model constellations"
		>
			<g className={styles.observatoryOrbit}>
				<ellipse
					cx="260"
					cy="150"
					rx="118"
					ry="94"
				/>
				<ellipse
					cx="260"
					cy="150"
					rx="82"
					ry="64"
				/>
			</g>
			<path
				className={styles.constellationPath}
				d="M186 88 264 66 336 104 350 182 276 224 194 207 158 146 186 88 276 224M158 146l178-42"
			/>
			<g className={styles.modelStars}>
				{modelStars.map(([cx, cy], index) => (
					<g key={`${cx}-${cy}`}>
						<circle
							cx={cx}
							cy={cy}
							r="8"
						/>
						<text
							x={cx}
							y={cy + 3}
						>
							{index + 1}
						</text>
					</g>
				))}
			</g>
			<g className={styles.telescope}>
				<path d="m76 232 73-71 24 24-72 72Z" />
				<ellipse
					cx="162"
					cy="173"
					rx="24"
					ry="35"
					transform="rotate(-45 162 173)"
				/>
				<path d="m108 229-26 48M126 240l14 37" />
			</g>
			<text
				className={styles.mongodbLabel}
				x="385"
				y="254"
			>
				7 CURRENT
			</text>
		</svg>
	);
}

function GatewaySymbol({ symbol, active }: { symbol: ChildToolSymbol; active: boolean }) {
	switch (symbol) {
		case 'component-forge':
			return <ComponentForgeSymbol active={active} />;
		case 'type-lattice':
			return <TypeLatticeSymbol active={active} />;
		case 'request-wormhole':
			return <RequestWormholeSymbol active={active} />;
		case 'schema-observatory':
			return <SchemaObservatorySymbol active={active} />;
	}
}

function gatewayGlyph(symbol: ChildToolSymbol): string {
	switch (symbol) {
		case 'component-forge':
			return '⬡';
		case 'type-lattice':
			return '⌁';
		case 'request-wormhole':
			return '⇢';
		case 'schema-observatory':
			return '⌾';
	}
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
	const gatewayRef = useRef<HTMLElement | null>(null);
	const navigationTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const persona = gatewayPersona(symbol);

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

	const trackPointer = useCallback((event: PointerEvent<HTMLElement>) => {
		const gateway = gatewayRef.current;
		if (!gateway) {
			return;
		}
		const bounds = gateway.getBoundingClientRect();
		const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
		const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
		gateway.style.setProperty('--gateway-x', `${(x * 100).toFixed(2)}%`);
		gateway.style.setProperty('--gateway-y', `${(y * 100).toFixed(2)}%`);
		gateway.style.setProperty('--gateway-rotate-x', `${((0.5 - y) * 3).toFixed(2)}deg`);
		gateway.style.setProperty('--gateway-rotate-y', `${((x - 0.5) * 4).toFixed(2)}deg`);
	}, []);

	const resetPointer = useCallback(() => {
		const gateway = gatewayRef.current;
		if (!gateway) {
			return;
		}
		gateway.style.setProperty('--gateway-x', '50%');
		gateway.style.setProperty('--gateway-y', '50%');
		gateway.style.setProperty('--gateway-rotate-x', '0deg');
		gateway.style.setProperty('--gateway-rotate-y', '0deg');
	}, []);

	return (
		<>
			<section
				ref={gatewayRef}
				className={`${styles.gateway}${launching ? ` ${styles.gatewayLaunching}` : ''}`}
				data-symbol={symbol}
				aria-label={`${toolName} launch gateway`}
				aria-busy={launching}
				onPointerMove={trackPointer}
				onPointerLeave={resetPointer}
			>
				<div
					className={styles.starField}
					aria-hidden="true"
				/>
				<div
					className={styles.ambientBloom}
					aria-hidden="true"
				>
					<span />
					<span />
					<span />
				</div>
				<div className={styles.visual}>
					<div
						className={styles.scanBeam}
						aria-hidden="true"
					/>
					<div className={styles.symbolStage}>
						<div
							className={styles.orbitalShell}
							aria-hidden="true"
						/>
						<GatewaySymbol
							symbol={symbol}
							active={launching}
						/>
						<div
							className={styles.liveSignal}
							aria-hidden="true"
						>
							<span />
							LIVE SIGNAL
						</div>
					</div>
					<div
						className={styles.coordinates}
						aria-hidden="true"
					>
						<span>GENERATED SURFACE</span>
						<span>SIGNAL LOCKED</span>
					</div>
				</div>
				<div className={styles.copy}>
					<div
						className={styles.personaRail}
						aria-hidden="true"
					>
						<span>
							<i />
							LIVING INTERFACE
						</span>
						<span>{persona.mode}</span>
					</div>
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
							{gatewayGlyph(symbol)}
						</span>
						<span>{launching ? persona.awakening : launchLabel}</span>
						<span
							className={styles.buttonVector}
							aria-hidden="true"
						>
							→
						</span>
					</button>
					<span
						className={styles.srOnly}
						role="status"
						aria-live="polite"
					>
						{launching ? `${persona.awakening}. Preparing navigation.` : ''}
					</span>
				</div>
			</section>
			{launching &&
				typeof document !== 'undefined' &&
				createPortal(
					<div
						className={`${styles.transitionVeil} ${styles.transitionActive}`}
						data-symbol={symbol}
						aria-hidden="true"
					>
						<div className={styles.transitionCosmos} />
						<div className={styles.transitionGeometry} />
						<div className={styles.transitionIris} />
						<div className={styles.transitionCore}>
							<span className={styles.transitionGlyph}>{gatewayGlyph(symbol)}</span>
							<span className={styles.transitionKicker}>LIVE SYSTEM AWAKENING</span>
							<strong>{persona.awakening}</strong>
							<div className={styles.transitionPhases}>
								{persona.phases.map((phase) => (
									<span key={phase}>{phase}</span>
								))}
							</div>
						</div>
						<div className={styles.transitionVitals}>
							<span />
							<span />
							<span />
							<span />
							<span />
							<em>LIVE LINK</em>
						</div>
						<div className={styles.transitionBlackout} />
					</div>,
					document.body,
				)}
		</>
	);
}
