import { Module } from '@nestjs/common';

import { AccountsTemplatesController } from './accounts-templates.controller';
import { AccountsTemplatesService } from './accounts-templates.service';

/** Accounts templates (owner-approved 2026-11-24): the library the company's books are installed from. */
@Module({
	controllers: [AccountsTemplatesController],
	providers: [AccountsTemplatesService],
	exports: [AccountsTemplatesService],
})
export class AccountsTemplatesModule {}
