import { CredentialsResolver, ServerRelayCredentials } from '../BaliCredentials';

import crypto from 'crypto';
import https from 'https';
import url from 'url';


/** 
* Base class that encapsulates and represents an authorization crendtial
*/
abstract class AuthToken {
  constructor(private expiration: number = 0) { }
  expired(): boolean {
    return Date.now() / 1000 > this.expiration; // - 86380; ... Use this to play with quicker expiration of tokens :)
  }
}


/**
* Represents, and encapsulates a MIOS portal MMS authorization crendtial
*/
class PortalAuth extends AuthToken {
  public readonly identity: string;
  public readonly signature: string;
  public readonly serverAccount: string;
  constructor(identity: string, signature: string, serverAccount: string) {
    super(JSON.parse(Buffer.from(identity, 'base64').toString()).Expires);
    this.identity = identity;
    this.signature = signature;
    this.serverAccount = serverAccount;
  }

  toHeaderRepresentation = (): Record<string, unknown> => {
    return { MMSAuth: this.identity, MMSAuthSig: this.signature };
  };
}

/**
 * Holds MiOS Portal MMS session token.
 */
export class SessionToken extends AuthToken {
  constructor(public token: string) {
    super(Infinity);
  }

  toHeaderRepresentation = (): Record<string, unknown> => {
    return { MMSSession: this.token };
  };
}

/**
 * Encapsulates device server info
 */
export interface DeviceServer {
  readonly deviceId: string;
  readonly url: string;
  readonly urlAlt: string;
  readonly sessionToken: SessionToken;
}

export class BaliCloudResolver implements CredentialsResolver {
  private readonly username: string;
  private readonly passwordHash: string;
  private portalAuth?: PortalAuth;
  private sessionToken?: SessionToken;
  private deviceCache = new Map<string, DeviceServer[]>();
  private deviceRelayCache = new Map<DeviceServer, string>(); // Map of DeviceServer -> device server relay URL

  constructor(username: string, password: string) {
    this.username = username;
    // Only retain the hashed password to reduce attack surface
    this.passwordHash = crypto.createHash('sha1')
      .update(username.toLowerCase())
      .update(password)
      .update('oZ7QE6LcLJp6fiWzdqZc') //Salt
      .digest('hex');
  }


  /**
   * Retrieves the MMS authorization crendentials from the MIOS portal.  This
   * requires a valid username and password.
   *
   * @returns portal authentication object representing the MMS authorization credentials
   */
  private portalAuthenticate(): Promise<PortalAuth> {
    const endpoint =
      'https://vera-us-oem-autha11.mios.com/autha/auth/username/' +
      `${this.username}?SHA1Password=${this.passwordHash}&PK_Oem=73&TokenVersion=2`;

    if (BaliCloudResolver.authIsValid(this.portalAuth)) {
      return Promise.resolve(this.portalAuth!);
    }

    return new Promise((resolve, reject) => {
      htRequest(endpoint)
        .then((authResponse) => {
          this.portalAuth = new PortalAuth(authResponse.Identity, authResponse.IdentitySignature, authResponse.Server_Account);
          resolve(this.portalAuth);
        })
        .catch((err) => {
          reject(new Error(`Failed to login to MIOS Portal due to error ${err}`));
        });
    });
  }


  private sessionAuthenticate(portalAuth: PortalAuth): Promise<SessionToken> {
    // No cached responses for session token. Always request one.
    return new Promise((resolve, reject) => {
      const endpoint =
        `https://${portalAuth.serverAccount}/info/session/token`;

      htRequest(Object.assign({}, url.parse(endpoint), { headers: portalAuth.toHeaderRepresentation() }), '', false)
        .then((tokenResponse) => {
          this.sessionToken = new SessionToken(tokenResponse);
          resolve(this.sessionToken);
        })
        .catch((err) => {
          reject(new Error(`Failed to get session token due to ${err}`));
        });
    });
  }

  private authenticate(): Promise<void> {
    if (this.portalAuth && this.sessionToken && BaliCloudResolver.authIsValid(this.portalAuth)) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      this.portalAuthenticate()
        .then((portalAuth) => {
          this.sessionAuthenticate(portalAuth)
            .then(() => {
              resolve();
            })
            .catch((err) => {
              reject(err);
            });
        })
        .catch((err) => {
          reject(err);
        });
    });
  }

  private deviceServers(): Promise<DeviceServer[]> {
    return new Promise<DeviceServer[]>((resolve, reject) => {
      try {
        const accountId = JSON.parse(Buffer.from(this.portalAuth!.identity, 'base64').toString()).PK_Account;
        if (this.deviceCache.has(accountId)) {
          const deviceServers = this.deviceCache.get(accountId);
          resolve(deviceServers!);
        } else {
          const endpoint =
            `https://${this.portalAuth!.serverAccount}/account/account/account/${accountId}/devices`;
          htRequest(Object.assign({}, url.parse(endpoint), { headers: this.sessionToken!.toHeaderRepresentation() }))
            .then((devicesResponse) => {
              const deviceServers = devicesResponse.Devices.map((device) => {
                return {
                  deviceId: device.PK_Device,
                  url: device.Server_Device,
                  urlAlt: device.Server_Device_Alt,
                } as DeviceServer;
              });
              this.deviceCache.set(accountId, deviceServers);
              resolve(deviceServers);
            });
        }
      } catch (err) {
        reject(`Error while getting device servers: ${err}`);
      }
    });
  }

  /**
 * Validates an authorization credential/token.  Valid means defined and
 * not expired
 *
 * @param auth - the authorization token to validate
 * @returns validity
 */
  private static authIsValid(auth?: AuthToken): boolean {
    return auth !== undefined && auth.expired() === false;
  }

  public credentials(hubSerial: string): Promise<ServerRelayCredentials> {
    return new Promise((resolve, reject) => {
      this.authenticate()
        .then(() => this.getDeviceServer(hubSerial))
        .then(async (deviceServer) => {
          const deviceServerRelay = await this.getDeviceServerRelayUrl(deviceServer);
          resolve({
            url: deviceServerRelay,
            hubIdentity: deviceServer.deviceId,
            signature: this.portalAuth?.signature,
            token: this.portalAuth?.identity,
          } as ServerRelayCredentials);
        })
        .catch((err) => {
          reject(new Error(`User ${this.username} is not authorized for hub ${hubSerial}. Caused by ${err}`));
        });
    });
  }

  hubs(): Promise<string[]> {
    return new Promise((resolve, reject) => {
      this.authenticate()
        .then(() => this.deviceServers())
        .then((devices) => {
          resolve(devices.map((device) => device.deviceId));
        })
        .catch((err) => {
          reject(new Error(`Failed to retrieve controller hubs from cloud due to error: ${err}`));
        });
    });
  }

  private getDeviceServer(hubSerial: string): Promise<DeviceServer> {
    return new Promise((resolve, reject) => {
      this.deviceServers()
        .then((devices) => {
          const matches = devices.filter((device) => device.deviceId === hubSerial);
          if (matches.length !== 1) {
            reject(new Error(`Unable to find hub with serial ${hubSerial}`));
          }
          resolve(matches[0]);
        })
        .catch((err) => {
          reject(new Error(`Error retrieving device server for ${hubSerial} due to ${err}`));
        });
    });
  }

  private getDeviceServerRelayUrl(deviceServer: DeviceServer): Promise<string> {
    if (this.deviceRelayCache.has(deviceServer)) {
      return Promise.resolve(this.deviceRelayCache.get(deviceServer)!);
    }
    return new Promise((resolve, reject) => {
      const endpoint =
        `https://${deviceServer.url}/device/device/device/${deviceServer.deviceId}`;
      htRequest(Object.assign({}, url.parse(endpoint), { headers: this.sessionToken?.toHeaderRepresentation() }))
        .then((response) => {
          // Update cache and resolve
          this.deviceRelayCache.set(deviceServer, response.Server_Relay);
          resolve(response.Server_Relay);
        })
        .catch(() => {
          // Try second device server
          const endpoint2 =
            `https://${deviceServer.urlAlt}/device/device/device/${deviceServer.deviceId}`;
          htRequest(Object.assign({}, url.parse(endpoint2), { headers: this.sessionToken?.toHeaderRepresentation() }))
            .then((response) => {
              // Update cache and resolve
              this.deviceRelayCache.set(deviceServer, response.Server_Relay);
              resolve(response.Server_Relay);
            })
            .catch((err2) => {
              reject(new Error(`Error while getting Device Server Relay URL due to ${err2}`));
            });
        });
    });
  }
}


/**
* Promise-based https request
*/
export function htRequest(urlOptions: any, data = '', isJson = true): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.request(urlOptions,
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk.toString()));
        res.on('error', err => reject(err));
        res.on('end', () => {
          if (res.statusCode! < 200 || res.statusCode! > 299) {
            reject(new Error(`Request failed. ${res.statusCode}, body: ${body}`));
          }
          if (!isJson) {
            resolve(body);
            return;
          }
          try {
            const payload = JSON.parse(body);
            if (payload?.data?.error_text) {
              reject(new Error(`Request returned error_text: ${payload.data.error_text}`));
            }
            // resolve({statusCode: res.statusCode, headers: res.headers, body: payload});
            resolve(payload);
          } catch (err) {
            reject(new Error(`Failed to parse http body ${body} as json due to error: ${err}`));
          }
        });
      });
    req.on('error', error => reject(`HTTPS Request failed with error: ${error}`));
    req.write(data, 'binary');
    req.end();
  });
}
