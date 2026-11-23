import { Module } from '@nestjs/common';

import { CompanyController } from './company.controller';
import { CompanyService } from './company.service';

/** Settings › Company, Registrations and Features (accounts brief J, CT, G1–G2). */
@Module({ controllers: [CompanyController], providers: [CompanyService], exports: [CompanyService] })
export class CompanyModule {}
