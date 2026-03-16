export const environment = {
  production: true,
  name: 'production',
  version: '1.0.0',
  client: 'web',
  baseUrl: '/api',
  identityServer: {
    authority: 'https://account.raffaellolibri.it',
    clientId: 'angularclient',
    scope: 'openid profile email api offline_access',
    responseType: 'code',
    renewTimeBeforeTokenExpiresInSeconds: 86400,
  }
};
