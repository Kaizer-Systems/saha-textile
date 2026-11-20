/**
 * Saves the Release Console's Secrets drafts for one tier. Run by the Mac helper in its own process
 * (the Infisical CLI blocks); the batch arrives on stdin, never on the command line, as
 * `{ tier, changes: [{ folder, name, value }] }`. It hands the batch to the Infisical chat's
 * `applySecretChanges`, which checks the whole batch first and writes each folder with the owner's
 * login. It prints names-only results as one JSON object; a value is never printed or logged.
 */
import { pathToFileURL } from 'node:url';

import { describeError, loadInventory } from '../secrets/inventory.mjs';
import { applySecretChanges } from '../secrets/write.mjs';

/**
 * @param {unknown} input
 * @param {{ inventory?: ReturnType<typeof loadInventory>, apply?: typeof applySecretChanges }} [options]
 */
export function saveBatch(input, { inventory = loadInventory(), apply = applySecretChanges } = {}) {
	const body = /** @type {{ tier?: unknown, changes?: unknown }} */ (input ?? {});
	const tier = String(body.tier ?? '');
	const changes = Array.isArray(body.changes) ? body.changes : [];
	const batch = changes.map((c) => ({
		tier,
		folder: String(c?.folder ?? ''),
		name: String(c?.name ?? ''),
		value: typeof c?.value === 'string' ? c.value : '',
	}));
	const results = apply(/** @type {any} */ (batch), { inventory });
	return {
		tier,
		project: inventory.projects[tier]?.name ?? tier,
		environment: inventory.projects[tier]?.environment ?? tier,
		results: results.map((r) => ({ folder: r.folder, names: r.names, saved: r.saved, error: r.error ?? null })),
	};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	let raw = '';
	process.stdin.setEncoding('utf8');
	process.stdin.on('data', (chunk) => (raw += chunk));
	process.stdin.on('end', () => {
		try {
			process.stdout.write(JSON.stringify(saveBatch(JSON.parse(raw))));
		} catch (error) {
			process.stdout.write(JSON.stringify({ error: describeError(error) }));
			process.exitCode = 1;
		} finally {
			raw = '';
		}
	});
}
