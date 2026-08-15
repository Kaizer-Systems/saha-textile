#!/usr/bin/env node
/**
 * Authorization guard for every HTTP route.
 *
 * Deny-by-default became true on 2026-08-12, when the last route authorizing by coarse role
 * alone was converted to a permission. True is not the same as permanent: nothing stopped the
 * next controller from reintroducing one, and nothing would have said so. This is the check
 * that makes the property hold rather than merely hold today — the same reasoning that
 * produced `check-naming.sh`, `check-browser-auth.mjs`, `check-route-contracts.mjs` and
 * `check-permission-registry.mjs`.
 *
 * ## The two rules, and the defect each one prevents
 *
 * **1. A role-gated route must declare an audience.** `SessionGuard` enforces an audience only
 * when one is DECLARED, on the route or its controller. `PATCH /orders/:id/status` carried
 * `@RequireRoles('admin', 'staff')` and no audience, on a controller whose other routes are
 * deliberately customer-facing — so a staff member who also shopped on the storefront reached
 * a back-office route with their STOREFRONT cookie. The role check passed and the handler ran.
 * That was found by probing the running application, not by reading the code, which is exactly
 * why it needs a mechanical check.
 *
 * **2. A role-only route must be justified in writing.** Coarse roles are not authorization:
 * `admin` must not silently mean every capability (build prompt §7). Some routes genuinely are
 * role-gated — self-service over one's OWN credentials and sessions, where there is no
 * resource to hold a permission against. Those are legitimate and are listed below WITH THE
 * REASON, so that "why is this one role-only?" is answered in this file rather than in
 * somebody's memory. Anything not listed must carry `@RequirePermissions`.
 *
 * A source-level guard, so it runs in `pnpm lint` beside the others and costs no build. It
 * reads controllers rather than the generated OpenAPI document because the property is about
 * which DECORATORS are present, which a generated document does not show.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const CONTROLLER_ROOT = 'apps/api/src';

/**
 * Routes that may authorize by role alone, each with the reason.
 *
 * Deliberately a map rather than a list: an entry has to carry a justification, so an
 * exemption cannot be added silently. Keyed by `<file> <METHOD> <path>` because that is what a
 * reader sees in the controller and in the OpenAPI document alike.
 *
 * Every entry here is SELF-SERVICE — the caller acting on their own credentials or their own
 * sessions. There is no other resource involved and therefore nothing to hold a permission
 * against: the authority being exercised is "I am this person", which the session already
 * proved, plus "I am back-office staff", which the role states.
 */
const ROLE_ONLY_ROUTES = {
	"auth/admin-auth.controller.ts POST 'pin'": 'Sets the caller’s OWN PIN, behind their own password proof.',
	"auth/admin-auth.controller.ts GET 'security'": 'Reads the caller’s OWN credential state.',
	"auth/admin-auth.controller.ts POST 'pin/remove'": 'Removes the caller’s OWN PIN, behind their own password proof.',
	"auth/admin-auth.controller.ts POST 'password/change'":
		'Changes the caller’s OWN password, behind their own password proof.',
	"auth/admin-auth.controller.ts GET 'me'": 'Reads the caller’s OWN identity and effective grants.',
	"auth/admin-auth.controller.ts GET 'sessions'": 'Lists the caller’s OWN sessions.',
	"auth/admin-auth.controller.ts DELETE 'sessions/:id'":
		'Revokes one of the caller’s OWN sessions; ownership is re-checked in the service and a stranger’s id answers 404.',
	"auth/admin-auth.controller.ts POST 'sessions/revoke-others'": 'Revokes the caller’s OWN other sessions.',
	"auth/admin-auth.controller.ts POST 'resume'": 'Re-proves presence on the caller’s OWN already-open session.',
	"auth/admin-auth.controller.ts PATCH 'profile'":
		'Updates the caller’s OWN display name/phone under a live admin session; no other account is addressable.',
	// Invites create/list/revoke use @RequirePermissions('admin_user.create') — not role-only.
};

let failures = 0;
const fail = (message) => {
	console.error(`check-route-authorization: ${message}`);
	failures += 1;
};

function controllerFiles(directory) {
	const found = [];
	for (const entry of readdirSync(directory)) {
		const full = join(directory, entry);
		if (statSync(full).isDirectory()) found.push(...controllerFiles(full));
		else if (entry.endsWith('.controller.ts')) found.push(full);
	}
	return found;
}

/**
 * Strips comments before matching.
 *
 * Load-bearing rather than tidy: a doc comment explaining why a route is NOT `@RequireRoles`
 * contains the literal text `@RequireRoles`, and `orders.controller.ts` has exactly such a
 * comment. Matching it would make the guard report the defect it documents as still present.
 */
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const ROUTE_DECORATOR = /@(Get|Post|Put|Patch|Delete)\s*\(([^)]*)\)/g;

const routes = [];
for (const file of controllerFiles(join(repositoryRoot, CONTROLLER_ROOT))) {
	const relativePath = relative(join(repositoryRoot, CONTROLLER_ROOT), file).split(sep).join('/');
	const source = stripComments(readFileSync(file, 'utf8'));

	// A class-level audience covers every route the class declares.
	const classBody = source.slice(0, source.search(/export\s+class\b/));
	const classHasAudience = /@Audience\s*\(/.test(classBody);

	const matches = [...source.matchAll(ROUTE_DECORATOR)];
	for (const [index, match] of matches.entries()) {
		// Everything from this route decorator to the next one is the route's own block.
		const start = match.index;
		const end = index + 1 < matches.length ? matches[index + 1].index : source.length;
		const block = source.slice(start, end);

		routes.push({
			key: `${relativePath} ${match[1].toUpperCase()} ${match[2].trim() || '/'}`,
			isPublic: /@Public\s*\(/.test(block),
			hasRoles: /@RequireRoles\s*\(/.test(block),
			hasPermissions: /@RequirePermissions\s*\(/.test(block),
			hasAudience: classHasAudience || /@Audience\s*\(/.test(block),
		});
	}
}

if (routes.length === 0) fail(`no controllers found under ${CONTROLLER_ROOT}`);

for (const route of routes) {
	if (!route.hasRoles) continue;

	// Rule 1 — the defect that was actually shipped.
	if (!route.hasAudience) {
		fail(
			`${route.key} is role-gated but declares no @Audience. ` +
				`SessionGuard enforces an audience only when one is declared, so a session from the ` +
				`OTHER surface satisfies this route.`,
		);
	}

	// Rule 2 — coarse roles are not authorization unless somebody said why.
	if (!route.hasPermissions && !(route.key in ROLE_ONLY_ROUTES)) {
		fail(
			`${route.key} authorizes by role alone. Add @RequirePermissions, or declare it in ` +
				`ROLE_ONLY_ROUTES in this file with the reason it does not need one.`,
		);
	}
}

// A stale exemption is its own defect: it reads as a reviewed decision about a route that no
// longer exists, and it would silently excuse a future route that reused the same path.
const liveKeys = new Set(routes.filter((route) => route.hasRoles).map((route) => route.key));
for (const key of Object.keys(ROLE_ONLY_ROUTES)) {
	if (!liveKeys.has(key)) fail(`ROLE_ONLY_ROUTES names "${key}", which is not a role-gated route — remove it`);
}

if (failures > 0) {
	console.error(`\ncheck-route-authorization: ${failures} violation(s).`);
	process.exit(1);
}

const roleOnly = routes.filter((route) => route.hasRoles && !route.hasPermissions).length;
const permissioned = routes.filter((route) => route.hasPermissions).length;
const publicRoutes = routes.filter((route) => route.isPublic).length;
console.log(
	`check-route-authorization: OK (${routes.length} routes — ${permissioned} permission-gated, ` +
		`${roleOnly} role-only and justified, ${publicRoutes} public, ` +
		`every role-gated route audience-bound)`,
);
