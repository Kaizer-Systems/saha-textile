/**
 * Ship › Code › Pull requests (brief E5WE6RSF2AJvpxDyDA1EJt, approved 24 Nov 2026): the list, and each
 * pull request's own page with its whole description, conversation, commits, checks and changed lines.
 * Everything is read from GitHub by the console API; a pull request past GitHub's 3,000-file list is
 * read from the console API's own copy of the repository (Q2), on this Mac or on a server alike.
 */
import { z } from 'zod';

import { vendorAnswer } from './projects.js';

/** Where a pull request stands. */
export const pullStateSchema = z.enum(['open', 'closed', 'merged']);
export type PullState = z.infer<typeof pullStateSchema>;

/** The checks on one commit, counted. */
export const checkCountsSchema = z.object({
	total: z.number().int().nonnegative(),
	running: z.number().int().nonnegative(),
	passed: z.number().int().nonnegative(),
	failed: z.number().int().nonnegative(),
});
export type CheckCounts = z.infer<typeof checkCountsSchema>;

/** What the reviews add up to: approved, changes asked for, a review still needed, or none asked. */
export const reviewStateSchema = z.enum(['approved', 'changes', 'required', 'none']);
export type ReviewState = z.infer<typeof reviewStateSchema>;

/** One row of the list. */
export const pullRowSchema = z.object({
	number: z.number().int().positive(),
	title: z.string(),
	author: z.string(),
	branch: z.string(),
	base: z.string(),
	draft: z.boolean(),
	state: pullStateSchema,
	updatedAt: z.string(),
	url: z.string().url(),
	commits: z.number().int().nonnegative(),
	additions: z.number().int().nonnegative(),
	deletions: z.number().int().nonnegative(),
	checks: checkCountsSchema.nullable(),
	review: reviewStateSchema,
});
export type PullRow = z.infer<typeof pullRowSchema>;
export const pullRowsAnswerSchema = vendorAnswer(z.array(pullRowSchema));

/** Which pull requests the list shows. */
export const pullListQuerySchema = z.object({ state: z.enum(['open', 'closed']).default('open') });

/** How one check run went. */
export const checkStatusSchema = z.enum(['queued', 'running', 'passed', 'failed', 'skipped', 'cancelled', 'neutral']);
export type CheckStatus = z.infer<typeof checkStatusSchema>;

/** One check run on the pull request's newest commit. */
export const pullCheckSchema = z.object({
	id: z.number().int(),
	name: z.string(),
	app: z.string(),
	status: checkStatusSchema,
	startedAt: z.string().nullable(),
	completedAt: z.string().nullable(),
	url: z.string(),
	/** A GitHub Actions job, whose log the console can show. */
	actionsJob: z.boolean(),
});
export type PullCheck = z.infer<typeof pullCheckSchema>;

/** One entry of the conversation's time line. */
export const pullEventSchema = z.object({
	kind: z.enum([
		'opened',
		'commented',
		'reviewed',
		'pushed',
		'force-pushed',
		'labeled',
		'unlabeled',
		'review-requested',
		'renamed',
		'merged',
		'closed',
		'reopened',
		'ready',
		'checks-started',
		'check-failed',
		'checks-passed',
		'other',
	]),
	who: z.string(),
	at: z.string(),
	/** The line in words ("pushed 14 commits"). */
	text: z.string(),
	/** A comment's or review's body as GitHub draws it; empty for other events. */
	html: z.string(),
	/** A review's verdict, a check's result: colours the event's icon. */
	tone: z.enum(['ok', 'amber', 'red', 'cy', 'muted']).nullable(),
	sha: z.string(),
	/** The failed check whose log the event opens. */
	checkId: z.number().int().nullable(),
	url: z.string(),
});
export type PullEvent = z.infer<typeof pullEventSchema>;

/** A reviewer and where their review stands. */
export const pullReviewerSchema = z.object({
	login: z.string(),
	state: z.enum(['approved', 'changes', 'commented', 'requested', 'dismissed']),
});

/** The pull request page's one read: everything above the tabs, the description and the conversation. */
export const pullPageSchema = z.object({
	number: z.number().int().positive(),
	title: z.string(),
	state: pullStateSchema,
	draft: z.boolean(),
	author: z.string(),
	base: z.string(),
	head: z.string(),
	baseSha: z.string(),
	headSha: z.string(),
	url: z.string().url(),
	createdAt: z.string(),
	updatedAt: z.string(),
	mergedAt: z.string().nullable(),
	mergedBy: z.string(),
	closedAt: z.string().nullable(),
	/** The description as GitHub draws it (`body_html`), whole. */
	bodyHtml: z.string(),
	/** Its length as written, in characters. */
	bodyLength: z.number().int().nonnegative(),
	commits: z.number().int().nonnegative(),
	additions: z.number().int().nonnegative(),
	deletions: z.number().int().nonnegative(),
	changedFiles: z.number().int().nonnegative(),
	/** Null while GitHub is still working it out. */
	mergeable: z.boolean().nullable(),
	mergeableState: z.string(),
	/** Merge when ready is on for this pull request. */
	autoMerge: z.boolean(),
	/** The repository lets a pull request merge itself when ready. */
	canAutoMerge: z.boolean(),
	checks: checkCountsSchema,
	checkList: z.array(pullCheckSchema),
	review: reviewStateSchema,
	reviewers: z.array(pullReviewerSchema),
	labels: z.array(z.string()),
	events: z.array(pullEventSchema),
});
export type PullPage = z.infer<typeof pullPageSchema>;
export const pullPageAnswerSchema = vendorAnswer(pullPageSchema);

/** One commit of the pull request. */
export const pullCommitSchema = z.object({
	sha: z.string(),
	headline: z.string(),
	author: z.string(),
	date: z.string(),
	checks: z.enum(['passed', 'failed', 'running', 'none']),
});
export type PullCommit = z.infer<typeof pullCommitSchema>;

/** One page of a pull request's commits, newest first, 100 to a page. */
export const pullCommitsSchema = z.object({
	total: z.number().int().nonnegative(),
	page: z.number().int().positive(),
	pages: z.number().int().nonnegative(),
	commits: z.array(pullCommitSchema),
});
export type PullCommits = z.infer<typeof pullCommitsSchema>;
export const pullCommitsAnswerSchema = vendorAnswer(pullCommitsSchema);
export const pullCommitsQuerySchema = z.object({ page: z.coerce.number().int().positive().max(100).default(1) });

/** How a file changed. */
export const fileChangeSchema = z.enum(['added', 'removed', 'modified', 'renamed', 'copied', 'changed']);

/** One changed file. */
export const pullFileSchema = z.object({
	path: z.string(),
	/** Its old path when it was renamed or copied. */
	previous: z.string().nullable(),
	status: fileChangeSchema,
	additions: z.number().int().nonnegative(),
	deletions: z.number().int().nonnegative(),
	binary: z.boolean(),
});
export type PullFile = z.infer<typeof pullFileSchema>;

/** Every changed file: from GitHub, or past its 3,000-file list from the console API's own copy. */
export const pullFilesSchema = z.object({
	total: z.number().int().nonnegative(),
	source: z.enum(['github', 'copy']),
	/** Why the list is partial or where it came from, when that needs saying; otherwise empty. */
	note: z.string(),
	files: z.array(pullFileSchema),
});
export type PullFiles = z.infer<typeof pullFilesSchema>;
export const pullFilesAnswerSchema = vendorAnswer(pullFilesSchema);

/** One line of a file's changes: a section heading (@@), an added, removed or unchanged line. */
export const diffLineSchema = z.object({
	kind: z.enum(['hunk', 'add', 'del', 'ctx']),
	old: z.number().int().nullable(),
	new: z.number().int().nullable(),
	text: z.string(),
});
export type DiffLine = z.infer<typeof diffLineSchema>;

/** One file's changed lines (or, with `whole`, the whole file with its changes marked). */
export const pullDiffSchema = z.object({
	path: z.string(),
	previous: z.string().nullable(),
	status: fileChangeSchema,
	binary: z.boolean(),
	/** A picture's or other binary file's size before and after, in bytes. */
	sizeBefore: z.number().int().nonnegative().nullable(),
	sizeAfter: z.number().int().nonnegative().nullable(),
	whole: z.boolean(),
	source: z.enum(['github', 'copy']),
	lines: z.array(diffLineSchema),
});
export type PullDiff = z.infer<typeof pullDiffSchema>;
export const pullDiffAnswerSchema = vendorAnswer(pullDiffSchema);

const sha = z.string().regex(/^[0-9a-f]{7,40}$/, 'A commit id is 7 to 40 hexadecimal characters.');

export const pullDiffQuerySchema = z.object({
	path: z.string().min(1).max(1_000),
	whole: z.enum(['0', '1']).default('0'),
	/** One commit's changes instead of the whole pull request's. */
	commit: sha.optional(),
});
export type PullDiffQuery = z.infer<typeof pullDiffQuerySchema>;

/** One commit opened from the Commits tab: its whole message, its checks and its files. */
export const pullCommitPageSchema = z.object({
	sha: z.string(),
	message: z.string(),
	author: z.string(),
	date: z.string(),
	checks: checkCountsSchema,
	files: pullFilesSchema,
});
export type PullCommitPage = z.infer<typeof pullCommitPageSchema>;
export const pullCommitPageAnswerSchema = vendorAnswer(pullCommitPageSchema);
export const commitIdSchema = sha;

/** A check's log: its last lines, each marked when it reads as an error. */
export const pullLogSchema = z.object({
	lines: z.array(z.object({ n: z.number().int().nonnegative(), text: z.string(), bad: z.boolean() })),
});
export type PullLog = z.infer<typeof pullLogSchema>;
export const pullLogAnswerSchema = vendorAnswer(pullLogSchema);
