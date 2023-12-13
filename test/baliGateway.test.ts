/* eslint-disable no-console */
import * as mockWebsocketServer from './utils/websocketServerSimulator';
import * as mockHttpServer from './utils/baliHttpApiSimulator';

import { BaliGateway, HubIdentifier, ObservationHandler, MessagePredicate, EzloIdentifier } from '../src/BaliGateway';
import { BaliCloudResolver } from '../src/BaliCredentials';

import * as chai from 'chai';
import { expect } from 'chai';
chai.use(require('chai-as-promised'));

import chalk from 'chalk';

const resolverStrategy: BaliCloudResolver = new BaliCloudResolver(mockHttpServer.fakeUser, mockHttpServer.fakePassword);
let availableHubs: HubIdentifier[];
let hubSerial: HubIdentifier = 'undefined';
let websocketServer: mockWebsocketServer.MockBaliWebsocketServer;
let websocketServerCloseTimeout: NodeJS.Timeout;


// Test conveneince extension to randomly select an element from an Array
declare global {
  interface Array<T> {
    randomElem(): T;
  }
}
Array.prototype.randomElem = function () {
  return this[Math.floor( Math.random() * this.length )];
};

describe('BaliGateway Test Suite', function() {
  const portalScope = mockHttpServer.portal();
  const sessionScope = mockHttpServer.sessionLookup();
  const deviceScope = mockHttpServer.deviceLookup();
  const deviceRelayScope = mockHttpServer.deviceRelayLookup();

  before('Setup test websocket server', function() {
    websocketServer = new mockWebsocketServer.MockBaliWebsocketServer(mockHttpServer.fakeDeviceRelayResp.Server_Relay);
    websocketServer.setup();
    console.log(chalk.green('      ✓'), 
      chalk.gray(`Mock websocket server initialized at ${mockHttpServer.fakeDeviceRelayResp.Server_Relay}`));
  });

  after('Tear down test websocket server', function() {
    clearTimeout(websocketServerCloseTimeout);
    websocketServer.close();
  });

  before('Get test hub(s)', async function() {
    availableHubs = await resolverStrategy.hubs();
    hubSerial = availableHubs.randomElem();
    console.log(chalk.green('      ✓'), chalk.gray(`Hub ${hubSerial} selected for test execution`));
  });

  describe('Secure Login (for each bali gateway)', function() {
    it('Connect to each available hub', function() {
      const hubs: Promise<EzloIdentifier>[] = availableHubs.map(serial => {
        return new Promise((resolve, reject) => {
          BaliGateway.createHub(serial, resolverStrategy)
            .then((hub) => {
              hub.info().then((info) => {
                console.log(chalk.green('      ✓'), chalk.gray(`Securely connected to local hub ${serial}, model: ${info.model}, `
                + `architecture: ${info.architecture}, firmware: ${info.firmware}`));
                expect(info, 'Info should contain serial property').to.have.property('serial');
                hub.disconnect().then(() => resolve('successful connection'));
              });
            })
            .catch((err) => reject(err));
        });
      });
      return expect(Promise.all(hubs)).to.eventually.be.fulfilled;
    });
  });

  describe('Hub Properties', function() {
    before('initialize hub test instance', async function() {
      this.hub = await BaliGateway.createHub(hubSerial, resolverStrategy).then(hub => hub.connect());
    });
    after(function () {
      this.hub.disconnect();
    });

    it('info(): hub.info.get', function() {
      return this.hub.info()
        .then((info) => {
          expect(info, 'Info should contain serial property').to.have.property('serial');
          expect(info, 'Info should contain firmware property').to.have.property('firmware');
          expect(info, 'Info should contain architecture property').to.have.property('architecture');
        });
    });

    it('devices(): hub.devices.list', async function() {
      return expect(this.hub.devices()).to.eventually.be.fulfilled.and.have.property('length').greaterThan(0);
    });

    it('device(): device with name', function() {
      return this.hub.devices()
        .then((devices) => {
          expect(devices.length, 'No devices returned').to.be.greaterThan(0);
          const randomDevice = devices.randomElem();
          return { name: randomDevice.name, id: randomDevice._id };
        })
        .then((testDevice) => {
          this.hub.scene(testDevice.name)
            .then((scn) => {
              return expect(scn._id).to.be.equal(testDevice.id);
            });
        });
    });

    it('items(): hub.items.list', function() {
      return expect(this.hub.items()).to.eventually.be.fulfilled.and.have.property('length').greaterThan(0);
    });

    it('items(): hub.items.list (for specific device)', async function() {
      const testDeviceId = await this.hub.devices().then((devices: any[]) => devices.randomElem()._id);
      return expect(this.hub.items(testDeviceId).then(items => items[0])).to.eventually.be.fulfilled
        .and.to.have.property('deviceId').to.be.equal(testDeviceId);
    });

    it('items(): hub.items.list (for non-existant device)', function() {
      return expect(this.hub.items('bogusDeviceId')).to.eventually.be.fulfilled.and.have.property('length').equal(0);
    });

    it('item(): item with name for device', async function() {
      const testDevice = await this.hub.devices().then((devices: any[]) => devices.randomElem());
      const testItem = await this.hub.items(testDevice._id).then((items: any[]) => items.randomElem());
      return expect(this.hub.item(testItem.name, testDevice._id).then(items => items[0])).to.eventually.be.fulfilled
        .and.to.have.property('_id').to.be.equal(testItem._id);
    });

    it('scenes(): hub.scenes.list', function() {
      return expect(this.hub.scenes()).to.eventually.be.fulfilled.and.have.property('length').greaterThan(0);
    });

    it('scene(): scene with name', async function() {
      const testScene = await this.hub.scenes().then((scenes: any[]) => scenes.randomElem());
      return expect(this.hub.scene(testScene.name)).to.eventually.be.fulfilled
        .and.to.have.property('_id').to.be.equal(testScene._id);
    });

    it('scene(): scene with name - non-existant', function() {
      return expect(this.hub.scene('non-existent-scene')).to.eventually.to.be.undefined;
    });

    it('rooms(): hub.room.list', function() {
      return expect(this.hub.rooms()).to.eventually.be.fulfilled.and.have.property('length').greaterThan(0);
    });

    it('room(): room with name', async function() {
      const testRoom = await this.hub.rooms().then((rooms: any[]) => rooms.randomElem());
      return expect(this.hub.room(testRoom.name)).to.eventually.be.fulfilled
        .and.to.have.property('_id').to.be.equal(testRoom._id);
    });
  });

  describe('Hub Event Observations', function() {
    const login = 'hub.offline.login.ui';
    it(`addObserver(): ${login}`, function() {
      const handler: ObservationHandler = (msg) => expect(msg.method).to.be.equal(login);
      const predicate: MessagePredicate = (msg) => msg.method === login;
      return BaliGateway.createHub(hubSerial, resolverStrategy)
        .then((hub) => {
          hub.addObserver(predicate, handler);
          hub.connect().then(() => hub.disconnect());
        });
    });
  });

  describe('Hub Actions', function() {
    before('initialize hub test instance', async function() {
      this.hub = await BaliGateway.createHub(hubSerial, resolverStrategy).then(hub => hub.connect());
    });
    after(function () {
      this.hub.disconnect();
    });

    it('runScene()', function() {
      // Allow tests to find hubs without the scene with the test name...
      const testSceneName = 'Test';
      return this.hub.scene(testSceneName)
        .then((scene) => {
          if (scene) {
            console.log(chalk.gray(`        ➔ running scene "${scene.name}:${scene._id}"`));
            return expect(this.hub.runScene(scene._id)).to.eventually.be.fulfilled;
          } else {
            console.log(chalk.cyan(`        ➔ unable to verify runScene() because the scene "${testSceneName}" does not exist`));
            return expect(Promise.resolve()).to.eventually.be.fulfilled;
          }
        });
    });

    it.skip('setItemValue()', function() {
      expect.fail('Test case not yet implemented.');
    });
  });

  describe.skip('Keep-alive test', function() {
    before('initialize hub test instance', async function() {
      this.hub = await BaliGateway.createHub(hubSerial, resolverStrategy)
        .then((hub) => hub.connect());
      console.log(`Connected to ${hubSerial}`);
    });
    after(function () {
      this.hub.disconnect();
    });

    it('connection-interrupt test', function(done) {
      console.log('Starting connection test - interrupt connection now');
      setTimeout(() => {
        done();
      }, 580 * 1000);

    }).timeout(600 * 1000);
  });
});