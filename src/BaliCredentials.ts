import { HubIdentifier } from './BaliGateway';

export interface ServerRelayCredentials {
  readonly url: string;
  readonly hubIdentity: string;
  readonly signature: string;
  readonly token: string;
}

export interface CredentialsResolver {
  hubs(): Promise<HubIdentifier[]>;
  credentials(hubIdentity: HubIdentifier): Promise<ServerRelayCredentials>;
}

export { BaliCloudResolver } from './CredentialsResolvers/BaliCloudResolver';
