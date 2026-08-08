/* ============================================================================
 * NEXT-GEN-UI · Frontend application atlas
 * What: filterable Storefront/Admin capability and state-ownership reference.
 * Why: routed visual completeness must remain distinct from real data and writes.
 * How: deterministic evidence cards render source-linked application facts.
 * Tuning knobs: capability copy, status filters, caution text, and search labels.
 * ========================================================================= */

import React, { useMemo, useRef, useState } from 'react';

import styles from './styles.module.css';

type Application = 'storefront' | 'admin';
type LifecycleStatus = 'implemented' | 'scaffolded' | 'planned' | 'deferred' | 'deprecated';

type AtlasItem = {
	name: string;
	summary: string;
	status: LifecycleStatus;
	runtime: string;
	data: string;
	sources: string[];
	caution?: string;
};

const statusOrder: LifecycleStatus[] = ['implemented', 'scaffolded', 'planned', 'deferred', 'deprecated'];

const atlases: Record<Application, AtlasItem[]> = {
	storefront: [
		{
			name: 'Analog routing and dynamic SSR',
			summary: 'File-based customer routes render through AnalogJS and the Nitro node-server preset.',
			status: 'implemented',
			runtime: 'Angular 21 + AnalogJS + Nitro',
			data: 'Route components fetch their own query data.',
			sources: ['apps/storefront/src/app/pages', 'apps/storefront/vite.config.ts'],
		},
		{
			name: 'Catalogue listing',
			summary:
				'The collection path has an API-backed catalogue query seam while adjacent catalogue readers still use JSON data.',
			status: 'scaffolded',
			runtime: 'Collection pages + shop feature components',
			data: 'GET /api/products for catalogue responses; JSON remains for legacy-shaped readers.',
			sources: [
				'apps/storefront/src/app/data-access/services/product.service.ts',
				'apps/storefront/src/app/data-access/queries/product.queries.ts',
			],
			caution: 'Do not describe the whole catalogue as API-backed yet.',
		},
		{
			name: 'Product detail',
			summary: 'The slug route, detail composition, related products, reviews, and questions are present.',
			status: 'scaffolded',
			runtime: 'Dynamic /en/product/[slug] route',
			data: 'Product, review, and question readers are still based on mock JSON collections.',
			sources: [
				'apps/storefront/src/app/pages/en/product/[slug].page.ts',
				'apps/storefront/src/app/features/shop/product-detail',
			],
		},
		{
			name: 'Client cart',
			summary:
				'Cart mutations, selectors, effects, optimistic changes, and browser persistence are implemented in classic NgRx.',
			status: 'implemented',
			runtime: 'Classic NgRx store/effects',
			data: 'Client-owned mock cart; server cart reconciliation is not implemented.',
			sources: ['apps/storefront/src/app/core/state/cart', 'apps/storefront/src/app/features/shop/cart'],
			caution: 'Implemented describes the current client behavior, not the future authenticated server cart.',
		},
		{
			name: 'Checkout and payment handoff',
			summary:
				'The checkout composition and totals experience exist, but order placement and payment execution do not.',
			status: 'scaffolded',
			runtime: 'Checkout page and feature composition',
			data: 'Client-computed mock totals and navigation-only completion seams.',
			sources: [
				'apps/storefront/src/app/pages/checkout.page.ts',
				'apps/storefront/src/app/features/shop/checkout',
			],
			caution: 'No production checkout, payment, inventory reservation, or order transaction is implied.',
		},
		{
			name: 'Authentication and account',
			summary:
				'Login, registration, OTP, recovery, account, address, order, wallet, and refund screens are routed.',
			status: 'scaffolded',
			runtime: 'Cookie auth gateway + SignalStore + account pages',
			data: 'Cookie-session login, OTP, recovery and email-verification flows are connected; several account readers remain JSON-backed.',
			sources: [
				'apps/storefront/src/app/core/state/auth.store.ts',
				'apps/storefront/src/app/pages/auth',
				'apps/storefront/src/app/pages/account',
			],
		},
		{
			name: 'Internationalization',
			summary: 'Transloco loading and runtime language switching are wired.',
			status: 'scaffolded',
			runtime: 'Transloco HTTP loader',
			data: 'The current code advertises en/fr; the active locale set is deployment configuration, not a contract enum.',
			sources: ['apps/storefront/src/app/app.config.ts', 'apps/storefront/src/app/core/i18n/transloco-loader.ts'],
			caution:
				'Runtime locale configuration and content coverage must enable Bengali before support is implemented.',
		},
		{
			name: 'PWA and offline catalogue/cart',
			summary:
				'Offline catalogue and cart behavior remain a ratified target, but the Vite PWA plugin is not wired in the current configuration.',
			status: 'planned',
			runtime: 'Target: Workbox through the Vite PWA integration',
			data: 'Caching and update policies are not yet implemented.',
			sources: ['apps/storefront/vite.config.ts', 'docs/engineering-live-context/owner-decisions-log.mdx'],
		},
	],
	admin: [
		{
			name: 'Application shell and lazy routing',
			summary:
				'The authenticated content shell, full-page shell, navigation, fallbacks, and feature-level lazy routes are implemented.',
			status: 'implemented',
			runtime: 'Angular Router + standalone lazy components',
			data: 'Route configuration and menu state are client-owned.',
			sources: ['apps/admin/src/app/app.routes.ts', 'apps/admin/src/app/routes', 'apps/admin/src/app/layout'],
		},
		{
			name: 'Dashboard and reporting widgets',
			summary: 'Counts, charts, tables, and browser-only chart setup are assembled.',
			status: 'scaffolded',
			runtime: 'Dashboard feature + ApexCharts',
			data: 'Dashboard queries read static JSON responses.',
			sources: [
				'apps/admin/src/app/features/dashboard',
				'apps/admin/src/app/data-access/queries/dashboard.queries.ts',
			],
		},
		{
			name: 'Catalogue administration',
			summary:
				'Product, category, attribute, tag, media, tax, shipping, store, and currency screens and forms exist.',
			status: 'scaffolded',
			runtime: 'Lazy feature routes + reactive forms',
			data: 'List/detail readers use JSON; mutations remain explicit mock seams.',
			sources: [
				'apps/admin/src/app/features/product',
				'apps/admin/src/app/features/category',
				'apps/admin/src/app/data-access/queries',
			],
		},
		{
			name: 'Order operations',
			summary:
				'Order list, details, create-order, checkout, status, refund, and customer-ledger surfaces are routed.',
			status: 'scaffolded',
			runtime: 'Order feature family',
			data: 'JSON-backed reads and client-side checkout totals; order placement is not connected.',
			sources: [
				'apps/admin/src/app/features/order',
				'apps/admin/src/app/features/order-status',
				'apps/admin/src/app/features/refund',
			],
		},
		{
			name: 'Users, roles, and administrative authentication',
			summary: 'User and role management screens plus password/PIN login and recovery routes are present.',
			status: 'scaffolded',
			runtime: 'Cookie auth gateway + guarded shells + routed forms',
			data: 'Admin authentication and API authorization are connected; management records remain JSON-backed and role-assignment API wiring is incomplete.',
			sources: [
				'apps/admin/src/app/core/state/auth.store.ts',
				'apps/admin/src/app/features/auth',
				'apps/admin/src/app/features/user',
				'apps/admin/src/app/features/role',
			],
		},
		{
			name: 'Content and engagement',
			summary:
				'Blog, pages, FAQs, reviews, questions, notifications, coupons, and theme settings have routed management surfaces.',
			status: 'scaffolded',
			runtime: 'Lazy feature families',
			data: 'JSON-backed reads with unconnected mutations.',
			sources: [
				'apps/admin/src/app/features/blog',
				'apps/admin/src/app/features/page',
				'apps/admin/src/app/features/faq',
				'apps/admin/src/app/features/review',
			],
		},
		{
			name: 'Server-backed mutations',
			summary:
				'Create, update, delete, approve, publish, refund, and bulk-operation contracts will replace the current UI seams.',
			status: 'planned',
			runtime: 'Target: typed HTTP clients consuming shared contracts',
			data: 'Backend endpoints and write queries are not yet wired to the admin.',
			sources: ['apps/admin/src/app/data-access/services', 'packages/contracts'],
		},
	],
};

const labels: Record<LifecycleStatus | 'all', string> = {
	all: 'All',
	implemented: 'Implemented',
	scaffolded: 'Scaffolded',
	planned: 'Planned',
	deferred: 'Deferred',
	deprecated: 'Deprecated',
};

export function ApplicationAtlas({ application }: { application: Application }): React.ReactNode {
	const [status, setStatus] = useState<LifecycleStatus | 'all'>('all');
	const [query, setQuery] = useState('');
	const items = atlases[application];
	const availableStatuses = statusOrder.filter((candidate) => items.some((item) => item.status === candidate));

	const visibleItems = useMemo(() => {
		const normalizedQuery = query.trim().toLocaleLowerCase('en');
		return items.filter((item) => {
			const matchesStatus = status === 'all' || item.status === status;
			const searchable = `${item.name} ${item.summary} ${item.runtime} ${item.data}`.toLocaleLowerCase('en');
			return matchesStatus && (!normalizedQuery || searchable.includes(normalizedQuery));
		});
	}, [items, query, status]);

	return (
		<section
			className={styles.atlas}
			aria-label={`${application} implementation atlas`}
		>
			<div className={styles.summaryGrid}>
				<div>
					<span className={styles.eyebrow}>Verified application atlas</span>
					<strong>{items.length} capability areas</strong>
				</div>
				{availableStatuses.map((candidate) => (
					<div key={candidate}>
						<span className={styles.eyebrow}>{labels[candidate]}</span>
						<strong>{items.filter((item) => item.status === candidate).length}</strong>
					</div>
				))}
			</div>

			<div className={styles.controls}>
				<div
					className={styles.filterGroup}
					aria-label="Filter by implementation status"
				>
					{(['all', ...availableStatuses] as const).map((candidate) => (
						<button
							key={candidate}
							type="button"
							className={status === candidate ? styles.activeFilter : styles.filter}
							aria-pressed={status === candidate}
							onClick={() => setStatus(candidate)}
						>
							{labels[candidate]}
						</button>
					))}
				</div>
				<label className={styles.searchLabel}>
					<span>Search the atlas</span>
					<input
						type="search"
						value={query}
						onChange={(event) => setQuery(event.currentTarget.value)}
						placeholder="Try routing, cart, forms…"
					/>
				</label>
			</div>

			<p
				className={styles.resultCount}
				aria-live="polite"
			>
				Showing {visibleItems.length} of {items.length} capability areas
			</p>

			<div className={styles.cards}>
				{visibleItems.map((item) => (
					<article
						className={styles.card}
						key={item.name}
					>
						<div className={styles.cardHeader}>
							<h3>{item.name}</h3>
							<span className={styles[item.status]}>{labels[item.status]}</span>
						</div>
						<p>{item.summary}</p>
						<dl>
							<div>
								<dt>Runtime</dt>
								<dd>{item.runtime}</dd>
							</div>
							<div>
								<dt>Data boundary</dt>
								<dd>{item.data}</dd>
							</div>
						</dl>
						{item.caution ? <div className={styles.caution}>{item.caution}</div> : null}
						<details>
							<summary>Evidence paths</summary>
							<ul>
								{item.sources.map((source) => (
									<li key={source}>
										<code>{source}</code>
									</li>
								))}
							</ul>
						</details>
					</article>
				))}
			</div>
		</section>
	);
}

type Decision = {
	label: string;
	tool: string;
	why: string;
	examples: string;
	avoid: string;
};

const decisions: Decision[] = [
	{
		label: 'Server-owned data',
		tool: 'TanStack Angular Query',
		why: 'The server owns freshness, caching, retries, and invalidation.',
		examples: 'Product lists, order detail, countries, dashboard statistics.',
		avoid: 'Do not copy remote collections into a long-lived UI store without a specific offline or mutation requirement.',
	},
	{
		label: 'Local feature or shell state',
		tool: 'NgRx SignalStore or a local signal',
		why: 'The browser owns compact state that is read reactively by a feature or shell.',
		examples: 'Session seam, active menu state, loader state, UI settings.',
		avoid: 'Do not introduce effects and reducers for a value that never leaves one component.',
	},
	{
		label: 'Heavily mutated client workflow',
		tool: 'Classic NgRx store + effects',
		why: 'The workflow benefits from explicit events, selectors, optimistic transitions, and persistence boundaries.',
		examples: 'Storefront cart, wishlist, and compare state.',
		avoid: 'Do not use it as the default for read-only server collections.',
	},
];

export function FrontendDecisionLab(): React.ReactNode {
	const [active, setActive] = useState(0);
	const decisionButtons = useRef<Array<HTMLButtonElement | null>>([]);
	const decision = decisions[active];
	const selectDecision = (index: number) => {
		setActive(index);
		decisionButtons.current[index]?.focus();
	};
	const handleDecisionKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
		let nextIndex: number | undefined;
		if (event.key === 'ArrowRight') nextIndex = (index + 1) % decisions.length;
		if (event.key === 'ArrowLeft') nextIndex = (index - 1 + decisions.length) % decisions.length;
		if (event.key === 'Home') nextIndex = 0;
		if (event.key === 'End') nextIndex = decisions.length - 1;
		if (nextIndex === undefined) return;
		event.preventDefault();
		selectDecision(nextIndex);
	};

	return (
		<section
			className={styles.decisionLab}
			aria-label="Frontend state ownership decision guide"
		>
			<div
				className={styles.decisionTabs}
				role="tablist"
				aria-label="Choose a state shape"
			>
				{decisions.map((candidate, index) => (
					<button
						key={candidate.label}
						ref={(element) => {
							decisionButtons.current[index] = element;
						}}
						type="button"
						role="tab"
						id={`state-decision-tab-${index}`}
						aria-controls="state-decision-panel"
						aria-selected={active === index}
						tabIndex={active === index ? 0 : -1}
						className={active === index ? styles.activeDecision : styles.decision}
						onClick={() => setActive(index)}
						onKeyDown={(event) => handleDecisionKeyDown(event, index)}
					>
						{candidate.label}
					</button>
				))}
			</div>
			<div
				className={styles.decisionPanel}
				role="tabpanel"
				id="state-decision-panel"
				aria-labelledby={`state-decision-tab-${active}`}
			>
				<span className={styles.eyebrow}>Recommended owner</span>
				<h3>{decision.tool}</h3>
				<p>{decision.why}</p>
				<div className={styles.decisionGrid}>
					<div>
						<strong>Current examples</strong>
						<p>{decision.examples}</p>
					</div>
					<div>
						<strong>Avoid</strong>
						<p>{decision.avoid}</p>
					</div>
				</div>
			</div>
		</section>
	);
}
