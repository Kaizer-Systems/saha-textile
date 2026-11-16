import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { ContactMessagesService } from './contact-messages.service';
import { InboxService } from './inbox.service';
import { MailboxBookkeeping } from './mailbox-support';
import { AdminInboxController } from './admin-inbox.controller';
import { AdminMailboxesController } from './admin-mailboxes.controller';
import { ContactMessagesController } from './contact-messages.controller';
import { MailboxesAdminService } from './mailboxes-admin.service';

/**
 * Gmail mailboxes in the admin and the Contact Us form (owner log § stores, Contact Us and Gmail
 * mailboxes; § page headings, deep trails and Gmail on Google Cloud).
 */
@Module({
	imports: [AuthModule, CatalogModule],
	controllers: [AdminMailboxesController, AdminInboxController, ContactMessagesController],
	providers: [MailboxBookkeeping, MailboxesAdminService, InboxService, ContactMessagesService],
	// Purchase orders are emailed through a connected mailbox (purchases brief, po03).
	exports: [InboxService],
})
export class MailboxesModule {}
