/**
 * NEXT-GEN-UI · Child tool gateways
 * ----------------------------------------------------------------------------
 * WHAT: four independent symbolic bridge scenes and cinematic handoffs.
 * WHY: each generated child has its own visual identity; only navigation,
 * prefetch, accessibility, and recovery are shared.
 * HOW: tool-specific React scenes own their SVG vocabulary and six-second
 * transition story. Reduced-motion users bypass the cinematic delay.
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

type GatewayPersona = {
	mode: string;
	awakening: string;
	phases: [string, string, string, string];
};

const LAUNCH_DURATION_MS = 6000;

function gatewayPersona(symbol: ChildToolSymbol): GatewayPersona {
	switch (symbol) {
		case 'component-forge':
			return {
				mode: 'ZERO-G FABRICATION',
				awakening: 'Component Forge online',
				phases: [
					'Igniting fabrication rails',
					'Capturing interface primitives',
					'Infusing the shared theme core',
					'Deploying the component explorer',
				],
			};
		case 'type-lattice':
			return {
				mode: 'CONTRACT INTELLIGENCE',
				awakening: 'Type Lattice resolving',
				phases: [
					'Activating exported source',
					'Resolving type constraints',
					'Crystallising contract knowledge',
					'Unfolding the reference plane',
				],
			};
		case 'request-wormhole':
			return {
				mode: 'GOVERNED REQUEST CHANNEL',
				awakening: 'Request Wormhole opening',
				phases: [
					'Assembling the operation packet',
					'Clearing security gates',
					'Crossing the contract horizon',
					'Deploying the flight console',
				],
			};
		case 'schema-observatory':
			return {
				mode: 'PERSISTENCE TELEMETRY',
				awakening: 'Schema Observatory awake',
				phases: [
					'Opening the observatory',
					'Acquiring model signals',
					'Resolving schema evidence',
					'Projecting the source catalogue',
				],
			};
	}
}

function resolveChildEntry(target: string): string {
	return `${target.replace(/\/+$/u, '')}/index.html`;
}

function SceneTelemetry({ left, right }: { left: string; right: string }) {
	return (
		<div
			className={styles.sceneTelemetry}
			aria-hidden="true"
		>
			<span>{left}</span>
			<span>
				<i />
				{right}
			</span>
		</div>
	);
}

function ComponentForgeScene() {
	const primitives = [
		{ className: styles.forgeButton, label: 'BUTTON', path: 'M24 25h64', kind: 'button' },
		{ className: styles.forgeInput, label: 'INPUT', path: 'M18 24h78', kind: 'input' },
		{ className: styles.forgeCard, label: 'CARD', path: 'M18 19h80M18 36h50M18 53h66', kind: 'card' },
		{ className: styles.forgeNav, label: 'NAV', path: 'M17 22h20M48 22h20M79 22h20', kind: 'nav' },
		{ className: styles.forgeModal, label: 'MODAL', path: 'M20 18h76M20 34h54M20 50h32', kind: 'modal' },
	];

	return (
		<div
			className={`${styles.scene} ${styles.forgeScene}`}
			data-gateway-scene="true"
		>
			<div
				className={styles.forgeRail}
				aria-hidden="true"
			>
				<span />
				<span />
				<span />
			</div>
			<div className={styles.forgeCore}>
				<div className={styles.forgeCorePulse} />
				<div className={styles.forgeChassis}>
					<span className={styles.chassisSocket} />
					<span className={styles.chassisSocket} />
					<span className={styles.chassisSocket} />
					<span className={styles.chassisSocket} />
					<strong>
						THEME
						<br />
						CORE
					</strong>
					<small>UNIFIED TOKENS</small>
				</div>
				<div className={styles.forgeContext}>
					<span>STOREFRONT</span>
					<span>ADMIN</span>
					<span>SHARED</span>
				</div>
			</div>
			{primitives.map((primitive) => (
				<div
					className={`${styles.forgePrimitive} ${primitive.className}`}
					data-kind={primitive.kind}
					key={primitive.label}
				>
					<svg
						viewBox="0 0 116 70"
						aria-hidden="true"
					>
						<rect
							x="3"
							y="3"
							width="110"
							height="64"
							rx="10"
						/>
						<path d={primitive.path} />
					</svg>
					<span>{primitive.label}</span>
				</div>
			))}
			<div className={styles.forgeTokenStreams}>
				<span>COLOR</span>
				<span>TYPE</span>
				<span>SPACE</span>
				<span>DEPTH</span>
			</div>
			<SceneTelemetry
				left="INTERFACE ATOMS · 05"
				right="MAGNETIC FIELD LIVE"
			/>
		</div>
	);
}

function TypeLatticeScene() {
	const nodes = [
		{ x: 62, y: 68, label: 'interface' },
		{ x: 184, y: 44, label: 'schema' },
		{ x: 300, y: 96, label: 'port' },
		{ x: 104, y: 190, label: 'params' },
		{ x: 246, y: 220, label: 'return' },
		{ x: 352, y: 172, label: 'type' },
	];

	return (
		<div
			className={`${styles.scene} ${styles.latticeScene}`}
			data-gateway-scene="true"
		>
			<div
				className={styles.sourceColumn}
				aria-hidden="true"
			>
				<span>export interface</span>
				<strong>{'{ ProductContract }'}</strong>
				<span>extends Entity</span>
				<span>price: Money</span>
				<span>status: ProductStatus</span>
				<span>resolve(): Promise&lt;Result&gt;</span>
			</div>
			<svg
				className={styles.latticeMap}
				viewBox="0 0 420 270"
				role="img"
				aria-label="Source contracts resolving through a type graph into a crystalline TypeScript prism"
			>
				<defs>
					<linearGradient
						id="bridge-prism-a"
						x1="0"
						y1="0"
						x2="1"
						y2="1"
					>
						<stop
							offset="0"
							stopColor="var(--portal-accent)"
							stopOpacity=".72"
						/>
						<stop
							offset=".55"
							stopColor="var(--portal-success)"
							stopOpacity=".42"
						/>
						<stop
							offset="1"
							stopColor="var(--portal-warning)"
							stopOpacity=".2"
						/>
					</linearGradient>
				</defs>
				<g className={styles.latticeEdges}>
					<path d="M62 68 184 44 300 96 352 172 246 220 104 190 62 68M184 44l62 176M300 96 104 190" />
					<path d="M62 68 210 135 352 172M104 190l106-55 90-39" />
				</g>
				<g className={styles.latticeNodes}>
					{nodes.map((node) => (
						<g
							key={node.label}
							transform={`translate(${node.x} ${node.y})`}
						>
							<circle r="7" />
							<circle
								className={styles.nodeEcho}
								r="15"
							/>
							<text
								x="0"
								y="-14"
								textAnchor="middle"
							>
								{node.label}
							</text>
						</g>
					))}
				</g>
				<g className={styles.latticePrism}>
					<path
						d="m210 80 76 44v82l-76 44-76-44v-82Z"
						fill="url(#bridge-prism-a)"
					/>
					<path d="m210 80 76 44-76 44-76-44 76-44v170m-76-126v82l76 44 76-44v-82" />
					<text
						x="210"
						y="178"
						textAnchor="middle"
					>
						TS
					</text>
				</g>
			</svg>
			<div
				className={styles.constraintLens}
				aria-hidden="true"
			>
				<span>TYPE RESOLUTION</span>
			</div>
			<div className={styles.latticeCategories}>
				<span>INTERFACES</span>
				<span>SIGNATURES</span>
				<span>PORTS</span>
				<span>SCHEMAS</span>
			</div>
			<SceneTelemetry
				left="EXPORT GRAPH · RESOLVED"
				right="CONTRACT PRISM STABLE"
			/>
		</div>
	);
}

function RequestWormholeScene() {
	return (
		<div
			className={`${styles.scene} ${styles.wormholeScene}`}
			data-gateway-scene="true"
		>
			<div className={styles.requestOrigin}>
				<span>OPERATION PACKET</span>
				<strong>POST</strong>
				<code>/orders</code>
				<small>JSON · APPLICATION CONTRACT</small>
			</div>
			<div
				className={styles.securityGates}
				aria-label="Request security controls"
			>
				<span>VALIDATE</span>
				<span>AUTH</span>
				<span>CSRF</span>
				<span>RBAC</span>
				<span>RATE</span>
			</div>
			<div
				className={styles.eventHorizon}
				aria-hidden="true"
			>
				<div className={styles.horizonMembrane} />
				<div className={styles.horizonCore}>
					<strong>OPENAPI</strong>
					<span>CONTRACT HORIZON</span>
				</div>
			</div>
			<div className={styles.responseDestination}>
				<span>RESPONSE SIGNAL</span>
				<strong>201</strong>
				<code>Created</code>
				<small>GOVERNED · TRACEABLE</small>
			</div>
			<div
				className={styles.operationTrace}
				aria-hidden="true"
			>
				<i />
			</div>
			<SceneTelemetry
				left="TEST REQUEST · ARMED"
				right="SECURITY CONTROLS ONLINE"
			/>
		</div>
	);
}

function SchemaObservatoryScene() {
	const stars = [
		{ x: 166, y: 65 },
		{ x: 244, y: 38 },
		{ x: 326, y: 76 },
		{ x: 350, y: 154 },
		{ x: 280, y: 218 },
		{ x: 190, y: 208 },
		{ x: 132, y: 138 },
	];

	return (
		<div
			className={`${styles.scene} ${styles.observatoryScene}`}
			data-gateway-scene="true"
		>
			<div
				className={styles.observatoryDome}
				aria-hidden="true"
			>
				<div className={styles.domeShutter} />
				<div className={styles.telescopeBody}>
					<span className={styles.telescopeLens} />
					<i className={styles.telescopeSight} />
				</div>
				<div className={styles.telescopeMount}>
					<span />
					<i />
					<i />
					<i />
				</div>
			</div>
			<svg
				className={styles.modelSky}
				viewBox="0 0 440 260"
				role="img"
				aria-label="A telescope resolving seven current MongoDB model constellations"
			>
				<g className={styles.skyConnections}>
					<path d="M166 65 244 38 326 76 350 154 280 218 190 208 132 138 166 65M132 138l218 16M166 65l114 153" />
				</g>
				<g className={styles.skyStars}>
					{stars.map((star, index) => (
						<g
							key={`${star.x}-${star.y}`}
							transform={`translate(${star.x} ${star.y})`}
						>
							<circle
								className={styles.starHalo}
								r="16"
							/>
							<circle r="6" />
							<text
								y="3"
								textAnchor="middle"
							>
								{index + 1}
							</text>
						</g>
					))}
				</g>
			</svg>
			<div
				className={styles.observatoryLens}
				aria-hidden="true"
			>
				<div>
					<span>MODEL 04</span>
					<strong>FIELDS · 17</strong>
					<small>INDEXES · 03</small>
				</div>
			</div>
			<div className={styles.evidenceConsole}>
				<span>SOURCE EVIDENCE</span>
				<i />
				<i />
				<i />
				<strong>7 CURRENT MODELS</strong>
			</div>
			<SceneTelemetry
				left="OPTICAL ARRAY · TRACKING"
				right="NO DATABASE CONNECTION"
			/>
		</div>
	);
}

function GatewayScene({ symbol }: { symbol: ChildToolSymbol }) {
	switch (symbol) {
		case 'component-forge':
			return <ComponentForgeScene />;
		case 'type-lattice':
			return <TypeLatticeScene />;
		case 'request-wormhole':
			return <RequestWormholeScene />;
		case 'schema-observatory':
			return <SchemaObservatoryScene />;
	}
}

function TransitionHeader({ persona }: { persona: GatewayPersona }) {
	return (
		<div className={styles.transitionHeader}>
			<span>
				<i />
				LIVE SYSTEM
			</span>
			<strong>{persona.awakening}</strong>
		</div>
	);
}

function TransitionPhases({ phases }: { phases: GatewayPersona['phases'] }) {
	return (
		<div className={styles.transitionPhases}>
			{phases.map((phase, index) => (
				<span key={phase}>
					<small>0{index + 1}</small>
					{phase}
				</span>
			))}
		</div>
	);
}

function ComponentForgeTransition({ persona }: { persona: GatewayPersona }) {
	const modules = ['BUTTON', 'INPUT', 'CARD', 'NAV', 'MODAL', 'TYPE'];
	return (
		<div className={`${styles.transition} ${styles.forgeTransition}`}>
			<TransitionHeader persona={persona} />
			<div className={styles.forgeTransitionBay}>
				<div className={styles.forgePressTop}>
					<span />
					<span />
					<span />
				</div>
				<div className={styles.forgePressBottom}>
					<span />
					<span />
					<span />
				</div>
				<div className={styles.forgeAssembly}>
					{modules.map((module, index) => (
						<div
							className={styles.forgeModule}
							data-index={index + 1}
							key={module}
						>
							<span>{module}</span>
						</div>
					))}
					<div className={styles.assembledBlock}>
						<div />
						<div />
						<div />
						<strong>UI</strong>
					</div>
				</div>
				<div className={styles.tokenInfusion}>
					<span>COLOR</span>
					<span>TYPE</span>
					<span>SPACE</span>
					<span>DEPTH</span>
				</div>
				<div className={styles.storybookBlueprint}>
					<div className={styles.blueprintNav}>
						<i />
						<i />
						<i />
						<i />
					</div>
					<div className={styles.blueprintCanvas}>
						<i />
						<i />
						<i />
					</div>
					<div className={styles.blueprintControls} />
				</div>
			</div>
			<TransitionPhases phases={persona.phases} />
			<div className={styles.forgeHandoff} />
		</div>
	);
}

function TypeLatticeTransition({ persona }: { persona: GatewayPersona }) {
	const glyphs = ['interface', 'type', 'schema', 'port', 'params', 'return'];
	return (
		<div className={`${styles.transition} ${styles.latticeTransition}`}>
			<TransitionHeader persona={persona} />
			<div className={styles.latticeTransitionField}>
				<div className={styles.exportGlyphs}>
					{glyphs.map((glyph, index) => (
						<span
							data-index={index + 1}
							key={glyph}
						>
							{glyph}
						</span>
					))}
				</div>
				<svg
					className={styles.constraintGraph}
					viewBox="0 0 1000 620"
					aria-hidden="true"
				>
					<path d="M80 100 300 190 495 78 708 184 920 112M80 510l220-320 198 342 210-348 212 326M80 100l418 432M920 112 300 190M80 510l628-326M920 510 495 78" />
				</svg>
				<div className={styles.crystalPrism}>
					<div className={styles.crystalFaceOne} />
					<div className={styles.crystalFaceTwo} />
					<div className={styles.crystalFaceThree} />
					<strong>TS</strong>
				</div>
				<div className={styles.prismRefractions}>
					<span>INTERFACES</span>
					<span>SIGNATURES</span>
					<span>PORTS</span>
					<span>SCHEMAS</span>
				</div>
				<div className={styles.referencePlane}>
					<div className={styles.referenceTree}>
						<i />
						<i />
						<i />
						<i />
					</div>
					<div className={styles.referenceContent}>
						<i />
						<i />
						<i />
						<i />
						<i />
					</div>
					<div className={styles.referenceIndex}>
						<i />
						<i />
						<i />
					</div>
				</div>
			</div>
			<TransitionPhases phases={persona.phases} />
			<div className={styles.latticeHandoff} />
		</div>
	);
}

function RequestWormholeTransition({ persona }: { persona: GatewayPersona }) {
	return (
		<div className={`${styles.transition} ${styles.wormholeTransition}`}>
			<TransitionHeader persona={persona} />
			<div className={styles.wormholeTransitionField}>
				<div className={styles.operationPacket}>
					<span>OPERATION PACKET</span>
					<strong>POST</strong>
					<code>/orders</code>
					<i>JSON BODY</i>
				</div>
				<div
					className={styles.operationPhoton}
					aria-hidden="true"
				>
					<strong>POST</strong>
					<span>/orders</span>
				</div>
				<div className={styles.clearanceTrack}>
					{['VALIDATE', 'AUTH', 'CSRF', 'RBAC', 'RATE'].map((gate, index) => (
						<span
							data-index={index + 1}
							key={gate}
						>
							<i />
							{gate}
						</span>
					))}
				</div>
				<div className={styles.contractMembrane}>
					<div className={styles.membraneGrid} />
					<div className={styles.accretionDisk} />
					<div className={styles.lensingArc} />
					<div className={styles.membraneEdge} />
					<div className={styles.membraneCore}>
						<strong>OPENAPI</strong>
						<span>EVENT HORIZON</span>
					</div>
				</div>
				<div className={styles.responseSignal}>
					<span>RESPONSE</span>
					<strong>201</strong>
					<code>Created</code>
					<i>TRACE COMPLETE</i>
				</div>
				<div className={styles.requestBeam} />
				<div className={styles.flightConsole}>
					<div className={styles.flightOperation}>
						<strong>OPERATIONS</strong>
						<span>Orders</span>
						<b>POST /orders</b>
						<span>GET /orders/:id</span>
					</div>
					<div className={styles.flightRequest}>
						<strong>TEST REQUEST</strong>
						<span>POST /orders</span>
						<code>{'{ "items": […], "currency": "INR" }'}</code>
						<small>AUTH · CSRF · RBAC VERIFIED</small>
						<b>SEND REQUEST →</b>
					</div>
					<div className={styles.flightResponse}>
						<strong>RESPONSE</strong>
						<b>201 CREATED</b>
						<span>128 ms</span>
						<code>{'{ "orderId": "…", "status": "created" }'}</code>
					</div>
				</div>
			</div>
			<TransitionPhases phases={persona.phases} />
			<div className={styles.wormholeHandoff} />
		</div>
	);
}

function SchemaObservatoryTransition({ persona }: { persona: GatewayPersona }) {
	const stars = [1, 2, 3, 4, 5, 6, 7];
	return (
		<div className={`${styles.transition} ${styles.observatoryTransition}`}>
			<TransitionHeader persona={persona} />
			<div className={styles.observatoryTransitionField}>
				<div className={styles.transitionDome}>
					<div className={styles.transitionShutterLeft} />
					<div className={styles.transitionShutterRight} />
					<div className={styles.transitionTelescope}>
						<span />
						<i className={styles.focusBeam}>
							<b />
						</i>
					</div>
					<div className={styles.transitionTelescopeStand} />
				</div>
				<div className={styles.transitionModelSky}>
					<svg
						viewBox="0 0 600 420"
						aria-hidden="true"
					>
						<path d="M122 104 286 58 474 120 502 278 320 360 154 314 82 214 122 104M82 214l420 64M122 104l198 256" />
					</svg>
					{stars.map((star) => (
						<span
							data-star={star}
							key={star}
						>
							{star}
						</span>
					))}
				</div>
				<div className={styles.schemaResolution}>
					<span>MODEL 04 · RESOLVED</span>
					<strong>orders</strong>
					<div>
						<i>FIELD</i>
						<i>TYPE</i>
						<i>POLICY</i>
						<i>INDEX</i>
					</div>
				</div>
				<div className={styles.catalogueProjection}>
					<div className={styles.catalogueNav}>
						{stars.map((star) => (
							<i key={star} />
						))}
					</div>
					<div className={styles.catalogueModel}>
						<i />
						<i />
						<i />
						<i />
						<i />
					</div>
					<div className={styles.catalogueEvidence}>
						<i />
						<i />
						<i />
					</div>
				</div>
			</div>
			<TransitionPhases phases={persona.phases} />
			<div className={styles.observatoryHandoff} />
		</div>
	);
}

function GatewayTransition({ symbol, persona }: { symbol: ChildToolSymbol; persona: GatewayPersona }) {
	switch (symbol) {
		case 'component-forge':
			return <ComponentForgeTransition persona={persona} />;
		case 'type-lattice':
			return <TypeLatticeTransition persona={persona} />;
		case 'request-wormhole':
			return <RequestWormholeTransition persona={persona} />;
		case 'schema-observatory':
			return <SchemaObservatoryTransition persona={persona} />;
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
	const childEntry = resolveChildEntry(target);

	useEffect(() => {
		const preloadLink = document.createElement('link');
		preloadLink.rel = 'prefetch';
		preloadLink.href = childEntry;
		document.head.appendChild(preloadLink);

		return () => {
			preloadLink.remove();
			if (navigationTimer.current) {
				clearTimeout(navigationTimer.current);
			}
		};
	}, [childEntry]);

	const navigate = useCallback(() => {
		window.location.assign(childEntry);
	}, [childEntry]);

	const launch = useCallback(() => {
		if (launching || typeof window === 'undefined') {
			return;
		}
		const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		setLaunching(true);
		navigationTimer.current = setTimeout(navigate, reduceMotion ? 0 : LAUNCH_DURATION_MS);
	}, [launching, navigate]);

	const skip = useCallback(() => {
		if (navigationTimer.current) {
			clearTimeout(navigationTimer.current);
		}
		navigate();
	}, [navigate]);

	const trackPointer = useCallback((event: PointerEvent<HTMLElement>) => {
		const gateway = gatewayRef.current;
		if (!gateway) {
			return;
		}
		const gatewayBounds = gateway.getBoundingClientRect();
		const gatewayX = Math.max(0, Math.min(1, (event.clientX - gatewayBounds.left) / gatewayBounds.width));
		const gatewayY = Math.max(0, Math.min(1, (event.clientY - gatewayBounds.top) / gatewayBounds.height));
		gateway.style.setProperty('--pointer-x', `${(gatewayX * 100).toFixed(2)}%`);
		gateway.style.setProperty('--pointer-y', `${(gatewayY * 100).toFixed(2)}%`);

		const scene = gateway.querySelector<HTMLElement>('[data-gateway-scene="true"]');
		if (!scene) {
			return;
		}
		const bounds = scene.getBoundingClientRect();
		const insideScene =
			event.clientX >= bounds.left &&
			event.clientX <= bounds.right &&
			event.clientY >= bounds.top &&
			event.clientY <= bounds.bottom;
		if (!insideScene) {
			gateway.style.setProperty('--scene-cursor-opacity', '0');
			return;
		}
		const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
		const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
		gateway.style.setProperty('--scene-pointer-x', `${(x * 100).toFixed(2)}%`);
		gateway.style.setProperty('--scene-pointer-y', `${(y * 100).toFixed(2)}%`);
		gateway.style.setProperty('--scene-cursor-opacity', '1');
		gateway.style.setProperty('--scene-shift-x', `${((x - 0.5) * 18).toFixed(2)}px`);
		gateway.style.setProperty('--scene-shift-y', `${((y - 0.5) * 14).toFixed(2)}px`);
		gateway.style.setProperty('--scene-angle', `${((x - 0.5) * 10).toFixed(2)}deg`);
	}, []);

	const resetPointer = useCallback(() => {
		const gateway = gatewayRef.current;
		if (!gateway) {
			return;
		}
		gateway.style.setProperty('--pointer-x', '50%');
		gateway.style.setProperty('--pointer-y', '50%');
		gateway.style.setProperty('--scene-pointer-x', '50%');
		gateway.style.setProperty('--scene-pointer-y', '50%');
		gateway.style.setProperty('--scene-cursor-opacity', '0');
		gateway.style.setProperty('--scene-shift-x', '0px');
		gateway.style.setProperty('--scene-shift-y', '0px');
		gateway.style.setProperty('--scene-angle', '0deg');
	}, []);

	return (
		<>
			<section
				ref={gatewayRef}
				className={styles.gateway}
				data-symbol={symbol}
				aria-label={`${toolName} launch gateway`}
				aria-busy={launching}
				onPointerMove={trackPointer}
				onPointerLeave={resetPointer}
			>
				<div
					className={styles.gatewayStars}
					aria-hidden="true"
				/>
				<GatewayScene symbol={symbol} />
				<div className={styles.narrative}>
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
						className={styles.transitionPortal}
						data-symbol={symbol}
						role="dialog"
						aria-modal="true"
						aria-label={`${toolName} transition`}
					>
						<GatewayTransition
							symbol={symbol}
							persona={persona}
						/>
						<button
							className={styles.skipTransition}
							type="button"
							onClick={skip}
						>
							Skip transition
						</button>
					</div>,
					document.body,
				)}
		</>
	);
}
