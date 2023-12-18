import { BaliCloudResolver, ServerRelayCredentials } from '../src/BaliCredentials';
import { BaliApiSimulator } from './utils/baliHttpApiSimulator';
import * as chai from 'chai';
import { expect } from 'chai';
chai.use(require('chai-as-promised'));


describe('BaliCredentials Test Suite', function () {
  const baliApiSim = new BaliApiSimulator();

  describe('BaliCloudResolver Tests', function () {
    it('hubs(): registered hubs', function () {
      const resolver = new BaliCloudResolver(BaliApiSimulator.fakeUser, BaliApiSimulator.fakePassword);
      const portalScope = baliApiSim.portal();
      const sessionScope = baliApiSim.sessionLookup();
      const deviceScope = baliApiSim.deviceLookup();

      return resolver.hubs()
        .then((hubs) => {
          expect(hubs).to.be.an('array');
          expect(hubs).property('length').is.greaterThan(0);
          hubs.forEach((id) => expect(/^\d+$/.test(id), 'Hub identifiers should be all digits').is.true);
        }).then(() => {
          portalScope.done();
          sessionScope.done();
          deviceScope.done();
        });
    });

    it('credentials(): credentials from Cloud for known hubs', async function () {
      const resolver = new BaliCloudResolver(BaliApiSimulator.fakeUser, BaliApiSimulator.fakePassword);
      const portalScope = baliApiSim.portal();
      const sessionScope = baliApiSim.sessionLookup();
      const deviceScope = baliApiSim.deviceLookup();
      const deviceRelayScope = baliApiSim.deviceRelayLookup();

      const expectations: Promise<ServerRelayCredentials | string>[] = [];
      for (const hub of await resolver.hubs()) {
        expectations.push(new Promise((resolve, reject) => {
          resolver.credentials(hub)
            .then((credentials: ServerRelayCredentials) => {
              expect(credentials, 'signature property should exist').to.have.property('signature');
              expect(credentials, 'token property should exist').to.have.property('token');
              expect(credentials, 'hubIdentity property should exist').to.have.property('hubIdentity');
              expect(credentials, 'url property should exist').to.have.property('url');
              resolve('pass');
            })
            .catch((err: Error) => reject(err));
        }));
      }
      return Promise.all(expectations).then(() => {
        portalScope.done();
        sessionScope.done();
        deviceScope.done();
        deviceRelayScope.done();
      });
    });

    it('credentials(): throw for missing or invalid hub entry', function () {
      const resolver = new BaliCloudResolver(BaliApiSimulator.fakeUser, BaliApiSimulator.fakePassword);
      const portalScope = baliApiSim.portal();
      const sessionScope = baliApiSim.sessionLookup();
      const deviceScope = baliApiSim.deviceLookup();

      return expect(resolver.credentials('NonExistantHub')
        .finally(() => {
          portalScope.done();
          sessionScope.done();
          deviceScope.done();
        })).eventually.is.rejected;
    });

    it('hubs(): throw for non-existant MIOS user', function () {
      const portalAuthFailScope = baliApiSim.portalAuthFailure();
      const resolver = new BaliCloudResolver(BaliApiSimulator.nonExistentUser, 'passwd');
      return expect(resolver.hubs()
        .finally(() => {
          portalAuthFailScope.done();
        })).eventually.is.rejected;
    });
  });
});