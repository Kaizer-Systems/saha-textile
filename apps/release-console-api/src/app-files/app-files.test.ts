import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { appBuild, appFile } from './app-files.js';

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

	it('fingerprints the app by its page, and has none without an app', () => {
		const before = appBuild(dir);
		expect(before).toMatch(/^[0-9a-f]{12}$/);
		writeFileSync(join(dir, 'index.html'), '<rc-root></rc-root><script src="/assets/main-EFGH5678.js"></script>');
		expect(appBuild(dir)).not.toBe(before);
		expect(appBuild(undefined)).toBeNull();
		expect(appBuild(join(dir, 'assets'))).toBeNull();
	});
});
