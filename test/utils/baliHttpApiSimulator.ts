import nock from 'nock';
import { HubIdentifier } from '../../src/BaliGateway';

/**
 * The following mock data builds around the following facts:
 *   - Username of "test-user"
 *   - Password of "test-password"
 *   - URLs pulled from working connection to Bali's API
 */

export const fakeHubIdentity: HubIdentifier = '70001234';
const expiration = Date.now() + 10000; // 10 seconds from now
const fakeAccountId = 1238062;
const portalIdentity = btoa(JSON.stringify({'Expires': expiration, 'PK_Account': fakeAccountId}));
const fakePortalAuth = {
  'Identity': portalIdentity,
  'IdentitySignature': 'my-fake-signautre',
  'Server_Account': 'swf-us-oem-account11.mios.com',
  'Server_Account_Alt': 'swf-us-oem-account12.mios.com',
};

const fakeDeviceResp = {
  'Devices': [{
    'PK_Device': fakeHubIdentity,
    'Server_Device': 'swf-us-oem-device11.mios.com',
    'Server_Device_Alt': 'swf-us-oem-device12.mios.com',
  }],
};

// This is the only URL that does not line up with real world situation. This one is for a potentially
// mocked websocket endpoint. An example of a real world response for device relay is:
// wss://nma-server10-oem-ui-cloud.ezlo.com:443
export const fakeDeviceRelayResp = { 'Server_Relay': 'ws://localhost:8080' };

export const fakeUser = 'test-user';
export const fakePassword = 'test-password';
const fakeAuthSha = '922170460ca810ae23bcc0220a9e6ff42095958d';
const fakeSessionToken = '000000042229006574B39B97973XXXXXXXXXXX';
export const nonExistentUser = 'nonexistentuser';

export function portal(): nock.Scope {
  // Mock portal auth
  return nock('https://vera-us-oem-autha11.mios.com')
    .get('/autha/auth/username/test-user')
    .query({
      'SHA1Password': fakeAuthSha,
      'PK_Oem': '73',
      'TokenVersion': '2',
    })
    .reply(200, fakePortalAuth);

}

export function sessionLookup(): nock.Scope {
  // Mock session token 
  return nock('https://swf-us-oem-account11.mios.com')
    .get('/info/session/token')
    .reply(200, fakeSessionToken)
    .matchHeader('MMSAuth', fakePortalAuth.Identity)
    .matchHeader('MMSAuthSig', fakePortalAuth.IdentitySignature);
}

export function deviceLookup(): nock.Scope {
  // Mock device lookup
  return nock('https://swf-us-oem-account11.mios.com')
    .get('/account/account/account/1238062/devices')
    .matchHeader('MMSSession', '000000042229006574B39B97973XXXXXXXXXXX')
    .reply(200, fakeDeviceResp);
}

export function deviceRelayLookup(): nock.Scope {
  // Mock device relay url lookup
  return nock('https://swf-us-oem-device11.mios.com')
    .get('/device/device/device/' + fakeHubIdentity)
    .matchHeader('MMSSession', '000000042229006574B39B97973XXXXXXXXXXX')
    .reply(200, fakeDeviceRelayResp);
}

export function portalAuthFailure(): nock.Scope {
  // Mock portl auth failure
  return nock('https://vera-us-oem-autha11.mios.com')
    .get('/autha/auth/username/nonexistentuser')
    .query({
      'SHA1Password': fakeAuthSha,
      'PK_Oem': '73',
      'TokenVersion': '2',
    })
    .reply(404, fakePortalAuth);
}