---
title: Choose Your Path
description: Select the reading path for your role.
status: implemented
audience: [beginner, frontend, backend, operator]
last_verified: '2026-11-07'
source_of_truth:
    - docs/engineering-live-context/owner-decisions-log.mdx
    - docs/engineering-live-context/execution-roadmap.mdx
    - docs/_data/portal-manifest.json
    - docs/_data/instruments/first-flight.json
---

# Choose your path

The portal offers one reading route per role. Each route gives an ordered reading list, the relevant source areas and the checks to run.

<section className="portalSurfaceNotice">
	<div>
		<span className="portalStatusPill" data-status="scaffolded">Guided mode</span>
		<h2>Prefer a guided tour?</h2>
	</div>
	<p>First Flight presents these four routes as an interactive tour with checkpoints on each page.</p>
	<a href="/getting-started/first-flight">Open First Flight</a>
</section>

<section className="portalPathGrid" aria-label="Developer onboarding paths">
	<a className="portalPathCard" href="/getting-started/beginner-path">
		<span>01 · Learn</span>
		<h2>New to the project</h2>
		<p>Learn the vocabulary, applications, dependency rule and a safe first change.</p>
	</a>
	<a className="portalPathCard" href="/getting-started/frontend-path">
		<span>02 · Build</span>
		<h2>Frontend developer</h2>
		<p>Start with the Angular applications, routes, state and component work.</p>
	</a>
	<a className="portalPathCard" href="/getting-started/backend-path">
		<span>03 · Integrate</span>
		<h2>Backend developer</h2>
		<p>Follow contracts into NestJS, the domain ports, adapters, OpenAPI and persistence.</p>
	</a>
	<a className="portalPathCard" href="/getting-started/operator-path">
		<span>04 · Operate</span>
		<h2>Platform operator</h2>
		<p>Find deployment, runtime, recovery and troubleshooting material.</p>
	</a>
</section>

## The universal first five minutes

Whatever your role:

1. Read the status label and source list at the top of the page.
2. Check that the **Verified** date suits the risk of your work.
3. Follow links to source files instead of guessing implementation details.
4. Treat a **Planned** or **Deferred** page as design intent, not working software.
5. If code, runtime behaviour and the portal disagree, follow [Source of truth and freshness](/governance/source-of-truth-and-freshness).

## What the portal does not replace

The portal explains the system. It does not replace source control, tests, runtime checks, the generated OpenAPI document or database validators.
