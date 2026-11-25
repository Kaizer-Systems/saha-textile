import { extname } from 'node:path';

import type { BlameRun, CodeFile, CodeSearch, TreeEntry } from '@saha-textile/release-console-contracts';

/** What the Code pages read with git, on the console API's own copy of the repository. */
export interface CopyReads {
	run(dir: string, args: readonly string[]): Promise<string>;
	bytes(dir: string, object: string): Promise<Buffer>;
}

/** Past this size a file shows only Raw and Download, as on GitHub. */
export const SHOW_LIMIT = 1024 * 1024;
/** Search shows this many matching lines at most. */
export const SEARCH_LIMIT = 500;
/** How far back a folder's walk looks for each entry's last commit. */
export const WALK_LIMIT = 20_000;

const PICTURES = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.avif']);
const KINDS: Record<string, TreeEntry['kind']> = { tree: 'dir', commit: 'module' };

/** "a/b" inside folder "a": its name there; "" for the folder itself. */
const below = (path: string, folder: string) => (folder ? path.slice(folder.length + 1) : path);

/** A folder's entries, folders first and each kind by name, as GitHub lists them; each with no last commit yet. */
export async function folderEntries(copy: CopyReads, dir: string, sha: string, path: string): Promise<TreeEntry[]> {
	const out = await copy.run(dir, ['ls-tree', '-z', sha, ...(path ? ['--', `${path}/`] : [])]);
	const entries = out
		.split('\0')
		.filter(Boolean)
		.map((line) => {
			const [meta, name] = line.split('\t') as [string, string];
			const [mode, type] = meta.split(' ') as [string, string];
			const kind: TreeEntry['kind'] = KINDS[type] ?? (mode === '120000' ? 'link' : 'file');
			return { name: below(name, path), path: name, kind, last: null };
		});
	const rank = (e: TreeEntry) => (e.kind === 'dir' || e.kind === 'module' ? 0 : 1);
	return entries.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

/**
 * Each entry's last commit, in one walk back through the folder's history: a commit names each entry it changed,
 * and the newest one to name it wins. Entries still unnamed after the walk keep none.
 */
export async function lastCommits(copy: CopyReads, dir: string, sha: string, path: string, entries: TreeEntry[]) {
	const out = await copy.run(dir, [
		'log',
		`--max-count=${WALK_LIMIT}`,
		'--format=%x1e%H%x1f%s%x1f%cI',
		'--name-only',
		sha,
		...(path ? ['--', path] : []),
	]);
	const wanted = new Map(entries.map((e) => [e.name, e]));
	for (const block of out.split('\x1e').slice(1)) {
		const [head, ...names] = block.split('\n');
		const [commit, headline, date] = (head as string).split('\x1f') as [string, string, string];
		for (const name of names) {
			const first = below(name, path).split('/')[0] as string;
			const entry = wanted.get(first);
			if (entry && !entry.last) entry.last = { sha: commit, headline, date };
		}
		if (entries.every((e) => e.last)) break;
	}
	return entries;
}

/** Every file's path on this commit, for Go to file. */
export async function allPaths(copy: CopyReads, dir: string, sha: string): Promise<string[]> {
	return (await copy.run(dir, ['ls-tree', '-r', '-z', '--name-only', sha])).split('\0').filter(Boolean);
}

/** A file's bytes and what to show of them: its text, a picture, or only Raw and Download. */
export async function readFile(
	copy: CopyReads,
	dir: string,
	sha: string,
	path: string,
): Promise<Pick<CodeFile, 'size' | 'kind' | 'text' | 'lines'>> {
	const size = Number((await copy.run(dir, ['cat-file', '-s', `${sha}:${path}`])).trim());
	if (PICTURES.has(extname(path).toLowerCase())) return { size, kind: 'image', text: null, lines: null };
	if (size > SHOW_LIMIT) return { size, kind: 'big', text: null, lines: null };
	const body = await copy.bytes(dir, `${sha}:${path}`);
	if (body.subarray(0, 8_000).includes(0)) return { size, kind: 'binary', text: null, lines: null };
	const text = body.toString('utf8');
	const lines = text === '' ? 0 : text.replace(/\n$/, '').split('\n').length;
	return { size, kind: 'text', text, lines };
}

/** Who wrote each run of lines (`git blame --porcelain`), and the file's lines as they are on this commit. */
export async function blame(
	copy: CopyReads,
	dir: string,
	sha: string,
	path: string,
): Promise<{ lines: string[]; runs: BlameRun[] }> {
	const out = await copy.run(dir, ['blame', '--porcelain', sha, '--', path]);
	const known = new Map<string, Omit<BlameRun, 'start' | 'end' | 'sha'>>();
	const lines: string[] = [];
	const runs: BlameRun[] = [];
	let commit = '';
	let meta: Omit<BlameRun, 'start' | 'end' | 'sha'> = { headline: '', author: '', date: '', previous: null };
	for (const line of out.split('\n')) {
		const head = /^([0-9a-f]{40}) \d+ (\d+)/.exec(line);
		if (head) {
			commit = head[1] as string;
			meta = known.get(commit) ?? { headline: '', author: '', date: '', previous: null };
			known.set(commit, meta);
		} else if (line.startsWith('author ')) meta.author = line.slice(7);
		else if (line.startsWith('author-time ')) meta.date = new Date(Number(line.slice(12)) * 1000).toISOString();
		else if (line.startsWith('summary ')) meta.headline = line.slice(8);
		// `previous <commit> <path>`: the path may hold spaces, so it is the rest of the line.
		else if (line.startsWith('previous ')) meta.previous = { sha: line.slice(9, 49), path: line.slice(50) };
		else if (line.startsWith('\t')) {
			lines.push(line.slice(1));
			const n = lines.length;
			const last = runs[runs.length - 1];
			if (last && last.sha === commit && last.end === n - 1) last.end = n;
			else runs.push({ start: n, end: n, sha: commit, ...meta });
		}
	}
	return { lines, runs };
}

/** Lines holding the words, any case, in every text file on this commit (`git grep`); at most 500 shown. */
export async function search(copy: CopyReads, dir: string, sha: string, q: string): Promise<CodeSearch> {
	const out = await copy
		.run(dir, ['grep', '-n', '-I', '-i', '-F', '-z', '--full-name', '-e', q, sha, '--'])
		// git grep ends with 1 when nothing matches.
		.catch((error: Error & { code?: unknown }) => (error.code === 1 ? '' : Promise.reject(error)));
	const files = new Map<string, { n: number; text: string }[]>();
	let total = 0;
	for (const line of out.split('\n')) {
		const [where, n, text] = line.split('\0');
		if (!where || n === undefined || text === undefined) continue;
		total += 1;
		if (total > SEARCH_LIMIT) continue;
		const file = where.slice(sha.length + 1);
		files.set(file, [...(files.get(file) ?? []), { n: Number(n), text: text.slice(0, 400) }]);
	}
	return {
		total,
		cut: total > SEARCH_LIMIT,
		files: [...files].map(([path, lines]) => ({ path, lines })),
	};
}

/** The content type a raw file is sent with: pictures as themselves, everything else as plain bytes or text. */
export function rawType(path: string, body: Buffer): string {
	const ext = extname(path).toLowerCase();
	const pictures: Record<string, string> = {
		'.png': 'image/png',
		'.jpg': 'image/jpeg',
		'.jpeg': 'image/jpeg',
		'.gif': 'image/gif',
		'.webp': 'image/webp',
		'.svg': 'image/svg+xml',
		'.ico': 'image/x-icon',
		'.bmp': 'image/bmp',
		'.avif': 'image/avif',
	};
	return (
		pictures[ext] ??
		(body.subarray(0, 8_000).includes(0) ? 'application/octet-stream' : 'text/plain; charset=utf-8')
	);
}
