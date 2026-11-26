import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/seed/first-run', () => ({ seedFirstRun: vi.fn() }));

import { systemRolesStep } from '../src/release/database-steps';
import { seedFirstRun } from '../src/seed/first-run';

describe('system roles step', () => {
	it('runs first-run setup every release and says what it added', async () => {
		const step = systemRolesStep();
		expect(step).toMatchObject({ key: 'system-roles', cadence: 'every-release' });
		await expect(step.needed()).resolves.toMatchObject({ needed: true });
		vi.mocked(seedFirstRun).mockResolvedValueOnce({ currencies: 1, templates: 2 });
		await expect(step.run()).resolves.toBe('roles refreshed; added 1 currency and 2 templates');
		vi.mocked(seedFirstRun).mockResolvedValueOnce({ currencies: 0, templates: 1 });
		await expect(step.run()).resolves.toBe('roles refreshed; added 0 currencies and 1 template');
	});
});
