import { Injectable } from '@nestjs/common';
import type {
	BranchRules,
	CodeActivity,
	CodeBlame,
	CodeBranches,
	CodeCompare,
	CodeDoc,
	CodeDone,
	CodeFile,
	CodeHtml,
	CodePackages,
	CodeHistory,
	CodeHistoryQuery,
	CodePaths,
	CodeRefs,
	CodeReleases,
	CodeSearch,
	CodeTags,
	CodeTree,
	CommunityFile,
	PullDiff,
	PullFile,
	ReleaseNotes,
	RepoInfo,
	VendorAnswer,
} from '@saha-textile/release-console-contracts';

import { type CopyReads, allPaths, blame, folderEntries, lastCommits, rawType, readFile, search } from './code-git.js';
import {
	activityOf,
	branchRules,
	branchesOf,
	compareOf,
	historyOf,
	markdownOf,
	packagesOf,
	readmeOf,
	renderMarkdown,
	refHead,
	refsOf,
	releaseNotes,
	releasesOf,
	repoInfo,
	tagsOf,
	zipOf,
} from './github-code.js';
import { gh, githubFile } from '../pulls/github-pulls.js';
import { Recent, fromCopy, fromPatch } from '../pulls/pulls.service.js';
import { RepoCopy } from '../pulls/repo-copy.js';
import { VendorReadsService } from '../projects/vendor-reads.service.js';
import { ConsoleStore } from '../store/console-store.js';
import { VendorError, rec, str } from '../vendors/http.js';

/** What the copy fetches when a commit is missing: every branch and tag. */
export const CODE_REFSPECS = ['+refs/heads/*:refs/heads/*', '+refs/tags/*:refs/tags/*'];
/** GitHub's compare lists this many changed files at most; past it the copy lists them. */
const COMPARE_FILES = 300;

const COMMUNITY: Array<[CommunityFile['key'], string, RegExp]> = [
	['readme', 'README', /^README(\.[A-Za-z]+)?$/i],
	['conduct', 'Code of conduct', /^(\.github\/|docs\/)?CODE_OF_CONDUCT(\.[A-Za-z]+)?$/i],
	['contributing', 'Contributing', /^(\.github\/|docs\/)?CONTRIBUTING(\.[A-Za-z]+)?$/i],
	['license', 'License', /^(LICEN[CS]E|COPYING)(\.[A-Za-z]+)?$/i],
	['security', 'Security', /^(\.github\/|docs\/)?SECURITY(\.[A-Za-z]+)?$/i],
];

/** The README, code of conduct, contributing guide, licence and security policy a branch has, for the home's tabs. */
export function communityFrom(paths: readonly string[]): CommunityFile[] {
	return COMMUNITY.flatMap(([key, label, re]) => {
		const path = paths.find((p) => re.test(p));
		return path ? [{ key, label, path }] : [];
	});
}

const escape = (text: string) =>
	text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
const markdown = (path: string) => /\.(md|markdown|mdx)$/i.test(path);

/**
 * Ship › Code › Code (brief 7Hu1SuB3A8qiJzeDwvFZLR, Part C): GitHub's repository pages, read through the
 * repository's key. Files, blame, search and each entry's last commit come from the console API's own copy of the
 * repository, so any size works on this Mac and on a server; every change is made through GitHub and kept in the
 * audit log.
 */
@Injectable()
export class CodeService {
	private readonly folders = new Recent<CodeTree['entries']>();
	private readonly pathLists = new Recent<string[]>();
	private readonly compares = new Recent<Awaited<ReturnType<typeof compareOf>>>();

	constructor(
		private readonly reads: VendorReadsService,
		private readonly copy: RepoCopy,
		private readonly store: ConsoleStore,
	) {}

	/** The copy, holding `sha`; it fetches every branch and tag when it lacks it. */
	private ready(repo: string, key: string, sha: string): Promise<string> {
		return this.copy.ready(repo, key, [sha], CODE_REFSPECS);
	}
	private get git(): CopyReads {
		return this.copy;
	}
	private paths(repo: string, key: string, sha: string): Promise<string[]> {
		return this.pathLists.get(`${repo}@${sha}`, async () =>
			allPaths(this.git, await this.ready(repo, key, sha), sha),
		);
	}

	repo(p: string, r: string): Promise<VendorAnswer<RepoInfo>> {
		return this.reads.sourceCode(p, r, async (repo, key) => {
			const info = await repoInfo(repo, key);
			const { sha } = await refHead(repo, key, info.defaultBranch, '');
			return { ...info, community: communityFrom(await this.paths(repo, key, sha)) };
		});
	}

	/** A folder: the newest commit that reaches it, its entries with their last commits, and its README. */
	tree(p: string, r: string, ref: string, path: string): Promise<VendorAnswer<CodeTree>> {
		return this.reads.sourceCode(p, r, async (repo, key) => {
			const { sha, head, commits } = await refHead(repo, key, ref, path);
			const entries = await this.folders.get(`${repo}@${sha}:${path}`, async () => {
				const dir = await this.ready(repo, key, sha);
				return lastCommits(this.git, dir, sha, path, await folderEntries(this.git, dir, sha, path));
			});
			// Git keeps no empty folders, so a path with nothing under it names a file (or nothing) and has no README;
			// the page then opens it as a file, as GitHub does with a folder address that names one.
			const readme = path && !entries.length ? null : await readmeOf(repo, key, ref, path);
			return { ref, sha, path, head, commits, entries, readme };
		});
	}

	/** A community file for the home's tabs: Markdown as GitHub draws it, anything else as its text. */
	doc(p: string, r: string, ref: string, path: string): Promise<VendorAnswer<CodeDoc>> {
		return this.reads.sourceCode(p, r, async (repo, key) => {
			if (markdown(path)) return { path, html: await markdownOf(repo, key, ref, path) };
			const { sha } = await refHead(repo, key, ref, path);
			const file = await readFile(this.git, await this.ready(repo, key, sha), sha, path);
			return { path, html: `<pre>${escape(file.text ?? '')}</pre>` };
		});
	}

	markdown(p: string, r: string, text: string): Promise<VendorAnswer<CodeHtml>> {
		return this.reads.sourceCode(p, r, async (repo, key) => ({ html: await renderMarkdown(repo, key, text) }));
	}

	refs(p: string, r: string): Promise<VendorAnswer<CodeRefs>> {
		return this.reads.sourceCode(p, r, async (repo, key) => refsOf(repo, key, await this.defaultBranch(repo, key)));
	}

	allPaths(p: string, r: string, ref: string): Promise<VendorAnswer<CodePaths>> {
		return this.reads.sourceCode(p, r, async (repo, key) => {
			const { sha } = await refHead(repo, key, ref, '');
			return { ref, sha, paths: await this.paths(repo, key, sha) };
		});
	}

	file(p: string, r: string, ref: string, path: string): Promise<VendorAnswer<CodeFile>> {
		return this.reads.sourceCode(p, r, async (repo, key) => {
			const { sha, head } = await refHead(repo, key, ref, path);
			const read = await readFile(this.git, await this.ready(repo, key, sha), sha, path);
			const html = read.kind === 'text' && markdown(path) ? await markdownOf(repo, key, ref, path) : null;
			return { ref, sha, path, ...read, html, last: head };
		});
	}

	packages(p: string, r: string): Promise<VendorAnswer<CodePackages>> {
		return this.reads.sourceCode(p, r, (repo, key) => packagesOf(repo, key));
	}

	/** A ref's files as one .zip, or why not. */
	async zip(p: string, r: string, ref: string): Promise<{ body: Buffer; name: string } | { error: string }> {
		const a = await this.reads.sourceCode(p, r, async (repo, key) => ({
			body: await zipOf(repo, key, ref),
			name: `${repo.slice(repo.indexOf('/') + 1)}-${ref.replace(/\//g, '-')}.zip`,
		}));
		return a.state === 'ok' ? a.data : { error: a.message };
	}

	/** A file's bytes for Raw, Download and pictures. */
	async raw(
		p: string,
		r: string,
		ref: string,
		path: string,
	): Promise<{ body: Buffer; type: string } | { error: string }> {
		const a = await this.reads.sourceCode(p, r, async (repo, key) => {
			const { sha } = await refHead(repo, key, ref, path);
			const body = await this.git.bytes(await this.ready(repo, key, sha), `${sha}:${path}`);
			return { body, type: rawType(path, body) };
		});
		return a.state === 'ok' ? a.data : { error: a.message };
	}

	blame(p: string, r: string, ref: string, path: string): Promise<VendorAnswer<CodeBlame>> {
		return this.reads.sourceCode(p, r, async (repo, key) => {
			const { sha } = await refHead(repo, key, ref, path);
			return { ref, sha, path, ...(await blame(this.git, await this.ready(repo, key, sha), sha, path)) };
		});
	}

	history(p: string, r: string, q: CodeHistoryQuery): Promise<VendorAnswer<CodeHistory>> {
		return this.reads.sourceCode(p, r, (repo, key) => historyOf(repo, key, q));
	}

	branches(p: string, r: string): Promise<VendorAnswer<CodeBranches>> {
		return this.reads.sourceCode(p, r, async (repo, key) =>
			branchesOf(repo, key, await this.defaultBranch(repo, key)),
		);
	}

	rules(p: string, r: string, branch: string): Promise<VendorAnswer<BranchRules>> {
		return this.reads.sourceCode(p, r, (repo, key) => branchRules(repo, key, branch));
	}

	tags(p: string, r: string, after: string): Promise<VendorAnswer<CodeTags>> {
		return this.reads.sourceCode(p, r, (repo, key) => tagsOf(repo, key, after));
	}

	releases(p: string, r: string, page: number): Promise<VendorAnswer<CodeReleases>> {
		return this.reads.sourceCode(p, r, (repo, key) => releasesOf(repo, key, page));
	}

	notes(
		p: string,
		r: string,
		q: { tag: string; target: string; previous: string },
	): Promise<VendorAnswer<ReleaseNotes>> {
		return this.reads.sourceCode(p, r, (repo, key) => releaseNotes(repo, key, q));
	}

	search(p: string, r: string, ref: string, q: string): Promise<VendorAnswer<CodeSearch>> {
		return this.reads.sourceCode(p, r, async (repo, key) => {
			const { sha } = await refHead(repo, key, ref, '');
			return search(this.git, await this.ready(repo, key, sha), sha, q);
		});
	}

	activity(
		p: string,
		r: string,
		q: { ref: string; actor: string; kind: string; after: string },
	): Promise<VendorAnswer<CodeActivity>> {
		return this.reads.sourceCode(p, r, (repo, key) => activityOf(repo, key, q));
	}

	/** Two refs compared: GitHub's commits and its first 300 files, or every file from the copy past that. */
	compare(p: string, r: string, base: string, head: string): Promise<VendorAnswer<CodeCompare>> {
		return this.reads.sourceCode(p, r, async (repo, key) => {
			const c = await this.compared(repo, key, base, head);
			const files = await this.compareFiles(repo, key, base, head, c);
			return {
				base,
				head,
				status: c.status,
				ahead: c.ahead,
				behind: c.behind,
				commits: c.commits,
				files,
				pull: c.pull,
			};
		});
	}

	/** One file's changes between two refs. */
	compareDiff(
		p: string,
		r: string,
		base: string,
		head: string,
		path: string,
		whole: boolean,
	): Promise<VendorAnswer<PullDiff>> {
		return this.reads.sourceCode(p, r, async (repo, key) => {
			const c = await this.compared(repo, key, base, head);
			const listed = c.files.map(githubFile);
			const found = listed.find((f) => f.file.path === path);
			if (found?.patch && !whole) return fromPatch(found.file, found.patch);
			const tip = (await refHead(repo, key, head, '')).sha;
			const dir = await this.copy.ready(repo, key, [c.mergeBase, tip], CODE_REFSPECS);
			const file = found?.file ?? (await this.copy.files(dir, [c.mergeBase, tip])).find((f) => f.path === path);
			if (!file) throw new VendorError(`${path} is not changed between ${base} and ${head}.`, 404);
			return fromCopy(
				file,
				await this.copy.diff(dir, [c.mergeBase, tip], file.path, file.previous, whole),
				whole,
			);
		});
	}

	private compared(repo: string, key: string, base: string, head: string) {
		return this.compares.get(`${repo}:${base}...${head}`, () => compareOf(repo, key, base, head));
	}

	private async compareFiles(
		repo: string,
		key: string,
		base: string,
		head: string,
		c: Awaited<ReturnType<typeof compareOf>>,
	): Promise<CodeCompare['files']> {
		if (c.files.length < COMPARE_FILES) {
			const files = c.files.map((f) => githubFile(f).file);
			return { total: files.length, source: 'github', note: '', files };
		}
		const tip = (await refHead(repo, key, head, '')).sha;
		const dir = await this.copy.ready(repo, key, [c.mergeBase, tip], CODE_REFSPECS);
		const files: PullFile[] = await this.copy.files(dir, [c.mergeBase, tip]);
		return {
			total: files.length,
			source: 'copy',
			note: `${files.length.toLocaleString('en-IN')} files. GitHub's compare lists the first ${COMPARE_FILES}, so this list and every change come from the console's own copy of the repository (${base} … ${head}).`,
			files,
		};
	}

	private async defaultBranch(repo: string, key: string): Promise<string> {
		return str(rec((await gh(`https://api.github.com/repos/${repo}`, key)).body)['default_branch']);
	}

	/**
	 * A change through GitHub with the repository's key, in the audit log either way (`code-<action>` or
	 * `code-<action>-refused`). The PIN was checked by the route.
	 */
	async change(
		p: string,
		r: string,
		action: string,
		make: (repo: string, key: string) => Promise<CodeDone>,
	): Promise<VendorAnswer<CodeDone>> {
		const a = await this.reads.sourceCode(p, r, make);
		if (a.state === 'ok') this.store.audit(p, `code-${action}`, a.data.message);
		else this.store.audit(p, `code-${action}-refused`, a.message);
		// Compares are kept by branch name, so one read before the change is stale now (folders and paths are kept by
		// commit and stay true).
		this.compares.clear();
		return a;
	}
}
