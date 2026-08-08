#!/usr/bin/env node
/**
 * Contract-stability guard for the generated OpenAPI document.
 *
 * Runs as part of `generate:openapi` rather than `pnpm lint`, because it reads the GENERATED
 * document and generating one costs a full Nest build. Putting it in lint would make every
 * lint run pay for a build; putting it here means the document cannot be produced without
 * being checked.
 *
 * What it protects, and why each rule earns its place:
 *
 * 1. **Every operation has an explicit `operationId`.** Nest derives one from the class and
 *    method name when none is given (`ProductsController_list`). That reads fine and is a
 *    trap: renaming a handler — a pure refactor with no contract meaning — silently renames
 *    the method on every generated client. Explicit ids decouple the published contract from
 *    internal naming.
 * 2. **No derived ids survive.** A new route added without `operationId` would otherwise pass
 *    rule 1 by accident, since Nest always fills something in.
 * 3. **Ids are unique.** Generators collide silently or overwrite; neither is discoverable
 *    from the document itself.
 * 4. **Ids are lowerCamelCase.** They become client method names.
 * 5. **Every operation is tagged, from the declared vocabulary only.** Tags become client
 *    namespaces, so a stray `catalogue` beside `catalog` is a second namespace nobody meant.
 * 6. **No bearer security scheme.** The API is cookie-authenticated; the guard that accepted
 *    `Authorization: Bearer` was retired in auth pass 4a, and `e2e/session-rotation.mjs`
 *    proves a bearer header authenticates nothing. Documenting one would send integrators
 *    down a path that cannot work.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const documentPath = resolve(process.argv[2] ?? 'dist/openapi.json');

/** Mirrors `src/openapi-tags.ts`. Kept as a literal so the check needs no build output. */
const DECLARED_TAGS = ['health', 'catalog', 'currency', 'promotions', 'cart', 'orders', 'auth', 'privacy'];

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
const LOWER_CAMEL_CASE = /^[a-z][A-Za-z0-9]*$/;
/** Nest's fallback shape: `SomeController_method`. */
const NEST_DERIVED_ID = /^[A-Z][A-Za-z0-9]*Controller_[A-Za-z0-9]+$/;

let failures = 0;
const fail = (message) => {
	console.error(`check-openapi: ${message}`);
	failures += 1;
};

let document;
try {
	document = JSON.parse(readFileSync(documentPath, 'utf8'));
} catch (error) {
	console.error(`check-openapi: could not read ${documentPath} — ${error.message}`);
	console.error('check-openapi: run `pnpm --filter @saha-textile/api generate:openapi` first.');
	process.exit(1);
}

const operations = [];
for (const [path, item] of Object.entries(document.paths ?? {})) {
	for (const [method, operation] of Object.entries(item)) {
		if (!HTTP_METHODS.includes(method)) continue;
		operations.push({ path, method, operation });
	}
}

if (operations.length === 0) fail('no operations found — wrong document?');

const byId = new Map();
for (const { path, method, operation } of operations) {
	const where = `${method.toUpperCase()} ${path}`;
	const id = operation.operationId;

	if (typeof id !== 'string' || id.length === 0) {
		fail(`${where} has no operationId`);
	} else {
		if (NEST_DERIVED_ID.test(id)) {
			fail(`${where} uses the framework-derived id "${id}" — give it an explicit @ApiOperation({ operationId })`);
		} else if (!LOWER_CAMEL_CASE.test(id)) {
			fail(`${where} operationId "${id}" is not lowerCamelCase`);
		}
		if (byId.has(id)) fail(`operationId "${id}" is used by both ${byId.get(id)} and ${where}`);
		else byId.set(id, where);
	}

	const tags = operation.tags ?? [];
	if (tags.length === 0) fail(`${where} has no tag`);
	for (const tag of tags) {
		if (!DECLARED_TAGS.includes(tag)) fail(`${where} uses undeclared tag "${tag}" — add it to src/openapi-tags.ts`);
	}
}

const schemes = document.components?.securitySchemes ?? {};
for (const [name, scheme] of Object.entries(schemes)) {
	if (scheme?.type === 'http' && String(scheme.scheme).toLowerCase() === 'bearer') {
		fail(`security scheme "${name}" documents bearer auth, which this API does not accept (auth pass 4a)`);
	}
}
if (Object.keys(schemes).length === 0) fail('no security scheme documented — the session cookie should be described');

// Declared tag order is part of the contract: an undeclared-but-used tag would otherwise only
// surface per-operation, and a tag declared without description reads as an empty namespace.
for (const declared of document.tags ?? []) {
	if (!DECLARED_TAGS.includes(declared.name)) fail(`document declares undeclared tag "${declared.name}"`);
	if (!declared.description) fail(`declared tag "${declared.name}" has no description`);
}

if (failures > 0) {
	console.error(`\ncheck-openapi: ${failures} problem(s) in ${documentPath}.`);
	process.exit(1);
}
console.log(
	`check-openapi: OK (${operations.length} operations across ${Object.keys(document.paths ?? {}).length} paths, ` +
		`${byId.size} unique explicit ids, ${DECLARED_TAGS.length} declared tags, no bearer scheme)`,
);
