import { Module } from '@nestjs/common';

import { AdminCustomersController } from './admin-customers.controller';
import { AdminCustomersService } from './admin-customers.service';
import { AdminNotificationsController } from './admin-notifications.controller';
import { AdminNotificationsService } from './admin-notifications.service';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { AuditLogsController } from './audit-logs.controller';
import { AuditLogsService } from './audit-logs.service';
import { PermissionsController } from './permissions.controller';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

/**
 * Administrative surfaces that manage authority itself and Customer CRM.
 *
 * Kept apart from `AuthModule`, which owns session lifecycle. Signing in and deciding who may
 * grant a permission are different concerns with different blast radii, and putting the
 * privilege-editing routes beside the login routes would blur that.
 */
@Module({
	controllers: [
		RolesController,
		AdminUsersController,
		AdminCustomersController,
		AdminNotificationsController,
		PermissionsController,
		AuditLogsController,
	],
	providers: [RolesService, AdminUsersService, AdminCustomersService, AdminNotificationsService, AuditLogsService],
	exports: [RolesService, AdminUsersService, AdminCustomersService, AdminNotificationsService, AuditLogsService],
})
export class AdminModule {}
