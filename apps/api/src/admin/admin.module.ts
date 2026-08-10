import { Module } from '@nestjs/common';

import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

/**
 * Administrative surfaces that manage authority itself.
 *
 * Kept apart from `AuthModule`, which owns session lifecycle. Signing in and deciding who may
 * grant a permission are different concerns with different blast radii, and putting the
 * privilege-editing routes beside the login routes would blur that.
 */
@Module({
	controllers: [RolesController],
	providers: [RolesService],
	exports: [RolesService],
})
export class AdminModule {}
