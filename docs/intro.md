---
title: Saha Textile Developer Portal
slug: /
description: Private developer portal for Saha Textile.
hide_title: true
hide_table_of_contents: true
---

<section className="portalHero">
	<div className="portalHero__content">
		<p className="portalEyebrow">Private platform intelligence</p>
		<h1>Saha Textile Developer Portal</h1>
		<p className="portalHero__lede">
			A living operating manual for the storefront, admin, API, database, deployment path, and handover decisions behind the Saha Textile rebuild.
		</p>
		<div className="portalHero__actions">
			<a className="portalButton portalButton--primary" href="/getting-started/overview">Start operating</a>
			<a className="portalButton portalButton--secondary" href="/architecture/system-overview">View architecture</a>
		</div>
	</div>
	<div className="portalHero__panel" aria-label="Documentation status">
		<div className="portalStatusHeader">
			<span>Build phase</span>
			<strong>Portal foundation</strong>
		</div>
		<div className="portalSignalGrid">
			<div>
				<span>Docs shell</span>
				<strong>Live</strong>
			</div>
			<div>
				<span>OpenAPI</span>
				<strong>Queued</strong>
			</div>
			<div>
				<span>DB catalogue</span>
				<strong>Queued</strong>
			</div>
			<div>
				<span>Storybook</span>
				<strong>Queued</strong>
			</div>
		</div>
	</div>
</section>

<section className="portalSection">
	<div>
		<p className="portalEyebrow">Why this exists now</p>
		<h2>Start the knowledge system before the platform gets wide.</h2>
	</div>
	<p>
		The portal begins with stable structure, source-of-truth pages, and flow templates. Generated references attach later, once API controllers, Mongo schemas, and UI stories become real.
	</p>
</section>

<section className="portalCardGrid" aria-label="Portal sections">
	<a className="portalCard portalCard--architecture" href="/architecture/system-overview">
		<span>01</span>
		<h2>System architecture</h2>
		<p>Hexagonal boundaries, app responsibilities, dependency direction, and the monorepo map.</p>
	</a>
	<a className="portalCard portalCard--flow" href="/business-flows/checkout">
		<span>02</span>
		<h2>Business flows</h2>
		<p>Customer and admin actions traced through route, state, API, domain, and persistence layers.</p>
	</a>
	<a className="portalCard portalCard--api" href="/api/overview">
		<span>03</span>
		<h2>API reference</h2>
		<p>Human concepts now; OpenAPI, Swagger console, and Redoc output once the API surface exists.</p>
	</a>
	<a className="portalCard portalCard--database" href="/database/overview">
		<span>04</span>
		<h2>Database catalogue</h2>
		<p>Generated collection docs, indexes, schema rules, DTO mappings, and retention notes when schemas land.</p>
	</a>
</section>

<section className="portalRoadmap">
	<div>
		<p className="portalEyebrow">Documentation runway</p>
		<h2>What is real, what is next.</h2>
	</div>
	<table>
		<thead>
			<tr>
				<th>Section</th>
				<th>Status</th>
				<th>Trigger to deepen</th>
			</tr>
		</thead>
		<tbody>
			<tr>
				<td>Architecture docs</td>
				<td><span className="portalBadge portalBadge--live">Started</span></td>
				<td>Every package or dependency-boundary change</td>
			</tr>
			<tr>
				<td>Business-flow templates</td>
				<td><span className="portalBadge portalBadge--live">Started</span></td>
				<td>Route, API, or state workflow implementation</td>
			</tr>
			<tr>
				<td>API reference</td>
				<td><span className="portalBadge">Waiting</span></td>
				<td>NestJS OpenAPI generation</td>
			</tr>
			<tr>
				<td>Database catalogue</td>
				<td><span className="portalBadge">Waiting</span></td>
				<td>Mongo schema and index definitions</td>
			</tr>
			<tr>
				<td>Storybook links</td>
				<td><span className="portalBadge">Waiting</span></td>
				<td>Admin and storefront component stories</td>
			</tr>
			<tr>
				<td>Pagefind search</td>
				<td><span className="portalBadge">Waiting</span></td>
				<td>Larger static portal build</td>
			</tr>
		</tbody>
	</table>
</section>

<section className="portalNext">
	<a href="/getting-started/overview">Getting started</a>
	<a href="/architecture/monorepo-map">Monorepo map</a>
	<a href="/decisions/developer-portal-now">Portal ADR</a>
</section>
