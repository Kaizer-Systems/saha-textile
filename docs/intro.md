---
title: Saha Textile Developer Portal
slug: /
description: Private developer portal for Saha Textile.
status: scaffolded
audience: [beginner, frontend, backend, operator]
last_verified: '2026-08-02'
source_of_truth:
    - docs/engineering-live-context/owner-decisions-log.mdx
    - apps/developer-portal/src
    - apps/developer-portal/plugins
    - packages/adapters-db-mongo/src/models
    - docs/_data/portal-manifest.json
    - docs/_data/instruments/first-flight.json
hide_title: true
hide_table_of_contents: true
---

import { ArchitectureReactor } from '@site/src/components/ArchitectureReactor';
import { MissionControl } from '@site/src/components/MissionControl';

<section className="portalHero portalHero--dashboard">
	<div className="portalHero__content">
		<p className="portalEyebrow">Private engineering system</p>
		<h1>Build, understand and operate Saha Textile.</h1>
		<div className="portalHero__lede">
			One evidence-linked home for application architecture, business behaviour, API and persistence boundaries, operational procedures and engineering decisions.
		</div>
		<div className="portalHero__actions">
			<a className="portalButton portalButton--primary" href="/getting-started/first-flight">Enter First Flight</a>
			<a className="portalButton portalButton--secondary" href="/getting-started/choose-your-path">Choose manually</a>
			<a className="portalButton portalButton--secondary" href="/architecture/system-overview">Explore architecture</a>
		</div>
	</div>
	<div className="portalHero__panel" aria-label="Portal foundation status">
		<div className="portalStatusHeader">
			<span>Latest milestone</span>
			<strong>First Flight · Launch Bay</strong>
		</div>
		<div className="portalSignalGrid">
			<div>
				<span>Request atlas</span>
				<strong>Implemented</strong>
			</div>
			<div>
				<span>Guided onboarding</span>
				<strong>Implemented</strong>
			</div>
			<div>
				<span>API reference</span>
				<strong>Scaffolded</strong>
			</div>
			<div>
				<span>DB catalogue</span>
				<strong>Scaffolded</strong>
			</div>
		</div>
	</div>
</section>

<ArchitectureReactor />

<MissionControl variant="teaser" />

<section className="portalDashboardSection">
	<div className="portalDashboardSection__heading">
		<p className="portalEyebrow">Backend platform atlas</p>
		<h2>Follow trust through every request boundary.</h2>
		<p>Compare current execution, ratified target architecture, and the proof required before a backend capability becomes production-ready.</p>
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
		<a className="portalPathCard" href="/database/schema-nebula">
			<span>Data · Explore</span>
			<h3>Schema Nebula</h3>
			<p>Navigate 64 physical collection targets, current model evidence, context clusters and decision gravity.</p>
		</a>
	</div>
</section>

<section className="portalDashboardSection">
	<div className="portalDashboardSection__heading">
		<p className="portalEyebrow">Business and commerce journeys</p>
		<h2>Follow intent across every boundary.</h2>
		<p>Compare current code, ratified target behavior, and failure recovery from discovery through fulfilment.</p>
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
		<h2>Choose a role-based onboarding route.</h2>
		<p>Each route provides an ordered reading and verification sequence for a distinct engineering responsibility.</p>
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
		<h2>Current implementation.</h2>
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
			<p>All 32 current Mongoose models plus their fields and indexes are source-generated into the scaffolded current-model catalogue.</p>
		</a>
	</div>
</section>

<section className="portalSurfaceGrid" aria-label="Scaffolded generated documentation surfaces">
	<div className="portalSurfaceNotice">
		<div>
			<span className="portalStatusPill" data-status="scaffolded">Scaffolded</span>
			<h2>Scalar API Reference</h2>
		</div>
		<p>The Request Wormhole publishes deterministic OpenAPI and Test Request, while complete operation semantics and promotion gates remain open.</p>
		<a href="/tools/scalar">Enter the bridge</a>
	</div>
	<div className="portalSurfaceNotice">
		<div>
			<span className="portalStatusPill" data-status="scaffolded">Scaffolded</span>
			<h2>Generated DB catalogue</h2>
		</div>
		<p>The Schema Observatory source-generates current models, fields and indexes without database access; target-only collections remain excluded.</p>
		<a href="/tools/database-catalogue">Enter the bridge</a>
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
			<strong>Ratified intent and tested behaviour remain visibly distinct</strong>
		</div>
		<a href="/governance/source-of-truth-and-freshness">Read the source-of-truth rules</a>
	</div>
</section>

<section className="portalNext">
	<a href="/getting-started/first-flight">Enter First Flight</a>
	<a href="/getting-started/choose-your-path">Choose your path</a>
	<a href="/governance/status-model">Understand statuses</a>
	<a href="/governance/contribution-standard">Contribute documentation</a>
</section>
