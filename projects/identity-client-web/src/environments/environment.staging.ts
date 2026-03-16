export const environment = {
  production: true,
  name: 'staging',
  version: '1.0.0',
  client: 'web',
  baseUrl: '/api',
  identityServer: {
    authority: 'https://account-dev.raffaellolibri.it',
    clientId: 'angularclient',
    scope: 'openid profile email offline_access',
    responseType: 'code',
    renewTimeBeforeTokenExpiresInSeconds: 120,
  }
};
