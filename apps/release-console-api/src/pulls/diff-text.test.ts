import { describe, expect, it } from 'vitest';

import { diffLines, fileStatus, filesFromGit } from './diff-text.js';

describe('a unified diff', () => {
	it('numbers each line, old and new, and leaves out git’s header and the missing-newline note', () => {
		const patch = [
			'diff --git a/x.ts b/x.ts',
			'--- a/x.ts',
			'+++ b/x.ts',
			'@@ -10,3 +10,4 @@ export class X {',
			' keep',
			'-gone',
			'+came',
			'+also',
			' tail',
			'\\ No newline at end of file',
			'',
		].join('\n');
		expect(diffLines(patch)).toEqual([
			{ kind: 'hunk', old: null, new: null, text: '@@ -10,3 +10,4 @@ export class X {' },
			{ kind: 'ctx', old: 10, new: 10, text: 'keep' },
			{ kind: 'del', old: 11, new: null, text: 'gone' },
			{ kind: 'add', old: null, new: 11, text: 'came' },
			{ kind: 'add', old: null, new: 12, text: 'also' },
			{ kind: 'ctx', old: 12, new: 13, text: 'tail' },
		]);
		// GitHub's patch starts at the first @@ and has no trailing newline; a one-line hunk has no counts.
		expect(diffLines('@@ -1 +1 @@\n-a\n+b')).toEqual([
			{ kind: 'hunk', old: null, new: null, text: '@@ -1 +1 @@' },
			{ kind: 'del', old: 1, new: null, text: 'a' },
			{ kind: 'add', old: null, new: 1, text: 'b' },
		]);
	});
});

describe('how a file changed', () => {
	it('keeps GitHub’s words and reads anything else as changed', () => {
		expect(['added', 'removed', 'modified', 'renamed', 'copied'].map(fileStatus)).toEqual([
			'added',
			'removed',
			'modified',
			'renamed',
			'copied',
		]);
		expect(fileStatus('unchanged')).toBe('changed');
	});

	it('reads git’s name and line lists together, renames and binary files included', () => {
		const names = [
			'M',
			'a.ts',
			'R087',
			'old.ts',
			'new.ts',
			'A',
			'logo.png',
			'D',
			'gone.ts',
			'T',
			'link',
			'X',
			'odd',
			'',
		].join('\0');
		const counts = ['3\t1\ta.ts', '2\t2\t', 'old.ts', 'new.ts', '-\t-\tlogo.png', '0\t5\tgone.ts', ''].join('\0');
		expect(filesFromGit(names, counts)).toEqual([
			{ path: 'a.ts', previous: null, status: 'modified', additions: 3, deletions: 1, binary: false },
			{ path: 'new.ts', previous: 'old.ts', status: 'renamed', additions: 2, deletions: 2, binary: false },
			{ path: 'logo.png', previous: null, status: 'added', additions: 0, deletions: 0, binary: true },
			{ path: 'gone.ts', previous: null, status: 'removed', additions: 0, deletions: 5, binary: false },
			{ path: 'link', previous: null, status: 'changed', additions: 0, deletions: 0, binary: false },
			{ path: 'odd', previous: null, status: 'changed', additions: 0, deletions: 0, binary: false },
		]);
		expect(filesFromGit('', '')).toEqual([]);
	});
});
