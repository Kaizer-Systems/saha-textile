import { Component } from '@angular/core';

import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { FormBlog } from '../form-blog/form-blog';

@Component({
	selector: 'app-edit-blog',
	templateUrl: './edit-blog.html',
	styleUrls: ['./edit-blog.scss'],
	imports: [PageWrapper, FormBlog],
})
export class EditBlog {}
