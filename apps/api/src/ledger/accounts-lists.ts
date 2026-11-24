import { Controller, Get, Header, Inject, Injectable, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	AccountsListQuery,
	AccountsListTab,
	type AccountsListPage,
	type AccountsListRow,
} from '@saha-textile/contracts';
import { istDay, type AccountsListsReader, type AdminUserRepository } from '@saha-textile/core-domain';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ACCOUNTS_LISTS_READER, ADMIN_USER_REPOSITORY } from '../infra/tokens';
import { API_TAGS } from '../openapi-tags';
import { canSeeCost } from '../purchasing/purchasing-support';

/**
 * Accounts › Vouchers (accounts brief A1–A9) and the Day book (A3): every document of the books as list rows, with
 * who made and approved each by name. A stock adjustment's value at cost and input tax go only to people who may see
 * cost (P8), as on its own page.
 */
@Injectable()
export class AccountsListsService {
	constructor(
		@Inject(ACCOUNTS_LISTS_READER) private readonly reader: AccountsListsReader,
		@Inject(ADMIN_USER_REPOSITORY) private readonly admins: Pick<AdminUserRepository, 'findById'>,
	) {}

	async list(
		tab: AccountsListTab,
		query: AccountsListQuery,
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	): Promise<AccountsListPage> {
		return this.shown(await this.reader.list(tab, query, istDay(now)), principal);
	}

	async dayBook(query: AccountsListQuery, principal: AuthenticatedPrincipal | undefined): Promise<AccountsListPage> {
		return this.shown(await this.reader.dayBook(query), principal);
	}

	/** Who by name (someone the admin no longer knows shows as nobody), and cost only where it may be seen. */
	private async shown(
		page: AccountsListPage,
		principal: AuthenticatedPrincipal | undefined,
	): Promise<AccountsListPage> {
		const ids = [...new Set(page.items.flatMap((row) => [row.by, row.approvedBy]))].filter(
			(id): id is string => !!id,
		);
		const names = new Map(await Promise.all(ids.map(async (id) => [id, await this.nameOf(id)] as const)));
		const seeCost = canSeeCost(principal);
		const name = (id: string | null) => (id ? (names.get(id) ?? null) : null);
		return {
			...page,
			items: page.items.map((row): AccountsListRow => {
				const named = { ...row, by: name(row.by), approvedBy: name(row.approvedBy) };
				return row.tab === 'stockAdjustments' && !seeCost
					? { ...named, amountINR: null, extra: { ...row.extra, itcReversedINR: null } }
					: named;
			}),
		};
	}

	private async nameOf(id: string): Promise<string | null> {
		const user = await this.admins.findById(id).catch(() => null);
		return user?.displayName || user?.email || user?.username || null;
	}
}

@ApiTags(API_TAGS.stock)
@Audience('admin')
@Controller('admin/accounts')
export class AccountsListsController {
	constructor(private readonly lists: AccountsListsService) {}

	@Get('lists/:tab')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({
		operationId: 'accountsList',
		summary: 'One tab of Accounts › Vouchers: a page of documents, the count behind each chip, the period totals',
	})
	list(
		@Param('tab', new ZodValidationPipe(AccountsListTab)) tab: AccountsListTab,
		@Query(new ZodValidationPipe(AccountsListQuery)) query: AccountsListQuery,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.lists.list(tab, query, principal);
	}

	@Get('day-book')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'accountsDayBook', summary: 'The Day book: every voucher made in a period, by date' })
	dayBook(
		@Query(new ZodValidationPipe(AccountsListQuery)) query: AccountsListQuery,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.lists.dayBook(query, principal);
	}
}
