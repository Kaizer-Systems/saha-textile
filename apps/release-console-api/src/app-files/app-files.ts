import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';

const TYPES: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.ico': 'image/x-icon',
	'.webp': 'image/webp',
	'.woff2': 'font/woff2',
	'.woff': 'font/woff',
	'.txt': 'text/plain; charset=utf-8',
	'.map': 'application/json; charset=utf-8',
};

export interface AppFile {
	body: Buffer;
	type: string;
	/** Built files with a content hash in their name never change; the page itself is never cached. */
	cache: string;
}

/**
 * The built console app's file for a request path, or its `index.html` for any other path so the
 * app's own router answers. `null` for `/api/…` paths and when no app folder is set. A path can never
 * leave the app folder.
 */
export function appFile(dir: string | undefined, urlPath: string): AppFile | null {
	if (!dir || urlPath === '/api' || urlPath.startsWith('/api/')) return null;
	// split always gives a first part.
	const path = decodeURIComponent((urlPath.split('?')[0] as string).split('#')[0] as string);
	const root = normalize(dir);
	const wanted = normalize(join(root, path));
	const inside = wanted === root || wanted.startsWith(root.endsWith(sep) ? root : root + sep);
	const file = inside && existsSync(wanted) && statSync(wanted).isFile() ? wanted : join(root, 'index.html');
	if (!existsSync(file)) return null;
	const isPage = file.endsWith('index.html');
	return {
		body: readFileSync(file),
		type: TYPES[extname(file)] ?? 'application/octet-stream',
		cache: isPage
			? 'no-store'
			: /[.-][A-Za-z0-9_]{8,}\.[a-z0-9]+$/.test(file)
				? 'public, max-age=31536000, immutable'
				: 'public, max-age=3600',
	};
}

/**
 * A fingerprint of the console app in `dir`: 12 characters from its index page, which names every built file by
 * its content, so any change to the app changes it. `null` when there is no app (the development server).
 */
export function appBuild(dir: string | undefined): string | null {
	const page = dir ? join(dir, 'index.html') : '';
	return page && existsSync(page) ? createHash('sha256').update(readFileSync(page)).digest('hex').slice(0, 12) : null;
}
