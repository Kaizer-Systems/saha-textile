import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import {
	changePinSchema,
	type LockStatus,
	pinSchema,
	type UnlockAnswer,
} from '@saha-textile/release-console-contracts';

import { LockService } from './lock.service.js';
import { Open, sessionOf } from './session.guard.js';
import { parseBody } from '../common/parse.js';

type Req = Parameters<typeof sessionOf>[0];

@Controller('api/lock')
@Open()
export class LockController {
	constructor(private readonly lock: LockService) {}

	@Get('status')
	status(@Req() req: Req): LockStatus {
		return this.lock.status(sessionOf(req));
	}

	@Post('setup')
	setup(@Body() body: unknown): UnlockAnswer {
		return { session: this.lock.setup(parseBody(pinSchema, body).pin) };
	}

	@Post('unlock')
	@HttpCode(200)
	unlock(@Body() body: unknown): UnlockAnswer {
		return { session: this.lock.unlock(parseBody(pinSchema, body).pin) };
	}

	@Post('lock')
	@HttpCode(200)
	lockNow(@Req() req: Req): { ok: true } {
		this.lock.lock(sessionOf(req));
		return { ok: true };
	}

	@Post('pin')
	@HttpCode(200)
	changePin(@Req() req: Req, @Body() body: unknown): { ok: true } {
		const { current, next } = parseBody(changePinSchema, body);
		this.lock.changePin(sessionOf(req), current, next);
		return { ok: true };
	}
}
