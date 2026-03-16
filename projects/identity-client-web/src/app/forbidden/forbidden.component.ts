import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'identity-forbidden',
  imports: [RouterLink],
  templateUrl: './forbidden.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ForbiddenComponent { }
