/* ============================================================================
 * NEXT-GEN-UI · Schema Nebula
 * ----------------------------------------------------------------------------
 * WHAT: the governed 65-collection target architecture rendered as an
 * interactive, zoomable constellation: bounded-context gravity wells, governed
 * current-model and target-only states, and selected relationship lines.
 * WHY: a newcomer can see what exists, what is only intended, which roadmap
 * chunk owns it, and what evidence/decision still governs it without reading a
 * 65-row matrix first.
 * HOW: deterministic SVG geometry keeps SSR stable; React owns only view state
 * (selection, lenses, search, zoom). Every project fact comes from the compiled
 * portal-data plugin. Zoom centres on the selected node without moving the
 * underlying layout; the two-column body and reserved detail panel prevent
 * hover/reflow jumps.
 * TUNING: VIEWBOX_SIZE/CLUSTER_ORBIT/local ring radii control geometry. CSS
 * module tokens control glow, density and responsive behaviour. Relationship
 * dashes stop under prefers-reduced-motion.
 * ========================================================================= */

import React, { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import Link from '@docusaurus/Link';

import { useSchemaNebulaData, type Cluster, type Collection, type CollectionState } from '@site/src/data/schema-nebula';
import styles from './styles.module.css';

const VIEWBOX_SIZE = 760;
const CENTER = { x: VIEWBOX_SIZE / 2, y: VIEWBOX_SIZE / 2 };
const CLUSTER_ORBIT = 260;
const ZOOM_LEVELS = [1, 1.35, 1.75, 2.2] as const;

type StateLens = 'all' | CollectionState;

type PlacedCollection = Collection & {
	x: number;
	y: number;
};

type PlacedCluster = Cluster & {
	x: number;
	y: number;
	radius: number;
	collectionIds: string[];
};

type PlacedGraph = {
	clusters: PlacedCluster[];
	collections: PlacedCollection[];
};

type Relationship = {
	id: string;
	node: PlacedCollection;
	direction: 'outgoing' | 'incoming' | 'both';
};

const STATE_LABEL: Record<CollectionState, string> = {
	existing: 'Current model',
	planned: 'Target only',
};

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value));
}

function splitClusterLabel(label: string): [string, string?] {
	if (label.length <= 22) return [label];
	const words = label.split(/\s+/);
	let first = '';
	let second = '';
	for (const word of words) {
		if (!second && `${first} ${word}`.trim().length <= Math.ceil(label.length / 2) + 2) {
			first = `${first} ${word}`.trim();
		} else {
			second = `${second} ${word}`.trim();
		}
	}
	return [first, second || undefined];
}

function placeGraph(clusters: Cluster[], collections: Collection[]): PlacedGraph {
	const placedClusters: PlacedCluster[] = [];
	const placedCollections: PlacedCollection[] = [];

	clusters.forEach((cluster, clusterIndex) => {
		const clusterAngle = -90 + clusterIndex * (360 / clusters.length);
		const clusterRadians = (clusterAngle * Math.PI) / 180;
		const clusterCollections = collections.filter((collection) => collection.cluster === cluster.id);
		const clusterX = CENTER.x + CLUSTER_ORBIT * Math.cos(clusterRadians);
		const clusterY = CENTER.y + CLUSTER_ORBIT * Math.sin(clusterRadians);
		const radius = clusterCollections.length > 7 ? 76 : clusterCollections.length > 1 ? 52 : 27;

		placedClusters.push({
			...cluster,
			x: clusterX,
			y: clusterY,
			radius,
			collectionIds: clusterCollections.map((collection) => collection.id),
		});

		clusterCollections.forEach((collection, collectionIndex) => {
			if (collectionIndex === 0) {
				placedCollections.push({ ...collection, x: clusterX, y: clusterY });
				return;
			}

			const firstRingCount = Math.min(6, Math.max(0, clusterCollections.length - 1));
			const isFirstRing = collectionIndex <= firstRingCount;
			const ringStart = isFirstRing ? 1 : firstRingCount + 1;
			const ringIndex = collectionIndex - ringStart;
			const ringCount = isFirstRing ? firstRingCount : clusterCollections.length - firstRingCount - 1;
			const localRadius = isFirstRing ? 30 : 58;
			const localAngle = clusterAngle + (ringIndex * 360) / Math.max(1, ringCount);
			const localRadians = (localAngle * Math.PI) / 180;

			placedCollections.push({
				...collection,
				x: clusterX + localRadius * Math.cos(localRadians),
				y: clusterY + localRadius * Math.sin(localRadians),
			});
		});
	});

	return { clusters: placedClusters, collections: placedCollections };
}

function stateClass(collection: Collection): string {
	return collection.currentState === 'existing' ? styles.nodeExisting : styles.nodePlanned;
}

export function SchemaNebula(): React.ReactNode {
	const { inventory, clusters, collections } = useSchemaNebulaData();
	const graph = useMemo(() => placeGraph(clusters, collections), [clusters, collections]);
	const collectionById = useMemo(
		() => new Map(graph.collections.map((collection) => [collection.id, collection])),
		[graph.collections],
	);
	const clusterById = useMemo(
		() => new Map(graph.clusters.map((cluster) => [cluster.id, cluster])),
		[graph.clusters],
	);
	const defaultCollectionId = useMemo(
		() =>
			collectionById.has('products')
				? 'products'
				: (
						graph.collections.find((collection) => collection.currentState === 'existing') ??
						graph.collections[0]
					).id,
		[collectionById, graph.collections],
	);
	const [selectedId, setSelectedId] = useState(defaultCollectionId);
	const [cameraFocusId, setCameraFocusId] = useState(defaultCollectionId);
	const [clusterLens, setClusterLens] = useState('all');
	const [stateLens, setStateLens] = useState<StateLens>('all');
	const [query, setQuery] = useState('');
	const [zoomIndex, setZoomIndex] = useState(0);
	const rootRef = useRef<HTMLElement>(null);
	const gradientId = `schema-nebula-${useId().replace(/:/g, '')}`;

	const normalizedQuery = query.trim().toLocaleLowerCase('en');
	const visibleCollections = useMemo(
		() =>
			graph.collections.filter((collection) => {
				const cluster = clusterById.get(collection.cluster);
				const matchesCluster = clusterLens === 'all' || collection.cluster === clusterLens;
				const matchesState = stateLens === 'all' || collection.currentState === stateLens;
				const searchable = [
					collection.id,
					collection.label,
					collection.purpose,
					collection.source,
					cluster?.label ?? '',
					...collection.owningChunks,
					...collection.blockingDecisions,
				]
					.join(' ')
					.toLocaleLowerCase('en');
				return matchesCluster && matchesState && (!normalizedQuery || searchable.includes(normalizedQuery));
			}),
		[clusterById, clusterLens, graph.collections, normalizedQuery, stateLens],
	);
	const visibleIds = useMemo(
		() => new Set(visibleCollections.map((collection) => collection.id)),
		[visibleCollections],
	);

	useEffect(() => {
		if (visibleCollections.length > 0 && !visibleIds.has(selectedId)) {
			const nextId = visibleCollections[0].id;
			setSelectedId(nextId);
			setCameraFocusId(nextId);
		}
	}, [selectedId, visibleCollections, visibleIds]);

	const selected = collectionById.get(selectedId) ?? graph.collections[0];
	const selectedCluster = clusterById.get(selected.cluster) ?? graph.clusters[0];
	const cameraFocus = collectionById.get(cameraFocusId) ?? selected;
	const incomingCollections = useMemo(
		() => graph.collections.filter((collection) => collection.references.includes(selected.id)),
		[graph.collections, selected.id],
	);
	const relationships = useMemo(() => {
		const related = new Map<string, Relationship>();
		for (const reference of selected.references) {
			const node = collectionById.get(reference);
			if (node) related.set(reference, { id: reference, node, direction: 'outgoing' });
		}
		for (const collection of incomingCollections) {
			const existing = related.get(collection.id);
			related.set(collection.id, {
				id: collection.id,
				node: collection,
				direction: existing ? 'both' : 'incoming',
			});
		}
		return Array.from(related.values());
	}, [collectionById, incomingCollections, selected.references]);
	const relationshipIds = useMemo(
		() => new Set(relationships.map((relationship) => relationship.id)),
		[relationships],
	);

	const zoom = ZOOM_LEVELS[zoomIndex];
	const viewSize = VIEWBOX_SIZE / zoom;
	const viewX = zoom === 1 ? 0 : clamp(cameraFocus.x - viewSize / 2, 0, VIEWBOX_SIZE - viewSize);
	const viewY = zoom === 1 ? 0 : clamp(cameraFocus.y - viewSize / 2, 0, VIEWBOX_SIZE - viewSize);
	const viewBox = `${viewX.toFixed(2)} ${viewY.toFixed(2)} ${viewSize.toFixed(2)} ${viewSize.toFixed(2)}`;

	const focusNode = (collectionId: string): void => {
		requestAnimationFrame(() => {
			rootRef.current?.querySelector<SVGGElement>(`#schema-node-${collectionId}`)?.focus();
		});
	};

	const selectCollection = (collectionId: string, focus = false): void => {
		setSelectedId(collectionId);
		setCameraFocusId(collectionId);
		if (focus) focusNode(collectionId);
	};

	const moveSelection = (direction: 1 | -1): void => {
		if (visibleCollections.length === 0) return;
		const currentIndex = visibleCollections.findIndex((collection) => collection.id === selected.id);
		const nextIndex =
			currentIndex === -1
				? 0
				: (currentIndex + direction + visibleCollections.length) % visibleCollections.length;
		selectCollection(visibleCollections[nextIndex].id, true);
	};

	const handleNodeKeyDown = (event: KeyboardEvent<SVGGElement>, collectionId: string): void => {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			selectCollection(collectionId);
		} else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
			event.preventDefault();
			moveSelection(1);
		} else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
			event.preventDefault();
			moveSelection(-1);
		} else if (event.key === 'Home' && visibleCollections.length > 0) {
			event.preventDefault();
			selectCollection(visibleCollections[0].id, true);
		} else if (event.key === 'End' && visibleCollections.length > 0) {
			event.preventDefault();
			selectCollection(visibleCollections[visibleCollections.length - 1].id, true);
		}
	};

	return (
		<section
			ref={rootRef}
			className={styles.nebula}
			aria-label="Schema Nebula — governed MongoDB collection constellation"
		>
			<header className={styles.head}>
				<div>
					<p className={styles.eyebrow}>Schema Nebula · Wave 2</p>
					<h2>Every physical collection. No family-level fog.</h2>
					<p className={styles.lede}>
						Explore the governed target as one star per MongoDB collection. Solid stars have adapter model
						evidence today; ghost stars are architecture targets only. Select a star to reveal its
						ownership, decisions, source and gravity links.
					</p>
				</div>
				<div
					className={styles.telemetry}
					aria-label="Schema inventory summary"
				>
					<div>
						<strong>{inventory.nodeCount}</strong>
						<span>physical nodes</span>
					</div>
					<div>
						<strong>{inventory.existingModelCount}</strong>
						<span>solid now</span>
					</div>
					<div>
						<strong>{inventory.targetOnlyCount}</strong>
						<span>target ghosts</span>
					</div>
					<div>
						<strong>{clusters.length}</strong>
						<span>contexts</span>
					</div>
				</div>
			</header>

			<div className={styles.controlDeck}>
				<label className={styles.search}>
					<span>Find a collection</span>
					<input
						type="search"
						value={query}
						placeholder="products, consent, Chunk G…"
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === 'Escape') {
								event.preventDefault();
								setQuery('');
							}
						}}
					/>
					<kbd>/</kbd>
				</label>

				<div
					className={styles.stateLens}
					role="group"
					aria-label="Implementation-state lens"
				>
					{(
						[
							['all', 'All'],
							['existing', 'Solid'],
							['planned', 'Ghost'],
						] as const
					).map(([value, label]) => (
						<button
							key={value}
							type="button"
							className={stateLens === value ? styles.lensActive : styles.lensButton}
							aria-pressed={stateLens === value}
							onClick={() => setStateLens(value)}
						>
							{label}
						</button>
					))}
				</div>

				<div
					className={styles.zoomControls}
					role="group"
					aria-label="Constellation zoom"
				>
					<button
						type="button"
						aria-label="Zoom out"
						disabled={zoomIndex === 0}
						onClick={() => setZoomIndex((index) => Math.max(0, index - 1))}
					>
						−
					</button>
					<button
						type="button"
						className={styles.zoomReadout}
						aria-label="Reset zoom"
						onClick={() => setZoomIndex(0)}
					>
						{Math.round(zoom * 100)}%
					</button>
					<button
						type="button"
						aria-label="Zoom in"
						disabled={zoomIndex === ZOOM_LEVELS.length - 1}
						onClick={() => setZoomIndex((index) => Math.min(ZOOM_LEVELS.length - 1, index + 1))}
					>
						+
					</button>
				</div>
			</div>

			<div
				className={styles.clusterLenses}
				role="listbox"
				aria-label="Bounded-context lens"
			>
				<button
					type="button"
					role="option"
					aria-selected={clusterLens === 'all'}
					className={clusterLens === 'all' ? styles.clusterLensActive : styles.clusterLens}
					onClick={() => setClusterLens('all')}
				>
					All contexts <span>{collections.length}</span>
				</button>
				{graph.clusters.map((cluster) => (
					<button
						key={cluster.id}
						type="button"
						role="option"
						aria-selected={clusterLens === cluster.id}
						className={clusterLens === cluster.id ? styles.clusterLensActive : styles.clusterLens}
						onClick={() => setClusterLens(cluster.id)}
					>
						{cluster.label} <span>{cluster.collectionIds.length}</span>
					</button>
				))}
			</div>

			<div className={styles.body}>
				<div className={styles.stage}>
					<div className={styles.stageHead}>
						<div
							className={styles.legend}
							aria-label="Constellation legend"
						>
							<span className={styles.legendExisting}>Current model</span>
							<span className={styles.legendPlanned}>Target only</span>
							<span className={styles.legendOutgoing}>References</span>
							<span className={styles.legendIncoming}>Referenced by</span>
						</div>
						<span className={styles.resultCount}>
							{visibleCollections.length}/{collections.length} visible
						</span>
					</div>

					<div
						className={styles.viewport}
						onKeyDown={(event) => {
							if (event.key === '+' || event.key === '=') {
								event.preventDefault();
								setZoomIndex((index) => Math.min(ZOOM_LEVELS.length - 1, index + 1));
							} else if (event.key === '-') {
								event.preventDefault();
								setZoomIndex((index) => Math.max(0, index - 1));
							} else if (event.key === '0') {
								event.preventDefault();
								setZoomIndex(0);
							}
						}}
					>
						<p
							id={`${gradientId}-instructions`}
							className={styles.visuallyHidden}
						>
							Tab to a star, use arrow keys to move through visible collections, Enter to select, and
							plus, minus or zero to control zoom.
						</p>
						<svg
							className={styles.map}
							viewBox={viewBox}
							role="group"
							aria-label={`${visibleCollections.length} of ${collections.length} collection stars visible`}
							aria-describedby={`${gradientId}-instructions`}
						>
							<defs>
								<radialGradient
									id={gradientId}
									cx="50%"
									cy="50%"
									r="50%"
								>
									<stop
										offset="0%"
										stopColor="var(--portal-accent)"
										stopOpacity="0.34"
									/>
									<stop
										offset="100%"
										stopColor="var(--portal-accent)"
										stopOpacity="0"
									/>
								</radialGradient>
							</defs>

							<circle
								className={styles.ambientCore}
								cx={CENTER.x}
								cy={CENTER.y}
								r="182"
								fill={`url(#${gradientId})`}
							/>
							<circle
								className={styles.orbit}
								cx={CENTER.x}
								cy={CENTER.y}
								r={CLUSTER_ORBIT}
							/>
							<circle
								className={styles.innerOrbit}
								cx={CENTER.x}
								cy={CENTER.y}
								r="152"
							/>

							{graph.clusters.map((cluster) => {
								const clusterVisible = cluster.collectionIds.some((id) => visibleIds.has(id));
								const clusterActive = selected.cluster === cluster.id || clusterLens === cluster.id;
								const [firstLine, secondLine] = splitClusterLabel(cluster.label);
								return (
									<g
										key={cluster.id}
										className={`${styles.cluster} ${clusterVisible ? '' : styles.clusterDimmed} ${clusterActive ? styles.clusterActive : ''}`}
										aria-hidden="true"
									>
										<line
											className={styles.clusterSpoke}
											x1={CENTER.x}
											y1={CENTER.y}
											x2={cluster.x}
											y2={cluster.y}
										/>
										<circle
											className={styles.clusterWell}
											cx={cluster.x}
											cy={cluster.y}
											r={cluster.radius}
										/>
										<text
											className={styles.clusterLabel}
											x={cluster.x}
											y={cluster.y + cluster.radius + 15}
										>
											<tspan
												x={cluster.x}
												dy="0"
											>
												{firstLine}
											</tspan>
											{secondLine && (
												<tspan
													x={cluster.x}
													dy="11"
												>
													{secondLine}
												</tspan>
											)}
										</text>
									</g>
								);
							})}

							<g aria-hidden="true">
								{relationships.map((relationship) => (
									<line
										key={`${selected.id}-${relationship.id}`}
										className={`${styles.relationship} ${
											relationship.direction === 'outgoing'
												? styles.relationshipOutgoing
												: relationship.direction === 'incoming'
													? styles.relationshipIncoming
													: styles.relationshipBoth
										} ${visibleIds.has(relationship.id) ? '' : styles.relationshipDimmed}`}
										x1={selected.x}
										y1={selected.y}
										x2={relationship.node.x}
										y2={relationship.node.y}
									/>
								))}
							</g>

							<g
								className={styles.schemaCore}
								aria-hidden="true"
							>
								<circle
									className={styles.schemaCoreDisc}
									cx={CENTER.x}
									cy={CENTER.y}
									r="45"
								/>
								<text
									className={styles.schemaCoreCount}
									x={CENTER.x}
									y={CENTER.y - 3}
								>
									{inventory.nodeCount}
								</text>
								<text
									className={styles.schemaCoreLabel}
									x={CENTER.x}
									y={CENTER.y + 14}
								>
									collections
								</text>
							</g>

							{graph.collections.map((collection) => {
								const isVisible = visibleIds.has(collection.id);
								const isSelected = selected.id === collection.id;
								const isRelated = relationshipIds.has(collection.id);
								return (
									<g
										id={`schema-node-${collection.id}`}
										key={collection.id}
										className={[
											styles.node,
											stateClass(collection),
											isVisible ? '' : styles.nodeDimmed,
											isSelected ? styles.nodeSelected : '',
											isRelated ? styles.nodeRelated : '',
										]
											.filter(Boolean)
											.join(' ')}
										role="button"
										tabIndex={isVisible ? 0 : -1}
										aria-hidden={!isVisible}
										aria-label={`${collection.id}, ${STATE_LABEL[collection.currentState]}, ${clusterById.get(collection.cluster)?.label ?? collection.cluster}`}
										aria-pressed={isSelected}
										onMouseEnter={() => {
											if (isVisible) setSelectedId(collection.id);
										}}
										onFocus={() => {
											if (isVisible) selectCollection(collection.id);
										}}
										onClick={() => {
											if (isVisible) selectCollection(collection.id);
										}}
										onKeyDown={(event) => handleNodeKeyDown(event, collection.id)}
									>
										<title>{`${collection.id} — ${STATE_LABEL[collection.currentState]}`}</title>
										{isSelected && (
											<circle
												className={styles.selectionHalo}
												cx={collection.x}
												cy={collection.y}
												r="14"
											/>
										)}
										<circle
											className={styles.nodeDisc}
											cx={collection.x}
											cy={collection.y}
											r={collection.currentState === 'existing' ? 8 : 6.5}
										/>
										{collection.currentState === 'existing' && (
											<circle
												className={styles.nodeCore}
												cx={collection.x}
												cy={collection.y}
												r="2.5"
											/>
										)}
									</g>
								);
							})}
						</svg>

						{visibleCollections.length === 0 && (
							<div
								className={styles.emptyState}
								role="status"
							>
								<strong>No stars match this lens.</strong>
								<span>Clear search or widen the context/state filters.</span>
								<button
									type="button"
									onClick={() => {
										setQuery('');
										setClusterLens('all');
										setStateLens('all');
									}}
								>
									Reset lenses
								</button>
							</div>
						)}
					</div>
				</div>

				<aside
					className={styles.panel}
					aria-live="polite"
				>
					<div className={styles.panelHead}>
						<div>
							<span className={styles.panelKicker}>Physical collection</span>
							<h3>{selected.id}</h3>
						</div>
						<span
							className={`${styles.stateBadge} ${
								selected.currentState === 'existing' ? styles.stateExisting : styles.statePlanned
							}`}
						>
							{STATE_LABEL[selected.currentState]}
						</span>
					</div>

					<button
						type="button"
						className={styles.contextButton}
						onClick={() => setClusterLens(selected.cluster)}
					>
						<span>Bounded context</span>
						<strong>{selectedCluster.label}</strong>
						<em>{selectedCluster.collectionIds.length} nodes</em>
					</button>

					<p className={styles.purpose}>{selected.purpose}</p>

					<div className={styles.evidence}>
						<span>Current evidence</span>
						{selected.currentModel ? (
							<>
								<strong>Adapter model exists</strong>
								<code>{selected.currentModel}</code>
							</>
						) : (
							<>
								<strong>No adapter model exists</strong>
								<p>Architecture target only; contracts or prose do not make this implemented.</p>
							</>
						)}
					</div>

					<dl className={styles.metaGrid}>
						<div>
							<dt>Target action</dt>
							<dd>
								{selected.targetAction === 'refactor' ? 'Refactor current model' : 'Add collection'}
							</dd>
						</div>
						<div>
							<dt>Source</dt>
							<dd>{selected.source}</dd>
						</div>
					</dl>

					<div className={styles.tagSection}>
						<span>Owning roadmap chunks</span>
						<div>
							{selected.owningChunks.map((chunk) => (
								<Link
									key={chunk}
									to="/mission-control"
									className={styles.chunkTag}
								>
									Chunk {chunk}
								</Link>
							))}
						</div>
					</div>

					{selected.blockingDecisions.length > 0 && (
						<div className={styles.tagSection}>
							<span>Open decision dependencies</span>
							<div>
								{selected.blockingDecisions.map((decision) => (
									<span
										key={decision}
										className={styles.decisionTag}
									>
										{decision}
									</span>
								))}
							</div>
						</div>
					)}

					<div className={styles.relationshipPanel}>
						<div>
							<span>References</span>
							<strong>{selected.references.length}</strong>
						</div>
						<div>
							<span>Referenced by</span>
							<strong>{incomingCollections.length}</strong>
						</div>
						{relationships.length > 0 ? (
							<div className={styles.relationshipButtons}>
								{relationships.map((relationship) => (
									<button
										key={relationship.id}
										type="button"
										data-direction={relationship.direction}
										onClick={() => selectCollection(relationship.id, true)}
									>
										{relationship.id}
										<span>
											{relationship.direction === 'outgoing'
												? 'out'
												: relationship.direction === 'incoming'
													? 'in'
													: 'both'}
										</span>
									</button>
								))}
							</div>
						) : (
							<p className={styles.noRelationships}>No governed collection references recorded.</p>
						)}
					</div>
				</aside>
			</div>
		</section>
	);
}
