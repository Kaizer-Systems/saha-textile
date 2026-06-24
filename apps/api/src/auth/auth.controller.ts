import { Body, Controller, Get, Post, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { TokenClaims } from '@saha/core-domain';
import { z } from 'zod';

import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

const RegisterSchema = z.object({
	email: z.email(),
	password: z.string().min(8, 'password must be at least 8 characters'),
	displayName: z.string().min(1).optional(),
});
type RegisterBody = z.infer<typeof RegisterSchema>;

const LoginSchema = z.object({ email: z.email(), password: z.string().min(1) });
type LoginBody = z.infer<typeof LoginSchema>;

const RefreshSchema = z.object({ refreshToken: z.string().min(1) });
type RefreshBody = z.infer<typeof RefreshSchema>;

const RequestOtpSchema = z.object({ email: z.email() });
type RequestOtpBody = z.infer<typeof RequestOtpSchema>;

const VerifyOtpSchema = z.object({ email: z.email(), code: z.string().min(1) });
type VerifyOtpBody = z.infer<typeof VerifyOtpSchema>;

@ApiTags('auth')
@Controller('auth')
export class AuthController {
	constructor(private readonly auth: AuthService) {}

	@Post('register')
	@ApiOperation({ summary: 'Register with email + password (argon2id)' })
	register(@Body(new ZodValidationPipe(RegisterSchema)) body: RegisterBody) {
		return this.auth.register(body);
	}

	@Post('login')
	@ApiOperation({ summary: 'Log in with email + password; returns access + refresh tokens' })
	login(@Body(new ZodValidationPipe(LoginSchema)) body: LoginBody) {
		return this.auth.login(body);
	}

	@Post('refresh')
	@ApiOperation({ summary: 'Rotate tokens using a valid refresh token' })
	refresh(@Body(new ZodValidationPipe(RefreshSchema)) body: RefreshBody) {
		return this.auth.refresh(body.refreshToken);
	}

	@Get('me')
	@UseGuards(JwtAuthGuard)
	@ApiBearerAuth()
	@ApiOperation({ summary: 'Get the authenticated user profile' })
	me(@CurrentUser() user: TokenClaims | undefined) {
		if (!user) throw new UnauthorizedException();
		return this.auth.me(user.sub);
	}

	@Post('otp/request')
	@ApiOperation({ summary: 'Request an email OTP (stub — pending Brevo credentials)' })
	requestOtp(@Body(new ZodValidationPipe(RequestOtpSchema)) body: RequestOtpBody) {
		return this.auth.requestEmailOtp(body.email);
	}

	@Post('otp/verify')
	@ApiOperation({ summary: 'Verify an email OTP (stub — pending Brevo credentials)' })
	verifyOtp(@Body(new ZodValidationPipe(VerifyOtpSchema)) body: VerifyOtpBody) {
		return this.auth.verifyEmailOtp(body.email, body.code);
	}
}
