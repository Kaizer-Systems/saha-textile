/** The local admin's address: the stack's fixed admin port (the e2e stack hard-codes it too). */
export const LOCAL_ADMIN_ORIGIN = 'https://localhost:4300';

const ORIGIN = /^https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?$/;

/**
 * The one origin allowed to frame the Page Builder preview and to talk to it (Page Builder step 6). A deployment sets
 * `ADMIN_ORIGIN`; a deployment without a valid one gets null, so nothing may frame the preview; a local run without it
 * uses the local admin. Keep this file free of TypeScript-only syntax: the preview middleware imports it.
 */
export function previewAdminOrigin() {
	const env = typeof process === 'undefined' ? undefined : process.env;
	const set = env?.['ADMIN_ORIGIN'];
	if (typeof set === 'string' && ORIGIN.test(set)) return set;
	return env?.['DEPLOY_ENV'] ? null : LOCAL_ADMIN_ORIGIN;
}
