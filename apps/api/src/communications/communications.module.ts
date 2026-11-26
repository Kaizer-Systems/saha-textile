import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { CommunicationsController } from './communications.controller';
import { CommunicationsService } from './communications.service';

/** Settings › Communications (owner decision round 2026-11-13): message × channel switches. */
@Module({
	imports: [AuthModule],
	controllers: [CommunicationsController],
	providers: [CommunicationsService],
})
export class CommunicationsModule {}
