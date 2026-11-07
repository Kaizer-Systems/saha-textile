/* ============================================================================
 * NEXT-GEN-UI · Backend request-path atlas
 * ----------------------------------------------------------------------------
 * WHAT: an interactive view of representative backend paths: current code, target design, checks.
 * WHY: engineers need existing behaviour shown apart from intended behaviour.
 * HOW: filterable request cards render path records with their source files.
 * TUNING: keep path status, risk, lens labels and sources aligned with the code.
 * ========================================================================= */

import React, { useMemo, useRef, useState } from 'react';

import styles from './styles.module.css';

type RequestStatus = 'implemented' | 'scaffolded' | 'planned' | 'deferred';
type RequestArea = 'catalogue' | 'commerce' | 'identity' | 'operations' | 'platform';
type Risk = 'observe' | 'high' | 'critical';
type Lens = 'current' | 'target' | 'verify';

type RequestPath = {
	id: string;
	title: string;
	area: RequestArea;
	status: RequestStatus;
	risk: Risk;
	method: string;
	path: string;
	summary: string;
	current: string;
	target: string;
	verify: string;
	layers: Array<{ label: string; detail: string }>;
	sources: string[];
};

const requestPaths: RequestPath[] = [
	{
		id: 'catalogue-list',
		title: 'List public products',
		area: 'catalogue',
		status: 'scaffolded',
		risk: 'critical',
		method: 'GET',
		path: '/catalog/products',
		summary: 'Read a public catalogue page without exposing non-public products.',
		current:
			'The public controller accepts no status query. The repository defaults to the public audience, so lists and direct reads return live products only. The storefront reads `/catalog/placements`, `/catalog/home` and `/catalog/cards`.',
		target: 'Public catalogue reads force live visibility on the server. MongoDB stays the source of truth.',
		verify: 'Send anonymous requests for every non-public status. Check the response fields, try category and facet combinations, and confirm the public handler cannot select an admin-only state.',
		layers: [
			{ label: 'Request', detail: 'Query parameters' },
			{ label: 'Controller', detail: 'ProductsController' },
			{ label: 'Application', detail: 'CatalogService' },
			{ label: 'Port', detail: 'ProductRepository' },
			{ label: 'Adapter', detail: 'MongoProductRepository' },
			{ label: 'Persistence', detail: 'ProductModel' },
		],
		sources: [
			'apps/api/src/catalog/products.controller.ts',
			'apps/api/src/catalog/catalog.service.ts',
			'packages/adapters-db-mongo/src/repositories/product.repository.ts',
			'docs/engineering-live-context/owner-decisions-log.mdx',
		],
	},
	{
		id: 'cart-mutation',
		title: 'Mutate a cart',
		area: 'commerce',
		status: 'scaffolded',
		risk: 'critical',
		method: 'POST',
		path: '/cart/:id/lines',
		summary: 'Change only the cart owned by the authenticated user or opaque guest identity.',
		current:
			'Cart routes enforce session ownership for user carts, or the hashed httpOnly st_guest cookie for guest carts. Cross-owner access returns not-found. Line changes do not validate product, variation, price or stock.',
		target: 'The session or guest cookie resolves the cart, with no owner id from the caller. Every change revalidates the product, configuration, stock and line signature before saving.',
		verify: 'Try cross-cart reads and writes, forged guest tokens, retired variants and excessive quantities. Expect line-level errors and no silent data loss.',
		layers: [
			{ label: 'Identity', detail: 'User or guest cookie' },
			{ label: 'Controller', detail: 'CartController' },
			{ label: 'Application', detail: 'CartService' },
			{ label: 'Port', detail: 'CartRepository' },
			{ label: 'Adapter', detail: 'MongoCartRepository' },
			{ label: 'Persistence', detail: 'CartModel' },
		],
		sources: [
			'apps/api/src/cart',
			'packages/core-domain/src/ports/cart.repository.ts',
			'packages/adapters-db-mongo/src/models/cart.model.ts',
			'docs/engineering-live-context/owner-decisions-log.mdx',
		],
	},
	{
		id: 'browser-auth',
		title: 'Establish a browser session',
		area: 'identity',
		status: 'scaffolded',
		risk: 'critical',
		method: 'POST',
		path: '/auth/storefront/login/password',
		summary: 'Authenticate a browser without exposing reusable session credentials to Angular storage.',
		current:
			'The API sets httpOnly access and refresh cookies for one audience, stores refresh families and a per-session CSRF hash, rotates atomically and revokes a family on reuse. It returns only sanitized user and session data. Both Angular applications use cookie-only gateways with single-flight refresh and cross-tab locks.',
		target: 'Sessions stay in httpOnly cookies, CSRF stays double-submit, and storefront and admin authority stay separate.',
		verify: 'Confirm that tokens never reach browser storage, an unsafe request without CSRF fails, refresh reuse revokes the family, and a storefront session cannot use admin routes.',
		layers: [
			{ label: 'Credentials', detail: 'Validated secret' },
			{ label: 'Controller', detail: 'AuthController' },
			{ label: 'Application', detail: 'AuthService' },
			{ label: 'Port', detail: 'AuthPort + user repo' },
			{ label: 'Adapter', detail: 'Argon2 + JWT / Mongo' },
			{ label: 'Session', detail: 'Cookie + persisted family' },
		],
		sources: [
			'apps/api/src/auth',
			'apps/api/src/infra/argon2-jwt.auth.ts',
			'packages/core-domain/src/ports/auth.port.ts',
			'docs/engineering-live-context/codex-auth-architecture-db-and-request-plan.mdx',
		],
	},
	{
		id: 'order-read',
		title: 'Read one customer order',
		area: 'commerce',
		status: 'scaffolded',
		risk: 'critical',
		method: 'GET',
		path: '/orders/:id',
		summary: 'Return an order only when the actor owns it or holds an explicitly authorized operator permission.',
		current:
			'The route compares order.userId with the authenticated subject and returns not-found on a mismatch. An admin holding order.index can read any order.',
		target: 'A storefront read is scoped to its owner in the query. Admin access uses a separate route and permission, and each actor receives its own response shape.',
		verify: 'Create two customers and confirm neither can read the other customer’s order by changing the id. Repeat for staff roles, disabled accounts, stale permissions and missing records.',
		layers: [
			{ label: 'Identity', detail: 'Token claims' },
			{ label: 'Guard', detail: 'SessionGuard + ownership' },
			{ label: 'Controller', detail: 'OrdersController' },
			{ label: 'Application', detail: 'OrdersService' },
			{ label: 'Port', detail: 'OrderRepository' },
			{ label: 'Persistence', detail: 'OrderModel' },
		],
		sources: [
			'apps/api/src/orders/orders.controller.ts',
			'apps/api/src/orders/orders.service.ts',
			'packages/adapters-db-mongo/src/repositories/order.repository.ts',
			'docs/engineering-live-context/saha-textile-technical-knowledgebase.mdx',
		],
	},
	{
		id: 'place-order',
		title: 'Place an order',
		area: 'commerce',
		status: 'scaffolded',
		risk: 'critical',
		method: 'POST',
		path: '/orders',
		summary: 'Convert an owned, revalidated cart into one durable commerce outcome exactly once.',
		current:
			'The service checks cart ownership and prices the lines, then saves the order and removes the cart in one transaction. It has no idempotency key, stock reservation, tax, shipping or payment step.',
		target: 'Quoting and placing are separate steps. Placing uses an idempotency key and one transaction across the order snapshot, payment attempt, inventory, ledger, cart and audit records.',
		verify: 'Inject a failure after each write, repeat identical requests, race for stock and replay callbacks. Expect one complete result or a full rollback, never a half-created order.',
		layers: [
			{ label: 'Request', detail: 'Owned cart + key' },
			{ label: 'Controller', detail: 'OrdersController' },
			{ label: 'Application', detail: 'OrdersService' },
			{ label: 'Domain', detail: 'Pricing invariants' },
			{ label: 'Ports', detail: 'Repos + providers' },
			{ label: 'Transaction', detail: 'Atomic records' },
		],
		sources: [
			'apps/api/src/orders/orders.service.ts',
			'packages/core-domain/src/pricing',
			'packages/core-domain/src/ports/payment-gateway.port.ts',
			'docs/engineering-live-context/api-db-development-roadmap-with-pending-decision-gates.mdx',
		],
	},
	{
		id: 'admin-order-status',
		title: 'Change order status as an operator',
		area: 'operations',
		status: 'scaffolded',
		risk: 'high',
		method: 'PATCH',
		path: '/orders/:id/status',
		summary: 'Authorize, validate, audit, and safely transition a privileged commerce state.',
		current:
			'The route requires an admin session, CSRF and the order.update permission, and the repository appends a timeline event. It has no legal-transition rule, entity version or audit record.',
		target: 'A use case checks the permission, legal transition and concurrency, and writes an immutable audit record.',
		verify: 'Test every illegal transition, a stale version, a customer session, a downgraded role, missing CSRF and a concurrent update. Confirm the audit record shows who changed what and why.',
		layers: [
			{ label: 'Admin session', detail: 'Audience + CSRF' },
			{ label: 'Authorization', detail: 'Role + permission' },
			{ label: 'Controller', detail: 'Status endpoint' },
			{ label: 'Use case', detail: 'Transition policy' },
			{ label: 'Repository', detail: 'Atomic update' },
			{ label: 'Audit', detail: 'Immutable event' },
		],
		sources: [
			'apps/api/src/orders/orders.controller.ts',
			'apps/api/src/auth/roles.guard.ts',
			'packages/adapters-db-mongo/src/repositories/order.repository.ts',
			'docs/engineering-live-context/api-db-development-roadmap-with-pending-decision-gates.mdx',
		],
	},
	{
		id: 'search',
		title: 'Run storefront search',
		area: 'catalogue',
		status: 'scaffolded',
		risk: 'high',
		method: 'GET',
		path: '/catalog/search',
		summary: 'Serve typo-tolerant search while MongoDB stays the source of truth.',
		current:
			'SearchPort is bound to self-hosted Meilisearch. The index holds ids and words, and prices come from MongoDB. If the index is down the route answers 503 and never falls back to MongoDB.',
		target: 'Product changes reach the index through an outbox, and facet configuration decides what is exposed. A full reindex rebuilds from MongoDB.',
		verify: 'Destroy and rebuild the index. Test removal of unpublished products, configured facets, no-result handling and behaviour when the index is down.',
		layers: [
			{ label: 'Request', detail: 'Normalized query' },
			{ label: 'Controller', detail: 'Search route' },
			{ label: 'Application', detail: 'CatalogPublicService' },
			{ label: 'Port', detail: 'SearchPort' },
			{ label: 'Adapter', detail: 'MeilisearchSearch' },
			{ label: 'Source', detail: 'MongoDB' },
		],
		sources: [
			'packages/core-domain/src/ports/search.port.ts',
			'apps/api/src/search/meilisearch-search.ts',
			'docs/engineering-live-context/owner-decisions-log.mdx',
		],
	},
	{
		id: 'readiness',
		title: 'Check runtime readiness',
		area: 'platform',
		status: 'implemented',
		risk: 'high',
		method: 'GET',
		path: '/health/ready',
		summary: 'Tell a running process apart from one that can serve requests.',
		current:
			'/health/live checks nothing external. /health/ready checks MongoDB and answers 503 when it is down. /health is an alias of /health/live. Readiness does not cover Redis or Meilisearch.',
		target: '/health/ready also checks Meilisearch, required configuration and other critical dependencies, without exposing secrets.',
		verify: 'Stop each dependency in turn. Confirm that liveness still answers, readiness fails with a sanitized list, and a deployment health check blocks promotion.',
		layers: [
			{ label: 'Probe', detail: 'Live or ready' },
			{ label: 'Controller', detail: 'Health boundary' },
			{ label: 'Checks', detail: 'Dependency probes' },
			{ label: 'Mongo', detail: 'Connection state' },
			{ label: 'Search', detail: 'Index service' },
			{ label: 'Deploy', detail: 'Promotion gate' },
		],
		sources: [
			'apps/api/src/health/health.controller.ts',
			'apps/api/src/infra/persistence.module.ts',
			'docs/engineering-live-context/execution-roadmap.mdx',
		],
	},
	{
		id: 'api-reference',
		title: 'Publish the API contract',
		area: 'platform',
		status: 'scaffolded',
		risk: 'observe',
		method: 'GET',
		path: '/api/reference',
		summary: 'Generate one machine-readable contract and present it through one reference.',
		current:
			'NestJS generates /openapi.json. The portal generates the same document for Scalar at /api/reference. It lists every route but omits full schemas and per-operation security.',
		target: 'CI generates and checks the document. It is published at /api/openapi.json and rendered by Scalar at /api/reference, for approved development and staging requests.',
		verify: 'Check operation coverage, security metadata, schemas, errors, idempotency and side effects. Confirm that no production secret or production target appears in the reference.',
		layers: [
			{ label: 'Contracts', detail: 'Zod DTO families' },
			{ label: 'Controllers', detail: 'Operation metadata' },
			{ label: 'Generator', detail: 'OpenAPI document' },
			{ label: 'Check', detail: 'Tag check' },
			{ label: 'Portal', detail: 'Scalar reference' },
			{ label: 'Access', detail: 'Local server only' },
		],
		sources: [
			'apps/api/src/main.ts',
			'apps/api/src',
			'docs/engineering-live-context/owner-decisions-log.mdx',
			'docs/api/openapi-and-scalar.md',
		],
	},
];

const areaLabels: Record<RequestArea | 'all', string> = {
	all: 'All paths',
	catalogue: 'Catalogue',
	commerce: 'Commerce',
	identity: 'Identity',
	operations: 'Operations',
	platform: 'Platform',
};

const statusLabels: Record<RequestStatus, string> = {
	implemented: 'Implemented',
	scaffolded: 'Scaffolded',
	planned: 'Planned',
	deferred: 'Deferred',
};

const riskLabels: Record<Risk | 'all', string> = {
	all: 'All risk levels',
	observe: 'Observe',
	high: 'High',
	critical: 'Critical',
};

const lensLabels: Record<Lens, string> = {
	current: 'Current code',
	target: 'Target design',
	verify: 'How to check it',
};

export function BackendRequestAtlas(): React.ReactNode {
	const [area, setArea] = useState<RequestArea | 'all'>('all');
	const [risk, setRisk] = useState<Risk | 'all'>('all');
	const [selectedId, setSelectedId] = useState(requestPaths[0].id);
	const [lens, setLens] = useState<Lens>('current');
	const lensButtons = useRef<Array<HTMLButtonElement | null>>([]);
	const areaPaths = useMemo(() => requestPaths.filter((request) => area === 'all' || request.area === area), [area]);
	const availableRisks = (['critical', 'high', 'observe'] as Risk[]).filter((candidate) =>
		areaPaths.some((request) => request.risk === candidate),
	);
	const effectiveRisk = risk === 'all' || availableRisks.includes(risk) ? risk : 'all';
	const visiblePaths = areaPaths.filter((request) => effectiveRisk === 'all' || request.risk === effectiveRisk);
	const selectedPath = visiblePaths.find((request) => request.id === selectedId) ?? visiblePaths[0];
	const lenses: Lens[] = ['current', 'target', 'verify'];

	const handleLensKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
		let nextIndex: number | undefined;
		if (event.key === 'ArrowRight') nextIndex = (index + 1) % lenses.length;
		if (event.key === 'ArrowLeft') nextIndex = (index - 1 + lenses.length) % lenses.length;
		if (event.key === 'Home') nextIndex = 0;
		if (event.key === 'End') nextIndex = lenses.length - 1;
		if (nextIndex === undefined) return;
		event.preventDefault();
		setLens(lenses[nextIndex]);
		lensButtons.current[nextIndex]?.focus();
	};

	return (
		<section
			className={styles.atlas}
			aria-label="Backend request-path atlas"
		>
			<div className={styles.filters}>
				<div>
					<span className={styles.filterLabel}>Capability area</span>
					<div
						className={styles.filterGroup}
						aria-label="Filter request paths by capability area"
					>
						{(['all', 'catalogue', 'commerce', 'identity', 'operations', 'platform'] as const).map(
							(candidate) => (
								<button
									key={candidate}
									type="button"
									aria-pressed={area === candidate}
									className={area === candidate ? styles.activeFilter : styles.filter}
									onClick={() => setArea(candidate)}
								>
									{areaLabels[candidate]}
								</button>
							),
						)}
					</div>
				</div>
				<div>
					<span className={styles.filterLabel}>Risk</span>
					<div
						className={styles.filterGroup}
						aria-label="Filter request paths by current risk"
					>
						{(['all', ...availableRisks] as Array<Risk | 'all'>).map((candidate) => (
							<button
								key={candidate}
								type="button"
								aria-pressed={effectiveRisk === candidate}
								className={effectiveRisk === candidate ? styles.activeFilter : styles.filter}
								onClick={() => setRisk(candidate)}
							>
								{riskLabels[candidate]}
							</button>
						))}
					</div>
				</div>
			</div>

			<div className={styles.workspace}>
				<nav
					className={styles.pathList}
					aria-label="Choose a backend request path"
				>
					{visiblePaths.map((request) => (
						<button
							key={request.id}
							type="button"
							className={selectedPath.id === request.id ? styles.activePath : styles.path}
							aria-current={selectedPath.id === request.id ? 'true' : undefined}
							onClick={() => setSelectedId(request.id)}
						>
							<span className={styles.route}>
								<small>{request.method}</small>
								<code>{request.path}</code>
							</span>
							<strong>{request.title}</strong>
							<span className={styles.pathMeta}>
								<small className={styles[request.status]}>{statusLabels[request.status]}</small>
								<small className={styles[request.risk]}>{riskLabels[request.risk]} risk</small>
							</span>
						</button>
					))}
				</nav>

				<article className={styles.detail}>
					<header>
						<div>
							<span className={styles.eyebrow}>{areaLabels[selectedPath.area]} request path</span>
							<h2>{selectedPath.title}</h2>
						</div>
						<div className={styles.badges}>
							<span className={styles[selectedPath.status]}>{statusLabels[selectedPath.status]}</span>
							<span className={styles[selectedPath.risk]}>{riskLabels[selectedPath.risk]} risk</span>
						</div>
					</header>
					<p className={styles.summary}>{selectedPath.summary}</p>

					<ol
						className={styles.pipeline}
						aria-label="Request boundary pipeline"
					>
						{selectedPath.layers.map((layer, index) => (
							<li key={`${layer.label}-${layer.detail}`}>
								<span>{String(index + 1).padStart(2, '0')}</span>
								<strong>{layer.label}</strong>
								<small>{layer.detail}</small>
							</li>
						))}
					</ol>

					<div
						className={styles.lensTabs}
						role="tablist"
						aria-label="Request path view"
					>
						{lenses.map((candidate, index) => (
							<button
								key={candidate}
								ref={(element) => {
									lensButtons.current[index] = element;
								}}
								type="button"
								role="tab"
								id={`backend-lens-${candidate}`}
								aria-controls="backend-lens-panel"
								aria-selected={lens === candidate}
								tabIndex={lens === candidate ? 0 : -1}
								className={lens === candidate ? styles.activeLens : styles.lens}
								onClick={() => setLens(candidate)}
								onKeyDown={(event) => handleLensKeyDown(event, index)}
							>
								{lensLabels[candidate]}
							</button>
						))}
					</div>
					<div
						className={styles.lensPanel}
						role="tabpanel"
						id="backend-lens-panel"
						aria-labelledby={`backend-lens-${lens}`}
					>
						<span className={styles.eyebrow}>{lensLabels[lens]}</span>
						<p>{selectedPath[lens]}</p>
					</div>

					<details className={styles.evidence}>
						<summary>Sources</summary>
						<ul>
							{selectedPath.sources.map((source) => (
								<li key={source}>
									<code>{source}</code>
								</li>
							))}
						</ul>
					</details>
				</article>
			</div>
		</section>
	);
}
