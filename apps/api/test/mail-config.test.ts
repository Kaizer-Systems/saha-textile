import { randomBytes } from 'node:crypto';

import { GmailMailbox } from '@saha-textile/adapters-mail-gmail';
import { MongoMailboxTokenStore } from '@saha-textile/adapters-db-mongo';
import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config/app-config';
import { buildMailboxPort, buildMailboxTokenStore } from '../src/infra/mail-adapters-factory';
import { UnavailableMailboxAdapter, UnavailableMailboxTokenStore } from '../src/infra/unavailable-mailbox.adapter';

const baseEnv = {
	JWT_ACCESS_SECRET: 'a'.repeat(32),
	JWT_REFRESH_SECRET: 'b'.repeat(32),
};

/** Generated per run; never a real client or key. */
const mailEnv = {
	GOOGLE_MAIL_CLIENT_ID: 'client.apps.googleusercontent.test',
	GOOGLE_MAIL_CLIENT_SECRET: 'not-a-real-secret',
	GOOGLE_MAIL_REDIRECT_URI: 'https://api.example.test/admin/mailboxes/oauth/callback',
	MAILBOX_TOKEN_KEY: randomBytes(32).toString('base64'),
	ADMIN_APP_URL: 'https://admin.example.test',
};

const load = (overrides: Record<string, string | undefined> = {}) =>
	loadConfig({ ...baseEnv, ...overrides } as NodeJS.ProcessEnv);

describe('Gmail mailbox configuration', () => {
	it('is off, and the API still boots, with no mail variable set', () => {
		expect(load().mail).toEqual({ domain: 'sahatextile.com' });
	});

	it('reads every value, and the shop domain can be changed', () => {
		const mail = load({ ...mailEnv, MAILBOX_DOMAIN: 'shop.test' }).mail;
		expect(mail).toMatchObject({ googleClientId: mailEnv.GOOGLE_MAIL_CLIENT_ID, domain: 'shop.test' });
		// The values the adapters are built from.
		expect(
			new GmailMailbox({
				clientId: 'c',
				clientSecret: 's',
				redirectUri: mail.redirectUri ?? '',
				domain: mail.domain,
			}).signInUrl('x'),
		).toContain('hd=shop.test');
		expect(
			() => new MongoMailboxTokenStore(new Uint8Array(Buffer.from(mail.tokenKey ?? '', 'base64'))),
		).not.toThrow();
	});

	it('builds the Gmail adapter and the encrypted token store only when configured', () => {
		const on = load(mailEnv);
		expect(buildMailboxPort(on)).toBeInstanceOf(GmailMailbox);
		expect(buildMailboxTokenStore(on)).toBeInstanceOf(MongoMailboxTokenStore);
		const off = load();
		expect(buildMailboxPort(off)).toBeInstanceOf(UnavailableMailboxAdapter);
		expect(buildMailboxTokenStore(off)).toBeInstanceOf(UnavailableMailboxTokenStore);
	});

	it('refuses a half-set group, naming every variable', () => {
		expect(() => load({ GOOGLE_MAIL_CLIENT_ID: 'only-this' })).toThrow(/GOOGLE_MAIL_CLIENT_SECRET.*ADMIN_APP_URL/);
	});

	it('refuses a token key that is not 32 bytes', () => {
		expect(() => load({ ...mailEnv, MAILBOX_TOKEN_KEY: randomBytes(16).toString('base64') })).toThrow(/32 bytes/);
	});
});
