---
title: Choose Your Path
description: Select the shortest reliable onboarding route for your role.
status: implemented
audience: [beginner, frontend, backend, operator]
last_verified: '2026-07-25'
source_of_truth:
    - project-context/angular-context/private-developer-portal-documentation-plan.md
    - project-context/angular-context/execution-roadmap.md
---

# Choose your path

You do not need to read the portal from beginning to end. Start with the path that matches the work you are about to do. Each path gives you an ordered reading list, the files you should recognise, the commands you may need, and the point where you should stop and ask for clarification.

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
2. Confirm that the page's **Verified** date is appropriate for the risk of your task.
3. Follow links to source files rather than guessing implementation details.
4. Treat a **Planned** or **Deferred** page as approved intent—not working software.
5. If code, runtime behaviour and this portal disagree, stop and follow the conflict rule in [Source of Truth and Freshness](/governance/source-of-truth-and-freshness).

## What the portal does not do

The portal explains the system; it does not replace source control, tests, runtime verification, generated OpenAPI, database validators or deployment evidence. Its job is to help you find and interpret those authorities quickly.
