/* ============================================================================
 * NEXT-GEN-UI · Frontend application atlas
 * What: filterable Storefront/Admin capability and state-ownership reference.
 * Why: a finished-looking screen can still lack real data and writes.
 * How: cards list each capability, its data source and its source files.
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
			name: 'Routing and server rendering',
			summary: 'File-based customer routes render through AnalogJS and the Nitro node-server preset.',
			status: 'implemented',
			runtime: 'Angular 22, AnalogJS and Nitro',
			data: 'Route components fetch their own query data.',
			sources: ['apps/storefront/src/app/pages', 'apps/storefront/vite.config.ts'],
		},
		{
			name: 'Catalogue listing',
			summary: 'Category pages, the home page, cards, search and old addresses read the catalogue API.',
			status: 'scaffolded',
			runtime: 'Collection pages and shop feature components',
			data: 'GET /catalog/* for catalogue responses. The category menu and attribute filters read JSON files.',
			sources: [
				'apps/storefront/src/app/data-access/services/product.service.ts',
				'apps/storefront/src/app/data-access/queries/product.queries.ts',
			],
			caution: 'Check the service behind a screen. Blog, tags and settings read JSON files.',
		},
		{
			name: 'Product detail',
			summary: 'The slug route, gallery, options, related products, questions and stock alerts are present.',
			status: 'scaffolded',
			runtime: 'Dynamic /<locale>/product/[slug] route',
			data: 'Product, gallery, relations and questions use the API. The review list reads a JSON file. Review submission and photo upload use the API.',
			sources: [
				'apps/storefront/src/app/pages/product/[slug].page.ts',
				'apps/storefront/src/app/features/shop/product-detail',
			],
		},
		{
			name: 'Client cart',
			summary: 'Cart actions, selectors, effects and browser persistence work in classic NgRx.',
			status: 'implemented',
			runtime: 'Classic NgRx store and effects',
			data: 'Browser state only. The storefront does not call the cart API.',
			sources: ['apps/storefront/src/app/core/state/cart', 'apps/storefront/src/app/features/shop/cart'],
			caution: 'This describes the browser cart. Its prices and totals are not authoritative.',
		},
		{
			name: 'Checkout and payment handoff',
			summary: 'The checkout forms and totals display exist. Order placement and payment do not.',
			status: 'scaffolded',
			runtime: 'Checkout page and feature composition',
			data: 'A static totals object. Placing an order only navigates to a detail page.',
			sources: [
				'apps/storefront/src/app/pages/checkout.page.ts',
				'apps/storefront/src/app/features/shop/checkout',
			],
			caution: 'No order, payment, stock reservation or shipping quote happens here.',
		},
		{
			name: 'Authentication and account',
			summary: 'Signup, sign-in, social sign-in, recovery and the account screens are routed.',
			status: 'scaffolded',
			runtime: 'Cookie auth gateway, SignalStore and account pages',
			data: 'Sign-in, profile, addresses, sign-in methods, sessions and contact changes use the API. Order, wallet, points, refund and notification screens read JSON files.',
			sources: [
				'apps/storefront/src/app/core/state/auth.store.ts',
				'apps/storefront/src/app/pages/auth',
				'apps/storefront/src/app/pages/account',
			],
		},
		{
			name: 'Languages',
			summary:
				'Every page is served under /en/ or /fr/, and the switcher links to the same page in the other language.',
			status: 'scaffolded',
			runtime: 'Transloco HTTP loader and locale routing',
			data: 'English and French dictionaries. Catalogue labels come from the API.',
			sources: ['apps/storefront/src/app/app.config.ts', 'apps/storefront/src/app/core/i18n'],
			caution: 'Bengali needs locale configuration and translated content.',
		},
		{
			name: 'PWA and offline catalogue and cart',
			summary: 'Offline catalogue and cart behaviour is planned. The PWA plugin is not in the build.',
			status: 'planned',
			runtime: 'Planned: Workbox through the Vite PWA integration',
			data: 'The build has no service worker or cache rules.',
			sources: ['apps/storefront/vite.config.ts', 'docs/engineering-live-context/owner-decisions-log.mdx'],
		},
	],
	admin: [
		{
			name: 'Application shell and lazy routing',
			summary:
				'The authenticated content shell, full-page shell, navigation, fallbacks and lazy feature routes work.',
			status: 'implemented',
			runtime: 'Angular Router and standalone lazy components',
			data: 'Route configuration and menu state are client-owned. Menu badges read a JSON file.',
			sources: ['apps/admin/src/app/app.routes.ts', 'apps/admin/src/app/routes', 'apps/admin/src/app/layout'],
		},
		{
			name: 'Dashboard and reporting widgets',
			summary: 'Counts, charts, tables and browser-only chart setup are assembled.',
			status: 'scaffolded',
			runtime: 'Dashboard feature and ApexCharts',
			data: 'Dashboard queries read JSON files.',
			sources: [
				'apps/admin/src/app/features/dashboard',
				'apps/admin/src/app/data-access/queries/dashboard.queries.ts',
			],
		},
		{
			name: 'Catalogue administration',
			summary: 'Product, category, attribute, tag, tax, shipping, store and currency screens and forms exist.',
			status: 'scaffolded',
			runtime: 'Lazy feature routes and reactive forms',
			data: 'The product form, redirects and add-on templates use the API. The other screens read JSON files and have no write path.',
			sources: [
				'apps/admin/src/app/features/product',
				'apps/admin/src/app/features/category',
				'apps/admin/src/app/data-access/queries',
			],
		},
		{
			name: 'Media and banners',
			summary: 'The media library, home banners, review moderation and the YouTube field are connected.',
			status: 'scaffolded',
			runtime: 'Media gateway, direct uploads and the media worker',
			data: 'API routes under /admin/media, plus direct uploads to Spaces.',
			sources: [
				'apps/admin/src/app/core/media',
				'apps/admin/src/app/features/media',
				'apps/admin/src/app/features/home-banners',
			],
		},
		{
			name: 'Customers',
			summary: 'List, create, edit, soft delete, recycle bin, restore and addresses are connected.',
			status: 'scaffolded',
			runtime: 'Customer gateway and reactive forms',
			data: 'API routes under /admin/customers. The customer ledger balance reads a JSON file.',
			sources: ['apps/admin/src/app/core/admin-customers', 'apps/admin/src/app/features/customer'],
		},
		{
			name: 'Order operations',
			summary: 'Order list, details, create-order, checkout, status, refund and ledger screens are routed.',
			status: 'scaffolded',
			runtime: 'Order feature family',
			data: 'JSON reads and client-side checkout totals. Placing an order has no backend.',
			sources: [
				'apps/admin/src/app/features/order',
				'apps/admin/src/app/features/order-status',
				'apps/admin/src/app/features/refund',
			],
		},
		{
			name: 'Operators, roles and sign-in',
			summary:
				'Password and PIN sign-in, recovery, invites, roles, operators and Account Security are connected.',
			status: 'scaffolded',
			runtime: 'Cookie auth gateway, guarded shells and routed forms',
			data: 'API routes under /auth/admin, /admin/users, /admin/roles and /admin/permissions.',
			sources: [
				'apps/admin/src/app/core/state/auth.store.ts',
				'apps/admin/src/app/core/admin-users',
				'apps/admin/src/app/core/admin-roles',
				'apps/admin/src/app/features/auth',
				'apps/admin/src/app/features/user',
				'apps/admin/src/app/features/role',
			],
		},
		{
			name: 'Content and engagement',
			summary: 'Blog, pages, FAQ, questions, notifications, coupons and theme settings have management screens.',
			status: 'scaffolded',
			runtime: 'Lazy feature families',
			data: 'FAQ, questions and notification settings use the API. Blog, pages, coupons and theme options read JSON files.',
			sources: [
				'apps/admin/src/app/features/blog',
				'apps/admin/src/app/features/page',
				'apps/admin/src/app/features/faq',
				'apps/admin/src/app/features/notification',
			],
		},
		{
			name: 'Server-backed writes',
			summary: 'Create, update, delete, approve, refund and bulk actions for the JSON-backed features.',
			status: 'planned',
			runtime: 'Planned: typed HTTP clients using shared contracts',
			data: 'These features have no write path.',
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
					<span className={styles.eyebrow}>Application atlas</span>
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
								<dt>Data source</dt>
								<dd>{item.data}</dd>
							</div>
						</dl>
						{item.caution ? <div className={styles.caution}>{item.caution}</div> : null}
						<details>
							<summary>Source files</summary>
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
		examples: 'Session, active menu state, loader state, UI settings.',
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
						<strong>Examples</strong>
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
