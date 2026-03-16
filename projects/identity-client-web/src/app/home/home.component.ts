import { filter, Observable, of, Subscription, take } from 'rxjs';

import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';

import { EventTypes, OidcSecurityService, PublicEventsService } from 'angular-auth-oidc-client';
import { KENDO_PROGRESSBARS } from '@progress/kendo-angular-progressbar';

import { User } from '../../common/models/user';
import { environment } from '../../environments/environment';

type ClaimMap = Record<string, unknown>;

interface AuthResult {
  isAuthenticated: boolean;
  idToken?: string;
  accessToken?: string;
  userData?: unknown;
}

interface ClaimEntry {
  key: string;
  value: string;
}

@Component({
  selector: 'identity-home',
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    KENDO_PROGRESSBARS
  ]
})
export class HomeComponent implements OnInit, OnDestroy {
  private readonly _oidcSecurityService = inject(OidcSecurityService);
  private readonly _eventService = inject(PublicEventsService);
  private readonly _httpClient = inject(HttpClient);
  private readonly _cdr = inject(ChangeDetectorRef);
  private readonly _subscriptions = new Subscription();

  private _idTokenIntervalId: ReturnType<typeof setInterval> | null = null;
  private _accessTokenIntervalId: ReturnType<typeof setInterval> | null = null;

  protected readonly environmentName = environment.name;
  protected readonly authority = environment.identityServer.authority;
  protected readonly clientId = environment.identityServer.clientId;
  protected readonly requestedScopes = environment.identityServer.scope
    .split(' ')
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);

  protected userData$: Observable<unknown> = of({});
  protected user: User | null = null;
  protected email = '';

  protected isAuthenticated = false;
  protected isBusy = true;
  protected isRefreshInProgress = false;

  protected idTokenPayload: ClaimMap | null = null;
  protected accessTokenPayload: ClaimMap | null = null;
  protected userDataClaims: ClaimMap | null = null;
  protected backendUserInfo: ClaimMap | null = null;

  protected idTokenClaims: ClaimEntry[] = [];
  protected accessTokenClaims: ClaimEntry[] = [];
  protected userDataClaimEntries: ClaimEntry[] = [];
  protected backendClaims: ClaimEntry[] = [];
  protected mergedClaimEntries: ClaimEntry[] = [];

  protected grantedScopes: string[] = [];

  protected idTokenExpiresInSeconds: number | null = null;
  protected accessTokenExpiresInSeconds: number | null = null;
  protected idTokenProgress = 0;
  protected accessTokenProgress = 0;
  protected idTokenTimeLabel = 'N/D';
  protected accessTokenTimeLabel = 'N/D';
  protected idTokenIssuedAt = '';
  protected accessTokenIssuedAt = '';
  protected idTokenExpiresAt = '';
  protected accessTokenExpiresAt = '';

  protected rawIdToken = '';
  protected rawAccessToken = '';

  protected errorMessage: string | null = null;
  protected backendUserInfoError: string | null = null;

  public ngOnInit(): void {
    this.userData$ = this._oidcSecurityService.userData$;

    this._subscriptions.add(
      this.userData$.subscribe((response) => {
        const claims = this._extractUserDataClaims(response);
        this._applyUserDataClaims(claims);
        this._rebuildMergedClaims();
        this._markForCheck();
      })
    );

    this._subscriptions.add(
      this._eventService.registerForEvents()
        .pipe(filter((notification) => notification.type === EventTypes.NewAuthenticationResult))
        .subscribe(() => {
          this._checkAuthAndLoad();
          this._refreshUserData();
        })
    );

    this._checkAuthAndLoad();
  }

  public login(): void {
    this.isBusy = true;
    this._markForCheck();
    this._oidcSecurityService.authorize();
  }

  public refreshToken(): void {
    if (!this.isAuthenticated || this.isRefreshInProgress) {
      return;
    }

    this.errorMessage = null;
    this.isRefreshInProgress = true;
    this._markForCheck();

    this._subscriptions.add(
      this._oidcSecurityService.forceRefreshSession().subscribe({
        next: (result) => {
          this.isRefreshInProgress = false;
          this._applyAuthResult(result as AuthResult);
          this._refreshUserData();
          this._markForCheck();
        },
        error: (error) => {
          this.isRefreshInProgress = false;
          this._handleError('Errore durante il refresh token', error);
          this._markForCheck();
        }
      })
    );
  }

  public revokeAccessToken(): void {
    if (!this.isAuthenticated) {
      return;
    }

    this._subscriptions.add(
      this._oidcSecurityService.revokeAccessToken().subscribe({
        next: () => {
          this._checkAuthAndLoad();
          this._markForCheck();
        },
        error: (error) => {
          this._handleError('Errore durante la revoca dell\'access token', error);
          this._markForCheck();
        }
      })
    );
  }

  public revokeRefreshToken(): void {
    if (!this.isAuthenticated) {
      return;
    }

    this._subscriptions.add(
      this._oidcSecurityService.revokeRefreshToken().subscribe({
        next: () => {
          this._checkAuthAndLoad();
          this._markForCheck();
        },
        error: (error) => {
          this._handleError('Errore durante la revoca del refresh token', error);
          this._markForCheck();
        }
      })
    );
  }

  public logoffAndRevokeTokens(): void {
    this._subscriptions.add(
      this._oidcSecurityService.logoffAndRevokeTokens().subscribe({
        next: () => {
          this._resetAuthState();
          this._markForCheck();
        },
        error: (error) => {
          this._handleError('Errore durante il logout', error);
          this._markForCheck();
        }
      })
    );
  }

  protected dismissError(): void {
    this.errorMessage = null;
    this._markForCheck();
  }

  protected dismissBackendError(): void {
    this.backendUserInfoError = null;
    this._markForCheck();
  }

  private _checkAuthAndLoad(): void {
    this.isBusy = true;
    this._markForCheck();

    this._subscriptions.add(
      this._oidcSecurityService.checkAuth().subscribe({
        next: (result) => {
          this._applyAuthResult(result as AuthResult);
          this.isBusy = false;
          this._markForCheck();
        },
        error: (error) => {
          this._handleError('Errore autenticazione', error);
          this._resetAuthState();
          this.isBusy = false;
          this._markForCheck();
        }
      })
    );
  }

  private _applyAuthResult(result: AuthResult): void {
    this.errorMessage = null;
    this.isAuthenticated = result.isAuthenticated !== false;

    if (!this.isAuthenticated) {
      this._resetAuthState();
      return;
    }

    this._applyUserDataClaims(this._asClaimMap(result.userData));

    this.rawIdToken = result.idToken ?? '';
    this.rawAccessToken = result.accessToken ?? '';

    this.idTokenPayload = this._decodeToken(this.rawIdToken);
    this.accessTokenPayload = this._decodeToken(this.rawAccessToken);

    this.idTokenClaims = this._buildClaimEntries(this.idTokenPayload);
    this.accessTokenClaims = this._buildClaimEntries(this.accessTokenPayload);
    this.grantedScopes = this._extractScopes(this.accessTokenPayload);

    if (!this.email) {
      this.email = this._readStringClaim(this.idTokenPayload, 'email') ??
        this._readStringClaim(this.accessTokenPayload, 'email') ?? '';
    }

    this._startIdTokenCountdown(this.idTokenPayload);
    this._startAccessTokenCountdown(this.accessTokenPayload);

    if (this.rawAccessToken) {
      this._loadBackendUserInfo(this.rawAccessToken);
    } else {
      this.backendUserInfo = null;
      this.backendClaims = [];
      this.backendUserInfoError = 'Access token non disponibile: impossibile interrogare /connect/userinfo.';
      this._rebuildMergedClaims();
    }

    this._refreshUserData();
    this._markForCheck();
  }

  private _loadBackendUserInfo(accessToken: string): void {
    this.backendUserInfoError = null;
    this._markForCheck();

    const userInfoUrl = `${environment.identityServer.authority.replace(/\/$/, '')}/connect/userinfo`;
    const headers = new HttpHeaders({ Authorization: `Bearer ${accessToken}` });

    this._subscriptions.add(
      this._httpClient.get<ClaimMap>(userInfoUrl, { headers }).subscribe({
        next: (response) => {
          this.backendUserInfo = response;
          this.backendClaims = this._buildClaimEntries(response);
          this._rebuildMergedClaims();
          this._markForCheck();
        },
        error: (error) => {
          this.backendUserInfo = null;
          this.backendClaims = [];
          this.backendUserInfoError = this._buildErrorMessage('Impossibile leggere i dati da /connect/userinfo', error);
          this._rebuildMergedClaims();
          this._markForCheck();
        }
      })
    );
  }

  private _startIdTokenCountdown(payload: ClaimMap | null): void {
    if (this._idTokenIntervalId !== null) {
      clearInterval(this._idTokenIntervalId);
      this._idTokenIntervalId = null;
    }

    const expiration = this._readNumericClaim(payload, 'exp');
    if (expiration === null) {
      this.idTokenExpiresInSeconds = null;
      this.idTokenProgress = 0;
      this.idTokenTimeLabel = 'N/D';
      this.idTokenIssuedAt = '';
      this.idTokenExpiresAt = '';
      this._markForCheck();
      return;
    }

    const issuedAt = this._readNumericClaim(payload, 'iat');
    const initialTtl = this._resolveInitialTtl(expiration, issuedAt);

    this.idTokenIssuedAt = issuedAt === null ? '' : this._formatUnixDate(issuedAt);
    this.idTokenExpiresAt = this._formatUnixDate(expiration);

    this._updateIdTokenCountdown(expiration, initialTtl);
    this._idTokenIntervalId = setInterval(() => this._updateIdTokenCountdown(expiration, initialTtl), 1000);
    this._markForCheck();
  }

  private _startAccessTokenCountdown(payload: ClaimMap | null): void {
    if (this._accessTokenIntervalId !== null) {
      clearInterval(this._accessTokenIntervalId);
      this._accessTokenIntervalId = null;
    }

    const expiration = this._readNumericClaim(payload, 'exp');
    if (expiration === null) {
      this.accessTokenExpiresInSeconds = null;
      this.accessTokenProgress = 0;
      this.accessTokenTimeLabel = 'N/D';
      this.accessTokenIssuedAt = '';
      this.accessTokenExpiresAt = '';
      this._markForCheck();
      return;
    }

    const issuedAt = this._readNumericClaim(payload, 'iat');
    const initialTtl = this._resolveInitialTtl(expiration, issuedAt);

    this.accessTokenIssuedAt = issuedAt === null ? '' : this._formatUnixDate(issuedAt);
    this.accessTokenExpiresAt = this._formatUnixDate(expiration);

    this._updateAccessTokenCountdown(expiration, initialTtl);
    this._accessTokenIntervalId = setInterval(() => this._updateAccessTokenCountdown(expiration, initialTtl), 1000);
    this._markForCheck();
  }

  private _updateIdTokenCountdown(expiration: number, initialTtl: number): void {
    const now = Math.floor(Date.now() / 1000);
    const remaining = Math.max(expiration - now, 0);

    this.idTokenExpiresInSeconds = remaining;
    this.idTokenProgress = Math.max(0, Math.min(100, Math.round((remaining / initialTtl) * 100)));
    this.idTokenTimeLabel = remaining > 0 ? this._formatDuration(remaining) : 'Scaduto';

    if (remaining === 0 && this._idTokenIntervalId !== null) {
      clearInterval(this._idTokenIntervalId);
      this._idTokenIntervalId = null;
    }

    this._markForCheck();
  }

  private _updateAccessTokenCountdown(expiration: number, initialTtl: number): void {
    const now = Math.floor(Date.now() / 1000);
    const remaining = Math.max(expiration - now, 0);

    this.accessTokenExpiresInSeconds = remaining;
    this.accessTokenProgress = Math.max(0, Math.min(100, Math.round((remaining / initialTtl) * 100)));
    this.accessTokenTimeLabel = remaining > 0 ? this._formatDuration(remaining) : 'Scaduto';

    if (remaining === 0 && this._accessTokenIntervalId !== null) {
      clearInterval(this._accessTokenIntervalId);
      this._accessTokenIntervalId = null;
    }

    this._markForCheck();
  }

  private _resolveInitialTtl(expiration: number, issuedAt: number | null): number {
    if (issuedAt !== null && expiration > issuedAt) {
      return expiration - issuedAt;
    }

    const now = Math.floor(Date.now() / 1000);
    return Math.max(expiration - now, 1);
  }

  private _extractScopes(payload: ClaimMap | null): string[] {
    if (payload === null) {
      return [];
    }

    const claim = payload['scope'];
    if (typeof claim === 'string') {
      return claim.split(' ').map((value) => value.trim()).filter((value) => value.length > 0);
    }

    if (Array.isArray(claim)) {
      return claim.map((value) => String(value).trim()).filter((value) => value.length > 0);
    }

    return [];
  }

  private _decodeToken(token: string): ClaimMap | null {
    if (!token) {
      return null;
    }

    const tokenParts = token.split('.');
    if (tokenParts.length < 2) {
      return null;
    }

    const payload = tokenParts[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    const paddedPayload = payload + '='.repeat((4 - (payload.length % 4)) % 4);

    try {
      const binaryPayload = atob(paddedPayload);
      const bytes = Uint8Array.from(binaryPayload, (char) => char.charCodeAt(0));
      const jsonPayload = new TextDecoder().decode(bytes);
      const parsedPayload: unknown = JSON.parse(jsonPayload);
      return this._asClaimMap(parsedPayload);
    } catch {
      return null;
    }
  }

  private _extractUserDataClaims(response: unknown): ClaimMap | null {
    const wrapper = this._asClaimMap(response);
    if (wrapper === null) {
      return null;
    }

    const wrappedUserData = this._asClaimMap(wrapper['userData']);
    return wrappedUserData ?? wrapper;
  }

  private _applyUserDataClaims(claims: ClaimMap | null): void {
    this.userDataClaims = claims;
    this.userDataClaimEntries = this._buildClaimEntries(claims);

    const claimsAsUser = claims as User | null;
    this.user = claimsAsUser;

    const emailFromClaims = claimsAsUser?.email ?? '';
    if (emailFromClaims) {
      this.email = emailFromClaims;
    } else if (!this.isAuthenticated) {
      this.email = '';
    }
  }

  private _refreshUserData(): void {
    if (!this.isAuthenticated) {
      return;
    }

    this._subscriptions.add(
      this._oidcSecurityService.getUserData().pipe(take(1)).subscribe({
        next: (userData) => {
          const claims = this._extractUserDataClaims({ userData });
          this._applyUserDataClaims(claims);
          this._rebuildMergedClaims();
          this._markForCheck();
        },
        error: () => {
          // If userinfo is not available yet, userData$ stream and token claims still fill the UI.
        }
      })
    );
  }

  private _buildClaimEntries(claims: ClaimMap | null): ClaimEntry[] {
    if (claims === null) {
      return [];
    }

    return Object.entries(claims)
      .map(([key, value]) => ({
        key,
        value: this._formatClaimValue(value)
      }))
      .sort((left, right) => left.key.localeCompare(right.key));
  }

  private _formatClaimValue(value: unknown): string {
    if (value === null || value === undefined) {
      return '-';
    }

    if (typeof value === 'string') {
      return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    if (Array.isArray(value)) {
      return value.map((item) => this._formatClaimValue(item)).join(', ');
    }

    return JSON.stringify(value);
  }

  private _readStringClaim(payload: ClaimMap | null, claimName: string): string | null {
    if (payload === null) {
      return null;
    }

    const value = payload[claimName];
    return typeof value === 'string' ? value : null;
  }

  private _readNumericClaim(payload: ClaimMap | null, claimName: string): number | null {
    if (payload === null) {
      return null;
    }

    const value = payload[claimName];

    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  }

  private _formatDuration(totalSeconds: number): string {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
    }

    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  }

  private _formatUnixDate(value: number): string {
    return new Date(value * 1000).toLocaleString('it-IT');
  }

  private _rebuildMergedClaims(): void {
    const mergedClaims: ClaimMap = {};

    for (const source of [this.idTokenPayload, this.accessTokenPayload, this.userDataClaims, this.backendUserInfo]) {
      if (source === null) {
        continue;
      }

      for (const [key, value] of Object.entries(source)) {
        mergedClaims[key] = value;
      }
    }

    this.mergedClaimEntries = this._buildClaimEntries(mergedClaims);
  }

  private _asClaimMap(value: unknown): ClaimMap | null {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as ClaimMap;
    }

    return null;
  }

  private _handleError(context: string, error: unknown): void {
    this.errorMessage = this._buildErrorMessage(context, error);
    this._markForCheck();
  }

  private _buildErrorMessage(context: string, error: unknown): string {
    const errorDetails = this._extractErrorText(error);
    return errorDetails ? `${context}: ${errorDetails}` : context;
  }

  private _extractErrorText(error: unknown): string | null {
    if (typeof error === 'string') {
      return error;
    }

    if (error instanceof Error) {
      return error.message;
    }

    const errorObject = this._asClaimMap(error);
    if (errorObject === null) {
      return null;
    }

    const message = errorObject['message'];
    if (typeof message === 'string') {
      return message;
    }

    const wrappedError = this._asClaimMap(errorObject['error']);
    if (wrappedError !== null) {
      const wrappedMessage = wrappedError['message'];
      if (typeof wrappedMessage === 'string') {
        return wrappedMessage;
      }
    }

    const statusText = errorObject['statusText'];
    if (typeof statusText === 'string') {
      return statusText;
    }

    return null;
  }

  private _resetTokenState(): void {
    this.rawIdToken = '';
    this.rawAccessToken = '';

    this.idTokenPayload = null;
    this.accessTokenPayload = null;
    this.backendUserInfo = null;

    this.idTokenClaims = [];
    this.accessTokenClaims = [];
    this.backendClaims = [];
    this.mergedClaimEntries = this._buildClaimEntries(this.userDataClaims);

    this.grantedScopes = [];

    this.idTokenExpiresInSeconds = null;
    this.accessTokenExpiresInSeconds = null;
    this.idTokenProgress = 0;
    this.accessTokenProgress = 0;
    this.idTokenTimeLabel = 'N/D';
    this.accessTokenTimeLabel = 'N/D';
    this.idTokenIssuedAt = '';
    this.accessTokenIssuedAt = '';
    this.idTokenExpiresAt = '';
    this.accessTokenExpiresAt = '';

    this.backendUserInfoError = null;

    if (this._idTokenIntervalId !== null) {
      clearInterval(this._idTokenIntervalId);
      this._idTokenIntervalId = null;
    }

    if (this._accessTokenIntervalId !== null) {
      clearInterval(this._accessTokenIntervalId);
      this._accessTokenIntervalId = null;
    }

    this._markForCheck();
  }

  private _resetAuthState(): void {
    this.isAuthenticated = false;
    this.isRefreshInProgress = false;
    this.user = this.userDataClaims as User | null;
    this.email = this.user?.email ?? '';
    this._resetTokenState();
    this._rebuildMergedClaims();
    this._markForCheck();
  }

  public ngOnDestroy(): void {
    if (this._idTokenIntervalId !== null) {
      clearInterval(this._idTokenIntervalId);
    }

    if (this._accessTokenIntervalId !== null) {
      clearInterval(this._accessTokenIntervalId);
    }

    this._subscriptions.unsubscribe();
  }

  private _markForCheck(): void {
    this._cdr.markForCheck();
  }
}
