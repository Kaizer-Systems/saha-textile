/**
 * This Mac's coverage for the Release Console's Coverage screen (brief CRmpBdP3ce62g1JoCAhh23): what
 * `pnpm coverage` left in this copy's coverage folder, the copy's files, one file's text and the lines a
 * change touched. The helper answers it at GET /coverage/<kind>.
 *
 * A file's text is given only for files git tracks or would track: anything git ignores (env files, keys,
 * build output) is refused, so the screen can never show a secret.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

const WORKSPACE = /^[a-z0-9][a-z0-9-]*$/;
const BRANCH = /^[\w./-]+$/;
const git = (root, args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** The added or changed lines of each file in a `git diff -U0`. */
export function changedFiles(diff) {
	const out = {};
	let file = null;
	let line = 0;
	for (const row of diff.split('\n')) {
		if (row.startsWith('+++ ')) {
			file = row === '+++ /dev/null' ? null : row.replace(/^\+\+\+ b\//, '');
			continue;
		}
		const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(row);
		if (hunk) line = Number(hunk[1]);
		else if (file && row.startsWith('+')) (out[file] ??= []).push(line++);
	}
	return out;
}

/** One coverage answer: `{ data }`, or `{ off, message }` when there is nothing yet, or `{ status, message }`. */
export function coverageLocal(kind, query, root) {
	const dir = join(root, 'coverage');
	if (kind === 'meta') {
		const workspaces = existsSync(dir)
			? readdirSync(dir).filter((n) => WORKSPACE.test(n) && existsSync(join(dir, n, 'coverage-final.json')))
			: [];
		if (!workspaces.length)
			return {
				off: true,
				message: 'This copy has no coverage reports yet. Run pnpm coverage, then open this screen again.',
			};
		const metaFile = join(dir, 'meta.json');
		const origin = git(root, ['remote', 'get-url', 'origin']).stdout.trim();
		return {
			data: {
				// owner/name of this copy's GitHub repository, so the console shows it only under that repository
				repository: /[:/]([^/:]+\/[^/]+?)(?:\.git)?$/.exec(origin)?.[1] ?? null,
				meta: existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : null,
				workspaces: workspaces.map((name) => ({
					name,
					measuredAt: statSync(join(dir, name, 'coverage-final.json')).mtime.toISOString(),
				})),
			},
		};
	}
	if (kind === 'report') {
		const ws = String(query.ws ?? '');
		if (!WORKSPACE.test(ws)) return { status: 400, message: 'That is not a workspace name.' };
		const file = join(dir, ws, query.part === 'tests' ? 'tests.json' : 'coverage-final.json');
		return { data: existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null };
	}
	if (kind === 'files') {
		const out = git(root, ['ls-files', '-co', '--exclude-standard']);
		return { data: out.status === 0 ? out.stdout.split('\n').filter(Boolean) : [] };
	}
	if (kind === 'text') {
		const path = String(query.path ?? '');
		const full = resolve(root, path);
		if (!path || !full.startsWith(root + sep)) return { status: 400, message: 'That file is outside this copy.' };
		if (git(root, ['check-ignore', '-q', '--', path]).status === 0)
			return { status: 403, message: 'That file is ignored by git, so the console does not show it.' };
		return { data: existsSync(full) && statSync(full).isFile() ? readFileSync(full, 'utf8') : null };
	}
	if (kind === 'diff') {
		const base = String(query.base ?? 'commit');
		let from = 'HEAD~1';
		if (base !== 'commit') {
			if (!BRANCH.test(base)) return { status: 400, message: 'That is not a branch name.' };
			const split = git(root, ['merge-base', base, 'HEAD']);
			if (split.status !== 0) return { status: 404, message: `This copy has no branch ${base}.` };
			from = split.stdout.trim();
		}
		// Against the working copy, so changes not yet committed count too.
		const diff = git(root, ['diff', '-U0', '--no-color', '--no-ext-diff', from, '--']);
		return { data: diff.status === 0 ? changedFiles(diff.stdout) : {} };
	}
	return { status: 404, message: 'The console asked for coverage it does not know.' };
}
