import { Module } from '@nestjs/common';

import { BlogModule } from '../blog/blog.module';
import { CatalogModule } from '../catalog/catalog.module';
import { AdminLanguagesController, LanguagesController } from './languages.controller';
import { LanguagesService } from './languages.service';

/**
 * The language list every app reads, and Settings › Languages. The in-memory list itself
 * (`LanguageStore`) lives with the persistence bindings, so every module reads it.
 */
@Module({
	imports: [CatalogModule, BlogModule],
	controllers: [LanguagesController, AdminLanguagesController],
	providers: [LanguagesService],
	exports: [LanguagesService],
})
export class LanguagesModule {}
