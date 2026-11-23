import { Component } from '@angular/core';

import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { FormAdminUser } from '../form-user/form-user';
import { AdminUserLocationsCard } from '../user-locations/user-locations';

@Component({
	selector: 'app-edit-user',
	templateUrl: './edit-user.html',
	styleUrls: ['./edit-user.scss'],
	imports: [PageWrapper, FormAdminUser, AdminUserLocationsCard],
})
export class EditAdminUser {}
