import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { appFile } from './app-files.js';

describe('console app files', () => {
	const dir = mkdtempSync(join(tmpdir(), 'release-console-app-'));
	mkdirSync(join(dir, 'assets'));
	writeFileSync(join(dir, 'index.html'), '<rc-root></rc-root>');
	writeFileSync(join(dir, 'assets', 'main-ABCD1234.js'), 'x');

	it('serves built files with long caching and the page without', () => {
		expect(appFile(dir, '/assets/main-ABCD1234.js')).toMatchObject({
			type: 'text/javascript; charset=utf-8',
			cache: 'public, max-age=31536000, immutable',
		});
		expect(appFile(dir, '/')).toMatchObject({ type: 'text/html; charset=utf-8', cache: 'no-store' });
	});

	it('answers any app route with the page so the app’s router takes it', () => {
		expect(appFile(dir, '/p/saha-textile/r/saha-textile/pipeline?tab=list')?.body.toString()).toContain('rc-root');
	});

	it('never leaves the app folder and never answers API paths', () => {
		expect(appFile(dir, '/../../etc/passwd')?.body.toString()).toContain('rc-root');
		expect(appFile(dir, '/%2e%2e/%2e%2e/etc/passwd')?.body.toString()).toContain('rc-root');
		expect(appFile(dir, '/api/projects')).toBeNull();
		expect(appFile(undefined, '/')).toBeNull();
	});
});
