import { Inject, Injectable } from '@nestjs/common';
import type { MessageOutboxRepository, QueueStatsPort } from '@saha-textile/core-domain';
import type { MessageOutboxEntry, OpsJobs, OpsMessages } from '@saha-textile/contracts';

import { MESSAGE_OUTBOX_REPOSITORY, QUEUE_STATS } from '../infra/tokens';

const CHANNELS = ['sms', 'email', 'whatsapp'] as const;
type Status = MessageOutboxEntry['status'];

/** Read-only summaries for the operations address: counts and statuses, nothing personal. */
@Injectable()
export class OpsService {
	constructor(
		@Inject(QUEUE_STATS) private readonly queues: QueueStatsPort,
		@Inject(MESSAGE_OUTBOX_REPOSITORY) private readonly outbox: MessageOutboxRepository,
	) {}

	async jobs(now = new Date()): Promise<OpsJobs> {
		return { at: now.toISOString(), queues: await this.queues.counts() };
	}

	async messages(hours: number, now = new Date()): Promise<OpsMessages> {
		const since = new Date(now.getTime() - hours * 3_600_000).toISOString();
		const count = async (channel: (typeof CHANNELS)[number], status?: Status) =>
			(await this.outbox.list({ channel, from: since, ...(status ? { status } : {}), page: 1, pageSize: 1 }))
				.total;
		const channels = [];
		for (const channel of CHANNELS) {
			const total = await count(channel);
			if (!total) continue;
			const [sent, delivered, failed, queued] = await Promise.all([
				count(channel, 'sent'),
				count(channel, 'delivered'),
				count(channel, 'failed'),
				count(channel, 'queued'),
			]);
			channels.push({
				channel,
				total,
				sent,
				delivered,
				failed,
				queued,
				suppressed: Math.max(0, total - sent - delivered - failed - queued),
			});
		}
		const recent = (await this.outbox.list({ from: since, page: 1, pageSize: 20 })).items.map((m) => ({
			at: m.createdAt,
			channel: m.channel,
			category: m.category,
			template: m.templateKey,
			status: m.status,
		}));
		return { at: now.toISOString(), since, channels, recent };
	}
}
