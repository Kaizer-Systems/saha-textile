import { Module } from '@nestjs/common';

import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { PermissionsController } from './permissions.controller';
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
	controllers: [RolesController, AdminUsersController, PermissionsController],
	providers: [RolesService, AdminUsersService],
	exports: [RolesService, AdminUsersService],
})
export class AdminModule {}
