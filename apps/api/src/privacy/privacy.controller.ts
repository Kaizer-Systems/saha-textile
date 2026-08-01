import { randomUUID } from 'node:crypto';

import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	type ConsentEvent,
	type ConsentStateResponse,
	ConsentUpdateRequest,
	type GenericAcceptedResponse,
} from '@saha-textile/contracts';
import type { ConsentRepository } from '@saha-textile/core-domain';
import type { FastifyRequest } from 'fastify';

import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { type AuthenticatedPrincipal, Public } from '../auth/session.guard';
import { Principal } from '../auth/ownership';
import { CONSENT_REPOSITORY } from '../infra/tokens';

const DEFAULT_CATEGORIES = {
	necessary: true as const,
	functional: false,
	analytics: false,
	targeting: false,
	marketing: false,
	promotional: false,
};

/**
 * Privacy and consent.
 *
 * Consent is append-only: every change writes a new `consentEvents` row and the latest
 * row is the effective state. That history is the evidence a regulator asks for — "what
 * did this person agree to, and when" cannot be answered by a mutable flag.
 *
 * Guests can consent too (they are the ones seeing the banner before any account exists),
 * so these routes are public and identify a guest by the hashed guest cookie.
 */
@ApiTags('privacy')
@Controller('privacy')
export class PrivacyController {
	constructor(@Inject(CONSENT_REPOSITORY) private readonly consent: ConsentRepository) {}

	private guestIdHash(request: FastifyRequest): string | null {
		const cookies = (request as FastifyRequest & { cookies?: Record<string, string> }).cookies;
		return cookies?.st_guest ?? null;
	}

	@Get('consent')
	@Public()
	@ApiOperation({ summary: 'Current effective consent for the caller (user or guest)' })
	async getConsent(
		@Req() request: FastifyRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<ConsentStateResponse> {
		const latest = principal
			? await this.consent.findLatestForUser(principal.userId)
			: await this.findLatestForGuest(request);

		if (!latest) {
			// No record yet: everything optional is OFF. Consent is opt-in, never assumed.
			return { categories: DEFAULT_CATEGORIES, policyVersion: null, updatedAt: null };
		}
		return { categories: latest.categories, policyVersion: latest.policyVersion, updatedAt: latest.createdAt };
	}

	@Post('consent')
	@Public()
	@HttpCode(HttpStatus.CREATED)
	@ApiOperation({ summary: 'Record a consent decision (append-only)' })
	async updateConsent(
		@Body(new ZodValidationPipe(ConsentUpdateRequest)) body: ConsentUpdateRequest,
		@Req() request: FastifyRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<ConsentStateResponse> {
		const event: ConsentEvent = {
			id: `consent_${randomUUID()}`,
			userId: principal?.userId ?? null,
			guestId: principal ? null : this.guestIdHash(request),
			categories: body.categories,
			policyVersion: body.policyVersion,
			source: 'storefront',
			// Hashes only — never a raw IP or user agent.
			ipHash: null,
			userAgentHash: null,
			createdAt: new Date().toISOString(),
		};

		await this.consent.append(event);
		return { categories: event.categories, policyVersion: event.policyVersion, updatedAt: event.createdAt };
	}

	/**
	 * Data export request.
	 *
	 * SEAM: the request is acknowledged and (once the job lands) queued. The export itself
	 * spans orders, addresses, consent history and media, and must not be assembled inline
	 * on a request thread. Deliberately not pretending to produce a file yet.
	 */
	@Post('export')
	@HttpCode(HttpStatus.ACCEPTED)
	@ApiOperation({ summary: 'Request a personal-data export (queued; seam)' })
	async requestExport(@Principal() principal: AuthenticatedPrincipal | undefined): Promise<GenericAcceptedResponse> {
		if (!principal) throw new UnauthorizedException('Authentication required');
		return { message: 'Your data export request has been received. We will email you when it is ready.' };
	}

	/**
	 * Erasure request.
	 *
	 * SEAM, and deliberately NOT an immediate delete: durable business records (orders,
	 * invoices, ledgers) are soft-deleted and retained under the financial/audit windows
	 * (`DEC-DELETE-RETENTION`), so an erasure is a reviewed workflow that anonymizes what
	 * it can and keeps what law requires — never a `deleteMany` triggered by an HTTP call.
	 */
	@Post('erase')
	@HttpCode(HttpStatus.ACCEPTED)
	@ApiOperation({ summary: 'Request account erasure (reviewed workflow; seam)' })
	async requestErasure(@Principal() principal: AuthenticatedPrincipal | undefined): Promise<GenericAcceptedResponse> {
		if (!principal) throw new UnauthorizedException('Authentication required');
		return {
			message:
				'Your erasure request has been received. Records we must keep for tax and accounting will be retained as required by law.',
		};
	}

	private async findLatestForGuest(request: FastifyRequest): Promise<ConsentEvent | null> {
		const guestHash = this.guestIdHash(request);
		return guestHash ? this.consent.findLatestForGuest(guestHash) : null;
	}
}
