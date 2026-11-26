/**
 * What the Release Console's Coverage screen needs to know about a coverage run besides the reports
 * themselves (brief CRmpBdP3ce62g1JoCAhh23): the repository root the reports' paths start with, which
 * commit and branch were measured, which CI run made it, whether this copy had uncommitted changes, and
 * how each workspace did. `pnpm coverage` writes it to coverage/meta.json.
 */
import { spawnSync } from 'node:child_process';

/** One git answer from the repository, or '' when git cannot give it. */
export function gitAnswer(root, args, run = spawnSync) {
	const out = run('git', args, { cwd: root, encoding: 'utf8' });
	return out.status === 0 ? String(out.stdout).trim() : '';
}

/**
 * The run's description. `results` are the workspaces measured, each with its folder, whether its tests
 * passed, whether it reached the floor and whether it is at 100%. `previous` is the description already in
 * the folder: a run of some workspaces keeps the others' entries from that run of the same copy, each with
 * the time it was measured.
 */
export function coverageMeta({
	root,
	env,
	results,
	floor,
	previous = null,
	now = new Date(),
	git = (args) => gitAnswer(root, args),
}) {
	const kept = previous && previous.root === root && previous.workspaces ? previous.workspaces : {};
	return {
		root,
		sha: env.GITHUB_SHA || git(['rev-parse', 'HEAD']),
		ref: env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || git(['rev-parse', '--abbrev-ref', 'HEAD']),
		runId: env.GITHUB_RUN_ID || null,
		// A CI checkout is clean; on this Mac, uncommitted changes mean lines may not match the commit.
		uncommitted: env.GITHUB_RUN_ID ? false : git(['status', '--porcelain']) !== '',
		finishedAt: now.toISOString(),
		floor,
		workspaces: {
			...kept,
			...Object.fromEntries(
				results.map((r) => [
					r.name,
					{ dir: r.dir, passed: r.passed, ok: r.ok, full: r.full, measuredAt: now.toISOString() },
				]),
			),
		},
	};
}
