---
title: Saha Textile Developer Portal
slug: /
description: Private developer portal for Saha Textile.
status: scaffolded
audience: [beginner, frontend, backend, operator]
last_verified: '2026-11-07'
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

<section className="portalHero portalHero--dashboard">
	<div className="portalHero__content">
		<p className="portalEyebrow">Developer portal</p>
		<h1>Build, understand and operate Saha Textile.</h1>
		<div className="portalHero__lede">
			Architecture, business behaviour, API and database reference, and operating procedures for the Saha Textile platform.
		</div>
		<div className="portalHero__actions">
			<a className="portalButton portalButton--primary" href="/getting-started/first-flight">Start the guided tour</a>
			<a className="portalButton portalButton--secondary" href="/getting-started/choose-your-path">Choose a reading path</a>
			<a className="portalButton portalButton--secondary" href="/architecture/system-overview">Explore architecture</a>
		</div>
	</div>
</section>

<ArchitectureReactor />

<section className="portalDashboardSection">
	<div className="portalDashboardSection__heading">
		<p className="portalEyebrow">Backend platform atlas</p>
		<h2>Trace a request through the backend.</h2>
		<p>See how a request moves through validation, authorization, domain rules, ports and adapters.</p>
	</div>
	<div className="portalPathGrid" aria-label="Backend platform documentation">
		<a className="portalPathCard" href="/backend/overview">
			<span>Backend · Explore</span>
			<h3>Interactive request atlas</h3>
			<p>Explore catalogue, commerce, identity, operations and platform request paths.</p>
		</a>
		<a className="portalPathCard" href="/backend/security-and-identity">
			<span>Security · Enforce</span>
			<h3>Sessions and authorization</h3>
			<p>Cookie sessions, CSRF, audiences, permissions, ownership, PIN and OTP.</p>
		</a>
		<a className="portalPathCard" href="/api/route-inventory">
			<span>API · Inspect</span>
			<h3>Route inventory</h3>
			<p>Every API route with its access rule.</p>
		</a>
	<a className="portalPathCard" href="/database/schema-nebula">
		<span>Data · Explore</span>
		<h3>Schema Nebula</h3>
		<p>Explore existing and planned collections and their relationships.</p>
	</a>
	</div>
</section>

<section className="portalDashboardSection">
	<div className="portalDashboardSection__heading">
		<p className="portalEyebrow">Business and commerce journeys</p>
		<h2>Follow a customer journey end to end.</h2>
		<p>Discovery, cart, checkout, payment, returns, identity and failure recovery.</p>
	</div>
	<div className="portalPathGrid" aria-label="Business and commerce documentation">
		<a className="portalPathCard" href="/business-flows/overview">
			<span>Journey · Explore</span>
			<h3>Interactive journey atlas</h3>
			<p>Select a journey and compare existing code, target design and failure recovery.</p>
		</a>
		<a className="portalPathCard" href="/business-flows/cart-and-intent">
			<span>Cart · Reconcile</span>
			<h3>Guest cart and intent</h3>
			<p>Guest carts, sign-in merge and resuming an interrupted action.</p>
		</a>
		<a className="portalPathCard" href="/business-flows/checkout">
			<span>Checkout · Calculate</span>
			<h3>Pricing and shipping</h3>
			<p>INR pricing, promotions, tax, currency, shipping and corrections.</p>
		</a>
		<a className="portalPathCard" href="/business-flows/failure-recovery-and-debugging">
			<span>Failure · Recover</span>
			<h3>Debug a journey</h3>
			<p>Symptoms, what to check first, and recovery principles.</p>
		</a>
	</div>
</section>

<section className="portalDashboardSection">
	<div className="portalDashboardSection__heading">
		<p className="portalEyebrow">Frontend application atlas</p>
		<h2>Find your way around the Angular applications.</h2>
		<p>Follow routes and state ownership, then use a contributor recipe to make a change.</p>
	</div>
	<div className="portalPathGrid" aria-label="Frontend application documentation">
		<a className="portalPathCard" href="/storefront/application-atlas">
			<span>Storefront · Explore</span>
			<h3>Customer application atlas</h3>
			<p>Server rendering, catalogue, cart, checkout, account and languages.</p>
		</a>
		<a className="portalPathCard" href="/admin/application-atlas">
			<span>Admin · Explore</span>
			<h3>Operator application atlas</h3>
			<p>Lazy features, forms, tables, queries and permissions.</p>
		</a>
		<a className="portalPathCard" href="/frontend/engineering-system">
			<span>Shared · Decide</span>
			<h3>State ownership lab</h3>
			<p>Choose queries, SignalStore, classic NgRx or local state from the data owner.</p>
		</a>
		<a className="portalPathCard" href="/frontend/quality-and-definition-of-done">
			<span>Quality · Verify</span>
			<h3>Definition of done</h3>
			<p>Architecture, behaviour, rendering and accessibility checks.</p>
		</a>
	</div>
</section>

<section className="portalDashboardSection">
	<div className="portalDashboardSection__heading">
		<p className="portalEyebrow">Role-based entry</p>
		<h2>Choose a reading path for your role.</h2>
		<p>Each path gives an ordered reading list and the checks to run.</p>
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
			<p>Angular routes, UI state, server state and components.</p>
		</a>
		<a className="portalPathCard" href="/getting-started/backend-path">
			<span>03 · Integrate</span>
			<h3>Backend developer</h3>
			<p>Contracts, domain ports, NestJS composition and persistence adapters.</p>
		</a>
		<a className="portalPathCard" href="/getting-started/operator-path">
			<span>04 · Operate</span>
			<h3>Platform operator</h3>
			<p>Deployment, runtime, recovery and troubleshooting.</p>
		</a>
	</div>
</section>

<section className="portalDashboardSection">
	<div className="portalDashboardSection__heading">
		<p className="portalEyebrow">Generated references</p>
		<h2>Look something up.</h2>
		<p>These references are generated from the source code.</p>
	</div>
	<div className="portalPathGrid" aria-label="Generated references">
		<a className="portalPathCard" href="/tools/scalar">
			<span>API · Reference</span>
			<h3>Scalar</h3>
			<p>HTTP operations and test requests.</p>
		</a>
		<a className="portalPathCard" href="/tools/database-catalogue">
			<span>Data · Reference</span>
			<h3>Database catalogue</h3>
			<p>Models, fields and indexes.</p>
		</a>
		<a className="portalPathCard" href="/tools/storybook">
			<span>UI · Reference</span>
			<h3>Storybook</h3>
			<p>Storefront, admin and shared components.</p>
		</a>
		<a className="portalPathCard" href="/tools/typedoc">
			<span>Types · Reference</span>
			<h3>TypeDoc</h3>
			<p>Exported contracts and ports.</p>
		</a>
	</div>
</section>

<section className="portalNext">
	<a href="/getting-started/first-flight">Start the guided tour</a>
	<a href="/getting-started/choose-your-path">Choose your path</a>
	<a href="/governance/status-model">Page statuses</a>
	<a href="/governance/contribution-standard">Writing standard</a>
</section>
