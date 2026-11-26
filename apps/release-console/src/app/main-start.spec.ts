import { afterEach, describe, expect, it, vi } from 'vitest';

/** The browser's start of the console, with Angular's own start answered here. */
const start = vi.hoisted(() => ({ outcome: Promise.resolve({}) as Promise<unknown> }));
vi.mock('@angular/platform-browser', async (original) => ({
	...(await original<typeof import('@angular/platform-browser')>()),
	bootstrapApplication: vi.fn(() => start.outcome),
}));

afterEach(() => {
	vi.restoreAllMocks();
});

describe('the console’s start', () => {
	it('starts the app, and writes a start that fails to the console', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		vi.resetModules();
		await import('../main');
		const { bootstrapApplication } = await import('@angular/platform-browser');
		expect(bootstrapApplication).toHaveBeenCalled();
		expect(logged).not.toHaveBeenCalled();
		const failure = new Error('no root element');
		start.outcome = Promise.reject(failure);
		vi.resetModules();
		await import('../main');
		await vi.waitFor(() => expect(logged).toHaveBeenCalledWith(failure));
	});
});
