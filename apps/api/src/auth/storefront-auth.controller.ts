import { randomUUID } from 'node:crypto';

import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	HttpStatus,
	Inject,
	Param,
	Post,
	Req,
	Res,
	BadRequestException,
	UnauthorizedException,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	ActivateCustomerRequest,
	type AuthSessionResponse,
	EmailOtpRequest,
	EmailOtpVerifyRequest,
	EmailVerificationRequest,
	type GenericAcceptedResponse,
	PasswordForgotRequest,
	PasswordLoginRequest,
	PasswordResetRequest,
	FinaliseSignupRequest,
	SignupOtpRequestBody,
	SignupOtpVerifyRequest,
	type PendingSignupState,
	type SignupOtpVerifyResponse,
	StartSignupRequest,
	FacebookVerifyRequest,
	GoogleVerifyRequest,
	OAuthStartRequest,
	ConnectIdentityRequest,
	DisconnectIdentityRequest,
	type LoginMethodsResponse,
	StepUpRequestBody,
	type OAuthStartResponse,
	type OAuthVerifyResponse,
	UpdateSignupFieldRequest,
	type SessionListResponse,
	type SessionRevokeResponse,
} from '@saha-textile/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { CartService } from '../cart/cart.service';
import { cookieNames, sessionCookieOptions } from '../common/cookies';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { API_TAGS } from '../openapi-tags';
import { AuthService } from './auth.service';
import { Principal } from './ownership';
import { assertPasswordAcceptable } from './password-policy';
import { mayRemoveCredential, stepUpMethodFor } from '@saha-textile/core-domain';

import { OAuthIdentityConflictError, OAuthService, OAuthStateInvalidError } from './oauth.service';
import { SignupError, SignupService } from './signup.service';
import { tooManyRequests } from './rate-limit-response';
import { RotatesSession } from './refresh-reuse.guard';
import { type AuthenticatedPrincipal, Audience, Public } from './session.guard';
import { SessionService } from './session.service';

/**
 * The one response every enumeration-sensitive endpoint returns.
 *
 * Owner lock: OTP requests and forgotten-password requests answer identically whether or
 * not the account exists. Anything that varies — status code, body, or which field is
 * named — turns the endpoint into a directory of registered customers.
 */
const ACCEPTED: GenericAcceptedResponse = {
	message: 'If the details are correct, we have sent you an email.',
};

@ApiTags(API_TAGS.auth)
@Controller('auth/storefront')
@Audience('storefront')
export class StorefrontAuthController {
	constructor(
		private readonly auth: AuthService,
		private readonly sessions: SessionService,
		private readonly carts: CartService,
		private readonly signup: SignupService,
		private readonly oauth: OAuthService,
		@Inject(APP_CONFIG) private readonly config: AppConfig,
	) {}

	/** Reads the `st_signup` cookie that ties an in-progress signup to this browser. */
	private signupKey(request: FastifyRequest): string | null {
		return request.cookies?.[cookieNames(this.config).signup] ?? null;
	}

	/**
	 * Every signup refusal becomes a 400 carrying a STABLE code.
	 *
	 * Deliberately not varied by HTTP status. `signup_identifier_taken` is only ever reached
	 * after proof of control, but a status code is the easiest thing for a caller to probe, so
	 * every refusal on this surface looks alike from the outside and differs only in a code the
	 * screen reads.
	 */
	private refuse(error: unknown): never {
		if (error instanceof OAuthStateInvalidError) {
			throw new BadRequestException({ code: 'oauth_state_invalid', message: 'Sign-in could not be completed' });
		}
		if (error instanceof OAuthIdentityConflictError) {
			throw new BadRequestException({
				code: 'oauth_identity_conflict',
				message: 'That account is already connected to a different customer',
			});
		}
		if (error instanceof Error && error.name === 'OAuthProviderUnavailableError') {
			throw new BadRequestException({ code: 'oauth_provider_unavailable', message: 'Sign-in is unavailable' });
		}
		// Verification failures name their reason for the LOG and never for the caller: somebody
		// who learns why a token was rejected learns how to build a better one.
		if (error instanceof Error && error.name === 'OAuthTokenInvalidError') {
			throw new BadRequestException({ code: 'oauth_token_invalid', message: 'Sign-in could not be completed' });
		}
		if (error instanceof SignupError) {
			throw new BadRequestException({ code: error.code, message: 'Signup could not be completed' });
		}
		throw error;
	}

	/** Merge a proven guest cart into the new session, then drop `st_guest`. */
	private async adoptGuestCart(userId: string, request: FastifyRequest, reply: FastifyReply): Promise<void> {
		const names = cookieNames(this.config);
		const guestToken = request.cookies?.[names.guest] ?? null;
		await this.carts.mergeGuestCartForUser(userId, guestToken);
		if (guestToken) {
			void reply.setCookie(names.guest, '', sessionCookieOptions(this.config, 0));
		}
	}

	@Post('signup/start')
	@Public()
	@ApiOperation({
		operationId: 'startCustomerSignup',
		summary: 'Begin a signup; no account exists until email and phone are verified',
	})
	async startSignup(
		@Body(new ZodValidationPipe(StartSignupRequest)) body: StartSignupRequest,
		@Req() request: FastifyRequest,
		@Res({ passthrough: true }) reply: FastifyReply,
	): Promise<PendingSignupState> {
		/**
		 * This route REPLACED `POST /auth/storefront/register`, which created an account from an
		 * email and a password with no verification at all. Shipping the verified flow beside it
		 * would have left the unverified door open next to the locked one, and an attacker uses
		 * whichever door opens.
		 *
		 * Nothing here is rate-limited on the address, because nothing here reveals anything about
		 * one: starting a signup is not an oracle. The cost controls live on the SEND.
		 */
		const sessionKey = this.signupKey(request) ?? this.signup.newSessionKey();
		const record = await this.signup.start({
			sessionKey,
			origin: 'password',
			email: body.email,
			phone: body.phone,
			displayName: body.displayName,
			marketingOptIn: body.marketingOptIn,
			guestCartId: body.guestCartId ?? null,
		});

		// httpOnly: a script that could read this could resume somebody else's half-finished signup.
		void reply.setCookie(cookieNames(this.config).signup, sessionKey, sessionCookieOptions(this.config, 1800));
		return this.signup.toState(record);
	}

	@Post('signup/field')
	@Public()
	@ApiOperation({ operationId: 'updateCustomerSignupField', summary: 'Set an email or phone, clearing its proof' })
	async updateSignupField(
		@Body(new ZodValidationPipe(UpdateSignupFieldRequest)) body: UpdateSignupFieldRequest,
		@Req() request: FastifyRequest,
	): Promise<PendingSignupState> {
		try {
			const record = await this.signup.require(this.signupKey(request));
			return this.signup.toState(await this.signup.setField(record, body.field, body.value));
		} catch (error) {
			return this.refuse(error);
		}
	}

	@Post('signup/otp/request')
	@Public()
	@ApiOperation({ operationId: 'requestCustomerSignupOtp', summary: 'Send a code to a pending email or phone' })
	async requestSignupOtp(
		@Body(new ZodValidationPipe(SignupOtpRequestBody)) body: SignupOtpRequestBody,
		@Req() request: FastifyRequest,
	): Promise<PendingSignupState> {
		try {
			const record = await this.signup.require(this.signupKey(request));
			return this.signup.toState(await this.signup.requestOtp(record, body.field));
		} catch (error) {
			return this.refuse(error);
		}
	}

	@Post('signup/otp/verify')
	@Public()
	@ApiOperation({
		operationId: 'verifyCustomerSignupOtp',
		summary: 'Verify a code; discloses an existing account only once control is proven',
	})
	async verifySignupOtp(
		@Body(new ZodValidationPipe(SignupOtpVerifyRequest)) body: SignupOtpVerifyRequest,
		@Req() request: FastifyRequest,
	): Promise<SignupOtpVerifyResponse> {
		try {
			const record = await this.signup.require(this.signupKey(request));
			const result = await this.signup.verifyOtp(record, body.field, body.code);
			return {
				state: this.signup.toState(result.record),
				// Safe to answer now, and ONLY now: the caller just proved they control this address.
				existingAccount: result.existingCustomerId !== null,
				accountUsable: result.accountUsable,
			};
		} catch (error) {
			return this.refuse(error);
		}
	}

	@Post('signup/finalise')
	@Public()
	@ApiOperation({ operationId: 'finaliseCustomerSignup', summary: 'Create the account from the proven values' })
	async finaliseSignup(
		@Body(new ZodValidationPipe(FinaliseSignupRequest)) body: FinaliseSignupRequest,
		@Req() request: FastifyRequest,
		@Res({ passthrough: true }) reply: FastifyReply,
	): Promise<AuthSessionResponse> {
		try {
			const record = await this.signup.require(this.signupKey(request));

			// Policy before consumption: a weak password must not burn the one-shot proof.
			if (record.origin === 'password') {
				if (!body.password) throw new SignupError('signup_incomplete');
				assertPasswordAcceptable(body.password);
			}

			const { resolution, consumed } = await this.signup.finalise(record);
			void reply.setCookie(cookieNames(this.config).signup, '', sessionCookieOptions(this.config, 0));

			if (resolution.kind === 'conflict') throw new SignupError('signup_identifier_conflict');
			if (resolution.kind === 'existing') throw new SignupError('signup_identifier_taken');

			// Every identifier comes from the CONSUMED record. The request carried none, which is why
			// a caller cannot name an address at the moment an account is minted.
			const customer = await this.auth.customerRepository.save({
				id: `cus_${randomUUID()}`,
				email: consumed.email.value,
				emailVerified: true,
				phone: consumed.phone.value,
				phoneVerified: true,
				displayName: consumed.displayName ?? undefined,
				status: 'active',
				identities: consumed.email.value ? [{ provider: 'password', email: consumed.email.value }] : [],
				addresses: [],
				contacts: [],
				savedSizes: [],
				measurementProfiles: [],
				guestCartId: consumed.guestCartId,
			});

			if (body.password) {
				await this.auth.customerAuthRepository.setPasswordHash(
					customer.id,
					await this.auth.hashPassword(body.password),
				);
			}

			const state = await this.auth.customerAuthRepository.findAuthStateById(customer.id);
			const { session } = await this.sessions.establish({
				user: { id: customer.id, role: null, tokenVersion: state?.tokenVersion ?? 0, permissionsVersion: 0 },
				audience: 'storefront',
				request,
				reply,
			});
			await this.adoptGuestCart(customer.id, request, reply);

			return {
				user: await this.auth.publicCustomer(customer.id),
				session: {
					audience: session.audience,
					expiresAt: session.expiresAt,
					refreshExpiresAt: session.absoluteExpiresAt,
				},
			};
		} catch (error) {
			return this.refuse(error);
		}
	}

	@Post('oauth/state')
	@Public()
	@ApiOperation({
		operationId: 'startCustomerOAuth',
		summary: 'Mint the single-use state a provider round-trip is bound to',
	})
	async startOAuth(
		@Body(new ZodValidationPipe(OAuthStartRequest)) body: OAuthStartRequest,
	): Promise<OAuthStartResponse> {
		try {
			return await this.oauth.start({ provider: body.provider, guestCartId: body.guestCartId ?? null });
		} catch (error) {
			return this.refuse(error);
		}
	}

	@Post('oauth/google')
	@Public()
	@ApiOperation({
		operationId: 'verifyCustomerGoogle',
		summary: 'Verify a Google ID token; sign in or begin a signup',
	})
	async verifyGoogle(
		@Body(new ZodValidationPipe(GoogleVerifyRequest)) body: GoogleVerifyRequest,
		@Req() request: FastifyRequest,
		@Res({ passthrough: true }) reply: FastifyReply,
	): Promise<OAuthVerifyResponse> {
		return this.completeOAuth('google', body.stateId, body.credential, body.nonce ?? null, request, reply);
	}

	@Post('oauth/facebook')
	@Public()
	@ApiOperation({
		operationId: 'verifyCustomerFacebook',
		summary: 'Verify a Meta access token; sign in or begin a signup',
	})
	async verifyFacebook(
		@Body(new ZodValidationPipe(FacebookVerifyRequest)) body: FacebookVerifyRequest,
		@Req() request: FastifyRequest,
		@Res({ passthrough: true }) reply: FastifyReply,
	): Promise<OAuthVerifyResponse> {
		// Meta has no nonce concept; its state binds the callback to this browser and nothing more.
		return this.completeOAuth('facebook', body.stateId, body.accessToken, null, request, reply);
	}

	/**
	 * One path for both providers, because the DECISION is identical once a token is verified.
	 *
	 * A known subject signs in. An unknown one begins a signup with whatever the provider
	 * supplied, still editable. A matching EMAIL does neither: accounts are never linked
	 * automatically on an address, so somebody arriving with a Google account whose email happens
	 * to match an existing customer lands in signup and is refused at finalisation — deliberately,
	 * because auto-linking there is account takeover by email.
	 */
	private async completeOAuth(
		provider: 'google' | 'facebook',
		stateId: string,
		credential: string,
		nonce: string | null,
		request: FastifyRequest,
		reply: FastifyReply,
	): Promise<OAuthVerifyResponse> {
		try {
			const { identity, guestCartId } = await this.oauth.verify({ provider, stateId, credential, nonce });
			const customerId = await this.oauth.findCustomerIdFor(identity);

			if (customerId) {
				const state = await this.auth.customerAuthRepository.findAuthStateById(customerId);
				const { session } = await this.sessions.establish({
					user: { id: customerId, role: null, tokenVersion: state?.tokenVersion ?? 0, permissionsVersion: 0 },
					audience: 'storefront',
					request,
					reply,
				});
				await this.adoptGuestCart(customerId, request, reply);
				return {
					outcome: 'signed_in',
					customer: await this.auth.publicCustomer(customerId),
					session: {
						audience: session.audience,
						expiresAt: session.expiresAt,
						refreshExpiresAt: session.absoluteExpiresAt,
					},
					pendingSignup: null,
				};
			}

			const sessionKey = this.signupKey(request) ?? this.signup.newSessionKey();
			const record = await this.signup.start({
				sessionKey,
				origin: provider,
				// Prefill only. Google's address is locked because Google asserts it; Meta's is a
				// suggestion that still earns its own OTP, because Meta asserts nothing we can check.
				email: identity.email ?? undefined,
				displayName: identity.displayName ?? undefined,
				marketingOptIn: false,
				guestCartId,
				emailPreVerified: identity.emailVerified,
				emailLocked: identity.emailVerified,
			});
			await this.signup.attachProvider(record, identity);

			void reply.setCookie(cookieNames(this.config).signup, sessionKey, sessionCookieOptions(this.config, 1800));
			return {
				outcome: 'signup_required',
				customer: null,
				session: null,
				pendingSignup: this.signup.toState(record),
			};
		} catch (error) {
			return this.refuse(error);
		}
	}

	@Get('login-methods')
	@Audience('storefront')
	@ApiOperation({ operationId: 'getCustomerLoginMethods', summary: 'Every way this customer can sign in' })
	async loginMethods(@Principal() principal: AuthenticatedPrincipal | undefined): Promise<LoginMethodsResponse> {
		if (!principal) throw new UnauthorizedException('Authentication required');

		const [state, customer, identities] = await Promise.all([
			this.auth.customerAuthRepository.findAuthStateById(principal.userId),
			this.auth.publicCustomer(principal.userId),
			this.oauth.listIdentities(principal.userId),
		]);

		const passwordSet = Boolean(state?.passwordHash);
		return {
			passwordSet,
			emailVerified: customer.emailVerified,
			phoneVerified: customer.phoneVerified,
			identities: (['google', 'facebook'] as const).map((provider) => {
				const linked = identities.find((identity) => identity.provider === provider);
				return {
					provider,
					connected: Boolean(linked),
					email: linked?.email ?? null,
					linkedAt: linked?.linkedAt ?? null,
				};
			}),
			// A password is preferred wherever one exists: free to check, and stronger than a code
			// sent to a channel an attacker holding the session may also be able to read.
			stepUpMethod: stepUpMethodFor({ passwordSet }),
		};
	}

	@Post('step-up/request')
	@Audience('storefront')
	@ApiOperation({ operationId: 'requestCustomerStepUp', summary: 'Send a step-up code to a chosen channel' })
	async requestStepUp(
		@Body(new ZodValidationPipe(StepUpRequestBody)) body: StepUpRequestBody,
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Res({ passthrough: true }) reply: FastifyReply,
		@Req() request: FastifyRequest,
	): Promise<GenericAcceptedResponse> {
		if (!principal) throw new UnauthorizedException('Authentication required');

		// The CALLER picks the channel, and that is a cost control as much as a courtesy: linking a
		// social account is not essential work, so credits are not spent on their behalf.
		const customer = await this.auth.publicCustomer(principal.userId);
		const destination = body.channel === 'email' ? customer.email : customer.phone;
		if (!destination)
			throw new BadRequestException({ code: 'step_up_required', message: 'That channel is unavailable' });

		const limit = await this.auth.consumeRateLimit('otp_request', { identifier: destination, ip: request.ip });
		if (!limit.allowed) throw tooManyRequests(limit, reply);

		await this.auth.issueOtp({
			identifier: destination,
			purpose: 'step_up',
			channel: body.channel,
			userId: principal.userId,
		});
		return ACCEPTED;
	}

	@Post('oauth/connect')
	@Audience('storefront')
	@ApiOperation({ operationId: 'connectCustomerIdentity', summary: 'Link a social account after fresh proof' })
	async connectIdentity(
		@Body(new ZodValidationPipe(ConnectIdentityRequest)) body: ConnectIdentityRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<LoginMethodsResponse> {
		if (!principal) throw new UnauthorizedException('Authentication required');
		try {
			// Step-up FIRST. A stolen session must not be able to bolt a permanent new way in onto
			// somebody's account, so freshness is proven before a provider is ever contacted.
			await this.requireStepUp(principal.userId, body.password, body.otpCode);

			const { identity } = await this.oauth.verify({
				provider: body.provider,
				stateId: body.stateId,
				credential: body.credential,
				nonce: body.nonce ?? null,
			});
			await this.oauth.link(principal.userId, identity);
			return this.loginMethods(principal);
		} catch (error) {
			return this.refuse(error);
		}
	}

	@Post('oauth/disconnect')
	@Audience('storefront')
	@ApiOperation({
		operationId: 'disconnectCustomerIdentity',
		summary: 'Unlink a social account, never the last way in',
	})
	async disconnectIdentity(
		@Body(new ZodValidationPipe(DisconnectIdentityRequest)) body: DisconnectIdentityRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<LoginMethodsResponse> {
		if (!principal) throw new UnauthorizedException('Authentication required');
		try {
			await this.requireStepUp(principal.userId, body.password, body.otpCode);

			const [state, customer, identities] = await Promise.all([
				this.auth.customerAuthRepository.findAuthStateById(principal.userId),
				this.auth.publicCustomer(principal.userId),
				this.oauth.listIdentities(principal.userId),
			]);

			/**
			 * Enforced, not assumed.
			 *
			 * Today every account carries a verified email and phone, so an OTP route always survives
			 * a disconnect and this can never refuse. That is exactly why it must exist: the day that
			 * assumption changes, this should start refusing loudly rather than quietly turning
			 * "disconnect" into "lock myself out permanently".
			 */
			const allowed = mayRemoveCredential({
				passwordSet: Boolean(state?.passwordHash),
				emailVerified: customer.emailVerified,
				phoneVerified: customer.phoneVerified,
				linkedProviders: identities.map((identity) => identity.provider as 'google' | 'facebook'),
				removing: { kind: 'provider', provider: body.provider },
			});
			if (!allowed) {
				throw new BadRequestException({
					code: 'last_credential',
					message: 'That is the only way left to sign in',
				});
			}

			await this.oauth.unlink(principal.userId, body.provider);
			return this.loginMethods(principal);
		} catch (error) {
			return this.refuse(error);
		}
	}

	/**
	 * Proves the person at the keyboard is still the account holder.
	 *
	 * Password when one is set — free, and stronger than a code delivered to a channel the
	 * session holder may already be reading. OTP only for accounts that have no password yet,
	 * which is every social signup until they set one.
	 */
	private async requireStepUp(customerId: string, password?: string, otpCode?: string): Promise<void> {
		const state = await this.auth.customerAuthRepository.findAuthStateById(customerId);
		const stepUpFailed = new BadRequestException({ code: 'step_up_required', message: 'Confirm it is you' });

		if (state?.passwordHash) {
			if (!password) throw stepUpFailed;
			if (!(await this.auth.verifyPassword(state, password))) throw stepUpFailed;
			return;
		}

		if (!otpCode) throw stepUpFailed;
		const customer = await this.auth.publicCustomer(customerId);
		for (const destination of [customer.email, customer.phone]) {
			if (!destination) continue;
			const verified = await this.auth.verifyOtp({ identifier: destination, purpose: 'step_up', code: otpCode });
			if (verified) return;
		}
		throw stepUpFailed;
	}

	@Post('login/password')
	@Public()
	@HttpCode(HttpStatus.OK)
	@ApiOperation({
		operationId: 'loginCustomerWithPassword',
		summary: 'Password login (sets httpOnly session cookies)',
	})
	async login(
		@Body(new ZodValidationPipe(PasswordLoginRequest)) body: PasswordLoginRequest,
		@Req() request: FastifyRequest,
		@Res({ passthrough: true }) reply: FastifyReply,
	): Promise<AuthSessionResponse> {
		const email = this.auth.normalizeEmail(body.email);
		const scopes = { identifier: email, ip: request.ip };
		const limit = await this.auth.checkRateLimit('storefront_login', scopes);
		if (!limit.allowed) {
			// An address-scoped refusal is about the network, so it may be stated plainly. An
			// identifier-scoped one keeps the generic credential failure, so an attacker
			// cannot read the response to learn when their budget resets.
			if (limit.scope === 'ip') throw tooManyRequests(limit, reply);
			throw new UnauthorizedException('Invalid credentials');
		}

		const user = await this.auth.findAuthUserByEmail(email);
		const valid = await this.auth.verifyPassword(user, body.password);

		// One message for every failure mode: unknown address, wrong password,
		// non-active account, and operator-only address (population-scoped lookup never
		// resolves adminUsers here — `DEC-ACCOUNT-SEPARATION` D1 / storefront rejection).
		if (!user || !valid || user.status !== 'active') {
			// Only failures are counted, so a signed-in customer never spends budget they
			// share with thousands of others behind the same carrier-grade NAT address.
			await this.auth.recordRateLimitFailure('storefront_login', scopes);
			throw new UnauthorizedException('Invalid credentials');
		}

		// Success clears this account's budget — never the shared address budget, which an
		// attacker could otherwise wipe by logging into an account they control.
		await this.auth.clearRateLimitIdentifier('storefront_login', email);

		// A storefront password login must never mint an admin session.
		await this.auth.customerAuthRepository.recordSuccessfulLogin(user.id, new Date().toISOString());
		const { session } = await this.sessions.establish({
			user: {
				id: user.id,
				role: null,
				tokenVersion: user.tokenVersion,
				permissionsVersion: 0,
			},
			audience: 'storefront',
			request,
			reply,
		});
		await this.adoptGuestCart(user.id, request, reply);

		return {
			user: await this.auth.publicCustomer(user.id),
			session: {
				audience: session.audience,
				expiresAt: session.expiresAt,
				refreshExpiresAt: session.absoluteExpiresAt,
			},
		};
	}

	@Post('login/email-otp/request')
	@Public()
	@HttpCode(HttpStatus.ACCEPTED)
	@ApiOperation({
		operationId: 'requestCustomerEmailOtp',
		summary: 'Request an email OTP (always answers generically)',
	})
	@ApiOkResponse({ description: 'Accepted — identical whether or not the account exists' })
	async requestOtp(
		@Body(new ZodValidationPipe(EmailOtpRequest)) body: EmailOtpRequest,
		@Req() request: FastifyRequest,
	): Promise<GenericAcceptedResponse> {
		const email = this.auth.normalizeEmail(body.email);
		// Refusal answers exactly like a real send. A 429 here would tell a caller which
		// addresses have been asked for recently, which is the enumeration this endpoint
		// exists to avoid.
		const limit = await this.auth.consumeRateLimit('otp_request', { identifier: email, ip: request.ip });
		if (!limit.allowed) return ACCEPTED;

		const user = await this.auth.findAuthUserByEmail(email);
		if (body.purpose === 'login' && (!user || user.status !== 'active')) return ACCEPTED;

		await this.auth.issueOtp({
			identifier: email,
			purpose: body.purpose,
			channel: 'email',
			userId: user?.id ?? null,
		});
		return ACCEPTED;
	}

	@Post('login/email-otp/verify')
	@Public()
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ operationId: 'verifyCustomerEmailOtp', summary: 'Verify an email OTP and start a session' })
	async verifyOtp(
		@Body(new ZodValidationPipe(EmailOtpVerifyRequest)) body: EmailOtpVerifyRequest,
		@Req() request: FastifyRequest,
		@Res({ passthrough: true }) reply: FastifyReply,
	): Promise<AuthSessionResponse> {
		const email = this.auth.normalizeEmail(body.email);
		const scopes = { identifier: email, ip: request.ip };
		const limit = await this.auth.checkRateLimit('otp_verify', scopes);
		if (!limit.allowed) {
			if (limit.scope === 'ip') throw tooManyRequests(limit, reply);
			throw new UnauthorizedException('Invalid or expired code');
		}

		const result = await this.auth.verifyOtp({ identifier: email, purpose: 'login', code: body.code });
		if (!result?.userId) {
			await this.auth.recordRateLimitFailure('otp_verify', scopes);
			throw new UnauthorizedException('Invalid or expired code');
		}
		await this.auth.clearRateLimitIdentifier('otp_verify', email);

		const user = await this.auth.customerAuthRepository.findAuthStateById(result.userId);
		if (!user || user.status !== 'active') throw new UnauthorizedException('Invalid or expired code');

		const { session } = await this.sessions.establish({
			user: {
				id: user.id,
				role: null,
				tokenVersion: user.tokenVersion,
				permissionsVersion: 0,
			},
			audience: 'storefront',
			request,
			reply,
		});
		await this.adoptGuestCart(user.id, request, reply);

		return {
			user: await this.auth.publicCustomer(user.id),
			session: {
				audience: session.audience,
				expiresAt: session.expiresAt,
				refreshExpiresAt: session.absoluteExpiresAt,
			},
		};
	}

	@Post('refresh')
	@Public()
	@RotatesSession()
	@HttpCode(HttpStatus.OK)
	@ApiOperation({
		operationId: 'refreshCustomerSession',
		summary: 'Rotate the session (reuse of an old token revokes the family)',
	})
	async refresh(
		@Req() request: FastifyRequest,
		@Res({ passthrough: true }) reply: FastifyReply,
	): Promise<AuthSessionResponse> {
		const { session } = await this.sessions.refresh({ request, reply, audience: 'storefront' });
		return {
			user: await this.auth.publicCustomer(session.userId),
			session: {
				audience: session.audience,
				expiresAt: session.expiresAt,
				refreshExpiresAt: session.absoluteExpiresAt,
			},
		};
	}

	@Post('logout')
	@Public()
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiOperation({ operationId: 'logoutCustomer', summary: 'Revoke the current session and clear cookies' })
	async logout(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
		await this.sessions.revoke(request, reply, 'logout');
	}

	@Post('password/forgot')
	@Public()
	@HttpCode(HttpStatus.ACCEPTED)
	@ApiOperation({
		operationId: 'requestCustomerPasswordReset',
		summary: 'Start a password reset (always answers generically)',
	})
	async forgotPassword(
		@Body(new ZodValidationPipe(PasswordForgotRequest)) body: PasswordForgotRequest,
		@Req() request: FastifyRequest,
	): Promise<GenericAcceptedResponse> {
		const email = this.auth.normalizeEmail(body.email);
		// Refused or not, the answer is identical: this endpoint must never confirm that an
		// address is known, and a rate-limit response would do exactly that.
		const limit = await this.auth.consumeRateLimit('password_reset', { identifier: email, ip: request.ip });
		if (limit.allowed) {
			await this.auth.startPasswordReset(email, 'storefront');
		}
		return ACCEPTED;
	}

	@Post('password/reset')
	@Public()
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiOperation({
		operationId: 'resetCustomerPassword',
		summary: 'Complete a password reset; revokes every existing session',
	})
	async resetPassword(
		@Body(new ZodValidationPipe(PasswordResetRequest)) body: PasswordResetRequest,
		@Res({ passthrough: true }) reply: FastifyReply,
	): Promise<void> {
		const result = await this.auth.completePasswordReset(body.token, body.newPassword);
		if (!result) throw new UnauthorizedException('Invalid or expired reset token');

		// A reset answers a suspected compromise: every other signed-in device is signed out.
		await this.sessions.revokeAllForUser(result.userId, 'password_changed');
		this.sessions.clearCookies(reply);
	}

	@Post('activate')
	@Public()
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiOperation({
		operationId: 'activateCustomer',
		summary: 'Set the first password from an admin-minted activation token',
	})
	async activate(
		@Body(new ZodValidationPipe(ActivateCustomerRequest)) body: ActivateCustomerRequest,
		@Res({ passthrough: true }) reply: FastifyReply,
	): Promise<void> {
		const result = await this.auth.activateCustomer(body.token, body.newPassword);
		if (!result) throw new UnauthorizedException('Invalid or expired activation token');

		await this.sessions.revokeAllForUser(result.userId, 'password_changed');
		this.sessions.clearCookies(reply);
	}

	@Get('me')
	@ApiOperation({ operationId: 'getCurrentCustomer', summary: 'Current storefront user (requires a session cookie)' })
	async me(@Principal() principal: AuthenticatedPrincipal | undefined) {
		if (!principal) throw new UnauthorizedException('Authentication required');
		return { user: await this.auth.publicCustomer(principal.userId) };
	}

	/**
	 * Redeems an email-verification token.
	 *
	 * Public because the whole point is that the recipient may not be signed in when they
	 * click the link. The token is single-use and consumed atomically, so a forwarded link
	 * cannot verify the address twice.
	 */
	/**
	 * The caller's own live sessions.
	 *
	 * "Where am I signed in?" is a security control, not a convenience: it is how somebody
	 * discovers a session they do not recognise. The rows are sanitized by
	 * `toSessionSummary` — no refresh fingerprint, no CSRF secret, no device hashes — because
	 * a device list that leaked the material reuse detection depends on would be worse than no
	 * device list at all.
	 */
	@Get('sessions')
	@ApiOperation({ operationId: 'listCustomerSessions', summary: 'List the caller’s own live sessions' })
	listSessions(@Principal() principal: AuthenticatedPrincipal | undefined): Promise<SessionListResponse> {
		if (!principal) throw new UnauthorizedException('Authentication required');
		return this.sessions.listOwnSessions(principal);
	}

	/**
	 * Ends one named session belonging to the caller.
	 *
	 * A session that is not theirs answers **404**, never 403 — the locked ownership rule, so
	 * an id cannot be probed for existence. Revoking the CURRENT session is allowed and clears
	 * this browser's cookies in the same response, because leaving a browser holding
	 * credentials for a session that no longer exists is what wedged the password-change flow.
	 */
	@Delete('sessions/:id')
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiOperation({ operationId: 'revokeCustomerSession', summary: 'Revoke one of the caller’s own sessions' })
	async revokeSession(
		@Param('id') id: string,
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Res({ passthrough: true }) reply: FastifyReply,
	): Promise<void> {
		if (!principal) throw new UnauthorizedException('Authentication required');

		const { wasCurrent } = await this.sessions.revokeOwnSession(principal, id);
		if (wasCurrent) this.sessions.clearCookies(reply);
	}

	/**
	 * Ends every OTHER session, keeping this one alive.
	 *
	 * The "somebody else is signed in as me" control. It deliberately does not end the calling
	 * session: signing the person out of the device they trust, while the suspected intruder
	 * is what prompted the action, is precisely backwards.
	 */
	@Post('sessions/revoke-others')
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ operationId: 'revokeOtherCustomerSessions', summary: 'Revoke every session except this one' })
	async revokeOtherSessions(
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<SessionRevokeResponse> {
		if (!principal) throw new UnauthorizedException('Authentication required');
		return { revoked: await this.sessions.revokeOtherSessions(principal) };
	}

	@Post('email/verify')
	@Public()
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiOperation({ operationId: 'verifyCustomerEmail', summary: 'Complete email verification with a token' })
	async verifyEmail(
		@Body(new ZodValidationPipe(EmailVerificationRequest)) body: EmailVerificationRequest,
	): Promise<void> {
		const verified = await this.auth.completeEmailVerification(body.token);
		// Expired, already-used and unknown tokens are indistinguishable.
		if (!verified) throw new UnauthorizedException('Invalid or expired verification token');
	}

	/**
	 * Re-sends the verification email for the signed-in account.
	 *
	 * Requires a session rather than taking an address: an unauthenticated resend endpoint
	 * that accepts any email is both an enumeration oracle and a way to have us mail
	 * strangers on demand.
	 */
	@Post('email/verify/resend')
	@HttpCode(HttpStatus.ACCEPTED)
	@ApiOperation({
		operationId: 'resendCustomerEmailVerification',
		summary: 'Re-send the verification email for the current account',
	})
	async resendVerification(
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Req() request: FastifyRequest,
	): Promise<GenericAcceptedResponse> {
		if (!principal) throw new UnauthorizedException('Authentication required');

		const user = await this.auth.customerAuthRepository.findAuthStateById(principal.userId);
		// Already-verified and rate-limited callers get the same answer as a real send.
		if (user?.email && !user.emailVerified) {
			const limit = await this.auth.consumeRateLimit('otp_request', { identifier: user.email, ip: request.ip });
			if (limit.allowed) {
				await this.auth.issueEmailVerification(user.id, user.email);
			}
		}
		return ACCEPTED;
	}
}
