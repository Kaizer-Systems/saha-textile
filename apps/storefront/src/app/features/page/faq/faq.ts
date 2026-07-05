import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';

import {
  NgbAccordionBody,
  NgbAccordionButton,
  NgbAccordionCollapse,
  NgbAccordionDirective,
  NgbAccordionHeader,
  NgbAccordionItem,
  NgbAccordionToggle,
  NgbCollapse,
} from '@ng-bootstrap/ng-bootstrap';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { GetFaqsAction } from '@data-access/actions/page.action';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { IBreadcrumb } from '@data-access/interfaces/breadcrumb';
import { IFaqModel } from '@data-access/interfaces/page.interface';
import { PageService } from '@data-access/services/page.service';
import { PageState } from '@data-access/states/page.state';
import { SkeletonPage } from '../skeleton-page/skeleton-page';

@Component({
  selector: 'app-faq',
  templateUrl: './faq.html',
  styleUrls: ['./faq.scss'],
  imports: [
    Breadcrumb,
    SkeletonPage,
    NgbAccordionDirective,
    NgbAccordionItem,
    NgbAccordionHeader,
    NgbAccordionToggle,
    NgbAccordionButton,
    NgbCollapse,
    NgbAccordionCollapse,
    NgbAccordionBody,
    AsyncPipe,
  ],
})
export class Faq {
  private store = inject(Store);
  pageService = inject(PageService);

  public breadcrumb: IBreadcrumb = {
    title: "FAQ's",
    items: [{ label: "FAQ's", active: true }],
  };

  faq$: Observable<IFaqModel> = inject(Store).select(PageState.faq);

  constructor() {
    this.store.dispatch(new GetFaqsAction());
  }
}
