import { ServiceUnavailableException } from '@nestjs/common';
import type { MailboxPort, MailboxTokenStore } from '@saha-textile/core-domain';

const MESSAGE =
	'Gmail is not set up. Set GOOGLE_MAIL_CLIENT_ID, GOOGLE_MAIL_CLIENT_SECRET, GOOGLE_MAIL_REDIRECT_URI, MAILBOX_TOKEN_KEY and ADMIN_APP_URL.';

const refuse = (): Promise<never> => Promise.reject(new ServiceUnavailableException(MESSAGE));

/**
 * Bound when the mail settings are absent. Every call answers "not set up" instead of
 * pretending a mailbox exists; Contact Us messages stay queued in the database meanwhile.
 * Same honesty rule as the unconfigured storage and YouTube adapters.
 */
export class UnavailableMailboxAdapter implements MailboxPort {
	signInUrl(): string {
		throw new ServiceUnavailableException(MESSAGE);
	}
	completeSignIn = refuse;
	revoke = refuse;
	listThreads = refuse;
	getThread = refuse;
	getAttachment = refuse;
	send = refuse;
	modifyThread = refuse;
	trashThread = refuse;
	importMessage = refuse;
	unreadCount = refuse;
	listSendAs = refuse;
	/** Nothing can be used without the settings, so nothing is singled out as missing. */
	featuresMissing(): [] {
		return [];
	}
}

/** Without a key nothing can be stored or read: every mailbox reads as needing reconnection. */
export class UnavailableMailboxTokenStore implements MailboxTokenStore {
	put = refuse;
	get(): Promise<string | null> {
		return Promise.resolve(null);
	}
	remove(): Promise<void> {
		return Promise.resolve();
	}
}
