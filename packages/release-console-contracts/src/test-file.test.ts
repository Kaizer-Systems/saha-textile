import { describe, expect, it } from 'vitest';

import { localActionSchema, startLocalSchema, testFileSchema } from './local';

describe('running one test file on this Mac (Coverage)', () => {
	it('accepts a test file inside a workspace of apps/ or packages/, and nothing else', () => {
		for (const ok of [
			'apps/admin/src/app/a.spec.ts',
			'packages/core-domain/test/rules.test.ts',
			'apps/x/e.test.mjs',
		])
			expect(testFileSchema.safeParse(ok).success, ok).toBe(true);
		for (const bad of [
			'apps/admin/src/a.ts',
			'scripts/a.test.mjs',
			'apps/admin/../x.spec.ts',
			'/etc/a.spec.ts',
			'apps/a b/c.spec.ts',
		])
			expect(testFileSchema.safeParse(bad).success, bad).toBe(false);
		expect(localActionSchema.parse('test-file')).toBe('test-file');
		expect(startLocalSchema.parse({ pin: '135790', path: 'apps/admin/src/a.spec.ts' }).path).toBe(
			'apps/admin/src/a.spec.ts',
		);
	});
});
