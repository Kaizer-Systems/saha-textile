#!/usr/bin/env node
/**
 * Keeps the canonical permission registry and the admin navigation in step.
 *
 * The registry in `packages/contracts/src/permission.ts` is not an invention: it is exactly
 * the set of codes `apps/admin/src/app/shared/data/menu.ts` already gates its navigation on.
 * Two lists that must agree, in two packages that do not import one another — the admin
 * application does not depend on `@saha-textile/contracts` today — is precisely the shape of
 * thing that drifts silently.
 *
 * Both directions matter, and they fail differently:
 *
 *   - A code in the MENU but not the registry means the navigation gates on a permission the
 *     server can never grant. The link is invisible to everyone, forever, and nothing errors.
 *   - A code in the REGISTRY but not the menu is a grantable permission that authorizes
 *     nothing reachable — either a retired feature whose code should go, or a screen somebody
 *     forgot to gate.
 *
 * This reads sources rather than build output, so it runs in `pnpm lint` at no cost. It
 * parses deliberately narrowly: a permission code is `resource.action` in quotes, and both
 * halves must come from the declared resource and action enums, so a stray string like
 * `'ri-user-line'` or a route path cannot be mistaken for one.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const REGISTRY = 'packages/contracts/src/permission.ts';
const ADMIN_MENU = 'apps/admin/src/app/shared/data/menu.ts';

let failures = 0;
const fail = (message) => {
	console.error(`check-permission-registry: ${message}`);
	failures += 1;
};

const read = (relativePath) => readFileSync(join(repositoryRoot, relativePath), 'utf8');

/** Pulls the members of a named `z.enum([...])` declaration. */
function enumMembers(source, name) {
	const declaration = new RegExp(`export const ${name} = z\\.enum\\(\\[([^\\]]*)\\]`, 's').exec(source);
	if (!declaration) return null;
	return [...declaration[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

const registrySource = read(REGISTRY);
const codes = enumMembers(registrySource, 'PermissionCode');
const resources = enumMembers(registrySource, 'PermissionResource');
const actions = enumMembers(registrySource, 'PermissionAction');

if (!codes || !resources || !actions) {
	fail(`could not parse PermissionCode / PermissionResource / PermissionAction from ${REGISTRY}`);
	process.exit(1);
}

// Internal consistency first: a code whose halves are not declared is a code nobody can
// reason about, and it would also defeat the menu parser below.
for (const code of codes) {
	const [resource, action, ...rest] = code.split('.');
	if (rest.length > 0) fail(`registry code "${code}" is not a single resource.action pair`);
	if (!resources.includes(resource)) fail(`registry code "${code}" uses undeclared resource "${resource}"`);
	if (!actions.includes(action)) fail(`registry code "${code}" uses undeclared action "${action}"`);
}
const sorted = [...codes].slice().sort((a, b) => a.localeCompare(b));
if (codes.join() !== sorted.join()) fail('registry codes are not in sorted order — ordering is part of the contract');
if (new Set(codes).size !== codes.length) fail('registry contains a duplicate code');

for (const resource of resources) {
	if (!codes.some((code) => code.startsWith(`${resource}.`))) {
		fail(`declared resource "${resource}" has no code — remove it or add one`);
	}
}
for (const action of actions) {
	if (!codes.some((code) => code.endsWith(`.${action}`))) {
		fail(`declared action "${action}" has no code — remove it or add one`);
	}
}

/**
 * The menu half. EVERY `resource.action`-shaped string in this file is taken as a permission,
 * with no filtering against the declared resources or actions — and that width is the point.
 *
 * An earlier version only counted strings whose halves were both already declared, which
 * quietly defeated the rule it was written for: a navigation entry gating on `user.destroy`
 * was discarded as "not a permission" rather than reported as one the server cannot grant.
 * The check failed to fail. Filtering by what is already known can only ever confirm what is
 * already known.
 *
 * Safe to be this wide because the file is menu DATA: icons (`ri-user-line`) and route paths
 * (`/user/create`) do not match the shape, and all 26 dotted strings present are permissions.
 * A future non-permission dotted string would fail here loudly, which is the right direction
 * for a guard to be wrong in.
 */
const menuSource = read(ADMIN_MENU);
const menuCodes = new Set([...menuSource.matchAll(/'([a-z_]+\.[a-z_]+)'/g)].map((match) => match[1]));

if (menuCodes.size === 0) fail(`no permission codes found in ${ADMIN_MENU} — wrong path or changed shape?`);

const registrySet = new Set(codes);
for (const code of menuCodes) {
	if (!registrySet.has(code)) {
		fail(`${ADMIN_MENU} gates on "${code}", which the registry cannot grant — add it to ${REGISTRY}`);
	}
}
for (const code of registrySet) {
	if (!menuCodes.has(code)) {
		fail(`registry grants "${code}", which no admin navigation entry uses — retire it or gate a screen with it`);
	}
}

if (failures > 0) {
	console.error(`\ncheck-permission-registry: ${failures} problem(s).`);
	process.exit(1);
}
console.log(
	`check-permission-registry: OK (${codes.length} codes across ${resources.length} resources, ` +
		`${actions.length} actions, identical to the admin navigation)`,
);
