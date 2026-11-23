import { randomUUID } from 'node:crypto';

import { Body, Controller, Get, Header, Param, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CompanyProfileWrite, FeatureKey, GstRegistrationWrite } from '@saha-textile/contracts';
import { z } from 'zod';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { CompanyService } from './company.service';

const ProfileSave = z.object({ profile: CompanyProfileWrite, expectedUpdatedAt: z.string().nullable() });
const FeaturesSave = z.object({
	on: z.partialRecord(FeatureKey, z.boolean()),
	expectedUpdatedAt: z.string().nullable(),
});

const canEdit = (principal: AuthenticatedPrincipal | undefined): boolean =>
	!!principal?.permissions.includes('company.edit');
const actor = (principal: AuthenticatedPrincipal | undefined): string | null => principal?.userId ?? null;

/**
 * Settings › Company, Registrations and Features (accounts brief J, CT, G1–G2). Reads need Settings
 * access; saves are gated on Settings access and checked for company.edit in the service, so a
 * refused attempt is answered the same way everywhere.
 */
@ApiTags(API_TAGS.stock)
@Audience('admin')
@Controller('admin/company')
export class CompanyController {
	constructor(private readonly company: CompanyService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('setting.index')
	@ApiOperation({ operationId: 'getCompanyProfile', summary: 'The kind of business, its numbers and its owners' })
	profile() {
		return this.company.profile();
	}

	@Put()
	@RequirePermissions('setting.index')
	@ApiOperation({ operationId: 'saveCompanyProfile', summary: 'Save the company profile over the copy read' })
	saveProfile(
		@Body(new ZodValidationPipe(ProfileSave)) body: z.infer<typeof ProfileSave>,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.company.saveProfile(body.profile, actor(principal), canEdit(principal), body.expectedUpdatedAt);
	}

	@Get('registrations')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('setting.index')
	@ApiOperation({ operationId: 'listGstRegistrations', summary: 'Every GSTIN with its dated terms' })
	registrations() {
		return this.company.registrations();
	}

	@Post('registrations')
	@RequirePermissions('setting.index')
	@ApiOperation({ operationId: 'addGstRegistration', summary: 'Add a GSTIN' })
	addRegistration(
		@Body(new ZodValidationPipe(GstRegistrationWrite)) body: GstRegistrationWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.company.saveRegistration(null, body, canEdit(principal), () => `gst_${randomUUID()}`);
	}

	@Put('registrations/:id')
	@RequirePermissions('setting.index')
	@ApiOperation({
		operationId: 'saveGstRegistration',
		summary: 'Add dated terms or change names; earlier terms stay',
	})
	saveRegistration(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(GstRegistrationWrite)) body: GstRegistrationWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.company.saveRegistration(id, body, canEdit(principal), () => id);
	}

	@Get('features')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('setting.index')
	@ApiOperation({ operationId: 'getFeatureSwitches', summary: 'Each feature switch with what uses it' })
	features() {
		return this.company.features();
	}

	@Put('features')
	@RequirePermissions('setting.index')
	@ApiOperation({ operationId: 'saveFeatureSwitches', summary: 'Switch features on or off' })
	saveFeatures(
		@Body(new ZodValidationPipe(FeaturesSave)) body: z.infer<typeof FeaturesSave>,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.company.saveFeatures(body.on, actor(principal), canEdit(principal), body.expectedUpdatedAt);
	}
}
