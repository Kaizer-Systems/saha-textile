import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AutomaticEDocPath, EDocKeysWrite, EDocSettingsWrite } from '@saha-textile/contracts';
import { z } from 'zod';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { EDocsOrderBridge } from './edocs-order-bridge';
import { EDocsService } from './edocs.service';

const SettingsSave = z.object({ settings: EDocSettingsWrite, expectedUpdatedAt: z.string().nullable() });
const PathParam = AutomaticEDocPath;
const ListQuery = z.object({
	kind: z.enum(['eInvoice', 'eWayBill']),
	status: z.enum(['active', 'cancelled']).optional(),
	from: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/)
		.optional(),
	to: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/)
		.optional(),
	q: z.string().trim().max(80).optional(),
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
const ActivityQuery = z.object({ page: z.coerce.number().int().min(1).default(1) });
const by = (principal: AuthenticatedPrincipal | undefined): string | null => principal?.userId ?? null;

/** Settings › E-invoice and e-way bill, keys and Test, the lists and the activity log (accounts brief addendum 2). */
@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin/edocs')
export class EDocsController {
	constructor(
		private readonly edocs: EDocsService,
		private readonly bridge: EDocsOrderBridge,
	) {}

	@Get('settings')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('setting.index')
	@ApiOperation({
		operationId: 'edocSettings',
		summary: 'The paths, enabled-from date, threshold and keys (never the secrets)',
	})
	settings() {
		return this.edocs.view();
	}

	@Put('settings')
	@RequirePermissions('edocs.settings')
	@ApiOperation({
		operationId: 'saveEdocSettings',
		summary: 'Choose the path per document (automatic only after Test passes)',
	})
	async saveSettings(
		@Body(new ZodValidationPipe(SettingsSave)) body: z.infer<typeof SettingsSave>,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		const view = await this.edocs.saveSettings(body.settings, body.expectedUpdatedAt, by(principal));
		await this.bridge.refresh();
		return view;
	}

	@Put('keys')
	@RequirePermissions('edocs.settings')
	@ApiOperation({
		operationId: 'saveEdocKeys',
		summary: 'Save a path’s keys, sealed with EDOC_KEYS_KEY; blank secrets keep the stored ones',
	})
	async saveKeys(
		@Body(new ZodValidationPipe(EDocKeysWrite)) body: EDocKeysWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		const view = await this.edocs.saveKeys(body, by(principal));
		await this.bridge.refresh();
		return view;
	}

	@Delete('keys/:path')
	@RequirePermissions('edocs.settings')
	@ApiOperation({
		operationId: 'removeEdocKeys',
		summary: 'Remove a path’s keys; a document using it goes back to by hand',
	})
	async removeKeys(@Param('path', new ZodValidationPipe(PathParam)) path: AutomaticEDocPath) {
		const view = await this.edocs.removeKeys(path);
		await this.bridge.refresh();
		return view;
	}

	@Post('keys/:path/test')
	@HttpCode(200)
	@RequirePermissions('edocs.settings')
	@ApiOperation({ operationId: 'testEdocKeys', summary: 'Sign in with the path’s keys and record the result' })
	async test(
		@Param('path', new ZodValidationPipe(PathParam)) path: AutomaticEDocPath,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		const view = await this.edocs.test(path, by(principal));
		await this.bridge.refresh();
		return view;
	}

	@Get('documents')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('order.index')
	@ApiOperation({
		operationId: 'edocDocuments',
		summary: 'E-invoices or e-way bills, newest first, with the period and search',
	})
	documents(@Query(new ZodValidationPipe(ListQuery)) query: z.infer<typeof ListQuery>) {
		return this.edocs.list(query);
	}

	@Get('activity')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('edocs.settings')
	@ApiOperation({ operationId: 'edocActivity', summary: 'Every call and by-hand entry, newest first (no keys)' })
	activity(@Query(new ZodValidationPipe(ActivityQuery)) query: z.infer<typeof ActivityQuery>) {
		return this.edocs.activity(query.page);
	}
}
