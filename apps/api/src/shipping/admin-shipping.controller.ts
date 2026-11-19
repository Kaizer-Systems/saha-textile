import {
	BadRequestException,
	Body,
	Controller,
	Delete,
	Get,
	Header,
	HttpCode,
	Param,
	Post,
	Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	ShippingExceptionWrite,
	ShippingRuleSetActivate,
	ShippingRuleSetCreate,
	ShippingRuleSetSave,
	ShippingSettingsWrite,
	ShippingTryRequest,
} from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { ShippingAdminService } from './shipping-admin.service';

const actor = (principal: AuthenticatedPrincipal | undefined) => principal?.userId ?? null;

/** A delete names the revision it was asked from, so a changed rule set is never deleted unseen. */
const revisionOf = (raw: string | undefined): number => {
	const revision = Number(raw);
	if (!Number.isInteger(revision) || revision < 0) {
		throw new BadRequestException({
			issues: [{ path: 'revision', message: 'A revision is required', code: 'revision_required' }],
		});
	}
	return revision;
};

/**
 * Admin › Shipping (brief approved 2026-11-19): Overview, Rule sets and the builder, Where rules
 * apply. Reading and Try it need `shipping.index`; adding needs `shipping.create`, changing and
 * making active `shipping.edit`, deleting `shipping.destroy`.
 */
@ApiTags(API_TAGS.shipping)
@Audience('admin')
@Controller('admin/shipping')
export class AdminShippingController {
	constructor(private readonly shipping: ShippingAdminService) {}

	@Get('overview')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('shipping.index')
	@ApiOperation({
		operationId: 'getShippingOverview',
		summary: 'Zone settings, rule sets, exception count and the checks',
	})
	overview() {
		return this.shipping.overview();
	}

	@Post('settings')
	@HttpCode(200)
	@RequirePermissions('shipping.edit')
	@ApiOperation({
		operationId: 'saveShippingSettings',
		summary: 'Save how each zone is priced and the path for orders sent abroad',
	})
	saveSettings(
		@Body(new ZodValidationPipe(ShippingSettingsWrite)) body: ShippingSettingsWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.shipping.saveSettings(body, actor(principal));
	}

	@Get('rule-sets')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('shipping.index')
	@ApiOperation({
		operationId: 'listShippingRuleSets',
		summary: 'Every rule set, pre-made and own, with where each is used',
	})
	list() {
		return this.shipping.list();
	}

	@Post('rule-sets')
	@HttpCode(200)
	@RequirePermissions('shipping.create')
	@ApiOperation({ operationId: 'createShippingRuleSet', summary: 'Start a rule set: blank, or a copy of another' })
	create(
		@Body(new ZodValidationPipe(ShippingRuleSetCreate)) body: ShippingRuleSetCreate,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.shipping.create(body, actor(principal));
	}

	@Post('try')
	@HttpCode(200)
	@RequirePermissions('shipping.index')
	@ApiOperation({
		operationId: 'tryShippingRuleSet',
		summary: 'Price rule blocks on real products without saving anything',
	})
	tryIt(@Body(new ZodValidationPipe(ShippingTryRequest)) body: ShippingTryRequest) {
		return this.shipping.tryRuleSet(body);
	}

	@Get('rule-sets/:id')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('shipping.index')
	@ApiOperation({
		operationId: 'getShippingRuleSet',
		summary: 'One rule set with its versions, where it is used and its checks',
	})
	detail(@Param('id') id: string) {
		return this.shipping.detail(id);
	}

	@Post('rule-sets/:id')
	@HttpCode(200)
	@RequirePermissions('shipping.edit')
	@ApiOperation({
		operationId: 'saveShippingRuleSet',
		summary: 'Save the working copy; the active version keeps pricing checkout',
	})
	save(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(ShippingRuleSetSave)) body: ShippingRuleSetSave,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.shipping.save(id, body, actor(principal));
	}

	@Post('rule-sets/:id/activate')
	@HttpCode(200)
	@RequirePermissions('shipping.edit')
	@ApiOperation({
		operationId: 'activateShippingRuleSet',
		summary: 'Make the saved working copy the new active version',
	})
	activate(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(ShippingRuleSetActivate)) body: ShippingRuleSetActivate,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.shipping.activate(id, body, actor(principal));
	}

	@Delete('rule-sets/:id')
	@HttpCode(200)
	@RequirePermissions('shipping.destroy')
	@ApiOperation({ operationId: 'deleteShippingRuleSet', summary: 'Delete an own rule set that is not used anywhere' })
	async remove(
		@Param('id') id: string,
		@Query('revision') revision: string | undefined,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		await this.shipping.remove(id, revisionOf(revision), actor(principal));
		return { ok: true };
	}

	@Get('exceptions')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('shipping.index')
	@ApiOperation({ operationId: 'listShippingExceptions', summary: 'Category and product exceptions, per zone' })
	exceptions() {
		return this.shipping.listExceptions();
	}

	@Post('exceptions')
	@HttpCode(200)
	@RequirePermissions('shipping.create')
	@ApiOperation({ operationId: 'createShippingException', summary: 'Add a category or product exception' })
	createException(
		@Body(new ZodValidationPipe(ShippingExceptionWrite)) body: ShippingExceptionWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.shipping.saveException(null, body, actor(principal));
	}

	@Post('exceptions/:id')
	@HttpCode(200)
	@RequirePermissions('shipping.edit')
	@ApiOperation({ operationId: 'updateShippingException', summary: 'Change an exception' })
	updateException(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(ShippingExceptionWrite)) body: ShippingExceptionWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.shipping.saveException(id, body, actor(principal));
	}

	@Delete('exceptions/:id')
	@HttpCode(200)
	@RequirePermissions('shipping.destroy')
	@ApiOperation({
		operationId: 'deleteShippingException',
		summary: 'Remove an exception; the site-wide choice applies again',
	})
	async removeException(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		await this.shipping.removeException(id, actor(principal));
		return { ok: true };
	}
}
