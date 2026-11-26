import { Routes, UrlSegment, type UrlMatchResult } from '@angular/router';

import { Inbox } from './inbox';

/**
 * `/inbox`, `/inbox/wecare`, `/inbox/wecare/sent` and `/inbox/wecare/inbox/18c2a9f` are one route,
 * so moving between them keeps the page (and its open frames) instead of building a new one. The
 * address names the mailbox, folder and conversation: Back closes a conversation and a link opens
 * the same one for a colleague, still checked against their own access (review T5).
 */
export function inboxMatcher(segments: UrlSegment[]): UrlMatchResult | null {
	if (segments.length > 3) return null;
	const [mailbox, folder, thread] = segments;
	return {
		consumed: segments,
		posParams: {
			...(mailbox ? { mailbox } : {}),
			...(folder ? { folder } : {}),
			...(thread ? { thread } : {}),
		},
	};
}

export default [
	{
		matcher: inboxMatcher,
		component: Inbox,
	},
] as Routes;
