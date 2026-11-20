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
	Put,
	Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	BusinessListQuery,
	BusinessReceiptWrite,
	BusinessStandingWrite,
	BusinessWrite,
	BusinessZoneWrite,
	BuyerSearchQuery,
	CouponBulkAction,
	CouponListQuery,
	CouponSwitchWrite,
	CouponWrite,
	DocumentNumberingWrite,
	LedgerQuery,
	OrderSettingsWrite,
	PriceZoneStatusWrite,
	PriceZoneWrite,
	SetOffSettingWrite,
	SetOffWrite,
	ZonePricingSettingsWrite,
} from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { codedRefusal } from '../common/coded-refusal';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { BusinessesService } from './businesses.service';
import { CouponsService } from './coupons.service';
import { OrderSettingsService } from './order-settings.service';
import { ZonesService } from './zones.service';

const actor = (principal: AuthenticatedPrincipal | undefined) => principal?.userId ?? null;

/** Admin › Coupons (brief cp01–cp05; owner 2026-11-20: ticks, bulk Delete / Turn on / Turn off, row switch). */
@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin/coupons')
export class AdminCouponsController {
	constructor(private readonly coupons: CouponsService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('coupon.index')
	@ApiOperation({ operationId: 'listCoupons', summary: 'Coupons, searched and filtered' })
	list(@Query(new ZodValidationPipe(CouponListQuery)) query: CouponListQuery) {
		return this.coupons.list(query);
	}

	@Get(':id')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('coupon.index')
	@ApiOperation({ operationId: 'getCoupon', summary: 'One coupon' })
	get(@Param('id') id: string) {
		return this.coupons.get(id);
	}

	@Post()
	@RequirePermissions('coupon.create')
	@ApiOperation({ operationId: 'createCoupon', summary: 'Save a new coupon from the builder' })
	create(
		@Body(new ZodValidationPipe(CouponWrite)) body: CouponWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.coupons.create(body, actor(principal));
	}

	@Put(':id')
	@RequirePermissions('coupon.edit')
	@ApiOperation({ operationId: 'updateCoupon', summary: 'Save a coupon (names the revision it was edited from)' })
	update(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(CouponWrite)) body: CouponWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.coupons.update(id, body, actor(principal));
	}

	@Post(':id/switch')
	@HttpCode(200)
	@RequirePermissions('coupon.edit')
	@ApiOperation({ operationId: 'switchCoupon', summary: 'The row switch: turn one coupon on or off' })
	switch(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(CouponSwitchWrite)) body: CouponSwitchWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.coupons.setEnabled(id, body.enabled, actor(principal));
	}

	@Post('bulk-switch')
	@HttpCode(200)
	@RequirePermissions('coupon.edit')
	@ApiOperation({ operationId: 'bulkSwitchCoupons', summary: 'Turn every ticked coupon on or off' })
	bulkSwitch(
		@Body(new ZodValidationPipe(CouponBulkAction)) body: CouponBulkAction,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		if (body.action === 'delete')
			throw new BadRequestException(codedRefusal('use_bulk_delete', 'Delete goes through bulk delete', 'action'));
		return this.coupons.bulk(body, actor(principal));
	}

	@Post('bulk-delete')
	@HttpCode(200)
	@RequirePermissions('coupon.destroy')
	@ApiOperation({
		operationId: 'bulkDeleteCoupons',
		summary: 'Delete every ticked coupon (a used one is turned off instead)',
	})
	bulkDelete(
		@Body(new ZodValidationPipe(CouponBulkAction)) body: CouponBulkAction,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.coupons.bulk({ action: 'delete', ids: body.ids }, actor(principal));
	}
}

/** Customers › Zones (`DEC-B2B-ZONES`). */
@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin/zones')
export class AdminZonesController {
	constructor(private readonly zones: ZonesService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('price_zone.index')
	@ApiOperation({ operationId: 'listZones', summary: 'Zones with their businesses and the settings they still need' })
	list() {
		return this.zones.list();
	}

	@Get('settings')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('price_zone.index')
	@ApiOperation({ operationId: 'getZoneSettings', summary: 'The zone settings (the open zone questions)' })
	settings() {
		return this.zones.getSettings();
	}

	@Post('settings')
	@HttpCode(200)
	@RequirePermissions('price_zone.edit')
	@ApiOperation({ operationId: 'saveZoneSettings', summary: 'Choose the zone settings' })
	saveSettings(
		@Body(new ZodValidationPipe(ZonePricingSettingsWrite)) body: ZonePricingSettingsWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.zones.saveSettings({ ...body, updatedAt: null, updatedBy: null }, actor(principal));
	}

	@Get(':id')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('price_zone.index')
	@ApiOperation({ operationId: 'getZone', summary: 'One zone and its price list' })
	get(@Param('id') id: string) {
		return this.zones.get(id);
	}

	@Post()
	@RequirePermissions('price_zone.create')
	@ApiOperation({ operationId: 'createZone', summary: 'Save a new zone (a draft until it goes live)' })
	create(
		@Body(new ZodValidationPipe(PriceZoneWrite)) body: PriceZoneWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.zones.create(body, actor(principal));
	}

	@Put(':id')
	@RequirePermissions('price_zone.edit')
	@ApiOperation({
		operationId: 'updateZone',
		summary: 'Save a zone’s price list (a new version when the list changes)',
	})
	update(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(PriceZoneWrite)) body: PriceZoneWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.zones.update(id, body, actor(principal));
	}

	@Post(':id/status')
	@HttpCode(200)
	@RequirePermissions('price_zone.edit')
	@ApiOperation({ operationId: 'setZoneStatus', summary: 'Go live, back to draft, or archive' })
	status(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(PriceZoneStatusWrite)) body: PriceZoneStatusWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.zones.setStatus(id, body.status, body.revision, actor(principal));
	}

	@Delete(':id')
	@HttpCode(204)
	@RequirePermissions('price_zone.destroy')
	@ApiOperation({ operationId: 'deleteZone', summary: 'Delete a zone no business uses (never RETAIL)' })
	async remove(@Param('id') id: string, @Principal() principal?: AuthenticatedPrincipal) {
		await this.zones.remove(id, actor(principal));
	}
}

/** Settings › Orders: named order settings and document number formats. */
@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin/order-settings')
export class AdminOrderSettingsController {
	constructor(private readonly settings: OrderSettingsService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('setting.index')
	@ApiOperation({ operationId: 'getOrderSettings', summary: 'The named order settings' })
	get() {
		return this.settings.getSettings();
	}

	@Post()
	@HttpCode(200)
	@RequirePermissions('setting.edit')
	@ApiOperation({ operationId: 'saveOrderSettings', summary: 'Save the named order settings' })
	save(
		@Body(new ZodValidationPipe(OrderSettingsWrite)) body: OrderSettingsWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.settings.saveSettings(body, actor(principal));
	}

	@Get('numbering')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('setting.index')
	@ApiOperation({ operationId: 'getDocumentNumbering', summary: 'Document number formats with an example of each' })
	numbering() {
		return this.settings.getNumbering();
	}

	@Post('numbering')
	@HttpCode(200)
	@RequirePermissions('setting.edit')
	@ApiOperation({
		operationId: 'saveDocumentNumbering',
		summary: 'Save the number formats (a used series is locked)',
	})
	saveNumbering(
		@Body(new ZodValidationPipe(DocumentNumberingWrite)) body: DocumentNumberingWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.settings.saveNumbering(body, actor(principal));
	}
}

const has = (principal: AuthenticatedPrincipal | undefined, code: string) =>
	principal?.permissions?.includes(code) ?? false;

/** Customers › Businesses (brief bz01–bz06, so01–so04): customers and suppliers in one record, two accounts. */
@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin/businesses')
export class AdminBusinessesController {
	constructor(private readonly businesses: BusinessesService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('business.index')
	@ApiOperation({ operationId: 'listBusinesses', summary: 'Businesses with roles, zone, both balances and standing' })
	list(@Query(new ZodValidationPipe(BusinessListQuery)) query: BusinessListQuery) {
		return this.businesses.list(query);
	}

	@Get('buyers')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('order.create')
	@ApiOperation({
		operationId: 'searchBusinessBuyers',
		summary: 'Businesses that buy from us, by name, phone or GSTIN',
	})
	buyers(@Query(new ZodValidationPipe(BuyerSearchQuery)) query: BuyerSearchQuery) {
		return this.businesses.searchBuyers(query.q, query.limit);
	}

	@Get(':id')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('business.index')
	@ApiOperation({ operationId: 'getBusiness', summary: 'One business' })
	get(@Param('id') id: string) {
		return this.businesses.get(id);
	}

	@Post()
	@RequirePermissions('business.create')
	@ApiOperation({
		operationId: 'createBusiness',
		summary: 'Add a business (zone and credit need their own permissions)',
	})
	create(
		@Body(new ZodValidationPipe(BusinessWrite)) body: BusinessWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.businesses.create(
			body,
			actor(principal),
			has(principal, 'business.assign'),
			has(principal, 'business.credit'),
		);
	}

	@Put(':id')
	@RequirePermissions('business.edit')
	@ApiOperation({ operationId: 'updateBusiness', summary: 'Save a business (names the revision it was edited from)' })
	update(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(BusinessWrite)) body: BusinessWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.businesses.update(
			id,
			body,
			actor(principal),
			has(principal, 'business.assign'),
			has(principal, 'business.credit'),
		);
	}

	@Post(':id/standing')
	@HttpCode(200)
	@RequirePermissions('business.hold')
	@ApiOperation({ operationId: 'setBusinessStanding', summary: 'Active, credit on hold or blocked, with a reason' })
	standing(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(BusinessStandingWrite)) body: BusinessStandingWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.businesses.setStanding(id, body, actor(principal));
	}

	@Post(':id/zone')
	@HttpCode(200)
	@RequirePermissions('business.assign')
	@ApiOperation({ operationId: 'setBusinessZone', summary: 'Put a business in a zone (DEC-B2B-ZONES)' })
	zone(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(BusinessZoneWrite)) body: BusinessZoneWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.businesses.setZone(id, body.zoneId, actor(principal));
	}

	@Get(':id/ledger')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('business.index')
	@ApiOperation({
		operationId: 'getBusinessLedger',
		summary: 'One account (receivable or payable) with a running balance',
	})
	ledger(@Param('id') id: string, @Query(new ZodValidationPipe(LedgerQuery)) query: LedgerQuery) {
		return this.businesses.statement(id, query);
	}

	@Post(':id/receipts')
	@RequirePermissions('order.payment')
	@ApiOperation({ operationId: 'recordBusinessReceipt', summary: 'Record a receipt on account (RC number issued)' })
	receipt(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(BusinessReceiptWrite)) body: BusinessReceiptWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.businesses.recordReceipt(id, body, actor(principal));
	}

	@Post(':id/set-off-setting')
	@HttpCode(200)
	@RequirePermissions('business.settle')
	@ApiOperation({
		operationId: 'setBusinessSetOff',
		summary: 'Set-off: never, or under a standing written agreement',
	})
	setOffSetting(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(SetOffSettingWrite)) body: SetOffSettingWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.businesses.setSetOff(id, body, actor(principal));
	}

	@Post(':id/set-offs')
	@RequirePermissions('business.settle')
	@ApiOperation({ operationId: 'recordSetOff', summary: 'Record a set-off (JV number) in both accounts' })
	setOff(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(SetOffWrite)) body: SetOffWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.businesses.recordSetOff(id, body, actor(principal));
	}
}
