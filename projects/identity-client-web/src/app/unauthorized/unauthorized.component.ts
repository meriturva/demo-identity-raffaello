import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'identity-unauthorized',
  imports: [RouterLink],
  templateUrl: './unauthorized.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UnauthorizedComponent { }
