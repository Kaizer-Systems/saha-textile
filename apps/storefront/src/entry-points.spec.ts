import { afterEach, describe, expect, it, vi } from 'vitest';

const bootstrapApplication = vi.hoisted(() => vi.fn());
const render = vi.hoisted(() => vi.fn(() => 'renderer'));

vi.mock('@angular/platform-browser', async (original) => ({
	...(await original<object>()),
	bootstrapApplication,
}));
vi.mock('@analogjs/router/server', () => ({ render }));
vi.mock('./app/app', () => ({ App: class {} }));
vi.mock('./app/app.config', () => ({ appConfig: {} }));
vi.mock('./app/app.config.server', () => ({ config: {} }));
vi.mock('zone.js', () => ({}));
vi.mock('zone.js/node', () => ({}));
vi.mock('@angular/localize/init', () => ({}));
vi.mock('@angular/platform-server/init', () => ({}));

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

describe('server entry', () => {
	const held = { warn: console.warn, error: console.error };

	afterEach(() => {
		console.warn = held.warn;
		console.error = held.error;
	});

	it('renders the app, and drops only the two noisy warnings', async () => {
		const seen: unknown[][] = [];
		console.warn = (...args: unknown[]) => void seen.push(args);
		console.error = (...args: unknown[]) => void seen.push(args);
		const entry = await import('./main.server');
		expect(entry.default).toBe('renderer');
		console.warn('NG0955: duplicate keys');
		console.error('NG0956: rebuilt');
		console.warn('a real warning');
		console.error({ not: 'text' });
		expect(seen).toEqual([['a real warning'], [{ not: 'text' }]]);
	});
});
