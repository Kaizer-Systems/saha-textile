import { describe, expect, it, vi } from 'vitest';

const bootstrapApplication = vi.hoisted(() => vi.fn());

vi.mock('@angular/platform-browser', async (original) => ({
	...(await original<object>()),
	bootstrapApplication,
}));
vi.mock('./app/app', () => ({ App: class {} }));
vi.mock('./app/app.config', () => ({ appConfig: {} }));

describe('browser entry', () => {
	it('boots the app and logs a failed boot', async () => {
		const failure = new Error('boot');
		bootstrapApplication.mockRejectedValue(failure);
		const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		await import('./main');
		await Promise.resolve();
		await Promise.resolve();
		expect(bootstrapApplication).toHaveBeenCalledOnce();
		expect(logged).toHaveBeenCalledWith(failure);
		logged.mockRestore();
	});
});
