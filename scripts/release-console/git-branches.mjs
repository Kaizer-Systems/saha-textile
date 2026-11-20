/**
 * Read-only git look-ups in the checkout the Mac helper runs from, for the Release Console's branch
 * pickers (owner, 20 Nov: each environment chooses its branch, and Live deploy can switch it before
 * a run). They answer only for the repository this checkout belongs to: its local branches (some
 * may never have been pushed, such as a local integration branch), the ones it knows on GitHub
 * (`origin/*`), the branch checked out now, and one file, `.release-console.json`, at a branch.
 * Nothing here changes the checkout.
 */
import { execFile } from 'node:child_process';

import { repositoryOf } from './infisical-places.mjs';
import { ROOT } from '../secrets/inventory.mjs';

/** Kept in step with BRANCH_NAME in packages/release-console-contracts/src/projects.ts. */
export const BRANCH_NAME =
	// eslint-disable-next-line no-control-regex
	/^(?!-)(?!\/)(?!.*\/\/)(?!.*\.\.)(?!.*@\{)(?!.*\/$)(?!.*\.lock$)[^\s~^:?*[\\\x00-\x1f\x7f]{1,255}$/;

/** The one file the console reads from a branch. */
export const MENUS_FILE = '.release-console.json';

/** @typedef {(args: string[]) => Promise<{ ok: boolean, out: string }>} Git */

/** @type {Git} */
const git = (args) =>
	new Promise((resolve) => {
		execFile(
			'git',
			['-C', ROOT, ...args],
			{ encoding: 'utf8', timeout: 15_000, maxBuffer: 4 * 1024 * 1024 },
			(e, out) => resolve({ ok: !e, out: String(out ?? '') }),
		);
	});

const lines = (text) =>
	text
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean);

/** Whether this checkout is `repository` (owner/name, compared without case). */
export async function isThisCheckout(repository, run = git) {
	const remote = await run(['remote', 'get-url', 'origin']);
	const own = remote.ok ? repositoryOf(remote.out) : null;
	return !!own && own.toLowerCase() === String(repository).toLowerCase();
}

/**
 * This checkout's branches, when it is `repository`: `{ checkout: false }` otherwise.
 * @param {string} repository
 * @param {Git} [run]
 */
export async function checkoutBranches(repository, run = git, { fetch = false } = {}) {
	if (!(await isThisCheckout(repository, run))) return { checkout: false, current: null, local: [], remote: [] };
	// The refresh button: GitHub's branches as of now (names only; nothing in the folder changes).
	if (fetch) await run(['fetch', '--prune', 'origin']);
	const [head, local, remote] = await Promise.all([
		run(['symbolic-ref', '--quiet', '--short', 'HEAD']),
		run(['for-each-ref', '--format=%(refname:short)', 'refs/heads']),
		run(['for-each-ref', '--format=%(refname:lstrip=3)', 'refs/remotes/origin']),
	]);
	const valid = (names) => lines(names).filter((n) => n !== 'HEAD' && BRANCH_NAME.test(n));
	return {
		checkout: true,
		current: head.ok ? head.out.trim() || null : null,
		local: valid(local.out),
		remote: valid(remote.out),
	};
}

/**
 * `.release-console.json` at a branch of this checkout: the local branch first, then the copy of
 * GitHub's it knows. `{ found: false }` when neither has the file.
 * @param {string} repository
 * @param {string} ref
 * @param {Git} [run]
 */
export async function menusFileAt(repository, ref, run = git) {
	if (!BRANCH_NAME.test(ref)) throw Object.assign(new Error('Not a branch name.'), { status: 400 });
	if (!(await isThisCheckout(repository, run)))
		throw Object.assign(new Error('This computer’s checkout is another repository.'), { status: 404 });
	for (const at of [ref, `origin/${ref}`]) {
		const shown = await run(['show', `${at}:${MENUS_FILE}`]);
		if (shown.ok) return { found: true, text: shown.out, ref: at };
	}
	return { found: false, text: '', ref };
}
