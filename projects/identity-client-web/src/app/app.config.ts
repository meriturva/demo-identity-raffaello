import { registerLocaleData } from '@angular/common';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { ApplicationConfig, DEFAULT_CURRENCY_CODE, LOCALE_ID, provideZoneChangeDetection } from '@angular/core';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import localeIt from '@angular/common/locales/it';

import { LogLevel, provideAuth, withAppInitializerAuthCheck } from 'angular-auth-oidc-client';

import { environment } from '../environments/environment';
import { routes } from './app.routes';

registerLocaleData(localeIt);

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideAnimations(),
    { provide: LOCALE_ID, useValue: 'it' },
    { provide: DEFAULT_CURRENCY_CODE, useValue: 'EUR' },

    // HTTP client with DI interceptors
    provideHttpClient(withInterceptorsFromDi()),

    // OIDC Auth — withAppInitializerAuthCheck() chiama checkAuth() come APP_INITIALIZER,
    // prima che Angular Router processi le route. Senza di esso, il Router redirige da ''
    // a 'home' e i parametri code/state del callback OIDC vengono persi prima che
    // checkAuth() li possa leggere, lasciando l'utente non autenticato senza errori.
    provideAuth({
      config: {
        authority: environment.identityServer.authority,
        redirectUrl: window.location.origin,
        postLogoutRedirectUri: window.location.origin,
        clientId: environment.identityServer.clientId,
        scope: environment.identityServer.scope,
        responseType: environment.identityServer.responseType,
        silentRenew: true,
        useRefreshToken: true,
        ignoreNonceAfterRefresh: true, // questo è richiesto se l'id_token non viene aggiornato dopo la prima autenticazione. Secondo la specifica OpenID Connect, il nonce è richiesto solo nel flusso di autorizzazione interattiva (authorization_code), non nel flusso refresh_token. Quindi lo ignore dopo il primo accesso.
        renewTimeBeforeTokenExpiresInSeconds: 15,//environment.identityServer.renewTimeBeforeTokenExpiresInSeconds,
        logLevel: LogLevel.Debug //TODO: Change to LogLevel.Error in production
      }
    }, withAppInitializerAuthCheck()),
  ]
};
