import type { DiffLine, PullFile } from '@saha-textile/release-console-contracts';

/**
 * A unified diff's lines (GitHub's `patch`, or `git diff`), each with its old and new line number. What comes
 * before the first `@@` (git's file header) and "\ No newline at end of file" are left out.
 */
export function diffLines(patch: string): DiffLine[] {
	const out: DiffLine[] = [];
	let before = 0;
	let after = 0;
	let started = false;
	for (const raw of patch.replace(/\n$/, '').split('\n')) {
		const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
		if (hunk) {
			started = true;
			before = Number(hunk[1]);
			after = Number(hunk[2]);
			out.push({ kind: 'hunk', old: null, new: null, text: raw });
		} else if (started && !raw.startsWith('\\')) {
			const text = raw.slice(1);
			if (raw.startsWith('+')) out.push({ kind: 'add', old: null, new: after++, text });
			else if (raw.startsWith('-')) out.push({ kind: 'del', old: before++, new: null, text });
			else out.push({ kind: 'ctx', old: before++, new: after++, text });
		}
	}
	return out;
}

const GIT_STATUS: Record<string, PullFile['status']> = {
	A: 'added',
	D: 'removed',
	M: 'modified',
	R: 'renamed',
	C: 'copied',
};

/** GitHub's word for how a file changed, in the console's (GitHub's "unchanged" and anything new read "changed"). */
export function fileStatus(github: string): PullFile['status'] {
	return (['added', 'removed', 'modified', 'renamed', 'copied'] as const).find((s) => s === github) ?? 'changed';
}

/**
 * The changed files from `git diff --name-status -z -M` and `git diff --numstat -z -M` over the same commits:
 * how each changed, its old name when renamed or copied, and its added and removed lines (a binary file counts none).
 */
export function filesFromGit(nameStatus: string, numstat: string): PullFile[] {
	const counts = new Map<string, { additions: number; deletions: number; binary: boolean }>();
	const stat = numstat.split('\0');
	for (let i = 0; i < stat.length - 1; i += 1) {
		const [added, removed, path] = (stat[i] as string).split('\t') as [string, string, string];
		// A rename's line has no path; its old and new paths follow as the next two fields.
		const where = path === '' ? (stat[(i += 2)] as string) : path;
		counts.set(where, {
			additions: added === '-' ? 0 : Number(added),
			deletions: removed === '-' ? 0 : Number(removed),
			binary: added === '-',
		});
	}
	const files: PullFile[] = [];
	const names = nameStatus.split('\0');
	for (let i = 0; i < names.length - 1; i += 1) {
		const code = names[i] as string;
		const moved = code.startsWith('R') || code.startsWith('C');
		const previous = moved ? (names[(i += 1)] as string) : null;
		const path = names[(i += 1)] as string;
		const count = counts.get(path) ?? { additions: 0, deletions: 0, binary: false };
		files.push({ path, previous, status: GIT_STATUS[code.charAt(0)] ?? 'changed', ...count });
	}
	return files;
}
