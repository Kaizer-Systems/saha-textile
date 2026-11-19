import { legacyMailboxRights } from '@saha-textile/core-domain';

import { MailboxAccessModel } from '../models/index';

/**
 * Migration 0007 (admin Inbox upgrade, owner log 2026-11-19): every mailbox access row gets the
 * seven-right list in place of its Read / Read-and-send flag. Read stays Read; Read-and-send becomes
 * Read, Send, Organise and Bin, which is what it allowed before. Nobody gains Delete forever,
 * Labels or Settings. `canSend` stays (expand half), so an older build still reads the same access.
 * Rows that already have rights are left alone, so a second run touches nothing.
 */
export async function giveMailboxAccessRights(): Promise<string> {
	const rows = await MailboxAccessModel.find(
		{ $or: [{ rights: { $exists: false } }, { rights: { $size: 0 } }] },
		{ _id: 1, canSend: 1 },
	)
		.lean<{ _id: string; canSend?: boolean }[]>()
		.exec();
	if (rows.length) {
		await MailboxAccessModel.bulkWrite(
			rows.map((row) => ({
				updateOne: {
					filter: { _id: row._id },
					update: { $set: { rights: legacyMailboxRights(Boolean(row.canSend)) } },
				},
			})),
		);
	}
	return `gave rights to ${rows.length} mailbox access row${rows.length === 1 ? '' : 's'}`;
}
