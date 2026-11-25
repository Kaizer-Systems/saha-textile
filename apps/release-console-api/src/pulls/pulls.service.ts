import { Injectable } from '@nestjs/common';
import type {
	PullBasePreview,
	PullCommitPage,
	PullCommits,
	PullDiff,
	PullDiffQuery,
	PullFile,
	PullFiles,
	PullLog,
	PullPage,
	PullRow,
	VendorAnswer,
} from '@saha-textile/release-console-contracts';

import {
	GITHUB_COMPARE_FILES,
	GITHUB_FILE_LIMIT,
	compareCounts,
	githubCommit,
	githubPullFiles,
	jobLog,
	pullCommits,
	pullHead,
	pullPage,
	pullRows,
} from './github-pulls.js';
import { diffLines } from './diff-text.js';
import { type CopyDiff, RepoCopy } from './repo-copy.js';
import { VendorReadsService } from '../projects/vendor-reads.service.js';
import { VendorError } from '../vendors/http.js';

type Head = Awaited<ReturnType<typeof pullHead>>;
interface FilesRead {
	list: PullFiles;
	patches: Map<string, string | null>;
}
type CommitRead = Awaited<ReturnType<typeof githubCommit>>;

/** How many pull requests' (and commits') file lists stay in memory, newest kept. */
const KEEP = 8;
const count = (n: number) => n.toLocaleString('en-IN');

/** A small newest-kept memory, so opening file after file reads the list once per head commit. */
export class Recent<T> {
	private readonly items = new Map<string, Promise<T>>();
	get(key: string, read: () => Promise<T>): Promise<T> {
		const hit = this.items.get(key);
		if (hit) return hit;
		const value = read();
		this.items.set(key, value);
		value.catch(() => this.items.delete(key));
		if (this.items.size > KEEP) this.items.delete(this.items.keys().next().value as string);
		return value;
	}
	/** Forgets everything: after a change, reads keyed by a branch's name are stale. */
	clear(): void {
		this.items.clear();
	}
}

/**
 * Ship › Code › Pull requests (brief E5WE6RSF2AJvpxDyDA1EJt): the list and each pull request's page, read from
 * GitHub with the repository's key. Past GitHub's 3,000-file list, files and changes come from the console API's
 * own copy of the repository (`RepoCopy`), the same on this Mac and on a server.
 */
@Injectable()
export class PullsService {
	private readonly files = new Recent<FilesRead>();
	private readonly commitsRead = new Recent<CommitRead>();

	constructor(
		private readonly reads: VendorReadsService,
		private readonly copy: RepoCopy,
	) {}

	list(p: string, r: string, state: 'open' | 'closed'): Promise<VendorAnswer<PullRow[]>> {
		return this.reads.sourceCode(p, r, (repo, key) => pullRows(repo, key, state));
	}

	page(p: string, r: string, n: number): Promise<VendorAnswer<PullPage>> {
		return this.reads.sourceCode(p, r, (repo, key) => pullPage(repo, key, n));
	}

	commits(p: string, r: string, n: number, page: number): Promise<VendorAnswer<PullCommits>> {
		return this.reads.sourceCode(p, r, (repo, key) => pullCommits(repo, key, n, page));
	}

	/** A GitHub Actions check's log, its last 200 lines. */
	log(p: string, r: string, job: number): Promise<VendorAnswer<PullLog>> {
		return this.reads.sourceCode(p, r, async (repo, key) => ({ lines: await jobLog(repo, key, String(job), 200) }));
	}

	changedFiles(p: string, r: string, n: number): Promise<VendorAnswer<PullFiles>> {
		return this.reads.sourceCode(p, r, async (repo, key) => (await this.filesOf(repo, key, n)).list);
	}

	commit(p: string, r: string, sha: string): Promise<VendorAnswer<PullCommitPage>> {
		return this.reads.sourceCode(p, r, async (repo, key) => {
			const c = await this.commitOf(repo, key, sha);
			return {
				sha: c.sha,
				message: c.message,
				author: c.author,
				date: c.date,
				checks: c.checks,
				files: {
					total: c.files.length,
					source: 'github',
					note: c.cut
						? `GitHub lists a commit's first ${count(GITHUB_FILE_LIMIT)} files; this one has more.`
						: '',
					files: c.files.map((f) => f.file),
				},
			};
		});
	}

	diff(p: string, r: string, n: number, q: PullDiffQuery): Promise<VendorAnswer<PullDiff>> {
		return this.reads.sourceCode(p, r, async (repo, key) => {
			const whole = q.whole === '1';
			if (q.commit) {
				const c = await this.commitOf(repo, key, q.commit);
				const found = c.files.find((f) => f.file.path === q.path);
				if (!found) throw new VendorError(`${q.path} is not changed in ${q.commit.slice(0, 8)}.`, 404);
				if (found.patch !== null && !whole) return fromPatch(found.file, found.patch);
				const dir = await this.copy.ready(repo, key, [q.commit], [q.commit]);
				const parent = await this.copy.parent(dir, q.commit);
				const d = await this.copy.diff(dir, [parent, q.commit], q.path, found.file.previous, whole);
				return fromCopy(found.file, d, whole);
			}
			const { list, patches, head } = await this.filesOf(repo, key, n);
			const file = list.files.find((f) => f.path === q.path);
			if (!file) throw new VendorError(`${q.path} is not changed in #${n}.`, 404);
			const patch = patches.get(q.path);
			if (patch && !whole) return fromPatch(file, patch);
			const dir = await this.copy.ready(repo, key, [head.baseSha, head.headSha], refspecs(n, head.base));
			const d = await this.copy.diff(dir, [`${head.baseSha}...${head.headSha}`], file.path, file.previous, whole);
			return fromCopy(file, d, whole);
		});
	}

	/**
	 * What the pull request would hold with `base` as its base (Change the base branch, A3): GitHub's commit count,
	 * and its file count, from the console's own copy when GitHub's compare stops listing at 300.
	 */
	basePreview(p: string, r: string, n: number, base: string): Promise<VendorAnswer<PullBasePreview>> {
		return this.reads.sourceCode(p, r, async (repo, key) => {
			const head = await pullHead(repo, key, n);
			const c = await compareCounts(repo, key, base, head.headSha);
			if (c.files < GITHUB_COMPARE_FILES) return { base, commits: c.commits, files: c.files };
			const dir = await this.copy.ready(repo, key, [c.baseSha, head.headSha], refspecs(n, base));
			const files = await this.copy.files(dir, [`${c.baseSha}...${head.headSha}`]);
			return { base, commits: c.commits, files: files.length };
		});
	}

	/** The pull request's files: GitHub's list up to its 3,000, the console's own copy past that. */
	private async filesOf(repo: string, key: string, n: number): Promise<FilesRead & { head: Head }> {
		const head = await pullHead(repo, key, n);
		const read = await this.files.get(`${repo}#${n}@${head.headSha}`, () => this.readFiles(repo, key, n, head));
		return { ...read, head };
	}

	private async readFiles(repo: string, key: string, n: number, head: Head): Promise<FilesRead> {
		const fromGithub = async (note: string) => {
			const got = await githubPullFiles(repo, key, n, head.changedFiles);
			return {
				list: { total: head.changedFiles, source: 'github' as const, note, files: got.map((g) => g.file) },
				patches: new Map(got.map((g) => [g.file.path, g.patch])),
			};
		};
		if (head.changedFiles <= GITHUB_FILE_LIMIT) return fromGithub('');
		try {
			const dir = await this.copy.ready(repo, key, [head.baseSha, head.headSha], refspecs(n, head.base));
			const files = await this.copy.files(dir, [`${head.baseSha}...${head.headSha}`]);
			return {
				list: {
					total: files.length,
					source: 'copy',
					note: `${count(files.length)} files. GitHub lists a pull request's first ${count(GITHUB_FILE_LIMIT)}, so this list and every change come from the console's own copy of the repository.`,
					files,
				},
				patches: new Map(),
			};
		} catch (error) {
			const missing = head.changedFiles - GITHUB_FILE_LIMIT;
			return fromGithub(
				`${count(head.changedFiles)} files. GitHub lists the first ${count(GITHUB_FILE_LIMIT)}, and the console's own copy of the repository could not be brought up to date (${(error as Error).message}), so ${count(missing)} are not listed here.`,
			);
		}
	}

	private commitOf(repo: string, key: string, sha: string): Promise<CommitRead> {
		return this.commitsRead.get(`${repo}@${sha}`, () => githubCommit(repo, key, sha));
	}
}

/** What the copy fetches for a pull request: its head and its base branch. */
export const refspecs = (n: number, base: string) => [
	`+refs/pull/${n}/head:refs/pull/${n}/head`,
	`+refs/heads/${base}:refs/heads/${base}`,
];

export const fromPatch = (file: PullFile, patch: string): PullDiff => ({
	path: file.path,
	previous: file.previous,
	status: file.status,
	binary: false,
	sizeBefore: null,
	sizeAfter: null,
	whole: false,
	source: 'github',
	lines: diffLines(patch),
});

export const fromCopy = (file: PullFile, d: CopyDiff, whole: boolean): PullDiff => ({
	path: file.path,
	previous: file.previous,
	status: file.status,
	binary: d.binary,
	sizeBefore: d.sizeBefore,
	sizeAfter: d.sizeAfter,
	whole,
	source: 'copy',
	lines: d.lines,
});
