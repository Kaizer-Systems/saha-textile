#!/usr/bin/env node
/**
 * Account naming law guard (`DEC-ACCOUNT-SEPARATION`, owner lock 2026-08-15).
 *
 * ## The defect this exists to prevent
 *
 * One `users` collection held storefront shoppers and back-office operators at once,
 * discriminated by a `role` field. Nobody noticed for months, because the NAME accommodated
 * both readings: "user" meant two populations, and every contract was a union of two unrelated
 * things. Splitting them was expensive. Re-merging them by accident would be cheap, and would
 * start with exactly one identifier named `User`.
 *
 * So: operators are `adminUser` / `AdminUser` / `admin_user`. Shoppers are `customer` /
 * `Customer`. The bare noun names neither.
 *
 * ## Why this checks DECLARATIONS and STORED NAMES only
 *
 * "User" is also ordinary English — `user input`, `user-facing`, `the user experiences it as`.
 * That is not the defect, and no regex separates it from one reliably. A guard that tried
 * would need a permanently growing exception list, which is precisely what turned the
 * permission registry's server-only escape hatch into a parking space for 64 unexamined
 * entries. A guard with no exceptions is one nobody has to argue with.
 *
 * What is checked, therefore, is only where the ambiguity can actually re-enter the
 * architecture — a name that something else must then agree with:
 *
 *   1. a type, interface, class or enum DECLARED as `User…`
 *   2. a physical collection named `users` or `userSomething`
 *   3. a permission code in the `user.` or `user_` family
 *
 * A local `const user = …` inside an admin controller is not flagged. It is a readability nit,
 * not a population defect: nothing else in the system has to agree with it.
 *
 * ## Deliberately allowed
 *
 * `AdminUser…` and `adminUser…` (the operator vocabulary itself), `userId` and the other
 * `…UserId` foreign keys, `username`, `userAgent`/`userAgentHash`, and `LEGACY_COLLECTION_NAMES`
 * keys — those are the historical names a live database may still hold, and erasing them would
 * break the very migration that fixes them.
 *
 * Sibling of `scripts/check-naming.sh` (brand naming law, owner lock 2026-07-24), and wired
 * into `pnpm lint` for the same reason: a rule that runs is a rule, and a rule that is merely
 * written down is a hope.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SCAN_ROOTS = [
	'packages/contracts/src',
	'packages/core-domain/src',
	'packages/adapters-db-mongo/src',
	'packages/http-transport/src',
	'apps/api/src',
	'apps/admin/src',
	'apps/storefront/src',
];

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.angular', '.turbo', 'vendor']);

/** This file quotes the forbidden shapes to describe them; it must not report itself. */
const SELF = 'scripts/check-account-naming.mjs';

const problems = [];
const fail = (file, line, message) => problems.push(`${file}:${line} — ${message}`);

function* walk(dir) {
	for (const entry of readdirSync(dir)) {
		if (SKIP_DIRS.has(entry)) continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) yield* walk(full);
		else if (/\.(ts|html)$/.test(full)) yield full;
	}
}

/**
 * A type/interface/class/enum whose name STARTS with the bare noun.
 *
 * `\bUser` will not match inside `AdminUser` or `PublicAdminUser` — the preceding character is
 * a word character, so the boundary fails. That is exactly the intended asymmetry.
 */
const DECLARATION = /\b(?:interface|class|enum)\s+(User[A-Za-z0-9_]*)\b|\btype\s+(User[A-Za-z0-9_]*)\s*[=<]/g;

/** A permission code in the retired family. `user_role.*` became `admin_user_role.*`. */
const PERMISSION_CODE = /'(user[._][a-z_]*\.[a-z_]+)'/g;

/**
 * A physical collection name of `users`, or camelCase `userSomething`.
 *
 * Applied ONLY to `collection-names.ts`. Elsewhere `: 'users'` is overwhelmingly something
 * else — `menu.ts` uses it as an i18n key for a navigation label — and flagging those would
 * make the guard a nuisance rather than a rule.
 */
const COLLECTION_VALUE = /:\s*'(users|user[A-Z][A-Za-z0-9]*)'/g;

for (const root of SCAN_ROOTS) {
	const abs = join(ROOT, root);
	let entries;
	try {
		entries = [...walk(abs)];
	} catch {
		continue; // a workspace that does not exist yet is not a violation
	}

	for (const file of entries) {
		const rel = relative(ROOT, file);
		if (rel === SELF) continue;
		const lines = readFileSync(file, 'utf8').split('\n');
		const isCollectionNames = rel.endsWith('collection-names.ts');
		let inLegacyMap = false;

		lines.forEach((text, index) => {
			const lineNo = index + 1;

			// The two legacy maps are the record of what a live database may still hold:
			// `LEGACY_COLLECTION_NAMES` for physical names, `LEGACY_ADMIN_USER_PERMISSION_MAP`
			// for retired permission codes. Their keys MUST spell the old names — that is how
			// the migration finds the rows to fix. Flagging them would forbid the remedy along
			// with the disease.
			if (/LEGACY_COLLECTION_NAMES|LEGACY_ADMIN_USER_PERMISSION_MAP/.test(text)) inLegacyMap = true;
			else if (inLegacyMap && /^}/.test(text)) inLegacyMap = false;

			// Comments describe the rule and its history; they are prose, not declarations.
			const code = text.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');

			for (const match of code.matchAll(DECLARATION)) {
				const name = match[1] ?? match[2];
				fail(rel, lineNo, `declares \`${name}\` — name the population: \`Customer…\` or \`AdminUser…\``);
			}

			if (!inLegacyMap) {
				for (const match of code.matchAll(PERMISSION_CODE)) {
					fail(
						rel,
						lineNo,
						`permission code \`${match[1]}\` — operators are \`admin_user…\`, shoppers \`customer…\``,
					);
				}

				if (isCollectionNames) {
					for (const match of code.matchAll(COLLECTION_VALUE)) {
						fail(rel, lineNo, `collection \`${match[1]}\` — use \`customers\` or \`adminUser…\``);
					}
				}
			}
		});
	}
}

if (problems.length > 0) {
	console.error(
		'Account naming violations (DEC-ACCOUNT-SEPARATION): the bare noun "user" must not name a population.',
	);
	for (const problem of problems) console.error(`  ${problem}`);
	console.error(`\ncheck-account-naming: ${problems.length} problem(s).`);
	process.exit(1);
}

console.log('check-account-naming: OK (no bare "user" declaration, collection or permission code)');
