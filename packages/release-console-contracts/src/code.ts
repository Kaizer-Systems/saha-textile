/**
 * Ship › Code › Code (brief 7Hu1SuB3A8qiJzeDwvFZLR, Part C, approved 24 Nov 2026): GitHub's repository pages in the
 * console. The repository's facts and every change go through GitHub; files, blame, search and each file's last
 * commit are read with git from the console API's own copy of the repository, on this Mac or on a server alike.
 */
import { z } from 'zod';

import { branchNameSchema, vendorAnswer } from './projects.js';
import { pullFilesSchema } from './pulls.js';

const count = z.number().int().nonnegative();
const sha = z.string().regex(/^[0-9a-f]{7,40}$/, 'A commit id is 7 to 40 hexadecimal characters.');
const pin = z.string().regex(/^\d{6}$/);

/** A branch, a tag or a commit id: what the Code pages show. */
export const codeRefSchema = z.union([sha, branchNameSchema]);
/** A path inside the repository: no leading slash and no `..` step; empty for its top. */
export const codePathSchema = z
	.string()
	.max(1_000)
	.regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\0]*$/, 'Not a path in the repository.')
	.default('');

/** How a commit's checks stand, as one word. */
export const codeChecksSchema = z.enum(['passed', 'failed', 'running', 'none']);
export type CodeChecks = z.infer<typeof codeChecksSchema>;

/** One commit as a line: its id, headline, author, date and checks. */
export const codeCommitSchema = z.object({
	sha: z.string(),
	headline: z.string(),
	author: z.string(),
	login: z.string().nullable(),
	date: z.string(),
	checks: codeChecksSchema,
});
export type CodeCommit = z.infer<typeof codeCommitSchema>;

/* ===== C1: the repository's home ===== */

export const repoLanguageSchema = z.object({ name: z.string(), color: z.string().nullable(), share: z.number() });
export type RepoLanguage = z.infer<typeof repoLanguageSchema>;

export const communityFileSchema = z.object({
	key: z.enum(['readme', 'license', 'conduct', 'contributing', 'security']),
	label: z.string(),
	path: z.string(),
});
export type CommunityFile = z.infer<typeof communityFileSchema>;

export const repoInfoSchema = z.object({
	owner: z.string(),
	name: z.string(),
	url: z.string(),
	visibility: z.enum(['public', 'private', 'internal']),
	description: z.string().nullable(),
	homepage: z.string().nullable(),
	topics: z.array(z.string()),
	stars: count,
	watchers: count,
	forks: count,
	defaultBranch: z.string(),
	/** Who the repository's key signs in as. */
	viewer: z.string(),
	license: z.string().nullable(),
	/** This sign-in's watch setting. */
	watching: z.enum(['subscribed', 'ignored', 'none']),
	starred: z.boolean(),
	branches: count,
	tags: count,
	releases: z.object({
		total: count,
		latest: z.object({ name: z.string(), tag: z.string(), publishedAt: z.string().nullable() }).nullable(),
	}),
	environments: z.array(
		z.object({ name: z.string(), deployedAt: z.string().nullable(), state: z.string().nullable() }),
	),
	contributors: z.object({ total: count, people: z.array(z.object({ login: z.string(), contributions: count })) }),
	/** GitHub's own languages with its colours, worked out from the default branch. */
	languages: z.array(repoLanguageSchema),
	community: z.array(communityFileSchema),
});
export type RepoInfo = z.infer<typeof repoInfoSchema>;
export const repoInfoAnswerSchema = vendorAnswer(repoInfoSchema);

export const treeEntrySchema = z.object({
	name: z.string(),
	path: z.string(),
	kind: z.enum(['dir', 'file', 'link', 'module']),
	/** The last commit that changed it, from the console's copy. */
	last: z.object({ sha: z.string(), headline: z.string(), date: z.string() }).nullable(),
});
export type TreeEntry = z.infer<typeof treeEntrySchema>;

export const codeTreeSchema = z.object({
	ref: z.string(),
	/** The commit the ref points at. */
	sha: z.string(),
	path: z.string(),
	head: codeCommitSchema,
	/** Commits that reach this folder (the whole history at the top). */
	commits: count,
	entries: z.array(treeEntrySchema),
	/** The folder's README as GitHub draws it, when it has one. */
	readme: z.object({ path: z.string(), html: z.string() }).nullable(),
});
export type CodeTree = z.infer<typeof codeTreeSchema>;
export const codeTreeAnswerSchema = vendorAnswer(codeTreeSchema);
export const codeTreeQuerySchema = z.object({ ref: codeRefSchema, path: codePathSchema });

/** A community file (licence, code of conduct, contributing, security policy) as GitHub draws it. */
export const codeDocSchema = z.object({ path: z.string(), html: z.string() });
export type CodeDoc = z.infer<typeof codeDocSchema>;
export const codeDocAnswerSchema = vendorAnswer(codeDocSchema);

/* ===== C2 and C4: refs and every path ===== */

export const codeRefsSchema = z.object({
	defaultBranch: z.string(),
	branches: z.array(z.object({ name: z.string(), rule: z.boolean() })),
	tags: z.array(z.string()),
});
export type CodeRefs = z.infer<typeof codeRefsSchema>;
export const codeRefsAnswerSchema = vendorAnswer(codeRefsSchema);

export const codePathsSchema = z.object({ ref: z.string(), sha: z.string(), paths: z.array(z.string()) });
export type CodePaths = z.infer<typeof codePathsSchema>;
export const codePathsAnswerSchema = vendorAnswer(codePathsSchema);
export const codeRefQuerySchema = z.object({ ref: codeRefSchema });

/* ===== C5 and C6: a file, and its blame ===== */

export const codeFileSchema = z.object({
	ref: z.string(),
	sha: z.string(),
	path: z.string(),
	size: count,
	/** `text` is shown with its lines; a picture is fetched from the raw route; past 1 MB only Raw and Download. */
	kind: z.enum(['text', 'image', 'binary', 'big']),
	text: z.string().nullable(),
	lines: count.nullable(),
	/** A Markdown file as GitHub draws it, for Preview. */
	html: z.string().nullable(),
	last: codeCommitSchema.nullable(),
});
export type CodeFile = z.infer<typeof codeFileSchema>;
export const codeFileAnswerSchema = vendorAnswer(codeFileSchema);

export const blameRunSchema = z.object({
	start: count,
	end: count,
	sha: z.string(),
	headline: z.string(),
	author: z.string(),
	date: z.string(),
	/** The commit before this one and the file's path there (it may have been renamed), for "the file before this change". */
	previous: z.object({ sha: z.string(), path: z.string() }).nullable(),
});
export type BlameRun = z.infer<typeof blameRunSchema>;
export const codeBlameSchema = z.object({
	ref: z.string(),
	sha: z.string(),
	path: z.string(),
	lines: z.array(z.string()),
	runs: z.array(blameRunSchema),
});
export type CodeBlame = z.infer<typeof codeBlameSchema>;
export const codeBlameAnswerSchema = vendorAnswer(codeBlameSchema);

/* ===== C7: history ===== */

export const codeHistorySchema = z.object({
	total: count,
	/** GitHub's cursor for the next 100, null at the end. */
	next: z.string().nullable(),
	commits: z.array(codeCommitSchema),
});
export type CodeHistory = z.infer<typeof codeHistorySchema>;
export const codeHistoryAnswerSchema = vendorAnswer(codeHistorySchema);
export const codeHistoryQuerySchema = z.object({
	ref: codeRefSchema,
	path: codePathSchema,
	author: z
		.string()
		.max(100)
		.regex(/^[A-Za-z0-9-]*$/)
		.default(''),
	since: z
		.string()
		.regex(/^(\d{4}-\d\d-\d\d)?$/)
		.default(''),
	until: z
		.string()
		.regex(/^(\d{4}-\d\d-\d\d)?$/)
		.default(''),
	after: z.string().max(200).default(''),
});
export type CodeHistoryQuery = z.infer<typeof codeHistoryQuerySchema>;

/* ===== C8: branches ===== */

export const branchRowSchema = z.object({
	name: z.string(),
	isDefault: z.boolean(),
	rule: z.boolean(),
	sha: z.string(),
	date: z.string(),
	author: z.string(),
	login: z.string().nullable(),
	/** Behind and ahead of the default branch. */
	behind: count,
	ahead: count,
	pull: z.object({ number: z.number().int(), state: z.enum(['open', 'closed', 'merged', 'draft']) }).nullable(),
	checks: codeChecksSchema,
});
export type BranchRow = z.infer<typeof branchRowSchema>;
export const codeBranchesSchema = z.object({
	defaultBranch: z.string(),
	viewer: z.string(),
	rows: z.array(branchRowSchema),
});
export type CodeBranches = z.infer<typeof codeBranchesSchema>;
export const codeBranchesAnswerSchema = vendorAnswer(codeBranchesSchema);

export const branchRulesSchema = z.object({
	branch: z.string(),
	rules: z.array(z.object({ type: z.string(), ruleset: z.string() })),
});
export type BranchRules = z.infer<typeof branchRulesSchema>;
export const branchRulesAnswerSchema = vendorAnswer(branchRulesSchema);
export const branchQuerySchema = z.object({ branch: branchNameSchema });

/* ===== C10: tags and releases ===== */

export const codeTagSchema = z.object({
	name: z.string(),
	sha: z.string(),
	date: z.string().nullable(),
	release: z.boolean(),
});
export type CodeTag = z.infer<typeof codeTagSchema>;
export const codeTagsSchema = z.object({ tags: z.array(codeTagSchema), next: z.string().nullable() });
export type CodeTags = z.infer<typeof codeTagsSchema>;
export const codeTagsAnswerSchema = vendorAnswer(codeTagsSchema);

export const releaseAssetSchema = z.object({
	id: z.number().int(),
	name: z.string(),
	size: count,
	downloads: count,
	url: z.string(),
});
export type ReleaseAsset = z.infer<typeof releaseAssetSchema>;
export const codeReleaseSchema = z.object({
	id: z.number().int(),
	name: z.string(),
	tag: z.string(),
	target: z.string(),
	draft: z.boolean(),
	prerelease: z.boolean(),
	latest: z.boolean(),
	publishedAt: z.string().nullable(),
	author: z.string(),
	/** The notes as Markdown (for editing) and as GitHub draws them. */
	body: z.string(),
	bodyHtml: z.string(),
	url: z.string(),
	assets: z.array(releaseAssetSchema),
});
export type CodeRelease = z.infer<typeof codeReleaseSchema>;
export const codeReleasesSchema = z.object({ releases: z.array(codeReleaseSchema), more: z.boolean() });
export type CodeReleases = z.infer<typeof codeReleasesSchema>;
export const codeReleasesAnswerSchema = vendorAnswer(codeReleasesSchema);
export const codePageQuerySchema = z.object({ page: z.coerce.number().int().positive().max(1_000).default(1) });
export const codeAfterQuerySchema = z.object({ after: z.string().max(200).default('') });

export const releaseNotesSchema = z.object({ name: z.string(), body: z.string() });
export type ReleaseNotes = z.infer<typeof releaseNotesSchema>;
export const releaseNotesAnswerSchema = vendorAnswer(releaseNotesSchema);
export const releaseNotesQuerySchema = z.object({
	tag: branchNameSchema,
	target: branchNameSchema,
	previous: z.union([z.literal(''), branchNameSchema]).default(''),
});

/* ===== C11: search ===== */

export const codeSearchSchema = z.object({
	total: count,
	/** True when the matches went past the 500 shown. */
	cut: z.boolean(),
	files: z.array(z.object({ path: z.string(), lines: z.array(z.object({ n: count, text: z.string() })) })),
});
export type CodeSearch = z.infer<typeof codeSearchSchema>;
export const codeSearchAnswerSchema = vendorAnswer(codeSearchSchema);
export const codeSearchQuerySchema = z.object({ ref: codeRefSchema, q: z.string().min(1).max(200) });

/* ===== C12: compare ===== */

export const codeCompareSchema = z.object({
	base: z.string(),
	head: z.string(),
	status: z.enum(['identical', 'ahead', 'behind', 'diverged']),
	ahead: count,
	behind: count,
	commits: z.array(codeCommitSchema),
	files: pullFilesSchema,
	/** An open pull request for these two branches, when there is one. */
	pull: z.object({ number: z.number().int(), title: z.string() }).nullable(),
});
export type CodeCompare = z.infer<typeof codeCompareSchema>;
export const codeCompareAnswerSchema = vendorAnswer(codeCompareSchema);
export const codeCompareQuerySchema = z.object({ base: codeRefSchema, head: codeRefSchema });
export const codeCompareDiffQuerySchema = codeCompareQuerySchema.extend({
	path: z.string().min(1).max(1_000),
	whole: z.enum(['0', '1']).default('0'),
});

/* ===== C13: activity ===== */

export const codeActivitySchema = z.object({
	rows: z.array(
		z.object({
			kind: z.string(),
			ref: z.string(),
			actor: z.string(),
			at: z.string(),
			before: z.string(),
			after: z.string(),
		}),
	),
	next: z.string().nullable(),
});
export type CodeActivity = z.infer<typeof codeActivitySchema>;
export const codeActivityAnswerSchema = vendorAnswer(codeActivitySchema);
export const codeActivityQuerySchema = z.object({
	ref: z.union([z.literal(''), branchNameSchema]).default(''),
	actor: z
		.string()
		.max(100)
		.regex(/^[A-Za-z0-9-]*$/)
		.default(''),
	kind: z.enum(['', 'push', 'force_push', 'branch_creation', 'branch_deletion', 'pr_merge']).default(''),
	after: z.string().max(400).default(''),
});

/* ===== changes, each with the console PIN ===== */

/** What a change sent back: in words, and where to go next. */
export const codeDoneSchema = z.object({
	message: z.string(),
	url: z.string().nullable(),
	branch: z.string().nullable(),
});
export type CodeDone = z.infer<typeof codeDoneSchema>;

export const branchCreateSchema = z.object({ pin, name: branchNameSchema, from: codeRefSchema });
export const branchRenameSchema = z.object({ pin, name: branchNameSchema, to: branchNameSchema });
export const branchDeleteSchema = z.object({ pin, name: branchNameSchema });

/** GitHub's own web upload limit for one file, and for one commit's files. */
export const FILE_LIMIT_BYTES = 25 * 1024 * 1024;
export const COMMIT_FILES_LIMIT = 100;

export const codeFileChangeSchema = z.object({
	path: z
		.string()
		.min(1)
		.max(1_000)
		.regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\0]*$/, 'Not a path in the repository.'),
	/** The file's new content in base64; null deletes it. */
	content: z
		.string()
		.max(Math.ceil((FILE_LIMIT_BYTES * 4) / 3) + 4)
		.nullable(),
});
export type CodeFileChange = z.infer<typeof codeFileChangeSchema>;
export const commitWriteSchema = z.object({
	pin,
	/** The branch the change starts from. */
	branch: branchNameSchema,
	message: z.string().min(1).max(500),
	description: z.string().max(10_000).default(''),
	changes: z.array(codeFileChangeSchema).min(1).max(COMMIT_FILES_LIMIT),
	/** A new branch for the commit (with a pull request into `branch` when `pull`), or '' for straight onto `branch`. */
	newBranch: z.union([z.literal(''), branchNameSchema]).default(''),
	pull: z.boolean().default(true),
});
export type CommitWrite = z.infer<typeof commitWriteSchema>;

export const releaseWriteSchema = z.object({
	pin,
	/** Null makes a new release. */
	id: z.number().int().positive().nullable().default(null),
	tag: branchNameSchema,
	target: branchNameSchema,
	name: z.string().max(200).default(''),
	body: z.string().max(125_000).default(''),
	draft: z.boolean().default(false),
	prerelease: z.boolean().default(false),
	latest: z.boolean().default(true),
	/** Files to attach once the release is made, as GitHub's release form attaches them. */
	assets: z
		.array(
			z.object({
				name: z
					.string()
					.min(1)
					.max(255)
					.regex(/^[^/\\\0]+$/),
				content: z.string().max(Math.ceil((FILE_LIMIT_BYTES * 4) / 3) + 4),
			}),
		)
		.max(10)
		.default([]),
});
export type ReleaseWrite = z.infer<typeof releaseWriteSchema>;
export const releaseDeleteSchema = z.object({ pin, id: z.number().int().positive() });
export const assetWriteSchema = z.object({
	pin,
	release: z.number().int().positive(),
	name: z
		.string()
		.min(1)
		.max(255)
		.regex(/^[^/\\\0]+$/),
	content: z.string().max(Math.ceil((FILE_LIMIT_BYTES * 4) / 3) + 4),
});
export const assetDeleteSchema = z.object({ pin, id: z.number().int().positive() });

export const aboutWriteSchema = z.object({
	pin,
	description: z.string().max(350).default(''),
	homepage: z.union([z.literal(''), z.string().url().max(255)]).default(''),
	topics: z
		.array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,49}$/))
		.max(20)
		.default([]),
});
export const watchWriteSchema = z.object({ pin, watching: z.enum(['subscribed', 'ignored', 'none']) });
export const starWriteSchema = z.object({ pin, starred: z.boolean() });
export const forkWriteSchema = z.object({
	pin,
	name: z.union([z.literal(''), z.string().regex(/^[A-Za-z0-9._-]{1,100}$/)]).default(''),
	defaultOnly: z.boolean().default(true),
});
export const pullCreateSchema = z.object({
	pin,
	base: branchNameSchema,
	head: branchNameSchema,
	title: z.string().min(1).max(256),
	body: z.string().max(65_000).default(''),
	draft: z.boolean().default(false),
});

/** Markdown drawn by GitHub while editing a file (Preview); nothing is changed. */
export const markdownRenderSchema = z.object({ text: z.string().max(400_000) });
export const codeHtmlSchema = z.object({ html: z.string() });
export type CodeHtml = z.infer<typeof codeHtmlSchema>;
export const codeHtmlAnswerSchema = vendorAnswer(codeHtmlSchema);

/** The repository's packages (GitHub's container registry), for the home's right column (Q7 A). */
export const codePackagesSchema = z.object({
	packages: z.array(
		z.object({ name: z.string(), visibility: z.string(), updatedAt: z.string(), url: z.string(), versions: count }),
	),
});
export type CodePackages = z.infer<typeof codePackagesSchema>;
export const codePackagesAnswerSchema = vendorAnswer(codePackagesSchema);
