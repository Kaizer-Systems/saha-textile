import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';

import { InboxService } from './inbox.service';

/** How often waiting messages are checked: a message goes between 10 and 12 seconds after Send. */
export const UNDO_SEND_SWEEP_MS = 2_000;

/**
 * Sends Inbox messages once their Undo time is up (C4). The waiting rows live in the database, so
 * a restart loses nothing: the first round after start-up sends what fell due meanwhile.
 */
@Injectable()
export class UndoSendDispatcher implements OnApplicationBootstrap, OnApplicationShutdown {
	private readonly logger = new Logger(UndoSendDispatcher.name);
	private timer: NodeJS.Timeout | null = null;
	private running = false;

	constructor(private readonly inbox: InboxService) {}

	onApplicationBootstrap(): void {
		if (process.env.SAHA_TEXTILE_DOCUMENTATION_BUILD === '1' || process.env.VITEST) return;
		void this.round();
		this.timer = setInterval(() => void this.round(), UNDO_SEND_SWEEP_MS);
		this.timer.unref();
	}

	onApplicationShutdown(): void {
		if (this.timer) clearInterval(this.timer);
	}

	/** One round at a time: a slow Gmail never starts a second round over the first. */
	async round(now = new Date()): Promise<void> {
		if (this.running) return;
		this.running = true;
		try {
			await this.inbox.dispatchDue(now);
		} catch (error) {
			this.logger.warn(`Undo Send round failed: ${(error as Error).name}`);
		} finally {
			this.running = false;
		}
	}
}
