/* ============================================================================
 * NEXT-GEN-UI · ArchitectureReactor (signature interactive centerpiece)
 * ----------------------------------------------------------------------------
 * The platform's hexagonal architecture rendered as a live orbital reactor:
 * a Domain core, six boundary nodes on a hexagon, connectors, and animated data
 * pulses. Embedded on the homepage and /architecture/system-overview. See
 * docs/frontend/portal-experience-layer.md; grep `NEXT-GEN-UI`.
 *
 * Educational notes:
 * - GEOMETRY: node positions are computed once from angle+radius (deterministic,
 *   so SSR and client markup match). RING_PATH is the hexagon through the nodes.
 * - PULSES: SVG SMIL <animateMotion> drives the dots along paths — no JS rAF and
 *   no library. They are gated behind the `animate` state which is enabled in an
 *   effect ONLY when prefers-reduced-motion is off; server + first client render
 *   both start with animate=false, so there is no hydration mismatch.
 * - A11Y: nodes are role="button" + tabIndex (Enter/Space select) and the chip
 *   row mirrors them as real <button>s, so it is fully keyboard-navigable.
 * ========================================================================= */

import React, { useEffect, useMemo, useState } from 'react';
import Link from '@docusaurus/Link';

import styles from './styles.module.css';

type Boundary = {
	id: string;
	label: string;
	sub: string;
	angle: number;
	doc: string;
	detail: string;
};

const CENTER = { x: 220, y: 220 };
const RADIUS = 152;

const CORE = {
	id: 'domain',
	label: 'Domain core',
	sub: 'Pure rules + ports',
	doc: '/backend/core-domain-and-ports',
	detail: 'The core domain holds entities, pricing and port interfaces and imports nothing external at runtime — contract shapes may be referenced via type-only imports (owner lock resolved 2026-07-25). Imports point inward; runtime calls flow outward only through a port supplied at composition.',
};

const BOUNDARIES: Boundary[] = [
	{
		id: 'client',
		label: 'Client',
		sub: 'Storefront · Admin',
		angle: -90,
		doc: '/architecture/system-overview',
		detail: 'Angular storefront (SSR) and admin (SPA) speak to the platform over HTTP only, loading a public config.json at boot and sending session cookies with withCredentials. They never import a server adapter.',
	},
	{
		id: 'transport',
		label: 'Transport',
		sub: 'Fastify + NestJS',
		angle: -30,
		doc: '/backend/request-lifecycle',
		detail: 'NestJS on Fastify terminates HTTP: Helmet, credentialed CORS, one global rate limit, zod validation and OpenAPI. TRUST_PROXY / CLIENT_IP_HEADER are parsed in config but not yet applied to Fastify.',
	},
	{
		id: 'application',
		label: 'Application',
		sub: 'Use cases',
		angle: 30,
		doc: '/backend/composition-and-adapters',
		detail: 'Controllers coordinate HTTP; application services own the workflow. They ask for capabilities through ports and never reach for a vendor SDK — a controller does not own business truth.',
	},
	{
		id: 'port',
		label: 'Ports',
		sub: 'Capability seams',
		angle: 90,
		doc: '/backend/core-domain-and-ports',
		detail: 'Repository and provider ports name capabilities in domain language — ProductRepository, AuthPort, SearchPort, PaymentGatewayPort. NotificationPort and a unit-of-work port are still planned.',
	},
	{
		id: 'adapter',
		label: 'Adapters',
		sub: 'Mongo · MSG91 · Meili · Spaces',
		angle: 150,
		doc: '/backend/composition-and-adapters',
		detail: 'Adapters translate a port into a concrete provider. The Mongo adapter is bound today; MSG91 notifications, Meilisearch, Spaces and the payment gateways are configured or planned — not yet wired.',
	},
	{
		id: 'external',
		label: 'Infrastructure',
		sub: 'MongoDB rs0 · providers',
		angle: -150,
		doc: '/database/current-adapter-map',
		detail: 'Self-hosted Docker MongoDB 8.3 single-node replica set (rs0) is the source of truth — the same profile locally (pnpm mongo:up) and in production. Meilisearch and external providers sit behind their adapters.',
	},
];

function placed(boundary: Boundary) {
	const rad = (boundary.angle * Math.PI) / 180;
	return {
		...boundary,
		x: CENTER.x + RADIUS * Math.cos(rad),
		y: CENTER.y + RADIUS * Math.sin(rad),
	};
}

const NODES = BOUNDARIES.map(placed);
const RING_PATH = `M ${NODES.map((node) => `${node.x.toFixed(1)},${node.y.toFixed(1)}`).join(' L ')} Z`;

export function ArchitectureReactor(): React.ReactNode {
	const [selectedId, setSelectedId] = useState<string>('domain');
	const [animate, setAnimate] = useState(false);

	useEffect(() => {
		// Enable SMIL pulses only after mount and only when motion is welcome.
		const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (!reduce) setAnimate(true);
	}, []);

	const selected = useMemo(() => {
		if (selectedId === CORE.id) return CORE;
		return BOUNDARIES.find((boundary) => boundary.id === selectedId) ?? CORE;
	}, [selectedId]);

	return (
		<section
			className={styles.reactor}
			aria-label="Hexagonal architecture reactor"
		>
			<div className={styles.reactorHead}>
				<p className={styles.eyebrow}>Live architecture</p>
				<h2>The platform as one hexagon.</h2>
				<p className={styles.lede}>
					Every request flows inward through a boundary to the domain core, then back out only through a port.
					Hover, tap or arrow through a node to inspect what exists today.
				</p>
			</div>

			<div className={styles.reactorBody}>
				<div
					className={styles.stage}
					data-animate={animate ? 'on' : 'off'}
				>
					<svg
						viewBox="0 0 440 440"
						className={styles.svg}
						role="presentation"
					>
						<defs>
							<radialGradient
								id="reactorCoreGlow"
								cx="50%"
								cy="50%"
								r="50%"
							>
								<stop
									offset="0%"
									stopColor="var(--portal-accent)"
									stopOpacity="0.35"
								/>
								<stop
									offset="100%"
									stopColor="var(--portal-accent)"
									stopOpacity="0"
								/>
							</radialGradient>
						</defs>

						<circle
							className={styles.coreGlow}
							cx={CENTER.x}
							cy={CENTER.y}
							r="150"
							fill="url(#reactorCoreGlow)"
						/>

						{/* Rotating reactor rings */}
						<circle
							className={styles.spinRing}
							cx={CENTER.x}
							cy={CENTER.y}
							r="118"
							fill="none"
							strokeDasharray="2 12"
						/>
						<circle
							className={styles.spinRingReverse}
							cx={CENTER.x}
							cy={CENTER.y}
							r="176"
							fill="none"
							strokeDasharray="1 22"
						/>

						{/* Spokes: dependencies point inward to the core */}
						{NODES.map((node) => (
							<line
								key={`spoke-${node.id}`}
								className={selectedId === node.id ? styles.spokeActive : styles.spoke}
								x1={node.x}
								y1={node.y}
								x2={CENTER.x}
								y2={CENTER.y}
							/>
						))}

						{/* Request-flow ring */}
						<path
							className={styles.ring}
							d={RING_PATH}
							fill="none"
						/>

						{/* Animated pulses (client-only, motion-safe) */}
						{animate && (
							<>
								{[0, 1, 2].map((index) => (
									<circle
										key={`ring-pulse-${index}`}
										r="3.7"
										className={styles.ringPulse}
									>
										<animateMotion
											dur="5.2s"
											begin={`${-index * 1.73}s`}
											repeatCount="indefinite"
											rotate="auto"
											path={RING_PATH}
										/>
									</circle>
								))}
								{NODES.map((node, index) => (
									<circle
										key={`spoke-pulse-${node.id}`}
										r="3"
										className={styles.spokePulse}
									>
										<animateMotion
											dur="2.2s"
											begin={`${-index * 0.36}s`}
											repeatCount="indefinite"
											path={`M ${node.x.toFixed(1)},${node.y.toFixed(1)} L ${CENTER.x},${CENTER.y}`}
										/>
									</circle>
								))}
							</>
						)}

						{/* Core */}
						<g
							className={selectedId === CORE.id ? styles.coreActive : styles.core}
							role="button"
							tabIndex={0}
							aria-label={`${CORE.label}: ${CORE.sub}`}
							aria-pressed={selectedId === CORE.id}
							onMouseEnter={() => setSelectedId(CORE.id)}
							onFocus={() => setSelectedId(CORE.id)}
							onClick={() => setSelectedId(CORE.id)}
							onKeyDown={(event) => {
								if (event.key === 'Enter' || event.key === ' ') {
									event.preventDefault();
									setSelectedId(CORE.id);
								}
							}}
						>
							<circle
								cx={CENTER.x}
								cy={CENTER.y}
								r="46"
								className={styles.coreDisc}
							/>
							<text
								x={CENTER.x}
								y={CENTER.y - 3}
								className={styles.coreLabel}
							>
								Domain
							</text>
							<text
								x={CENTER.x}
								y={CENTER.y + 12}
								className={styles.coreSub}
							>
								core
							</text>
						</g>

						{/* Boundary nodes */}
						{NODES.map((node) => (
							<g
								key={node.id}
								className={selectedId === node.id ? styles.nodeActive : styles.node}
								role="button"
								tabIndex={0}
								aria-label={`${node.label}: ${node.sub}`}
								aria-pressed={selectedId === node.id}
								onMouseEnter={() => setSelectedId(node.id)}
								onFocus={() => setSelectedId(node.id)}
								onClick={() => setSelectedId(node.id)}
								onKeyDown={(event) => {
									if (event.key === 'Enter' || event.key === ' ') {
										event.preventDefault();
										setSelectedId(node.id);
									}
								}}
							>
								<circle
									cx={node.x}
									cy={node.y}
									r="33"
									className={styles.nodeDisc}
								/>
								<text
									x={node.x}
									y={node.y + 4}
									className={styles.nodeLabel}
								>
									{node.label}
								</text>
							</g>
						))}
					</svg>
				</div>

				<aside
					className={styles.panel}
					aria-live="polite"
				>
					<div className={styles.panelChips}>
						{[CORE, ...BOUNDARIES].map((boundary) => (
							<button
								key={boundary.id}
								type="button"
								className={selectedId === boundary.id ? styles.chipActive : styles.chip}
								aria-pressed={selectedId === boundary.id}
								onMouseEnter={() => setSelectedId(boundary.id)}
								onClick={() => setSelectedId(boundary.id)}
							>
								{boundary.label}
							</button>
						))}
					</div>

					<div className={styles.panelCard}>
						<span className={styles.panelKicker}>Boundary</span>
						<h3 className={styles.panelTitle}>{selected.label}</h3>
						<p className={styles.panelSub}>{selected.sub}</p>
						<p className={styles.panelDetail}>{selected.detail}</p>
						<Link
							className={styles.panelLink}
							to={selected.doc}
						>
							Open the reference
							<span aria-hidden="true"> →</span>
						</Link>
					</div>
				</aside>
			</div>
		</section>
	);
}
