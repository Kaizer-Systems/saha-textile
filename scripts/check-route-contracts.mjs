#!/usr/bin/env node
/**
 * Route/contract family guard, and the categorisation itself.
 *
 * Every HTTP route belongs to a contract family, and every request body it accepts must be
 * validated by a schema that lives in `@saha-textile/contracts` — not by one declared inside
 * the controller.
 *
 * The reconciliation that produced this rule (auth pass 4e) found seven request shapes
 * declared as anonymous Zod objects in controllers: three on cart, two on orders, one on
 * promotions, and one written inline in the route decorator for email verification. Each was
 * invisible outside the file that declared it — the Angular gateways could not import it, the
 * OpenAPI document could not name it, and nothing tied it to the entity it wrote to. The cart
 * add-on shape had already been re-declared character for character beside the
 * `CartAddonValue` it duplicated, which is the drift this prevents rather than predicts.
 *
 * A source-level guard, so it runs in `pnpm lint` beside the naming and browser-auth checks
 * and costs no build. It reads the controllers rather than the generated document because the
 * property is about WHERE a shape is declared, which a generated document cannot show.
 *
 * On success it prints the family table, which is the categorisation deliverable: families,
 * route counts, and how many routes accept a body.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const CONTROLLER_ROOT = 'apps/api/src';
const CONTRACTS_PACKAGE = '@saha-textile/contracts';

/** Mirrors `apps/api/src/openapi-tags.ts`. */
const DECLARED_FAMILIES = ['health', 'catalog', 'currency', 'promotions', 'cart', 'orders', 'auth', 'privacy'];

const ROUTE_DECORATOR = /@(Get|Post|Put|Patch|Delete)\s*\(/g;
const VALIDATION_PIPE = /new\s+ZodValidationPipe\s*\(\s*([^)]*)/g;
const BODY_DECORATOR = /@Body\s*\(/g;

let failures = 0;
const fail = (message) => {
	console.error(`check-route-contracts: ${message}`);
	failures += 1;
};

function controllerFiles(directory) {
	const found = [];
	for (const entry of readdirSync(directory)) {
		const path = join(directory, entry);
		if (statSync(path).isDirectory()) found.push(...controllerFiles(path));
		else if (path.endsWith('.controller.ts')) found.push(path);
	}
	return found;
}

/** Identifiers a file imports from the contracts package, including `type` imports. */
function contractImports(text) {
	const names = new Set();
	const pattern = new RegExp(`import\\s+(?:type\\s+)?\\{([^}]*)\\}\\s*from\\s*['"]${CONTRACTS_PACKAGE}['"]`, 'gs');
	for (const match of text.matchAll(pattern)) {
		for (const raw of match[1].split(',')) {
			const name = raw
				.replace(/\btype\b/, '')
				.split(' as ')[0]
				.trim();
			if (name) names.add(name);
		}
	}
	return names;
}

const files = controllerFiles(join(repositoryRoot, CONTROLLER_ROOT));
if (files.length < 5) fail(`only ${files.length} controllers found under ${CONTROLLER_ROOT} — wrong path?`);

const families = new Map(DECLARED_FAMILIES.map((name) => [name, { routes: 0, bodies: 0, controllers: 0 }]));

for (const file of files) {
	const relativePath = relative(repositoryRoot, file).split(sep).join('/');
	const text = readFileSync(file, 'utf8');
	const imported = contractImports(text);

	// Family membership. Referencing the shared vocabulary is what makes a family checkable;
	// a raw string literal would drift the moment somebody typed `catalogue`.
	const tag = /@ApiTags\(\s*API_TAGS\.([A-Za-z0-9_]+)\s*\)/.exec(text);
	if (!tag) {
		fail(`${relativePath} declares no family — add @ApiTags(API_TAGS.<family>)`);
	} else if (!families.has(tag[1])) {
		fail(`${relativePath} uses undeclared family "${tag[1]}" — add it to apps/api/src/openapi-tags.ts`);
	} else {
		const family = families.get(tag[1]);
		family.controllers += 1;
		family.routes += [...text.matchAll(ROUTE_DECORATOR)].length;
		family.bodies += [...text.matchAll(BODY_DECORATOR)].length;
	}

	// Every validated body must name a contract, not a local shape.
	for (const match of text.matchAll(VALIDATION_PIPE)) {
		const argument = match[1].trim();

		if (argument.startsWith('z.')) {
			fail(
				`${relativePath} validates a body with an inline ${argument.slice(0, 12)}… — declare it in ${CONTRACTS_PACKAGE}`,
			);
			continue;
		}

		// `AdminPinLoginRequest.pick({ pin: true })` is a legitimate narrowing of a contract:
		// the base identifier is what must come from the package.
		const base = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(argument)?.[0];
		if (!base) {
			fail(`${relativePath} validates a body with an unrecognised expression: ${argument.slice(0, 40)}`);
			continue;
		}
		if (!imported.has(base)) {
			fail(`${relativePath} validates a body with "${base}", which is not imported from ${CONTRACTS_PACKAGE}`);
		}
	}

	// An unvalidated body reaches a handler as whatever the caller sent.
	const bodies = [...text.matchAll(BODY_DECORATOR)].length;
	const validated = [...text.matchAll(VALIDATION_PIPE)].length;
	if (bodies > validated) {
		fail(`${relativePath} has ${bodies} @Body parameter(s) but only ${validated} validated`);
	}
}

if (failures > 0) {
	console.error(`\ncheck-route-contracts: ${failures} problem(s).`);
	process.exit(1);
}

const totals = [...families.values()].reduce(
	(sum, f) => ({ routes: sum.routes + f.routes, bodies: sum.bodies + f.bodies }),
	{ routes: 0, bodies: 0 },
);
console.log('check-route-contracts: OK — every route is in a declared family and every body is contract-validated');
for (const name of DECLARED_FAMILIES) {
	const family = families.get(name);
	console.log(
		`  ${name.padEnd(11)} ${String(family.controllers).padStart(2)} controller(s)  ` +
			`${String(family.routes).padStart(2)} route(s)  ${String(family.bodies).padStart(2)} with a body`,
	);
}
console.log(
	`  ${'total'.padEnd(11)} ${String(files.length).padStart(2)} controller(s)  ${String(totals.routes).padStart(2)} route(s)  ${String(totals.bodies).padStart(2)} with a body`,
);
