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
		summary:
			'Read a public catalogue page without exposing non-public inventory or using Mongo as storefront search.',
		current:
			'The controller accepts an optional status query and the repository applies it only when supplied. A public request can therefore omit status or request draft/archived records. Search uses a Mongo regular expression over slug, SKU, and tags.',
		target: 'Public catalogue reads force published and purchasable visibility server-side. Listing/search flows use SearchPort and self-hosted Meilisearch for configured facets while MongoDB remains the rebuildable source of truth.',
		verify: 'Test anonymous requests for every non-public status, confirm field-level response safety, probe category/facet combinations, and prove the public handler cannot select an admin-only visibility state.',
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
			'Cart routes accept a cart id without an authentication guard, guest-cookie proof, or ownership check. They append contract-shaped lines but do not validate product publication, selected variation, price, or stock.',
		target: 'An httpOnly opaque guest cookie or authenticated session resolves the cart without trusting a caller-supplied owner id. Every mutation revalidates product, configuration, stock, and the line signature before persistence.',
		verify: 'Attempt cross-cart reads and writes, forged guest tokens, retired variants, excessive quantities, and replayed offline mutations. Assert line-level safe errors and no silent data loss.',
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
		path: '/auth/login',
		summary: 'Authenticate a browser without exposing reusable session credentials to Angular storage.',
		current:
			'Login/register return access and refresh JWTs in JSON. The guard reads Authorization: Bearer only; refresh tokens are signed JWTs with no persisted family, rotation record, or reuse detection. Password minimum is eight characters.',
		target: 'The API sets audience-bound httpOnly Secure cookies, rotates opaque refresh tokens, validates signed double-submit CSRF, enforces the locked password/PIN policies, and separates storefront from admin authority.',
		verify: 'Prove tokens never enter browser-readable storage, unsafe cookie-authenticated methods reject missing CSRF, refresh reuse revokes the family, and storefront identity cannot authorize admin routes.',
		layers: [
			{ label: 'Credentials', detail: 'Validated secret' },
			{ label: 'Controller', detail: 'AuthController' },
			{ label: 'Application', detail: 'AuthService' },
			{ label: 'Port', detail: 'AuthPort + user repo' },
			{ label: 'Adapter', detail: 'Argon2 + JWT / Mongo' },
			{ label: 'Session', detail: 'Current JSON tokens' },
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
			'The route requires a valid bearer token but passes only the requested id to OrdersService. The service and repository fetch by id without comparing order.userId to the authenticated subject.',
		target: 'A storefront query is ownership-scoped by construction. Admin access uses a separate route/audience and explicit resource permission, with sensitive fields serialized according to actor.',
		verify: 'Create two users and prove neither can read the other order by changing the id. Repeat for staff roles, disabled users, stale permissions, missing records, and fields excluded from storefront responses.',
		layers: [
			{ label: 'Identity', detail: 'Token claims' },
			{ label: 'Guard', detail: 'JwtAuthGuard' },
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
			'The service reads products sequentially, calculates a partial subtotal/coupon result, saves one order, then deletes the cart. There is no cart ownership check, idempotency key, transaction, stock reservation, tax/shipping quote, payment attempt, or rollback boundary.',
		target: 'Checkout quote and place-order are separate. Place-order uses an idempotency key and Mongo transaction spanning immutable order snapshot, payment attempt, inventory, ledger, cart, and audit/event records.',
		verify: 'Inject failure after each write, repeat identical requests, race stock, replay callbacks, and assert either one complete committed result or a full rollback—never a half-created order.',
		layers: [
			{ label: 'Request', detail: 'Owned cart + key' },
			{ label: 'Controller', detail: 'OrdersController' },
			{ label: 'Orchestrator', detail: 'OrdersService' },
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
			'JWT and role guards restrict the route to admin/staff, and the repository appends a timeline event. There is no admin audience, granular permission, transition policy, CSRF, entity version, or audit-log write.',
		target: 'Admin routes are separately namespaced and audience-bound. A permission-aware use case validates legal transitions, concurrency, actor context, side effects, and an immutable audit event.',
		verify: 'Test every illegal transition, stale version, customer token, downgraded role, missing CSRF, concurrent update, and provider-side-effect failure. Confirm the audit record explains who changed what and why.',
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
		status: 'planned',
		risk: 'high',
		method: 'GET',
		path: '/search/typeahead',
		summary: 'Serve typo-tolerant multilingual discovery without making a derived index authoritative.',
		current:
			'SearchPort exists but is not bound. ProductRepository currently implements an escaped Mongo regular-expression fallback, and its SearchPort comment still names a superseded hosted service.',
		target: 'Self-hosted Meilisearch implements SearchPort. Mongo changes enqueue an outbox, the index contains public derived data, facet configuration controls exposure, and a complete reindex rebuilds from Mongo.',
		verify: 'Destroy and rebuild the index, test unpublished removal, Bengali/transliteration aliases, configured facets, no-result capture, stale outbox recovery, and graceful degraded behavior.',
		layers: [
			{ label: 'Request', detail: 'Normalized query' },
			{ label: 'Controller', detail: 'Search HTTP seam' },
			{ label: 'Application', detail: 'Discovery policy' },
			{ label: 'Port', detail: 'SearchPort' },
			{ label: 'Adapter', detail: 'Meilisearch planned' },
			{ label: 'Source', detail: 'Mongo + outbox' },
		],
		sources: [
			'packages/core-domain/src/ports/search.port.ts',
			'packages/adapters-db-mongo/src/repositories/product.repository.ts',
			'docs/engineering-live-context/owner-decisions-log.mdx',
		],
	},
	{
		id: 'readiness',
		title: 'Prove runtime readiness',
		area: 'platform',
		status: 'planned',
		risk: 'high',
		method: 'GET',
		path: '/health/ready',
		summary: 'Distinguish a live process from a backend that can safely serve dependency-backed requests.',
		current:
			'A single /health endpoint reports process status. Mongo connection failure is intentionally non-fatal, so the API may report ok while every persistence-backed route fails.',
		target: '/health/live proves the process is alive. /health/ready separately checks Mongo, Meilisearch, required configuration, and other critical dependencies without leaking secrets.',
		verify: 'Stop each dependency independently, corrupt safe test configuration, and confirm liveness remains truthful while readiness fails with sanitized component evidence and deployment health checks block promotion.',
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
		status: 'deferred',
		risk: 'observe',
		method: 'GET',
		path: '/api/reference',
		summary: 'Generate one machine-readable contract and present it through one protected modern reference.',
		current:
			'NestJS generates /openapi.json and mounts a transitional framework UI at /docs. Local zod body schemas and limited decorators mean the document is not yet a complete endpoint contract.',
		target: 'OpenAPI is generated and checked in CI, published at /api/openapi.json, and rendered once through protected Scalar at /api/reference for approved development/staging requests.',
		verify: 'Assert operation coverage, auth/CSRF/role metadata, schemas, errors, idempotency and side effects. Confirm no production secret or unrestricted production execution target appears in the reference.',
		layers: [
			{ label: 'Contracts', detail: 'Zod DTO families' },
			{ label: 'Controllers', detail: 'Operation metadata' },
			{ label: 'Generator', detail: 'OpenAPI document' },
			{ label: 'CI', detail: 'Contract smoke test' },
			{ label: 'Portal', detail: 'Scalar deferred' },
			{ label: 'Security', detail: 'Protected targets' },
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
	current: 'Current execution',
	target: 'Locked target',
	verify: 'How to prove it',
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
					<span className={styles.filterLabel}>Current risk</span>
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
						aria-label="Request-path evidence lens"
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
						<summary>Repository evidence and authority</summary>
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
