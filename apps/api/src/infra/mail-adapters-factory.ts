import { MongoMailboxTokenStore } from '@saha-textile/adapters-db-mongo';
import { GmailMailbox } from '@saha-textile/adapters-mail-gmail';
import type { MailboxPort, MailboxTokenStore } from '@saha-textile/core-domain';

import type { AppConfig } from '../config/app-config';
import { UnavailableMailboxAdapter, UnavailableMailboxTokenStore } from './unavailable-mailbox.adapter';

/** Encrypted token storage with the configured key, or none at all. */
export function buildMailboxTokenStore(config: AppConfig): MailboxTokenStore {
	const key = (value: string) => new Uint8Array(Buffer.from(value, 'base64'));
	return config.mail.tokenKey
		? new MongoMailboxTokenStore(
				key(config.mail.tokenKey),
				config.mail.tokenKeyPrevious ? key(config.mail.tokenKeyPrevious) : undefined,
			)
		: new UnavailableMailboxTokenStore();
}

/** The Gmail adapter when the Google client is configured; otherwise every call says "not set up". */
export function buildMailboxPort(config: AppConfig): MailboxPort {
	const { googleClientId, googleClientSecret, redirectUri, domain } = config.mail;
	return googleClientId && googleClientSecret && redirectUri
		? new GmailMailbox({ clientId: googleClientId, clientSecret: googleClientSecret, redirectUri, domain })
		: new UnavailableMailboxAdapter();
}
