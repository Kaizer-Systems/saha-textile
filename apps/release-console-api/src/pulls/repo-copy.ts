import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { PullFile } from '@saha-textile/release-console-contracts';

import { diffLines, filesFromGit } from './diff-text.js';
import { dataDir } from '../store/console-store.js';

/** Git's empty folder: what a repository's first commit is compared with. */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** A file's changes read from the copy: its lines, or its size before and after when it is binary. */
export interface CopyDiff {
	binary: boolean;
	sizeBefore: number | null;
	sizeAfter: number | null;
	lines: ReturnType<typeof diffLines>;
}

/**
 * The console API's own copy of a repository (pull request page brief, Q2): a bare clone in the console's data
 * folder, fetched with the repository's GitHub key, so a pull request past GitHub's 3,000-file list still shows
 * every file and every change. The same code runs on this Mac and on a server; it needs only the `git` program.
 * The key reaches git through its environment for each command, never in a URL, a log or a file.
 */
export class RepoCopy {
	private readonly queue = new Map<string, Promise<unknown>>();

	constructor(
		private readonly root = join(dataDir(), 'repositories'),
		private readonly remote = (repository: string) => `https://github.com/${repository}.git`,
	) {}

	/** Where the copy fetches "owner/name" from: GitHub over https. */
	origin(repository: string): string {
		return this.remote(repository);
	}

	/** The copy's folder for "owner/name". */
	folder(repository: string): string {
		return join(this.root, `${repository.replace('/', '__')}.git`);
	}

	/**
	 * Makes sure the copy holds these commits: clones it the first time, then fetches the pull request's head and
	 * its base branch when one is missing. One repository is cloned or fetched one call at a time.
	 */
	async ready(
		repository: string,
		key: string,
		shas: readonly string[],
		refspecs: readonly string[],
	): Promise<string> {
		const dir = this.folder(repository);
		const before = this.queue.get(dir) ?? Promise.resolve();
		const next = before
			.catch(() => undefined)
			.then(async () => {
				if (!existsSync(join(dir, 'HEAD'))) {
					mkdirSync(this.root, { recursive: true });
					await this.git(key, this.root, ['clone', '--bare', '--quiet', this.origin(repository), dir]);
				}
				const missing: string[] = [];
				for (const sha of shas) if (!(await this.has(dir, sha))) missing.push(sha);
				if (missing.length) await this.git(key, dir, ['fetch', '--quiet', 'origin', ...refspecs]);
				for (const sha of missing)
					if (!(await this.has(dir, sha)))
						throw new Error(`The copy has no commit ${sha.slice(0, 7)} after fetching from GitHub.`);
				return dir;
			});
		this.queue.set(dir, next);
		return next;
	}

	/** Every file changed between two commits; `from...to` (three dots) compares `to` with where it left `from`. */
	async files(dir: string, range: readonly string[]): Promise<PullFile[]> {
		const [names, counts] = await Promise.all([
			this.git('', dir, ['diff', '--no-color', '--no-ext-diff', '-M', '--name-status', '-z', ...range]),
			this.git('', dir, ['diff', '--no-color', '--no-ext-diff', '-M', '--numstat', '-z', ...range]),
		]);
		return filesFromGit(names, counts);
	}

	/** One file's changes between two commits, with three lines around each change or the whole file. */
	async diff(
		dir: string,
		range: readonly string[],
		path: string,
		previous: string | null,
		whole: boolean,
	): Promise<CopyDiff> {
		const text = await this.git('', dir, [
			'diff',
			'--no-color',
			'--no-ext-diff',
			'-M',
			whole ? '-U1000000' : '-U3',
			...range,
			'--',
			...(previous ? [previous] : []),
			path,
		]);
		if (!/^Binary files /m.test(text))
			return { binary: false, sizeBefore: null, sizeAfter: null, lines: diffLines(text) };
		const [from, to] = await this.ends(dir, range);
		return {
			binary: true,
			sizeBefore: await this.size(dir, `${from}:${previous ?? path}`),
			sizeAfter: await this.size(dir, `${to}:${path}`),
			lines: [],
		};
	}

	/** A commit's first parent, or git's empty folder for a repository's first commit. */
	async parent(dir: string, sha: string): Promise<string> {
		return (
			await this.git('', dir, ['rev-parse', '--verify', '--quiet', `${sha}^1`]).catch(() => EMPTY_TREE)
		).trim();
	}

	/** The two commits a range compares; for `a...b` the first is where `b` left `a`. */
	private async ends(dir: string, range: readonly string[]): Promise<[string, string]> {
		if (range.length === 2) return [range[0] as string, range[1] as string];
		const [from, to] = (range[0] as string).split('...') as [string, string];
		return [(await this.git('', dir, ['merge-base', from, to])).trim(), to];
	}

	private async size(dir: string, object: string): Promise<number | null> {
		const out = await this.git('', dir, ['cat-file', '-s', object]).catch(() => null);
		return out === null ? null : Number(out.trim());
	}

	private async has(dir: string, sha: string): Promise<boolean> {
		return this.git('', dir, ['cat-file', '-e', `${sha}^{commit}`]).then(
			() => true,
			() => false,
		);
	}

	/** Runs git; with a key, GitHub's sign-in header rides in git's environment for this one command. */
	private git(key: string, cwd: string, args: readonly string[]): Promise<string> {
		const auth = key ? Buffer.from(`x-access-token:${key}`).toString('base64') : '';
		return new Promise((resolve, reject) => {
			execFile(
				'git',
				args,
				{
					cwd,
					encoding: 'utf8',
					maxBuffer: 512 * 1024 * 1024,
					timeout: 300_000,
					env: {
						...process.env,
						GIT_TERMINAL_PROMPT: '0',
						...(auth
							? {
									GIT_CONFIG_COUNT: '1',
									GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
									GIT_CONFIG_VALUE_0: `Authorization: Basic ${auth}`,
								}
							: {}),
					},
				},
				(error, stdout, stderr) =>
					error
						? reject(new Error(`git ${args[0]} failed: ${String(stderr).trim() || error.message}`))
						: resolve(stdout),
			);
		});
	}
}
