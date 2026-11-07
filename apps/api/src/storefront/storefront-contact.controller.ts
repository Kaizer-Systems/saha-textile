import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	HttpStatus,
	Post,
	Req,
	Res,
	UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';

import {
	ConfirmContactChangeRequest,
	type Customer,
	type PendingContactChangeResponse,
	type PendingContactChangeState,
	StartEmailChangeRequest,
	StartPhoneChangeRequest,
} from '@saha-textile/contracts';

import { AuthService } from '../auth/auth.service';
import { Principal } from '../auth/ownership';
import { tooManyRequests } from '../auth/rate-limit-response';
import { type AuthenticatedPrincipal, Audience } from '../auth/session.guard';
import { SessionService } from '../auth/session.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { ContactChangeService } from './contact-change.service';

/**
 * Changing the email or the phone on the signed-in account.
 *
 * ## Why this is not a field on the profile route
 *
 * Both are login credentials under `DEC-SIGNUP-VERIFICATION`. The security matrix requires a
 * change to either to carry recent credential proof, mint its own verification token, keep the
 * old value live until the new one is proven, and be audited — none of which is expressible as a
 * key in a patch body. `PATCH /storefront/account/profile` therefore takes `displayName` alone
 * and these routes exist instead.
 *
 * ## Two steps, and nothing moves in between
 *
 * Start proves the caller and sends a code to the new value. Confirm spends it. Until then the
 * account is untouched: the old address still signs in and still receives recovery mail. A
 * session stolen for five minutes cannot leave with the recovery channel.
 *
 * Confirmation carries a code and NOTHING else — which credential is moving and to what are read
 * off the record the server is holding. The brief sketched a confirm route per field; one route
 * with no field removes the last parameter a caller could have lied about, the same absence that
 * makes `FinaliseSignupRequest` safe.
 *
 * No customer id here either. The owner comes from the session, as with every route in this
 * folder.
 */
@ApiTags(API_TAGS.storefrontAccount)
@Controller('storefront/account/contact')
@Audience('storefront')
export class StorefrontContactController {
	constructor(
		private readonly contact: ContactChangeService,
		private readonly sessions: SessionService,
		private readonly auth: AuthService,
	) {}

	private ownerId(principal: AuthenticatedPrincipal | undefined): string {
		if (!principal) throw new UnauthorizedException('Authentication required');
		return principal.userId;
	}

	/**
	 * The IP budget, spent before anything is sent.
	 *
	 * The per-change budget and backoff in the service are per ACCOUNT; this is the one that
	 * bounds a caller working through many accounts from one place. Refusal is a plain 429 here
	 * rather than a silent accept: this route is authenticated, so there is no anonymous
	 * enumeration to protect against, and pretending a send happened would only confuse the
	 * person waiting for it.
	 */
	private async spendSendBudget(
		destinationScope: string,
		request: FastifyRequest,
		reply: FastifyReply,
	): Promise<void> {
		const limit = await this.auth.consumeRateLimit('otp_request', {
			identifier: destinationScope,
			ip: request.ip,
		});
		if (!limit.allowed) throw tooManyRequests(limit, reply);
	}

	@Get()
	@ApiOperation({
		operationId: 'getOwnContactChange',
		summary: 'The email or phone change in flight on the current account, if any',
	})
	async pending(@Principal() principal: AuthenticatedPrincipal | undefined): Promise<PendingContactChangeResponse> {
		return { pending: await this.contact.pendingFor(this.ownerId(principal)) };
	}

	@Post('email')
	@ApiOperation({
		operationId: 'startOwnEmailChange',
		summary: 'Start changing the account email; sends a code to the new address',
	})
	async startEmail(
		@Body(new ZodValidationPipe(StartEmailChangeRequest)) body: StartEmailChangeRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Req() request: FastifyRequest,
		@Res({ passthrough: true }) reply: FastifyReply,
	): Promise<PendingContactChangeState> {
		const customerId = this.ownerId(principal);
		await this.spendSendBudget(body.newEmail, request, reply);
		return this.contact.start({
			customerId,
			field: 'email',
			rawValue: body.newEmail,
			proof: { password: body.password, otpCode: body.otpCode },
		});
	}

	@Post('phone')
	@ApiOperation({
		operationId: 'startOwnPhoneChange',
		summary: 'Start changing the account phone; sends a code to the new number',
	})
	async startPhone(
		@Body(new ZodValidationPipe(StartPhoneChangeRequest)) body: StartPhoneChangeRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Req() request: FastifyRequest,
		@Res({ passthrough: true }) reply: FastifyReply,
	): Promise<PendingContactChangeState> {
		const customerId = this.ownerId(principal);
		await this.spendSendBudget(body.newPhone, request, reply);
		return this.contact.start({
			customerId,
			field: 'phone',
			rawValue: body.newPhone,
			proof: { password: body.password, otpCode: body.otpCode },
		});
	}

	/**
	 * Sends the code again to the value already parked.
	 *
	 * Deliberately takes no step-up. The destination was fixed by a request that already proved
	 * the caller and this cannot redirect it, so a second password prompt would be ceremony.
	 */
	@Post('resend')
	@ApiOperation({ operationId: 'resendOwnContactChangeCode', summary: 'Send the verification code again' })
	async resend(
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Req() request: FastifyRequest,
		@Res({ passthrough: true }) reply: FastifyReply,
	): Promise<PendingContactChangeState> {
		const customerId = this.ownerId(principal);
		await this.spendSendBudget(customerId, request, reply);
		return this.contact.resend(customerId);
	}

	/**
	 * Spends the code, moves the value, and evicts every OTHER device.
	 *
	 * The caller's own session is kept — like `password/set` and unlike `password/reset`. This
	 * request arrived on a session that proved itself twice over (step-up at the start, a code
	 * from the new channel here), so signing it out would read as a failure. Everything else goes:
	 * the account's recovery channel just moved, and any session that predates that should have
	 * to re-establish itself against the new one.
	 */
	@Post('confirm')
	@ApiOperation({
		operationId: 'confirmOwnContactChange',
		summary: 'Confirm the pending email or phone change; signs other devices out',
	})
	async confirm(
		@Body(new ZodValidationPipe(ConfirmContactChangeRequest)) body: ConfirmContactChangeRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<Customer> {
		if (!principal) throw new UnauthorizedException('Authentication required');
		const customer = await this.contact.confirm(principal.userId, body.code);
		await this.sessions.revokeOtherSessions(principal);
		return customer;
	}

	@Delete()
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiOperation({ operationId: 'cancelOwnContactChange', summary: 'Abandon the pending change' })
	async cancel(@Principal() principal: AuthenticatedPrincipal | undefined): Promise<void> {
		await this.contact.cancel(this.ownerId(principal));
	}
}
