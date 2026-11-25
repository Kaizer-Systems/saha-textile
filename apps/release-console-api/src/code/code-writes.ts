import type { CodeDone, CommitWrite, ReleaseWrite } from '@saha-textile/release-console-contracts';

import { ghSend, refPath } from './github-code.js';
import { gh, graphql } from '../pulls/github-pulls.js';
import { VendorError, num, rec, str } from '../vendors/http.js';

/**
 * The Code pages' changes (brief 7Hu1SuB3A8qiJzeDwvFZLR, Part C, Q6 A), each made through GitHub with the
 * repository's key after the console PIN. Every message says what changed in words; GitHub's refusal is passed on.
 */
const API = 'https://api.github.com';
const UPLOADS = 'https://uploads.github.com';

const done = (message: string, url: string | null = null, branch: string | null = null): CodeDone => ({
	message,
	url,
	branch,
});

/** Where a branch points now. */
async function branchTip(repository: string, key: string, branch: string): Promise<string> {
	const ref = rec((await gh(`${API}/repos/${repository}/git/ref/heads/${refPath(branch)}`, key)).body);
	return str(rec(ref['object'])['sha']);
}

/** A new branch from a branch, tag or commit. */
export async function createBranch(repository: string, key: string, name: string, from: string): Promise<CodeDone> {
	const commit = rec((await gh(`${API}/repos/${repository}/commits/${refPath(from)}`, key)).body);
	await ghSend('POST', `${API}/repos/${repository}/git/refs`, key, {
		ref: `refs/heads/${name}`,
		sha: str(commit['sha']),
	});
	return done(`Branch ${name} made from ${from}`, null, name);
}

export async function renameBranch(repository: string, key: string, name: string, to: string): Promise<CodeDone> {
	await ghSend('POST', `${API}/repos/${repository}/branches/${refPath(name)}/rename`, key, { new_name: to });
	return done(`Branch ${name} is now ${to}`, null, to);
}

export async function deleteBranch(repository: string, key: string, name: string): Promise<CodeDone> {
	await ghSend('DELETE', `${API}/repos/${repository}/git/refs/heads/${refPath(name)}`, key);
	return done(`Branch ${name} deleted`);
}

const COMMIT = `mutation($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid url } } }`;

/**
 * Files added, changed or deleted in one commit, made by GitHub's `createCommitOnBranch`, which GitHub signs, so
 * the commit shows Verified as the repository's rules need. On a new branch (made first from `branch`) with a
 * pull request into `branch` when asked; otherwise straight onto `branch`, which its rules may refuse.
 */
export async function commitFiles(repository: string, key: string, w: CommitWrite): Promise<CodeDone> {
	const base = await branchTip(repository, key, w.branch);
	const target = w.newBranch || w.branch;
	if (w.newBranch)
		await ghSend('POST', `${API}/repos/${repository}/git/refs`, key, {
			ref: `refs/heads/${w.newBranch}`,
			sha: base,
		});
	const data = await graphql(key, COMMIT, {
		input: {
			branch: { repositoryNameWithOwner: repository, branchName: target },
			message: { headline: w.message, ...(w.description ? { body: w.description } : {}) },
			fileChanges: {
				additions: w.changes
					.filter((c) => c.content !== null)
					.map((c) => ({ path: c.path, contents: c.content })),
				deletions: w.changes.filter((c) => c.content === null).map((c) => ({ path: c.path })),
			},
			expectedHeadOid: base,
		},
	});
	const commit = rec(rec(data['createCommitOnBranch'])['commit']);
	const sha = str(commit['oid']).slice(0, 7);
	if (!w.newBranch || !w.pull) return done(`${sha} committed to ${target}`, str(commit['url']), target);
	const pull = rec(
		await ghSend('POST', `${API}/repos/${repository}/pulls`, key, {
			base: w.branch,
			head: w.newBranch,
			title: w.message,
			body: w.description,
		}),
	);
	return done(
		`${sha} committed to ${target}, pull request #${num(pull['number'])} opened into ${w.branch}`,
		str(pull['html_url']),
		target,
	);
}

/** A new release, or a change to one; GitHub makes its tag on publishing when the tag is new. */
export async function saveRelease(repository: string, key: string, w: ReleaseWrite): Promise<CodeDone> {
	const body = {
		tag_name: w.tag,
		target_commitish: w.target,
		name: w.name || w.tag,
		body: w.body,
		draft: w.draft,
		prerelease: w.prerelease,
		make_latest: w.latest && !w.draft && !w.prerelease ? 'true' : 'false',
	};
	const base = `${API}/repos/${repository}/releases`;
	const r = rec(await (w.id ? ghSend('PATCH', `${base}/${w.id}`, key, body) : ghSend('POST', base, key, body)));
	for (const a of w.assets)
		await uploadAsset(repository, key, num(r['id']), a.name, Buffer.from(a.content, 'base64'));
	const what = w.draft ? 'saved as a draft' : w.id ? 'saved' : 'published';
	const files = w.assets.length ? ` with ${w.assets.length} ${w.assets.length === 1 ? 'file' : 'files'}` : '';
	return done(`Release ${body.name} ${what}${files}`, str(r['html_url']));
}

export async function deleteRelease(repository: string, key: string, id: number): Promise<CodeDone> {
	await ghSend('DELETE', `${API}/repos/${repository}/releases/${id}`, key);
	return done('Release deleted');
}

/** A file attached to a release, sent to GitHub's upload address as it is. */
export async function uploadAsset(
	repository: string,
	key: string,
	release: number,
	name: string,
	body: Buffer,
): Promise<CodeDone> {
	const res = await fetch(
		`${UPLOADS}/repos/${repository}/releases/${release}/assets?name=${encodeURIComponent(name)}`,
		{
			method: 'POST',
			headers: {
				authorization: `Bearer ${key}`,
				accept: 'application/vnd.github+json',
				'content-type': 'application/octet-stream',
				'user-agent': 'release-console',
			},
			body: new Uint8Array(body),
			signal: AbortSignal.timeout(300_000),
		},
	);
	const answer = rec(await res.json().catch(() => null));
	if (res.status >= 400)
		throw new VendorError(
			`GitHub refused the file: ${str(answer['message']) || `it answered ${res.status}`}.`,
			res.status,
		);
	return done(`${name} attached`, str(answer['browser_download_url']) || null);
}

export async function deleteAsset(repository: string, key: string, id: number): Promise<CodeDone> {
	await ghSend('DELETE', `${API}/repos/${repository}/releases/assets/${id}`, key);
	return done('File removed from the release');
}

/** About: the description, website and topics. */
export async function saveAbout(
	repository: string,
	key: string,
	w: { description: string; homepage: string; topics: string[] },
): Promise<CodeDone> {
	await ghSend('PATCH', `${API}/repos/${repository}`, key, { description: w.description, homepage: w.homepage });
	await ghSend('PUT', `${API}/repos/${repository}/topics`, key, { names: w.topics });
	return done('About saved');
}

/** Watching: all activity, ignoring, or only when taking part (no subscription). */
export async function setWatching(
	repository: string,
	key: string,
	watching: 'subscribed' | 'ignored' | 'none',
): Promise<CodeDone> {
	const at = `${API}/repos/${repository}/subscription`;
	if (watching === 'none') await ghSend('DELETE', at, key);
	else await ghSend('PUT', at, key, watching === 'ignored' ? { ignored: true } : { subscribed: true });
	const words = { subscribed: 'Watching all activity', ignored: 'Ignoring', none: 'Watching only when taking part' };
	return done(words[watching]);
}

export async function setStarred(repository: string, key: string, starred: boolean): Promise<CodeDone> {
	await ghSend(starred ? 'PUT' : 'DELETE', `${API}/user/starred/${repository}`, key);
	return done(starred ? 'Starred' : 'Star removed');
}

/** A fork in the signed-in account, its default branch only unless asked. */
export async function forkRepository(
	repository: string,
	key: string,
	w: { name: string; defaultOnly: boolean },
): Promise<CodeDone> {
	const fork = rec(
		await ghSend('POST', `${API}/repos/${repository}/forks`, key, {
			...(w.name ? { name: w.name } : {}),
			default_branch_only: w.defaultOnly,
		}),
	);
	return done(`Forked to ${str(fork['full_name'])}`, str(fork['html_url']));
}

/** A pull request from one branch into another. */
export async function openPull(
	repository: string,
	key: string,
	w: { base: string; head: string; title: string; body: string; draft: boolean },
): Promise<CodeDone> {
	const pull = rec(await ghSend('POST', `${API}/repos/${repository}/pulls`, key, w));
	return done(`Pull request #${num(pull['number'])} opened`, str(pull['html_url']));
}
