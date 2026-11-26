import { afterEach, describe, expect, it, vi } from 'vitest';

type Listener = (event: unknown) => void;

async function load(manifest: readonly unknown[]) {
	const listeners: Record<string, Listener> = {};
	const scope = {
		__WB_MANIFEST: manifest,
		clients: { claim: vi.fn(() => Promise.resolve()) },
		skipWaiting: vi.fn(() => Promise.resolve()),
		addEventListener: (type: string, listener: Listener) => (listeners[type] = listener),
	};
	vi.stubGlobal('self', scope);
	vi.resetModules();
	await import('./sw');
	return { listeners, scope };
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('service worker', () => {
	it('has no fetch listener, so no request ever passes through it', async () => {
		const { listeners } = await load([]);
		expect(Object.keys(listeners).sort()).toEqual(['activate', 'install', 'message']);
	});

	it('takes over as soon as it is installed', async () => {
		const { listeners, scope } = await load([]);
		const waitUntil = vi.fn();
		listeners['install']({ waitUntil });
		listeners['activate']({ waitUntil });
		expect(scope.skipWaiting).toHaveBeenCalled();
		expect(scope.clients.claim).toHaveBeenCalled();
		expect(waitUntil).toHaveBeenCalledTimes(2);
	});

	it('reports the live build', async () => {
		const { listeners } = await load([{ url: 'build', revision: 'abc123' }]);
		const postMessage = vi.fn();
		listeners['message']({ ports: [{ postMessage }] });
		expect(postMessage).toHaveBeenCalledWith({ build: 'abc123' });
	});

	it('reports nothing when asked without a reply port, or before a build', async () => {
		const { listeners } = await load([]);
		expect(() => listeners['message']({ ports: [] })).not.toThrow();
		const postMessage = vi.fn();
		listeners['message']({ ports: [{ postMessage }] });
		expect(postMessage).toHaveBeenCalledWith({ build: null });
	});
});
