import type { EmailPicture, EmailPictureSent } from '@saha-textile/contracts';

/**
 * Email pictures that left their photo (deleted for good or replaced), kept for good so emails already sent keep their
 * pictures (Media brief R4-3, R6-1). Only Clean up › Email pictures removes them.
 */
export interface EmailPictureRepository {
	/** Records pictures as they leave their photo; one already recorded is left as it is. */
	keep(rows: readonly EmailPicture[]): Promise<void>;
	/** A page in key order after `after`, filtered by when a picture was last sent (`now` sets the cut-offs). */
	list(input: { sent: EmailPictureSent; now: Date; after: string | null; limit: number }): Promise<EmailPicture[]>;
	count(input: { sent: EmailPictureSent; now: Date }): Promise<number>;
	/** Every recorded picture: how many and how many bytes. */
	totals(): Promise<{ count: number; bytes: number }>;
	findByKeys(keys: readonly string[]): Promise<EmailPicture[]>;
	remove(keys: readonly string[]): Promise<void>;
}
