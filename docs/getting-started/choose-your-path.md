---
title: Choose Your Path
description: Select the shortest reliable onboarding route for your role.
status: implemented
audience: [beginner, frontend, backend, operator]
last_verified: '2026-08-22'
source_of_truth:
    - docs/engineering-live-context/owner-decisions-log.mdx
    - docs/engineering-live-context/execution-roadmap.mdx
    - docs/_data/portal-manifest.json
    - docs/_data/instruments/first-flight.json
---

# Choose your path

The portal is organized around role-specific entry routes rather than a required front-to-back reading order. Each route provides an ordered reading list, relevant source areas, verification commands, and clear escalation boundaries.

<section className="portalSurfaceNotice">
	<div>
		<span className="portalStatusPill" data-status="scaffolded">Guided mode</span>
		<h2>Prefer a mission briefing?</h2>
	</div>
	<p>First Flight turns these four paths into an interactive Launch Bay with verified checkpoints, lifecycle telemetry and a role-specific outcome.</p>
	<a href="/getting-started/first-flight">Enter First Flight</a>
</section>

<section className="portalPathGrid" aria-label="Developer onboarding paths">
	<a className="portalPathCard" href="/getting-started/beginner-path">
		<span>01 · Learn</span>
		<h2>New to the project</h2>
		<p>Understand the vocabulary, applications, dependency rule and safe first-day workflow.</p>
	</a>
	<a className="portalPathCard" href="/getting-started/frontend-path">
		<span>02 · Build</span>
		<h2>Frontend developer</h2>
		<p>Enter through the Angular applications, routes, UI state, query boundaries and component work.</p>
	</a>
	<a className="portalPathCard" href="/getting-started/backend-path">
		<span>03 · Integrate</span>
		<h2>Backend developer</h2>
		<p>Follow contracts into NestJS, the domain ports, adapters, OpenAPI and persistence.</p>
	</a>
	<a className="portalPathCard" href="/getting-started/operator-path">
		<span>04 · Operate</span>
		<h2>Platform operator</h2>
		<p>Find deployment, runtime, recovery and troubleshooting material without reading application internals first.</p>
	</a>
</section>

## The universal first five minutes

Regardless of role:

1. Read the page status and provenance strip before trusting instructions.
2. Confirm that the page's **Verified** date is appropriate for the risk of the work.
3. Follow links to source files rather than guessing implementation details.
4. Treat a **Planned** or **Deferred** page as approved intent—not working software.
5. If code, runtime behaviour and this portal disagree, stop and follow the conflict rule in [Source of Truth and Freshness](/governance/source-of-truth-and-freshness).

## What the portal does not do

The portal explains the system; it does not replace source control, tests, runtime verification, generated OpenAPI, database validators, or deployment evidence. It provides a structured path to those authorities and the context required to interpret them.
