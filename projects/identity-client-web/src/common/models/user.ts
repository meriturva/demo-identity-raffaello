export interface User {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  preferred_username?: string;
  given_name?: string;
  family_name?: string;
  nome?: string;
  cognome?: string;
  consensoMarketing?: boolean;
  consensoProfilazione?: boolean;
  consensoTerzeParti?: boolean;
  [claim: string]: unknown;
}
