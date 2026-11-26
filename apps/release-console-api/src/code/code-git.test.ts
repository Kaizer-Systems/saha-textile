import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
	SEARCH_LIMIT,
	SHOW_LIMIT,
	allPaths,
	blame,
	folderEntries,
	lastCommits,
	rawType,
	readFile,
	search,
} from './code-git.js';
import { RepoCopy } from '../pulls/repo-copy.js';

/** A real repository made here, read through the copy's own git calls (no GitHub). */
const root = mkdtempSync(join(tmpdir(), 'code-git-'));
const work = join(root, 'work');
const dir = join(root, 'copy.git');
const git = (...args: string[]) =>
	execFileSync(
		'git',
		['-c', 'user.name=Test', '-c', 'user.email=test@example.test', '-c', 'commit.gpgsign=false', ...args],
		{ cwd: work, encoding: 'utf8' },
	).trim();
const copy = new RepoCopy(root);
let tip = '';
let firstCommit = '';

beforeAll(() => {
	execFileSync('git', ['init', '--quiet', '--initial-branch=main', work]);
	mkdirSync(join(work, 'apps', 'api'), { recursive: true });
	mkdirSync(join(work, 'old'), { recursive: true });
	writeFileSync(join(work, 'README.md'), '# Shop\n\nThe shop.\n');
	writeFileSync(join(work, 'apps', 'api', 'main.ts'), 'export const port = 4000;\n');
	writeFileSync(join(work, 'old', 'gone.txt'), 'soon gone\n');
	git('add', '.');
	git('commit', '--quiet', '-m', 'first');
	firstCommit = git('rev-parse', 'HEAD');
	writeFileSync(join(work, 'README.md'), '# Shop\n\nThe shop, in Kolkata.\n');
	writeFileSync(join(work, 'empty.txt'), '');
	writeFileSync(join(work, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1]));
	writeFileSync(join(work, 'data.bin'), Buffer.from([1, 0, 2]));
	writeFileSync(join(work, 'big.txt'), 'x'.repeat(SHOW_LIMIT + 10));
	writeFileSync(join(work, 'many.txt'), 'Port here\n'.repeat(SEARCH_LIMIT + 1));
	symlinkSync('README.md', join(work, 'link.md'));
	rmSync(join(work, 'old'), { recursive: true });
	git('add', '-A');
	git('update-index', '--add', '--cacheinfo', `160000,${firstCommit},vendor-module`);
	git('commit', '--quiet', '-m', 'second: readme, pictures and a module');
	writeFileSync(join(work, 'apps', 'api', 'main.ts'), 'export const port = 4410;\n');
	git('add', 'apps/api/main.ts');
	git('commit', '--quiet', '-m', 'third: the API port');
	tip = git('rev-parse', 'HEAD');
	execFileSync('git', ['clone', '--bare', '--quiet', work, dir]);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('a folder’s list', () => {
	it('lists folders first, then files by name, and names links and modules', async () => {
		const top = await folderEntries(copy, dir, tip, '');
		expect(top.map((e) => `${e.kind} ${e.name}`)).toEqual([
			'dir apps',
			'module vendor-module',
			'file big.txt',
			'file data.bin',
			'file empty.txt',
			'link link.md',
			'file logo.png',
			'file many.txt',
			'file README.md',
		]);
		const api = await folderEntries(copy, dir, tip, 'apps/api');
		expect(api).toEqual([{ name: 'main.ts', path: 'apps/api/main.ts', kind: 'file', last: null }]);
	});

	it('names each entry’s last commit in one walk, stopping once every entry has one', async () => {
		const top = await lastCommits(copy, dir, tip, '', await folderEntries(copy, dir, tip, ''));
		const by = Object.fromEntries(top.map((e) => [e.name, e.last?.headline]));
		expect(by['apps']).toBe('third: the API port');
		expect(by['README.md']).toBe('second: readme, pictures and a module');
		expect(top.every((e) => e.last?.sha && e.last.date)).toBe(true);
		const api = await lastCommits(copy, dir, tip, 'apps', await folderEntries(copy, dir, tip, 'apps'));
		expect(api.map((e) => e.last?.headline)).toEqual(['third: the API port']);
		const first = await lastCommits(copy, dir, firstCommit, '', await folderEntries(copy, dir, firstCommit, ''));
		expect(first.map((e) => `${e.name}: ${e.last?.headline}`)).toEqual([
			'apps: first',
			'old: first',
			'README.md: first',
		]);
	});

	it('lists every path', async () => {
		expect(await allPaths(copy, dir, tip)).toContain('apps/api/main.ts');
	});
});

describe('a file', () => {
	it('reads text with its lines, and leaves pictures, big files and binaries to Raw', async () => {
		expect(await readFile(copy, dir, tip, 'README.md')).toEqual({
			size: 30,
			kind: 'text',
			text: '# Shop\n\nThe shop, in Kolkata.\n',
			lines: 3,
		});
		expect(await readFile(copy, dir, tip, 'empty.txt')).toMatchObject({ kind: 'text', lines: 0 });
		expect(await readFile(copy, dir, tip, 'logo.png')).toMatchObject({ kind: 'image', size: 6, text: null });
		expect(await readFile(copy, dir, tip, 'big.txt')).toMatchObject({ kind: 'big', size: SHOW_LIMIT + 10 });
		expect(await readFile(copy, dir, tip, 'data.bin')).toMatchObject({ kind: 'binary', lines: null });
		await expect(copy.bytes(dir, `${tip}:nothing-here`)).rejects.toThrow('git cat-file failed');
	});

	it('says which commit wrote each run of lines, and the commit before it', async () => {
		const b = await blame(copy, dir, tip, 'README.md');
		expect(b.lines).toEqual(['# Shop', '', 'The shop, in Kolkata.']);
		expect(b.runs.map((r) => [r.start, r.end, r.headline, r.author])).toEqual([
			[1, 2, 'first', 'Test'],
			[3, 3, 'second: readme, pictures and a module', 'Test'],
		]);
		expect(b.runs[0]?.previous).toBeNull();
		expect(b.runs[1]?.previous).toEqual({ sha: firstCommit, path: 'README.md' });
		expect(b.runs[0]?.date).toMatch(/^\d{4}-\d\d-\d\dT/);
	});

	it('sends pictures as themselves and other files as text or bytes', () => {
		expect(rawType('a/logo.PNG', Buffer.from([1]))).toBe('image/png');
		expect(rawType('icon.svg', Buffer.from('<svg/>'))).toBe('image/svg+xml');
		expect(rawType('data.bin', Buffer.from([1, 0]))).toBe('application/octet-stream');
		expect(rawType('notes.txt', Buffer.from('hi'))).toBe('text/plain; charset=utf-8');
	});
});

describe('search', () => {
	it('finds lines in any case, shows 500 at most, says when nothing matches, and passes git’s other failures on', async () => {
		const port = await search(copy, dir, tip, 'PORT');
		expect(port.total).toBe(SEARCH_LIMIT + 2);
		expect(port.cut).toBe(true);
		expect(port.files.map((f) => f.path)).toEqual(['apps/api/main.ts', 'many.txt']);
		expect(port.files[0]?.lines).toEqual([{ n: 1, text: 'export const port = 4410;' }]);
		expect(port.files[1]?.lines).toHaveLength(SEARCH_LIMIT - 1);
		expect(await search(copy, dir, tip, 'nothing like this')).toEqual({ total: 0, cut: false, files: [] });
		await expect(search(copy, dir, 'f'.repeat(40), 'port')).rejects.toThrow('git grep failed');
	});
});
