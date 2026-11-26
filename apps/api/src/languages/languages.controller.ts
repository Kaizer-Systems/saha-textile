import { Body, Controller, Delete, Get, Header, Param, Post, Put, Req, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	type ActiveLocaleConfig,
	LanguageAddWrite,
	LanguageEraseWrite,
	type LanguageListResponse,
	type LanguageReminderResponse,
	type LanguageSettingsResponse,
	LanguageSwitchWrite,
	type LanguageTodoResponse,
	LocaleCode,
	type LanguageMissingResponse,
	type WrittenLanguageArea,
	WrittenLanguageAreaParam,
} from '@saha-textile/contracts';
import type { FastifyRequest } from 'fastify';

import { Principal } from '../auth/ownership';
import { type AuthenticatedPrincipal, Audience, Public, RequirePermissions } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { LanguagesService } from './languages.service';

const requestIdOf = (request: FastifyRequest): string | null => (typeof request.id === 'string' ? request.id : null);
const codePipe = new ZodValidationPipe(LocaleCode);
const areaPipe = new ZodValidationPipe(WrittenLanguageAreaParam);

/** The languages the shop shows, read by the shop and by the admin before anyone signs in. */
@ApiTags(API_TAGS.languages)
@Controller()
export class LanguagesController {
	constructor(private readonly languages: LanguagesService) {}

	@Get('storefront/languages')
	@Public()
	@Header('Cache-Control', 'public, max-age=60')
	@ApiOperation({
		operationId: 'storefrontLanguages',
		summary: 'The shop’s languages English first, the admin’s own languages, and those whose addresses answer 301',
	})
	list(): ActiveLocaleConfig {
		return this.languages.publicList();
	}
}

/**
 * Settings › Languages (step 0d, owner decision round 2026-11-15). Every signed-in admin reads the
 * working list (forms show each added language); everything else needs `language.manage`, which
 * only the Administrator role holds at first.
 */
@ApiTags(API_TAGS.languages)
@Audience('admin')
@Controller('admin/languages')
export class AdminLanguagesController {
	constructor(private readonly languages: LanguagesService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@ApiOperation({ operationId: 'adminLanguages', summary: 'Every added language with its Admin and Shop state' })
	list(): LanguageListResponse {
		return this.languages.workingList();
	}

	@Get('settings')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('language.manage')
	@ApiOperation({
		operationId: 'languageSettings',
		summary: 'Settings › Languages: every language with its to-do total, stored text and what this release ships',
	})
	settings(): Promise<LanguageSettingsResponse> {
		return this.languages.settings();
	}

	@Get('reminders')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('language.manage')
	@ApiOperation({
		operationId: 'languageReminders',
		summary: 'Deleted languages whose stored text the bell reminds about (30 days unused, then every 30 days)',
	})
	reminders(): Promise<LanguageReminderResponse> {
		return this.languages.reminders();
	}

	@Get(':code/todo')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('language.manage')
	@ApiOperation({ operationId: 'languageTodo', summary: 'What is still empty in one language, by area' })
	todo(@Param('code', codePipe) code: string): Promise<LanguageTodoResponse> {
		return this.languages.todo(code);
	}

	@Get(':code/missing/:area')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('language.manage')
	@ApiOperation({
		operationId: 'languageMissingItems',
		summary: 'The ids of the items one list shows when filtered to what is missing in a language',
	})
	async missing(
		@Param('code', codePipe) code: string,
		@Param('area', areaPipe) area: WrittenLanguageArea,
	): Promise<LanguageMissingResponse> {
		return { ids: await this.languages.missingIds(area, code) };
	}

	@Post()
	@RequirePermissions('language.manage')
	@ApiOperation({ operationId: 'addLanguage', summary: 'Add a language this release ships, as a draft (audited)' })
	add(
		@Body(new ZodValidationPipe(LanguageAddWrite)) body: LanguageAddWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Req() request: FastifyRequest,
	): Promise<LanguageSettingsResponse> {
		return this.languages.change(this.actor(principal), { kind: 'add', code: body.code }, requestIdOf(request));
	}

	@Put(':code/admin')
	@RequirePermissions('language.manage')
	@ApiOperation({
		operationId: 'switchLanguageAdmin',
		summary: 'Let staff use the admin in this language, or stop (audited)',
	})
	admin(
		@Param('code', codePipe) code: string,
		@Body(new ZodValidationPipe(LanguageSwitchWrite)) body: LanguageSwitchWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Req() request: FastifyRequest,
	): Promise<LanguageSettingsResponse> {
		return this.languages.change(this.actor(principal), { kind: 'admin', code, on: body.on }, requestIdOf(request));
	}

	@Put(':code/shop')
	@RequirePermissions('language.manage')
	@ApiOperation({
		operationId: 'switchLanguageShop',
		summary: 'Show this language on the shop once nothing is left, or take it off (301 to English; audited)',
	})
	shop(
		@Param('code', codePipe) code: string,
		@Body(new ZodValidationPipe(LanguageSwitchWrite)) body: LanguageSwitchWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Req() request: FastifyRequest,
	): Promise<LanguageSettingsResponse> {
		return this.languages.change(this.actor(principal), { kind: 'shop', code, on: body.on }, requestIdOf(request));
	}

	@Delete(':code')
	@RequirePermissions('language.manage')
	@ApiOperation({
		operationId: 'deleteLanguage',
		summary: 'Remove a language the shop no longer shows from every list; its text stays stored (audited)',
	})
	remove(
		@Param('code', codePipe) code: string,
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Req() request: FastifyRequest,
	): Promise<LanguageSettingsResponse> {
		return this.languages.change(this.actor(principal), { kind: 'delete', code }, requestIdOf(request));
	}

	@Post(':code/keep')
	@RequirePermissions('language.manage')
	@ApiOperation({
		operationId: 'keepLanguageText',
		summary: 'Keep a deleted language’s stored text; the bell reminds again in 30 days (audited)',
	})
	keep(
		@Param('code', codePipe) code: string,
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Req() request: FastifyRequest,
	): Promise<LanguageSettingsResponse> {
		return this.languages.change(this.actor(principal), { kind: 'keep', code }, requestIdOf(request));
	}

	@Post(':code/erase')
	@RequirePermissions('language.manage')
	@ApiOperation({
		operationId: 'eraseLanguageText',
		summary: 'Erase a deleted language’s stored text for good, after its name is typed (audited)',
	})
	erase(
		@Param('code', codePipe) code: string,
		@Body(new ZodValidationPipe(LanguageEraseWrite)) body: LanguageEraseWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Req() request: FastifyRequest,
	): Promise<LanguageSettingsResponse> {
		return this.languages.change(
			this.actor(principal),
			{ kind: 'erase', code, typed: body.confirm },
			requestIdOf(request),
		);
	}

	private actor(principal: AuthenticatedPrincipal | undefined): string {
		if (!principal) throw new UnauthorizedException('Authentication required');
		return principal.userId;
	}
}
