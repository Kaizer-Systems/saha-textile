import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { SHARE_APPS as CONTRACT_SHARE_APPS } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { SHARE_APPS } from './storefront-setting';

/** Every non-test TypeScript file under a folder. */
function sources(folder: string): string[] {
	return readdirSync(folder).flatMap((name) => {
		const path = join(folder, name);
		if (statSync(path).isDirectory()) return sources(path);
		return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [path] : [];
	});
}

/** Names brought in as values (not `type`) from `@saha-textile/contracts`. */
function valueImports(text: string): string[] {
	const names: string[] = [];
	for (const match of text.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s*from\s*'@saha-textile\/contracts'/g)) {
		if (match[1]) continue;
		for (const part of (match[2] ?? '').split(',')) {
			const name = part.trim();
			if (name && !name.startsWith('type ')) names.push(name);
		}
	}
	return names;
}

describe('Sharing tab app list', () => {
	it('matches the contracts list, name for name and in order', () => {
		expect([...SHARE_APPS]).toEqual([...CONTRACT_SHARE_APPS]);
	});
});

describe('imports from @saha-textile/contracts', () => {
	it('are types only in the admin and the storefront, because the browser cannot load its CommonJS build', () => {
		const apps = resolve(__dirname, '../../../../..');
		const offenders = ['admin/src', 'storefront/src']
			.flatMap((folder) => sources(join(apps, folder)))
			.flatMap((file) => valueImports(readFileSync(file, 'utf8')).map((name) => `${file}: ${name}`));
		expect(offenders).toEqual([]);
	});
});
