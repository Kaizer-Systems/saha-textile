---
title: Saha Textile Developer Portal
slug: /
description: Private developer portal for Saha Textile.
status: scaffolded
audience: [beginner, frontend, backend, operator]
last_verified: '2026-07-18'
source_of_truth:
    - project-context/angular-context/private-developer-portal-documentation-plan.md
    - project-context/angular-context/developer-portal-scalar-visual-baseline.md
    - project-context/angular-context/developer-portal-pass-2-frontend-atlas.md
    - project-context/angular-context/developer-portal-pass-3-commerce-journeys.md
    - project-context/angular-context/developer-portal-pass-4-backend-platform-atlas.md
hide_title: true
hide_table_of_contents: true
---

<section className="portalHero portalHero--dashboard">
	<div className="portalHero__content">
		<p className="portalEyebrow">Private engineering system</p>
		<h1>Build, understand and operate Saha Textile.</h1>
		<div className="portalHero__lede">
			One evidence-linked home for application architecture, business behaviour, API and persistence boundaries, operational procedures and engineering decisions.
		</div>
		<div className="portalHero__actions">
			<a className="portalButton portalButton--primary" href="/getting-started/choose-your-path">Choose your path</a>
			<a className="portalButton portalButton--secondary" href="/architecture/system-overview">Explore architecture</a>
		</div>
	</div>
	<div className="portalHero__panel" aria-label="Portal foundation status">
		<div className="portalStatusHeader">
			<span>Documentation release</span>
			<strong>Backend platform atlas · Pass 4</strong>
		</div>
		<div className="portalSignalGrid">
			<div>
				<span>Request atlas</span>
				<strong>Implemented</strong>
			</div>
			<div>
				<span>Risk map</span>
				<strong>Implemented</strong>
			</div>
			<div>
				<span>API reference</span>
				<strong>Deferred</strong>
			</div>
			<div>
				<span>DB catalogue</span>
				<strong>Deferred</strong>
			</div>
		</div>
	</div>
</section>

<section className="portalDashboardSection">
	<div className="portalDashboardSection__heading">
		<p className="portalEyebrow">Backend platform atlas</p>
		<h2>Follow trust through every request boundary.</h2>
		<p>Compare current execution, locked target architecture and the proof required before a backend capability becomes production-ready.</p>
	</div>
	<div className="portalPathGrid" aria-label="Backend platform documentation">
		<a className="portalPathCard" href="/backend/overview">
			<span>Backend · Explore</span>
			<h3>Interactive request atlas</h3>
			<p>Filter catalogue, commerce, identity, operations and platform paths by current risk.</p>
		</a>
		<a className="portalPathCard" href="/backend/security-and-identity">
			<span>Security · Enforce</span>
			<h3>Sessions and authorization</h3>
			<p>Cookie target, CSRF, audiences, permissions, object ownership, PIN and OTP boundaries.</p>
		</a>
		<a className="portalPathCard" href="/api/route-inventory">
			<span>API · Inspect</span>
			<h3>Current route inventory</h3>
			<p>Every present controller route, existing control and missing production guarantee.</p>
		</a>
		<a className="portalPathCard" href="/database/current-adapter-map">
			<span>Data · Trace</span>
			<h3>Mongo adapter map</h3>
			<p>Models, indexes, repositories, mappings, seeds and the transaction/catalogue triggers.</p>
		</a>
	</div>
</section>

<section className="portalDashboardSection">
	<div className="portalDashboardSection__heading">
		<p className="portalEyebrow">Business and commerce journeys</p>
		<h2>Follow intent across every boundary.</h2>
		<p>Compare current code, locked target behavior and failure recovery from discovery through fulfilment.</p>
	</div>
	<div className="portalPathGrid" aria-label="Business and commerce documentation">
		<a className="portalPathCard" href="/business-flows/overview">
			<span>Journey · Explore</span>
			<h3>Interactive journey atlas</h3>
			<p>Select discovery, commerce, identity or operations and switch evidence lenses.</p>
		</a>
		<a className="portalPathCard" href="/business-flows/cart-and-intent">
			<span>Cart · Reconcile</span>
			<h3>Guest cart and intent</h3>
			<p>Offline queue, server authority, authentication merge and safe replay.</p>
		</a>
		<a className="portalPathCard" href="/business-flows/checkout">
			<span>Checkout · Calculate</span>
			<h3>Pricing and shipping</h3>
			<p>INR canonical price, promotions, tax, FX, quote and correction paths.</p>
		</a>
		<a className="portalPathCard" href="/business-flows/failure-recovery-and-debugging">
			<span>Failure · Recover</span>
			<h3>Debug by invariant</h3>
			<p>Trace identity, contract, version, domain and adapter evidence safely.</p>
		</a>
	</div>
</section>

<section className="portalDashboardSection">
	<div className="portalDashboardSection__heading">
		<p className="portalEyebrow">Frontend application atlas</p>
		<h2>Trace the code before changing it.</h2>
		<p>Filter real capability boundaries, follow routes and state ownership, then use a contributor recipe to make the change safely.</p>
	</div>
	<div className="portalPathGrid" aria-label="Frontend application documentation">
		<a className="portalPathCard" href="/storefront/application-atlas">
			<span>Storefront · Explore</span>
			<h3>Customer application atlas</h3>
			<p>Dynamic SSR, catalogue, cart, checkout, account, language and PWA boundaries.</p>
		</a>
		<a className="portalPathCard" href="/admin/application-atlas">
			<span>Admin · Explore</span>
			<h3>Operator application atlas</h3>
			<p>Lazy features, forms, tables, queries, permissions and mock mutation seams.</p>
		</a>
		<a className="portalPathCard" href="/frontend/engineering-system">
			<span>Shared · Decide</span>
			<h3>State ownership lab</h3>
			<p>Choose queries, SignalStore, classic NgRx or local state from the data owner.</p>
		</a>
		<a className="portalPathCard" href="/frontend/quality-and-definition-of-done">
			<span>Quality · Verify</span>
			<h3>Definition of done</h3>
			<p>Architecture, behavior, rendering, accessibility and evidence checks.</p>
		</a>
	</div>
</section>

<section className="portalDashboardSection">
	<div className="portalDashboardSection__heading">
		<p className="portalEyebrow">Role-based entry</p>
		<h2>Start with the work in front of you.</h2>
		<p>Each path narrows the portal into an ordered reading and verification sequence for one kind of maintainer.</p>
	</div>
	<div className="portalPathGrid" aria-label="Developer portal entry paths">
		<a className="portalPathCard" href="/getting-started/beginner-path">
			<span>01 · Learn</span>
			<h3>New to the project</h3>
			<p>Vocabulary, applications, architecture and a safe first contribution.</p>
		</a>
		<a className="portalPathCard" href="/getting-started/frontend-path">
			<span>02 · Build</span>
			<h3>Frontend developer</h3>
			<p>Angular routes, UI state, server state and component boundaries.</p>
		</a>
		<a className="portalPathCard" href="/getting-started/backend-path">
			<span>03 · Integrate</span>
			<h3>Backend developer</h3>
			<p>Contracts, domain ports, NestJS composition and persistence adapters.</p>
		</a>
		<a className="portalPathCard" href="/getting-started/operator-path">
			<span>04 · Operate</span>
			<h3>Platform operator</h3>
			<p>Deployment, runtime evidence, recovery and troubleshooting.</p>
		</a>
	</div>
</section>

<section className="portalDashboardSection">
	<div className="portalDashboardSection__heading">
		<p className="portalEyebrow">Implementation radar</p>
		<h2>What exists today.</h2>
		<p>Status describes repository evidence, not ambition. Open a page to see its verification date and source paths.</p>
	</div>
	<div className="portalImplementationGrid" role="list" aria-label="Platform implementation status">
		<a href="/storefront/application-atlas" className="portalImplementationItem" role="listitem">
			<span className="portalStatusPill" data-status="scaffolded">Scaffolded</span>
			<strong>Storefront</strong>
			<p>Analog pages, client state and an evolving server-side catalogue boundary.</p>
		</a>
		<a href="/admin/application-atlas" className="portalImplementationItem" role="listitem">
			<span className="portalStatusPill" data-status="scaffolded">Scaffolded</span>
			<strong>Admin</strong>
			<p>Broad Angular feature surface with development-data service boundaries.</p>
		</a>
		<a href="/backend/overview" className="portalImplementationItem" role="listitem">
			<span className="portalStatusPill" data-status="scaffolded">Scaffolded</span>
			<strong>API</strong>
			<p>NestJS modules, controllers and OpenAPI exist; production completeness is not claimed.</p>
		</a>
		<a href="/database/overview" className="portalImplementationItem" role="listitem">
			<span className="portalStatusPill" data-status="scaffolded">Scaffolded</span>
			<strong>Mongo adapter</strong>
			<p>Models, indexes, mappers and repositories exist; generated portal pages do not.</p>
		</a>
	</div>
</section>

<section className="portalSurfaceGrid" aria-label="Deferred generated documentation surfaces">
	<div className="portalSurfaceNotice">
		<div>
			<span className="portalStatusPill" data-status="deferred">Deferred</span>
			<h2>Scalar API Reference</h2>
		</div>
		<p>The API produces OpenAPI, but the locked portal route and interactive Scalar surface are not wired yet. The existing framework UI is transitional.</p>
		<a href="/api/overview">See the exact boundary</a>
	</div>
	<div className="portalSurfaceNotice">
		<div>
			<span className="portalStatusPill" data-status="deferred">Deferred</span>
			<h2>Generated DB catalogue</h2>
		</div>
		<p>The Mongo adapter has real models and indexes. Automated collection, field, index and DTO mapping pages remain to be generated.</p>
		<a href="/database/overview">See the generation trigger</a>
	</div>
</section>

<section className="portalProvenancePanel">
	<div>
		<p className="portalEyebrow">Documentation contract</p>
		<h2>Evidence before confidence.</h2>
	</div>
	<div className="portalProvenancePanel__facts">
		<div>
			<span>Required on every page</span>
			<strong>Status · audience · verification date · sources</strong>
		</div>
		<div>
			<span>Content validation</span>
			<strong>Metadata and terminology boundaries enforced before build</strong>
		</div>
		<div>
			<span>Conflict handling</span>
			<strong>Locked intent and tested behaviour are reconciled explicitly</strong>
		</div>
		<a href="/governance/source-of-truth-and-freshness">Read the source-of-truth rules</a>
	</div>
</section>

<section className="portalNext">
	<a href="/getting-started/choose-your-path">Choose your path</a>
	<a href="/governance/status-model">Understand statuses</a>
	<a href="/governance/contribution-standard">Contribute documentation</a>
</section>
