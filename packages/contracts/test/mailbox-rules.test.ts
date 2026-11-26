import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import {
	InboxBulkRequest,
	InboxLabelWrite,
	InboxModifyRequest,
	MailboxFilterWrite,
	MailboxVacationWrite,
} from '../src/mailbox';

/** The messages a schema answers with, or [] when the value passes. */
const problems = (schema: z.ZodType, value: unknown): string[] => {
	const result = schema.safeParse(value);
	return result.success ? [] : result.error.issues.map((issue) => issue.message);
};

describe('the mailbox rules', () => {
	it('a label name may not start or end with a slash, or hold two together', () => {
		expect(problems(InboxLabelWrite, { name: 'Orders/Paid' })).toEqual([]);
		for (const name of ['/Orders', 'Orders/', 'Orders//Paid']) {
			expect(problems(InboxLabelWrite, { name })).toEqual(['label_name_slashes']);
		}
	});

	it('adding or removing a label names the label; other actions need none', () => {
		expect(problems(InboxModifyRequest, { action: 'archive' })).toEqual([]);
		expect(problems(InboxModifyRequest, { action: 'add_label', labelId: 'Label_1' })).toEqual([]);
		expect(problems(InboxModifyRequest, { action: 'remove_label' })).toEqual(['label_needed']);
	});

	it('a bulk change names either threads or a search, never both and never neither', () => {
		expect(problems(InboxBulkRequest, { action: 'archive', threadIds: ['t1'] })).toEqual([]);
		expect(problems(InboxBulkRequest, { action: 'trash', matching: { folder: 'inbox' } })).toEqual([]);
		expect(problems(InboxBulkRequest, { action: 'archive' })).toEqual(['threads_or_matching']);
		expect(
			problems(InboxBulkRequest, { action: 'archive', threadIds: ['t1'], matching: { folder: 'inbox' } }),
		).toEqual(['threads_or_matching']);
		expect(problems(InboxBulkRequest, { action: 'add_label', threadIds: ['t1'] })).toEqual(['label_needed']);
	});

	it('a filter needs something to match and something to do', () => {
		expect(
			problems(MailboxFilterWrite, { criteria: { from: 'shop@example.com' }, addLabelIds: ['STARRED'] }),
		).toEqual([]);
		expect(problems(MailboxFilterWrite, { criteria: { hasAttachment: true }, removeLabelIds: ['INBOX'] })).toEqual(
			[],
		);
		expect(problems(MailboxFilterWrite, { criteria: {}, addLabelIds: ['STARRED'] })).toEqual(['criteria_needed']);
		expect(problems(MailboxFilterWrite, { criteria: { subject: 'Invoice' } })).toEqual(['action_needed']);
	});

	it('a switched-on vacation answer has words, and ends after it starts', () => {
		const vacation = {
			enabled: true,
			subject: 'Away',
			message: 'Back on Monday.',
			contactsOnly: false,
			domainOnly: false,
			startTime: '2026-12-01T00:00:00.000Z',
			endTime: '2026-12-08T00:00:00.000Z',
		};
		expect(problems(MailboxVacationWrite, vacation)).toEqual([]);
		expect(problems(MailboxVacationWrite, { ...vacation, enabled: false, message: '' })).toEqual([]);
		expect(problems(MailboxVacationWrite, { ...vacation, startTime: null })).toEqual([]);
		expect(problems(MailboxVacationWrite, { ...vacation, message: '   ' })).toEqual(['message_needed']);
		expect(problems(MailboxVacationWrite, { ...vacation, endTime: vacation.startTime })).toEqual([
			'end_before_start',
		]);
	});
});
