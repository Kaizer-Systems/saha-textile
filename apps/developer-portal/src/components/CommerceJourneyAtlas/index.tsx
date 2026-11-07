/* ============================================================================
 * NEXT-GEN-UI · Business and commerce journey atlas
 * What: interactive views of platform journeys: current code, target design, failure recovery.
 * Why: a reader needs the whole journey without mistaking design for working code.
 * How: filterable cards connect journey steps to source paths.
 * Tuning knobs: journey copy, status filters, view labels and step labels.
 * ========================================================================= */

import React, { useMemo, useRef, useState } from 'react';

import styles from './styles.module.css';

type JourneyStatus = 'implemented' | 'scaffolded' | 'planned' | 'deferred';
type JourneyArea = 'discovery' | 'commerce' | 'identity' | 'operations';
type Lens = 'current' | 'target' | 'recovery';

type Journey = {
	id: string;
	title: string;
	area: JourneyArea;
	status: JourneyStatus;
	summary: string;
	current: string;
	target: string;
	recovery: string;
	steps: string[];
	sources: string[];
};

const journeys: Journey[] = [
	{
		id: 'discover',
		title: 'Discover and select a product',
		area: 'discovery',
		status: 'scaffolded',
		summary: 'Move from category or search intent to one public, purchasable product configuration.',
		current: 'Category pages, search and product pages read the catalogue API, with facets and SEO data.',
		target: 'Discovery returns items, configured facets, counts and SEO data, and MongoDB stays the source of truth.',
		recovery:
			'An unknown address answers 404. A retired one answers 410, or a 301 when a live replacement is named.',
		steps: [
			'Resolve locale and route',
			'Query category or search',
			'Apply configured facets',
			'Open product detail',
			'Verify publish and purchase state',
		],
		sources: [
			'apps/storefront/src/app/pages/collections.page.ts',
			'apps/storefront/src/app/pages/product/[slug].page.ts',
			'apps/api/src/catalog',
			'docs/engineering-live-context/codex-catalog-db-architecture-assessment-and-plan.mdx',
		],
	},
	{
		id: 'configure',
		title: 'Configure a product',
		area: 'discovery',
		status: 'scaffolded',
		summary:
			'Resolve variation axes, named add-ons, measurements, bundles, media, price deltas, and stock into one cart-line signature.',
		current:
			'The product page reads option groups, variants, measurements and bundles from the API, and the configurator builds a cart line.',
		target: 'Only variation axes create SKU and stock rows. Named add-ons customize included services, bundles consume component stock, and descriptive values stay as filters.',
		recovery:
			'Block an incomplete configuration, keep the shopper’s valid choices, and say which selection needs attention.',
		steps: [
			'Load semantic option roles',
			'Select purchasable variant',
			'Select named add-ons',
			'Capture required measurements',
			'Recalculate and validate line signature',
		],
		sources: [
			'apps/storefront/src/app/shared/ui/product-config',
			'packages/contracts/src/product.ts',
			'docs/engineering-live-context/owner-decisions-log.mdx',
		],
	},
	{
		id: 'cart',
		title: 'Add, persist, and merge a cart',
		area: 'commerce',
		status: 'scaffolded',
		summary: 'Keep the guest cart fast, with server validation as the authority.',
		current:
			'Classic NgRx holds the browser cart, with persistence. The API has a separate cart with user or st_guest ownership, and merges a guest cart at sign-in. The storefront does not call the cart API.',
		target: 'An opaque guest cookie owns a 30-day server cart. Sign-in merges guest lines in a transaction before any pending action replays.',
		recovery:
			'Unavailable products are line errors, insufficient stock adjusts or blocks quantities, and invalid lines are reported rather than silently discarded.',
		steps: [
			'Build cart-line signature',
			'Validate purchase state',
			'Write guest or user cart',
			'Queue offline mutation when needed',
			'Merge and revalidate after authentication',
		],
		sources: [
			'apps/storefront/src/app/core/state/cart',
			'apps/api/src/cart',
			'packages/contracts/src/cart.ts',
			'docs/engineering-live-context/owner-decisions-log.mdx',
		],
	},
	{
		id: 'auth-resume',
		title: 'Authenticate and resume intent',
		area: 'identity',
		status: 'scaffolded',
		summary: 'Authenticate without losing the shopper’s origin, cart, or one account-bound action.',
		current:
			'Verified signup, password and OTP sign-in, Google and Facebook, refresh, recovery and guest-cart merge work through cookie sessions. Only Notify me replays after sign-in.',
		target: 'After sign-in, the guest cart merges and one server-side pending action resumes.',
		recovery:
			'Expired or invalid intent is not replayed. Show a safe explanation and return the user to the most relevant valid screen.',
		steps: [
			'Capture safe intent',
			'Authenticate or register',
			'Merge guest cart',
			'Revalidate intent',
			'Replay once and clear',
		],
		sources: [
			'apps/storefront/src/app/pages/auth',
			'apps/api/src/auth',
			'docs/engineering-live-context/codex-auth-architecture-db-and-request-plan.mdx',
			'docs/engineering-live-context/owner-decisions-log.mdx',
		],
	},
	{
		id: 'checkout',
		title: 'Price and quote checkout',
		area: 'commerce',
		status: 'scaffolded',
		summary:
			'Turn an authenticated cart, destination, promotions, tax, currency, and shipping quote into an expiring server-calculated total.',
		current:
			'Checkout forms exist, but totals are a static client object and placing an order only navigates to a detail page.',
		target: 'The API recalculates INR prices, promotions, tax, exchange rates, gateway gross-up and shipping. The browser only formats returned values.',
		recovery:
			'Stale quotes, changed prices, invalid coupons, address failures and unavailable stock return structured corrections before payment.',
		steps: [
			'Require authenticated cart',
			'Validate address and lines',
			'Resolve promotions and tax',
			'Fetch shipping quote',
			'Return priced checkout snapshot',
		],
		sources: [
			'apps/storefront/src/app/features/shop/checkout',
			'apps/api/src/promotions',
			'apps/api/src/currency',
			'packages/contracts/src/shipping.ts',
		],
	},
	{
		id: 'payment-order',
		title: 'Pay and create an order',
		area: 'commerce',
		status: 'scaffolded',
		summary: 'Create a durable order and separate payment attempt without exposing gateway secrets to Angular.',
		current:
			'POST /orders saves the order and removes the cart in one transaction. Idempotency, stock, payment attempts and provider adapters do not exist.',
		target: 'The server selects CCAvenue for INR and PayPal for other currencies. One atomic write snapshots order lines, prices, exchange rate, tax, promotions, shipping and the payment attempt.',
		recovery:
			'An idempotency key prevents duplicate orders. Failed, cancelled, pending and delayed payments stay distinct and recoverable.',
		steps: [
			'Freeze checkout snapshot',
			'Select gateway server-side',
			'Create order and payment attempt',
			'Hand off to hosted provider',
			'Verify callback/webhook and transition status',
		],
		sources: [
			'apps/api/src/orders',
			'packages/contracts/src/order.ts',
			'packages/core-domain/src/ports/payment-gateway.port.ts',
			'docs/engineering-live-context/saha-textile-technical-knowledgebase.mdx',
		],
	},
	{
		id: 'fulfilment',
		title: 'Fulfil, return, and refund',
		area: 'operations',
		status: 'planned',
		summary: 'Keep order, shipment, return, and financial reversal lifecycles separate but traceable.',
		current: 'Order, refund and shipping screens read JSON files. No provider or financial flow exists.',
		target: 'Separate records hold order snapshots, shipment events, item-level returns and payment-linked refunds.',
		recovery:
			'Partial fulfilment, failed labels, lost callbacks, rejected returns and partial refunds keep an auditable history.',
		steps: [
			'Move order to processing',
			'Create shipment and label',
			'Record provider events',
			'Evaluate return lines',
			'Process and reconcile refund',
		],
		sources: [
			'apps/admin/src/app/features/order',
			'apps/admin/src/app/features/refund',
			'packages/core-domain/src/ports/shipping.port.ts',
			'docs/engineering-live-context/codex-catalog-db-architecture-assessment-and-plan.mdx',
		],
	},
	{
		id: 'admin-resume',
		title: 'Authorize and resume admin work',
		area: 'operations',
		status: 'scaffolded',
		summary: 'Protect privileged operations without destroying complex in-progress operator work.',
		current:
			'Password and PIN sessions, invites, recovery, role management, Account Security and the 15-minute idle lock work. Complex forms have no draft recovery.',
		target: 'Feature-owned drafts add recovery for complex forms, on top of API authorization, audit records and the idle lock.',
		recovery:
			'A lost permission fails closed. A stale draft goes through normal validation. A blocked request replays only after session, permission and version checks.',
		steps: [
			'Authorize route and action',
			'Preserve in-memory workflow',
			'Soft-lock on inactivity',
			'Reauthenticate preferred method',
			'Revalidate and resume safely',
		],
		sources: [
			'apps/admin/src/app/core/guards',
			'apps/admin/src/app/core/state/auth.store.ts',
			'apps/admin/src/app/features',
			'docs/engineering-live-context/owner-decisions-log.mdx',
		],
	},
	{
		id: 'track-order',
		title: 'Public order tracking',
		area: 'operations',
		status: 'deferred',
		summary: 'A public order lookup is postponed until payment and shipment lifecycles exist.',
		current: 'No production public tracking contract or verified lookup model exists.',
		target: 'Define the lookup after shipment events and privacy needs are known.',
		recovery: 'Do not invent a weak order-number-only lookup that could expose customer or shipment information.',
		steps: [
			'Complete order lifecycle',
			'Complete shipment events',
			'Define privacy-safe lookup',
			'Threat-model enumeration',
			'Implement after a privacy review',
		],
		sources: ['docs/engineering-live-context/owner-decisions-log.mdx'],
	},
];

const areaLabels: Record<JourneyArea | 'all', string> = {
	all: 'All journeys',
	discovery: 'Discovery',
	commerce: 'Commerce',
	identity: 'Identity',
	operations: 'Operations',
};

const statusLabels: Record<JourneyStatus | 'all', string> = {
	all: 'All statuses',
	implemented: 'Implemented',
	scaffolded: 'Scaffolded',
	planned: 'Planned',
	deferred: 'Deferred',
};

const lensLabels: Record<Lens, string> = {
	current: 'Current code',
	target: 'Target design',
	recovery: 'Failure recovery',
};

export function CommerceJourneyAtlas(): React.ReactNode {
	const [area, setArea] = useState<JourneyArea | 'all'>('all');
	const [statusFilter, setStatusFilter] = useState<JourneyStatus | 'all'>('all');
	const [selectedId, setSelectedId] = useState(journeys[0].id);
	const [lens, setLens] = useState<Lens>('current');
	const lensButtons = useRef<Array<HTMLButtonElement | null>>([]);
	const areaJourneys = useMemo(() => journeys.filter((journey) => area === 'all' || journey.area === area), [area]);
	const availableStatuses = (['scaffolded', 'planned', 'deferred'] as JourneyStatus[]).filter((status) =>
		areaJourneys.some((journey) => journey.status === status),
	);
	const effectiveStatus = statusFilter === 'all' || availableStatuses.includes(statusFilter) ? statusFilter : 'all';
	const visibleJourneys = areaJourneys.filter(
		(journey) => effectiveStatus === 'all' || journey.status === effectiveStatus,
	);
	const selectedJourney = visibleJourneys.find((journey) => journey.id === selectedId) ?? visibleJourneys[0];
	const lenses: Lens[] = ['current', 'target', 'recovery'];

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
			aria-label="Business and commerce journey atlas"
		>
			<div className={styles.filterRows}>
				<div>
					<span className={styles.filterLabel}>Journey area</span>
					<div
						className={styles.areaFilters}
						aria-label="Filter journeys by area"
					>
						{(['all', 'discovery', 'commerce', 'identity', 'operations'] as const).map((candidate) => (
							<button
								key={candidate}
								type="button"
								aria-pressed={area === candidate}
								className={area === candidate ? styles.activeFilter : styles.filter}
								onClick={() => setArea(candidate)}
							>
								{areaLabels[candidate]}
							</button>
						))}
					</div>
				</div>
				<div>
					<span className={styles.filterLabel}>Status</span>
					<div
						className={styles.areaFilters}
						aria-label="Filter journeys by status"
					>
						{(['all', ...availableStatuses] as Array<JourneyStatus | 'all'>).map((candidate) => (
							<button
								key={candidate}
								type="button"
								aria-pressed={effectiveStatus === candidate}
								className={effectiveStatus === candidate ? styles.activeFilter : styles.filter}
								onClick={() => setStatusFilter(candidate)}
							>
								{statusLabels[candidate]}
							</button>
						))}
					</div>
				</div>
			</div>

			<div className={styles.workspace}>
				<nav
					className={styles.journeyList}
					aria-label="Choose a journey"
				>
					{visibleJourneys.map((journey) => (
						<button
							key={journey.id}
							type="button"
							className={selectedJourney.id === journey.id ? styles.activeJourney : styles.journey}
							aria-current={selectedJourney.id === journey.id ? 'true' : undefined}
							onClick={() => setSelectedId(journey.id)}
						>
							<span>{areaLabels[journey.area]}</span>
							<strong>{journey.title}</strong>
							<small className={styles[journey.status]}>{statusLabels[journey.status]}</small>
						</button>
					))}
				</nav>

				<article className={styles.detail}>
					<header>
						<div>
							<span className={styles.eyebrow}>{areaLabels[selectedJourney.area]} journey</span>
							<h2>{selectedJourney.title}</h2>
						</div>
						<span className={styles[selectedJourney.status]}>{statusLabels[selectedJourney.status]}</span>
					</header>
					<p className={styles.summary}>{selectedJourney.summary}</p>

					<ol
						className={styles.timeline}
						aria-label="Journey stages"
					>
						{selectedJourney.steps.map((step, index) => (
							<li key={step}>
								<span>{String(index + 1).padStart(2, '0')}</span>
								<strong>{step}</strong>
							</li>
						))}
					</ol>

					<div
						className={styles.lensTabs}
						role="tablist"
						aria-label="Journey documentation lens"
					>
						{lenses.map((candidate, index) => (
							<button
								key={candidate}
								ref={(element) => {
									lensButtons.current[index] = element;
								}}
								type="button"
								role="tab"
								id={`journey-lens-${candidate}`}
								aria-controls="journey-lens-panel"
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
						id="journey-lens-panel"
						aria-labelledby={`journey-lens-${lens}`}
					>
						<span className={styles.eyebrow}>{lensLabels[lens]}</span>
						<p>{selectedJourney[lens]}</p>
					</div>

					<details className={styles.evidence}>
						<summary>Sources</summary>
						<ul>
							{selectedJourney.sources.map((source) => (
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
