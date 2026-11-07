/**
 * The storefront's service worker.
 *
 * It has no `fetch` listener on purpose, so the browser never routes a request through it: API,
 * sign-in, account, cart, checkout, `/config.json` and signed URLs all go straight to the network.
 * Nothing is cached and nothing is stored. Its jobs today are to make the shop a real installable
 * app and to tell open pages when a new build is live.
 *
 * Offline features are added here, in this file, as their own routes. Whatever is added must never
 * cache API responses, auth, account, cart or checkout data, signed URLs or `/config.json`.
 */

interface WorkerEvent {
	waitUntil(work: Promise<unknown>): void;
}

interface WorkerMessageEvent {
	ports: readonly { postMessage(message: unknown): void }[];
}

interface WorkerScope {
	/** Replaced at build time. Changes with every build, which is what makes browsers update. */
	__WB_MANIFEST: readonly { url: string; revision: string | null }[];
	clients: { claim(): Promise<void> };
	skipWaiting(): Promise<void>;
	addEventListener(type: 'install' | 'activate', listener: (event: WorkerEvent) => void): void;
	addEventListener(type: 'message', listener: (event: WorkerMessageEvent) => void): void;
}

declare const self: WorkerScope;

const build = self.__WB_MANIFEST[0]?.revision ?? null;

// Taking over at once is safe only because this worker serves nothing: pages cannot end up with
// files from two builds. Revisit this when precaching arrives.
self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

/** Answers which build is live, for checks and support. */
self.addEventListener('message', (event) => event.ports[0]?.postMessage({ build }));

export {};
