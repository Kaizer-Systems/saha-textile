import { Routes } from '@angular/router';

import { Blog } from './blog';
import { BlogCategory } from './category/blog-category/blog-category';
import { EditBlogCategory } from './category/edit-blog-category/edit-blog-category';
import { CreateBlog } from './create-blog/create-blog';
import { EditBlog } from './edit-blog/edit-blog';
import { BlogTag } from './tag/blog-tag/blog-tag';
import { CreateBlogTag } from './tag/create-blog-tag/create-blog-tag';
import { EditBlogTag } from './tag/edit-blog-tag/edit-blog-tag';

export default [
	{
		path: '',
		component: Blog,
	},
	{
		path: 'create',
		component: CreateBlog,
	},
	{
		path: 'edit/:id',
		component: EditBlog,
	},
	{
		path: 'category',
		component: BlogCategory,
	},
	{
		path: 'category/edit/:id',
		component: EditBlogCategory,
	},
	{
		path: 'tag',
		component: BlogTag,
	},
	{
		path: 'tag/create',
		component: CreateBlogTag,
	},
	{
		path: 'tag/edit/:id',
		component: EditBlogTag,
	},
] as Routes;
