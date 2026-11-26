import { Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import {
	type BranchRules,
	type CodeActivity,
	type CodeBlame,
	type CodeBranches,
	type CodeCompare,
	type CodeDoc,
	type CodeDone,
	type CodeFile,
	type CodeHtml,
	type CodePackages,
	type CodeHistory,
	type CodePaths,
	type CodeRefs,
	type CodeReleases,
	type CodeSearch,
	type CodeTags,
	type CodeTree,
	type PullDiff,
	type ReleaseNotes,
	type RepoInfo,
	type VendorAnswer,
	aboutWriteSchema,
	assetDeleteSchema,
	assetWriteSchema,
	branchCreateSchema,
	branchDeleteSchema,
	branchQuerySchema,
	branchRenameSchema,
	codeActivityQuerySchema,
	codeAfterQuerySchema,
	codeCompareDiffQuerySchema,
	codeCompareQuerySchema,
	codeHistoryQuerySchema,
	codePageQuerySchema,
	codeRefQuerySchema,
	codeSearchQuerySchema,
	codeTreeQuerySchema,
	commitWriteSchema,
	forkWriteSchema,
	markdownRenderSchema,
	pullCreateSchema,
	releaseDeleteSchema,
	releaseNotesQuerySchema,
	releaseWriteSchema,
	starWriteSchema,
	watchWriteSchema,
} from '@saha-textile/release-console-contracts';
import { z } from 'zod';

import { CodeService } from './code.service.js';
import * as writes from './code-writes.js';
import { parseBody } from '../common/parse.js';
import { LockService } from '../lock/lock.service.js';
import { sessionOf } from '../lock/session.guard.js';

type Req = Parameters<typeof sessionOf>[0];
type Answer<T> = Promise<VendorAnswer<T>>;
interface RawReply {
	status(code: number): RawReply;
	header(name: string, value: string): RawReply;
	send(body: Buffer | string): void;
}
const fileQuery = codeTreeQuerySchema.extend({ path: z.string().min(1).max(1_000) });

/** Ship › Code › Code (brief 7Hu1SuB3A8qiJzeDwvFZLR, Part C): GitHub's repository pages and their changes. */
@Controller('api/projects/:p/repos/:r/github/code')
export class CodeController {
	constructor(
		private readonly code: CodeService,
		private readonly lock: LockService,
	) {}

	@Get('repo')
	repo(@Param('p') p: string, @Param('r') r: string): Answer<RepoInfo> {
		return this.code.repo(p, r);
	}

	@Get('tree')
	tree(@Param('p') p: string, @Param('r') r: string, @Query() q: unknown): Answer<CodeTree> {
		const { ref, path } = parseBody(codeTreeQuerySchema, q);
		return this.code.tree(p, r, ref, path);
	}

	@Get('doc')
	doc(@Param('p') p: string, @Param('r') r: string, @Query() q: unknown): Answer<CodeDoc> {
		const { ref, path } = parseBody(fileQuery, q);
		return this.code.doc(p, r, ref, path);
	}

	/** Markdown drawn by GitHub for Preview while editing: a read (nothing changes), so no PIN. */
	@Post('markdown')
	markdown(@Param('p') p: string, @Param('r') r: string, @Body() body: unknown): Answer<CodeHtml> {
		return this.code.markdown(p, r, parseBody(markdownRenderSchema, body).text);
	}

	@Get('refs')
	refs(@Param('p') p: string, @Param('r') r: string): Answer<CodeRefs> {
		return this.code.refs(p, r);
	}

	@Get('paths')
	paths(@Param('p') p: string, @Param('r') r: string, @Query() q: unknown): Answer<CodePaths> {
		return this.code.allPaths(p, r, parseBody(codeRefQuerySchema, q).ref);
	}

	@Get('file')
	file(@Param('p') p: string, @Param('r') r: string, @Query() q: unknown): Answer<CodeFile> {
		const { ref, path } = parseBody(fileQuery, q);
		return this.code.file(p, r, ref, path);
	}

	/** A file as stored: shown as a picture, opened as Raw, or saved with Download. */
	@Get('raw')
	async raw(
		@Param('p') p: string,
		@Param('r') r: string,
		@Query() q: unknown,
		@Res() reply: RawReply,
	): Promise<void> {
		const { ref, path } = parseBody(fileQuery, q);
		const got = await this.code.raw(p, r, ref, path);
		if ('error' in got) {
			reply.status(404).header('content-type', 'text/plain; charset=utf-8').send(got.error);
			return;
		}
		reply
			.header('content-type', got.type)
			.header('x-content-type-options', 'nosniff')
			.header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
			.send(got.body);
	}

	@Get('packages')
	packages(@Param('p') p: string, @Param('r') r: string): Answer<CodePackages> {
		return this.code.packages(p, r);
	}

	/** Code ▾ › Download ZIP: the ref's files as GitHub's .zip, saved under its own name. */
	@Get('zip')
	async zip(
		@Param('p') p: string,
		@Param('r') r: string,
		@Query() q: unknown,
		@Res() reply: RawReply,
	): Promise<void> {
		const got = await this.code.zip(p, r, parseBody(codeRefQuerySchema, q).ref);
		if ('error' in got) {
			reply.status(404).header('content-type', 'text/plain; charset=utf-8').send(got.error);
			return;
		}
		reply
			.header('content-type', 'application/zip')
			.header('content-disposition', `attachment; filename="${got.name}"`)
			.send(got.body);
	}

	@Get('blame')
	blame(@Param('p') p: string, @Param('r') r: string, @Query() q: unknown): Answer<CodeBlame> {
		const { ref, path } = parseBody(fileQuery, q);
		return this.code.blame(p, r, ref, path);
	}

	@Get('history')
	history(@Param('p') p: string, @Param('r') r: string, @Query() q: unknown): Answer<CodeHistory> {
		return this.code.history(p, r, parseBody(codeHistoryQuerySchema, q));
	}

	@Get('branches')
	branches(@Param('p') p: string, @Param('r') r: string): Answer<CodeBranches> {
		return this.code.branches(p, r);
	}

	@Get('rules')
	rules(@Param('p') p: string, @Param('r') r: string, @Query() q: unknown): Answer<BranchRules> {
		return this.code.rules(p, r, parseBody(branchQuerySchema, q).branch);
	}

	@Get('tags')
	tags(@Param('p') p: string, @Param('r') r: string, @Query() q: unknown): Answer<CodeTags> {
		return this.code.tags(p, r, parseBody(codeAfterQuerySchema, q).after);
	}

	@Get('releases')
	releases(@Param('p') p: string, @Param('r') r: string, @Query() q: unknown): Answer<CodeReleases> {
		return this.code.releases(p, r, parseBody(codePageQuerySchema, q).page);
	}

	@Get('notes')
	notes(@Param('p') p: string, @Param('r') r: string, @Query() q: unknown): Answer<ReleaseNotes> {
		return this.code.notes(p, r, parseBody(releaseNotesQuerySchema, q));
	}

	@Get('search')
	search(@Param('p') p: string, @Param('r') r: string, @Query() q: unknown): Answer<CodeSearch> {
		const { ref, q: words } = parseBody(codeSearchQuerySchema, q);
		return this.code.search(p, r, ref, words);
	}

	@Get('activity')
	activity(@Param('p') p: string, @Param('r') r: string, @Query() q: unknown): Answer<CodeActivity> {
		return this.code.activity(p, r, parseBody(codeActivityQuerySchema, q));
	}

	@Get('compare')
	compare(@Param('p') p: string, @Param('r') r: string, @Query() q: unknown): Answer<CodeCompare> {
		const { base, head } = parseBody(codeCompareQuerySchema, q);
		return this.code.compare(p, r, base, head);
	}

	@Get('compare/diff')
	compareDiff(@Param('p') p: string, @Param('r') r: string, @Query() q: unknown): Answer<PullDiff> {
		const { base, head, path, whole } = parseBody(codeCompareDiffQuerySchema, q);
		return this.code.compareDiff(p, r, base, head, path, whole === '1');
	}

	/* ===== changes: the PIN first, then GitHub, then the audit log ===== */

	private confirmed<T extends { pin: string }>(req: Req, schema: z.ZodType<T>, body: unknown, what: string): T {
		const input = parseBody(schema, body);
		this.lock.confirm(sessionOf(req), input.pin, what);
		return input;
	}

	@Post('branch')
	createBranch(
		@Param('p') p: string,
		@Param('r') r: string,
		@Body() body: unknown,
		@Req() req: Req,
	): Answer<CodeDone> {
		const w = this.confirmed(req, branchCreateSchema, body, 'make a branch');
		return this.code.change(p, r, 'branch', (repo, key) => writes.createBranch(repo, key, w.name, w.from));
	}

	@Post('branch/rename')
	renameBranch(
		@Param('p') p: string,
		@Param('r') r: string,
		@Body() body: unknown,
		@Req() req: Req,
	): Answer<CodeDone> {
		const w = this.confirmed(req, branchRenameSchema, body, 'rename a branch');
		return this.code.change(p, r, 'branch-rename', (repo, key) => writes.renameBranch(repo, key, w.name, w.to));
	}

	@Post('branch/delete')
	deleteBranch(
		@Param('p') p: string,
		@Param('r') r: string,
		@Body() body: unknown,
		@Req() req: Req,
	): Answer<CodeDone> {
		const w = this.confirmed(req, branchDeleteSchema, body, 'delete a branch');
		return this.code.change(p, r, 'branch-delete', (repo, key) => writes.deleteBranch(repo, key, w.name));
	}

	@Post('commit')
	commit(@Param('p') p: string, @Param('r') r: string, @Body() body: unknown, @Req() req: Req): Answer<CodeDone> {
		const w = this.confirmed(req, commitWriteSchema, body, 'commit files');
		return this.code.change(p, r, 'commit', (repo, key) => writes.commitFiles(repo, key, w));
	}

	@Post('release')
	release(@Param('p') p: string, @Param('r') r: string, @Body() body: unknown, @Req() req: Req): Answer<CodeDone> {
		const w = this.confirmed(req, releaseWriteSchema, body, 'save a release');
		return this.code.change(p, r, 'release', (repo, key) => writes.saveRelease(repo, key, w));
	}

	@Post('release/delete')
	deleteRelease(
		@Param('p') p: string,
		@Param('r') r: string,
		@Body() body: unknown,
		@Req() req: Req,
	): Answer<CodeDone> {
		const w = this.confirmed(req, releaseDeleteSchema, body, 'delete a release');
		return this.code.change(p, r, 'release-delete', (repo, key) => writes.deleteRelease(repo, key, w.id));
	}

	@Post('asset')
	asset(@Param('p') p: string, @Param('r') r: string, @Body() body: unknown, @Req() req: Req): Answer<CodeDone> {
		const w = this.confirmed(req, assetWriteSchema, body, 'attach a file to a release');
		return this.code.change(p, r, 'asset', (repo, key) =>
			writes.uploadAsset(repo, key, w.release, w.name, Buffer.from(w.content, 'base64')),
		);
	}

	@Post('asset/delete')
	deleteAsset(
		@Param('p') p: string,
		@Param('r') r: string,
		@Body() body: unknown,
		@Req() req: Req,
	): Answer<CodeDone> {
		const w = this.confirmed(req, assetDeleteSchema, body, 'remove a release file');
		return this.code.change(p, r, 'asset-delete', (repo, key) => writes.deleteAsset(repo, key, w.id));
	}

	@Post('about')
	about(@Param('p') p: string, @Param('r') r: string, @Body() body: unknown, @Req() req: Req): Answer<CodeDone> {
		const w = this.confirmed(req, aboutWriteSchema, body, 'change About');
		return this.code.change(p, r, 'about', (repo, key) => writes.saveAbout(repo, key, w));
	}

	@Post('watch')
	watch(@Param('p') p: string, @Param('r') r: string, @Body() body: unknown, @Req() req: Req): Answer<CodeDone> {
		const w = this.confirmed(req, watchWriteSchema, body, 'change watching');
		return this.code.change(p, r, 'watch', (repo, key) => writes.setWatching(repo, key, w.watching));
	}

	@Post('star')
	star(@Param('p') p: string, @Param('r') r: string, @Body() body: unknown, @Req() req: Req): Answer<CodeDone> {
		const w = this.confirmed(req, starWriteSchema, body, 'star the repository');
		return this.code.change(p, r, 'star', (repo, key) => writes.setStarred(repo, key, w.starred));
	}

	@Post('fork')
	fork(@Param('p') p: string, @Param('r') r: string, @Body() body: unknown, @Req() req: Req): Answer<CodeDone> {
		const w = this.confirmed(req, forkWriteSchema, body, 'fork the repository');
		return this.code.change(p, r, 'fork', (repo, key) => writes.forkRepository(repo, key, w));
	}

	@Post('pull')
	pull(@Param('p') p: string, @Param('r') r: string, @Body() body: unknown, @Req() req: Req): Answer<CodeDone> {
		const w = this.confirmed(req, pullCreateSchema, body, 'open a pull request');
		return this.code.change(p, r, 'pull', (repo, key) => writes.openPull(repo, key, w));
	}
}
