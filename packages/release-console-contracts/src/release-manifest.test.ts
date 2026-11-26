import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MANIFEST_COMMAND, readManifest } from './release-manifest.js';

describe('.release-console.json version 2', () => {
	it('reads the repository’s own file with no problem', () => {
		const file = JSON.parse(readFileSync(join(__dirname, '../../../.release-console.json'), 'utf8'));
		const { manifest, problems } = readManifest(file);
		expect(problems).toEqual([]);
		expect(manifest?.product.kind).toBe('shop');
		expect(manifest?.parts.map((p) => p.id)).toContain('api');
		expect(manifest?.jobs?.queues).toEqual(['saha-textile-media', 'saha-textile-documents']);
		expect(manifest?.menus).toEqual(['payments', 'messages', 'clients', 'seo']);
	});

	it('still reads version 1, only menus', () => {
		const { manifest, problems } = readManifest({ menus: ['payments'] }, 'shop-web');
		expect(problems).toEqual([]);
		expect(manifest?.version).toBe(2);
		expect(manifest?.product).toEqual({ name: 'shop-web', kind: 'other' });
		expect(manifest?.menus).toEqual(['payments']);
	});

	it('reports unknown and unreadable lines, drops them, and keeps the rest', () => {
		const { manifest, problems } = readManifest({
			version: 2,
			product: { name: 'Shop', kind: 'shop' },
			colour: 'blue',
			commands: { stackUp: 'rm -rf /' },
			menus: ['seo'],
		});
		expect(problems).toEqual([
			'“colour” is not used by this console.',
			expect.stringMatching(/“commands\.stackUp” was skipped: pnpm <script>/),
		]);
		expect(manifest?.menus).toEqual(['seo']);
		expect(manifest?.commands).toEqual({});
	});

	it('runs only pnpm scripts from the repository root', () => {
		for (const ok of ['pnpm stack:up', 'pnpm pipeline:local', 'pnpm stack:env -- --tier dev'])
			expect(MANIFEST_COMMAND.test(ok), ok).toBe(true);
		for (const bad of [
			'npm run up',
			'pnpm stack:up; rm -rf /',
			'pnpm stack:up && curl x',
			'bash deploy.sh',
			'pnpm ../x',
		])
			expect(MANIFEST_COMMAND.test(bad), bad).toBe(false);
	});

	it('refuses a file that is not an object or names no product', () => {
		expect(readManifest([]).manifest).toBeNull();
		expect(readManifest({ version: 2 }).manifest).toBeNull();
	});
});
