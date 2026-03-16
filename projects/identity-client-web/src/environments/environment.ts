export const environment = {
  production: false,
  name: 'development',
  version: '1.0.0',
  client: 'web',
  baseUrl: '/api',
  identityServer: {
    authority: 'https://localhost:5001',
    clientId: 'angularclient',
    scope: 'openid profile email offline_access',
    responseType: 'code',
    renewTimeBeforeTokenExpiresInSeconds: 15,
  }
};
