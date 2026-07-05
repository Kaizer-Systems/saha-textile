import { isPlatformBrowser } from '@angular/common';
import { Component, TemplateRef, PLATFORM_ID, inject, viewChild } from '@angular/core';
import { FormControl, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';

import { ModalDismissReasons, NgbModal, NgbRating } from '@ng-bootstrap/ng-bootstrap';
import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngxs/store';

import { SendReviewAction, UpdateReviewAction } from '@data-access/actions/review.action';
import { IProduct } from '@data-access/interfaces/product.interface';
import { Button } from '../../button/button';

@Component({
  selector: 'app-review-modal',
  templateUrl: './review-modal.html',
  styleUrls: ['./review-modal.scss'],
  imports: [Button, ReactiveFormsModule, NgbRating, TranslateModule],
})
export class ReviewModal {
  private modalService = inject(NgbModal);
  private platformId = inject<Object>(PLATFORM_ID);
  private store = inject(Store);

  readonly ReviewModal = viewChild<TemplateRef<string>>('reviewModal');

  public closeResult: string;
  public modalOpen: boolean = false;
  public product: IProduct;
  public currentRate: number = 0;
  public review = new FormControl('', [Validators.required]);
  public form: FormGroup;
  public type: string;

  constructor() {
    this.form = new FormGroup({
      rating: new FormControl('', [Validators.required]),
      description: new FormControl(''),
    });
  }

  async openModal(product: IProduct, type: string) {
    if (isPlatformBrowser(this.platformId)) {
      this.modalOpen = true;
      this.type = type;
      this.product = product;
      type &&
        type === 'edit' &&
        this.form.patchValue({
          rating: product.user_review.rating,
          description: product.user_review.description,
        });

      this.modalService
        .open(this.ReviewModal(), {
          ariaLabelledBy: 'profile-Modal',
          centered: true,
          windowClass: 'theme-modal',
        })
        .result.then(
          result => {
            `Result ${result}`;
          },
          reason => {
            this.closeResult = `Dismissed ${this.getDismissReason(reason)}`;
          },
        );
    }
  }

  private getDismissReason(reason: ModalDismissReasons): string {
    if (reason === ModalDismissReasons.ESC) {
      return 'by pressing ESC';
    } else if (reason === ModalDismissReasons.BACKDROP_CLICK) {
      return 'by clicking on a backdrop';
    } else {
      return `with: ${reason}`;
    }
  }

  submit() {
    this.form.markAllAsTouched();
    if (this.form.valid) {
      let data = {
        product_id: this.product.id,
        rating: this.form.get('rating')?.value,
        review_image_id: '',
        description: this.form.get('description')?.value,
      };
      let action = new SendReviewAction(data);

      if (this.type && this.type === 'edit' && this.product.user_review.id) {
        action = new UpdateReviewAction(this.product.user_review.id, data);
      }
      this.store.dispatch(action);
    }
  }
}
