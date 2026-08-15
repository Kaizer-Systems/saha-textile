import { Component } from '@angular/core';

import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { FormAdminUser } from '../form-user/form-user';

@Component({
	selector: 'app-create-user',
	templateUrl: './create-user.html',
	styleUrls: ['./create-user.scss'],
	imports: [PageWrapper, FormAdminUser],
})
export class CreateAdminUser {}
