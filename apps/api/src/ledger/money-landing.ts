import { Body, Controller, Get, Header, Inject, Injectable, Put } from '@nestjs/common';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { MoneyLanding, MoneyLandingWrite } from '@saha-textile/contracts';
import { ledgerClass, type MoneyLandingRepository } from '@saha-textile/core-domain';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { MONEY_LANDING_REPOSITORY } from '../infra/tokens';
import { API_TAGS } from '../openapi-tags';
import { accountsRefusal } from './accounts-refusal';
import { LedgerService } from './ledger.service';

/** Which kind of ledger each choice must be: a bank account, cash, or any active ledger. */
const NEEDS: Record<keyof MoneyLandingWrite, 'bank' | 'cash' | 'any'> = {
	receivedByGateway: 'any',
	receivedByUpi: 'any',
	receivedByBank: 'bank',
	cashOnDelivery: 'any',
	paidByBank: 'bank',
	paidInCash: 'cash',
};

/**
 * Where money lands (Postings and Convert brief AP1, AP-D1): the ledger each way of paying posts to, set once on
 * Accounts › Ledgers. Bank transfers and cheques need a bank account; cash payments a cash ledger.
 */
@Injectable()
export class MoneyLandingService {
	constructor(
		@Inject(MONEY_LANDING_REPOSITORY) private readonly store: MoneyLandingRepository,
		private readonly ledger: LedgerService,
	) {}

	get(): Promise<MoneyLanding> {
		return this.store.get();
	}

	async save(write: MoneyLandingWrite, by: string | null, now = new Date()): Promise<MoneyLanding> {
		const [before, chart] = await Promise.all([this.store.get(), this.ledger.chart()]);
		for (const [field, needs] of Object.entries(NEEDS) as [keyof MoneyLandingWrite, 'bank' | 'cash' | 'any'][]) {
			const id = write[field];
			if (!id) continue;
			const ledger = chart.ledgers.find((l) => l.id === id && l.active);
			if (!ledger || (needs !== 'any' && ledgerClass(ledger, chart.groups) !== needs))
				throw new BadRequestException(accountsRefusal(`money_landing_wrong_ledger:${field}`));
		}
		const next = MoneyLanding.parse({ ...write, updatedAt: now.toISOString(), updatedBy: by });
		await this.store.save(next, before.updatedAt).catch((error: Error) => {
			throw new ConflictException(accountsRefusal(error.message));
		});
		return next;
	}
}

@ApiTags(API_TAGS.stock)
@Audience('admin')
@Controller('admin/accounts/money-landing')
export class MoneyLandingController {
	constructor(private readonly landing: MoneyLandingService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'moneyLanding', summary: 'Where money lands, by each way of paying' })
	get() {
		return this.landing.get();
	}

	@Put()
	@RequirePermissions('accounts.edit')
	@ApiOperation({ operationId: 'saveMoneyLanding', summary: 'Set where money lands' })
	save(
		@Body(new ZodValidationPipe(MoneyLandingWrite)) body: MoneyLandingWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.landing.save(body, principal?.userId ?? null);
	}
}
