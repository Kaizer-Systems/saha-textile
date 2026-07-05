import { NgTemplateOutlet } from '@angular/common';
import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ICategory } from '@data-access/interfaces/category.interface';

@Component({
  selector: 'app-blog-category',
  templateUrl: './blog-category.html',
  styleUrls: ['./blog-category.scss'],
  imports: [NgTemplateOutlet, RouterLink],
})
export class BlogCategory {
  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly data = input<ICategory[]>();
}
