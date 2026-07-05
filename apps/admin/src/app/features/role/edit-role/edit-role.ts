import { Component } from '@angular/core';

import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { FormRole } from '../form-role/form-role';

@Component({
	selector: 'app-edit-role',
	templateUrl: './edit-role.html',
	styleUrls: ['./edit-role.scss'],
	imports: [PageWrapper, FormRole],
})
export class EditRole {}
