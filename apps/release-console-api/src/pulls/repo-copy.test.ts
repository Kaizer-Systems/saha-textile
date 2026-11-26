import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EMPTY_TREE, RepoCopy } from './repo-copy.js';
import { refspecs } from './pulls.service.js';

/**
 * The copy against a real repository made here (no GitHub): a base branch and a pull request whose head is
 * `refs/pull/1/head`, as GitHub keeps it.
 */
const root = mkdtempSync(join(tmpdir(), 'repo-copy-'));
const origin = join(root, 'origin');
const git = (...args: string[]) =>
	execFileSync(
		'git',
		['-c', 'user.name=Test', '-c', 'user.email=test@example.test', '-c', 'commit.gpgsign=false', ...args],
		{
			cwd: origin,
			encoding: 'utf8',
		},
	).trim();
const sha = (ref: string) => git('rev-parse', ref);
let first = '';
let base = '';
let head = '';

beforeAll(() => {
	execFileSync('git', ['init', '--quiet', '--initial-branch=main', origin]);
	writeFileSync(join(origin, 'a.txt'), 'one\ntwo\nthree\n');
	writeFileSync(join(origin, 'old.txt'), 'kept the same\nacross the rename\n');
	writeFileSync(join(origin, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
	writeFileSync(join(origin, 'gone.bin'), Buffer.from([0, 1, 2]));
	git('add', '.');
	git('commit', '--quiet', '-m', 'first');
	first = sha('HEAD');
	git('checkout', '--quiet', '-b', 'feature');
	writeFileSync(join(origin, 'a.txt'), 'one\n2\nthree\nfour\n');
	git('mv', 'old.txt', 'new.txt');
	writeFileSync(join(origin, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 9, 9, 9, 9]));
	git('rm', '--quiet', 'gone.bin');
	git('add', '.');
	git('commit', '--quiet', '-m', 'change');
	head = sha('HEAD');
	base = first;
	git('update-ref', 'refs/pull/1/head', head);
	git('checkout', '--quiet', 'main');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const copy = new RepoCopy(join(root, 'copies'), () => origin);

describe('the console API’s own copy of a repository', () => {
	it('fetches from GitHub over https into the console’s data folder by default', () => {
		const fresh = new RepoCopy();
		expect(fresh.origin('Kaizer-Systems/saha-textile')).toBe('https://github.com/Kaizer-Systems/saha-textile.git');
		expect(fresh.folder('o/r')).toMatch(/repositories[/\\]o__r\.git$/);
	});

	it('lives in its own folder per repository', () => {
		expect(copy.folder('Kaizer-Systems/saha-textile')).toBe(
			join(root, 'copies', 'Kaizer-Systems__saha-textile.git'),
		);
	});

	it('clones once, then lists every changed file and each one’s lines, renames and binary files included', async () => {
		const dir = await copy.ready('o/r', 'test-key', [base, head], refspecs(1, 'main'));
		expect(existsSync(join(dir, 'HEAD'))).toBe(true);
		const range = [`${base}...${head}`];
		expect(await copy.files(dir, range)).toEqual([
			{ path: 'a.txt', previous: null, status: 'modified', additions: 2, deletions: 1, binary: false },
			{ path: 'gone.bin', previous: null, status: 'removed', additions: 0, deletions: 0, binary: true },
			{ path: 'logo.png', previous: null, status: 'modified', additions: 0, deletions: 0, binary: true },
			{ path: 'new.txt', previous: 'old.txt', status: 'renamed', additions: 0, deletions: 0, binary: false },
		]);
		const lines = await copy.diff(dir, range, 'a.txt', null, false);
		expect(lines.binary).toBe(false);
		expect(lines.lines.filter((l) => l.kind !== 'ctx').map((l) => `${l.kind} ${l.text}`)).toEqual([
			'hunk @@ -1,3 +1,4 @@',
			'del two',
			'add 2',
			'add four',
		]);
		const whole = await copy.diff(dir, range, 'new.txt', 'old.txt', true);
		expect(whole.lines.map((l) => l.text)).toEqual([]);
		expect(await copy.diff(dir, range, 'logo.png', null, false)).toEqual({
			binary: true,
			sizeBefore: 8,
			sizeAfter: 9,
			lines: [],
		});
		expect(await copy.diff(dir, range, 'gone.bin', null, false)).toEqual({
			binary: true,
			sizeBefore: 3,
			sizeAfter: null,
			lines: [],
		});
	});

	it('compares a commit with its parent, and a first commit with nothing', async () => {
		const dir = copy.folder('o/r');
		expect(await copy.parent(dir, head)).toBe(first);
		expect(await copy.parent(dir, first)).toBe(EMPTY_TREE);
		const logo = await copy.diff(dir, [first, head], 'logo.png', null, false);
		expect([logo.sizeBefore, logo.sizeAfter]).toEqual([8, 9]);
		const all = await copy.diff(dir, [EMPTY_TREE, first], 'a.txt', null, true);
		expect(all.lines.filter((l) => l.kind === 'add')).toHaveLength(3);
	});

	it('fetches only when a commit is missing, and says so when GitHub has no such commit either', async () => {
		writeFileSync(join(origin, 'later.txt'), 'later\n');
		git('add', '.');
		git('commit', '--quiet', '-m', 'later on main');
		const later = sha('HEAD');
		const dir = await copy.ready('o/r', 'test-key', [later], ['+refs/heads/main:refs/heads/main']);
		expect(await copy.parent(dir, later)).toBe(first);
		await expect(
			copy.ready('o/r', 'test-key', ['f'.repeat(40)], ['+refs/heads/main:refs/heads/main']),
		).rejects.toThrow('The copy has no commit fffffff after fetching from GitHub.');
		// A failed call does not stop the next one for the same repository.
		await expect(copy.ready('o/r', 'test-key', [later], [])).resolves.toBe(dir);
	});

	it('names git’s own complaint when a clone fails', async () => {
		const broken = new RepoCopy(join(root, 'broken'), () => join(root, 'no-such-repository'));
		await expect(broken.ready('o/x', 'test-key', [head], [])).rejects.toThrow(
			/git clone failed: .*no-such-repository/,
		);
	});
});
