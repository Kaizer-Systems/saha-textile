import { randomUUID } from 'node:crypto';

import {
	BadRequestException,
	ConflictException,
	Inject,
	Injectable,
	Logger,
	NotFoundException,
	type OnApplicationBootstrap,
	type OnApplicationShutdown,
} from '@nestjs/common';
import type { RecurringEntry, RecurringEntryEdit, RecurringEntryWrite } from '@saha-textile/contracts';
import { dayAfter, firstOnOrAfter, istDay, nextAfter, type RecurringEntryRepository } from '@saha-textile/core-domain';

import type { AuthenticatedPrincipal } from '../auth/session.guard';
import { RECURRING_ENTRY_REPOSITORY } from '../infra/tokens';
import { accountsRefusal } from '../ledger/accounts-refusal';
import { LedgerService } from '../ledger/ledger.service';

/** How often the job looks for entries due (it makes each one once). */
export const RECURRING_SWEEP_MS = 60 * 60_000;

/**
 * Rent and recurring entries (accounts brief R5): each makes a voucher draft on its day (a day of the month, or month
 * end), for someone to check, fill any amount left at nothing, and post; a journal can undo itself the next day.
 * The job runs hourly and makes every draft that has come due, each once, moving the entry to its next day.
 */
@Injectable()
export class RecurringService implements OnApplicationBootstrap, OnApplicationShutdown {
	private readonly logger = new Logger('RecurringEntries');
	private timer: NodeJS.Timeout | null = null;

	constructor(
		@Inject(RECURRING_ENTRY_REPOSITORY) private readonly entries: RecurringEntryRepository,
		@Inject(LedgerService) private readonly ledger: Pick<LedgerService, 'saveDraft'>,
	) {}

	onApplicationBootstrap(): void {
		if (process.env.SAHA_TEXTILE_DOCUMENTATION_BUILD === '1' || process.env.VITEST) return;
		this.timer = setInterval(() => void this.makeDue(), RECURRING_SWEEP_MS);
		this.timer.unref();
	}

	onApplicationShutdown(): void {
		if (this.timer) clearInterval(this.timer);
	}

	list(): Promise<RecurringEntry[]> {
		return this.entries.list();
	}

	private check(write: RecurringEntryWrite) {
		if (write.endOn && write.endOn < write.startOn)
			throw new BadRequestException(accountsRefusal('recurring_ends_before_start'));
	}

	async create(write: RecurringEntryWrite, principal: AuthenticatedPrincipal | undefined, now = new Date()) {
		this.check(write);
		const entry: RecurringEntry = {
			...write,
			id: `rec_${randomUUID()}`,
			nextOn: firstOnOrAfter(write.every, write.day, write.startOn),
			lastMadeOn: null,
			lastDraftId: null,
			createdBy: principal?.userId ?? null,
			createdAt: now.toISOString(),
			updatedAt: now.toISOString(),
			version: 0,
		};
		await this.entries.insert(entry);
		return entry;
	}

	private async get(id: string): Promise<RecurringEntry> {
		const entry = await this.entries.get(id);
		if (!entry) throw new NotFoundException(accountsRefusal('recurring_entry_not_found'));
		return entry;
	}

	private async save(entry: RecurringEntry, version: number) {
		try {
			return await this.entries.save(entry, version);
		} catch (error) {
			if (error instanceof Error && error.message === 'recurring_entry_changed')
				throw new ConflictException(accountsRefusal('recurring_entry_changed'));
			throw error;
		}
	}

	/** A change of schedule picks the next day again from the later of today and the start. */
	async update(id: string, edit: RecurringEntryEdit, now = new Date()): Promise<RecurringEntry> {
		const current = await this.get(id);
		const { version, ...write } = edit;
		this.check(write);
		const from = [write.startOn, istDay(now)].sort().at(-1) as string;
		return this.save(
			{
				...current,
				...write,
				nextOn: firstOnOrAfter(write.every, write.day, from),
				updatedAt: now.toISOString(),
			},
			version,
		);
	}

	async remove(id: string): Promise<void> {
		await this.get(id);
		await this.entries.remove(id);
	}

	/** One pass: a draft for every active entry due by today (within its end), each moved to its next day. */
	async makeDue(now = new Date()): Promise<number> {
		const today = istDay(now);
		let made = 0;
		for (const entry of await this.entries.list()) {
			if (!entry.active || entry.nextOn > today || (entry.endOn && entry.nextOn > entry.endOn)) continue;
			try {
				const draft = await this.ledger.saveDraft(
					null,
					{
						kind: entry.kind,
						date: entry.nextOn,
						narration: entry.party ? `${entry.what} · ${entry.party}` : entry.what,
						lines: entry.lines,
						reverseOn: entry.reverseNextDay ? dayAfter(entry.nextOn) : null,
						attachments: [],
						expectedUpdatedAt: null,
					},
					undefined,
				);
				await this.entries.save(
					{
						...entry,
						lastMadeOn: entry.nextOn,
						lastDraftId: draft.id,
						nextOn: nextAfter(entry.every, entry.day, entry.nextOn),
						updatedAt: now.toISOString(),
					},
					entry.version,
				);
				made += 1;
			} catch (error) {
				this.logger.warn(
					`Recurring entry ${entry.id} could not make its draft: ${error instanceof Error ? error.message : 'unknown'}`,
				);
			}
		}
		return made;
	}
}
