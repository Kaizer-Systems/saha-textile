import { Component, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';

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
import { TranslateModule } from '@ngx-translate/core';
import { Subject, of } from 'rxjs';
import { map, switchMap, takeUntil } from 'rxjs/operators';

import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { NoData } from '@shared/ui/no-data/no-data';
import { IShipping } from '@data-access/interfaces/shipping.interface';
import { ShippingService } from '@data-access/services/shipping.service';
import { FormShipping } from '../form-shipping/form-shipping';
import { ShippingRuleModal } from '../modal/shipping-rule-modal/shipping-rule-modal';

@Component({
  selector: 'app-shipping-country',
  templateUrl: './shipping-country.html',
  styleUrls: ['./shipping-country.scss'],
  imports: [
    PageWrapper,
    RouterModule,
    NgbAccordionDirective,
    NgbAccordionItem,
    NgbAccordionHeader,
    NgbAccordionToggle,
    NgbAccordionButton,
    NgbCollapse,
    NgbAccordionCollapse,
    NgbAccordionBody,
    FormShipping,
    NoData,
    ShippingRuleModal,
    TranslateModule,
  ],
})
export class ShippingCountry {
  private shippingService = inject(ShippingService);
  private route = inject(ActivatedRoute);

  readonly shipping = signal<IShipping | undefined>(undefined);

  readonly CreateShippingRuleModal = viewChild<ShippingRuleModal>('createShippingRuleModal');

  public id: number;
  private destroy$ = new Subject<void>();

  ngOnInit() {
    this.route.params
      .pipe(
        switchMap(params => {
          if (!params['id']) return of();
          return this.shippingService
            .getShippings()
            .pipe(map(res => res.data.find(shipping => shipping.id == params['id'])));
        }),
        takeUntil(this.destroy$),
      )
      .subscribe(shipping => {
        this.shipping.set(shipping);
        this.id = shipping?.id!;
      });
  }

  delete(_actionType: string, _data: IShipping) {
    // Mock: delete has no backend yet.
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
