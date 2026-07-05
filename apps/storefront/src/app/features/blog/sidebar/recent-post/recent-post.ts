import { SlicePipe, DatePipe } from '@angular/common';
import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { IBlog } from '@data-access/interfaces/blog.interface';

@Component({
  selector: 'app-recent-post',
  templateUrl: './recent-post.html',
  styleUrls: ['./recent-post.scss'],
  imports: [RouterLink, SlicePipe, DatePipe],
})
export class RecentPost {
  readonly blogs = input<IBlog[]>();

  constructor() {}
}
