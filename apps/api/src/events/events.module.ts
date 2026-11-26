import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { AdminEventsController } from './admin-events.controller';
import { EventCatalog } from './event-catalog';
import { EventClock } from './event-clock';
import { EventMessenger } from './event-messenger';
import { EventProductsService } from './event-products.service';
import { EventsAdminService } from './events-admin.service';
import { EventsPublicController } from './events-public.controller';
import { EventsPublicService } from './events-public.service';

/** Launch and sale events (owner log § launch and sale events, 2026-11-09). */
@Module({
	imports: [AuthModule, CatalogModule],
	controllers: [EventsPublicController, AdminEventsController],
	providers: [
		EventCatalog,
		EventClock,
		EventMessenger,
		EventProductsService,
		EventsAdminService,
		EventsPublicService,
	],
})
export class EventsModule {}
