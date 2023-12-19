import nock from 'nock';
import { HubIdentifier } from '../../src/BaliGateway';

/**
 * The following mock data builds around the following facts:
 *   - Username of "test-user"
 *   - Password of "test-password"
 *   - URLs pulled from working connection to Bali's API
 */

export class BaliApiSimulator {
  public static fakeHubIdentity: HubIdentifier = '70001234';
  public static age = 5; // The age in seconds for which tokens will expire
  // This is the only URL that does not line up with real world situation. This one is for a potentially
  // mocked websocket endpoint. An example of a real world response for device relay is:
  // wss://nma-server10-oem-ui-cloud.ezlo.com:443
  public static fakeDeviceRelayResp = { 'Server_Relay': 'ws://localhost:8080' };
  public static fakeUser = 'test-user';
  public static fakePassword = 'test-password';
  public static nonExistentUser = 'nonexistentuser';

  private expiration: number;
  private fakeAccountId = 1238062;
  private portalIdentity: string;
  private fakePortalAuth: any;
  private fakeAuthSha = '922170460ca810ae23bcc0220a9e6ff42095958d';
  private fakeSessionToken = '000000042229006574B39B97973XXXXXXXXXXX';

  private fakeDeviceResp = {
    'Devices': [{
      'PK_Device': BaliApiSimulator.fakeHubIdentity,
      'Server_Device': 'swf-us-oem-device11.mios.com',
      'Server_Device_Alt': 'swf-us-oem-device12.mios.com',
    }],
  };
  
  constructor() {
    this.expiration = (Date.now() / 1000) + BaliApiSimulator.age;
    this.portalIdentity = btoa(JSON.stringify({'Expires': this.expiration, 'PK_Account': this.fakeAccountId}));
    this.fakePortalAuth = {
      'Identity': this.portalIdentity,
      'IdentitySignature': 'my-fake-signautre',
      'Server_Account': 'swf-us-oem-account11.mios.com',
      'Server_Account_Alt': 'swf-us-oem-account12.mios.com',
    };
    if(!nock.isActive()) {
      nock.activate();
    }
  }

  public stop() {
    nock.cleanAll();
    //nock.restore();
  }

  public portal(): nock.Scope {
    // Mock portal auth
    return nock('https://vera-us-oem-autha11.mios.com')
      .get('/autha/auth/username/test-user')
      .query({
        'SHA1Password': this.fakeAuthSha,
        'PK_Oem': '73',
        'TokenVersion': '2',
      })
      .once()
      .reply(200, this.fakePortalAuth);
  
  }

  public sessionLookup(): nock.Scope {
    // Mock session token 
    return nock('https://swf-us-oem-account11.mios.com')
      .get('/info/session/token')
      .once()
      .reply(200, this.fakeSessionToken)
      .matchHeader('MMSAuth', this.fakePortalAuth.Identity)
      .matchHeader('MMSAuthSig', this.fakePortalAuth.IdentitySignature);
  }  

  public deviceLookup(): nock.Scope {
    // Mock device lookup
    return nock('https://swf-us-oem-account11.mios.com')
      .get('/account/account/account/1238062/devices')
      .matchHeader('MMSSession', '000000042229006574B39B97973XXXXXXXXXXX')
      .once()
      .reply(200, this.fakeDeviceResp);
  }

  public deviceRelayLookup(): nock.Scope {
    // Mock device relay url lookup
    return nock('https://swf-us-oem-device11.mios.com')
      .get('/device/device/device/' + BaliApiSimulator.fakeHubIdentity)
      .matchHeader('MMSSession', '000000042229006574B39B97973XXXXXXXXXXX')
      .once()
      .reply(200, BaliApiSimulator.fakeDeviceRelayResp);
  }

  public portalAuthFailure(): nock.Scope {
    // Mock portl auth failure
    return nock('https://vera-us-oem-autha11.mios.com')
      .get('/autha/auth/username/nonexistentuser')
      .query({
        'SHA1Password': this.fakeAuthSha,
        'PK_Oem': '73',
        'TokenVersion': '2',
      })
      .once()
      .reply(404, this.fakePortalAuth);
  }
}
