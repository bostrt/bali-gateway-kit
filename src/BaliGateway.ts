/* eslint-disable no-console */
import { CredentialsResolver, ServerRelayCredentials } from './BaliCredentials';
import { Mutex } from 'async-mutex';

import WebSocket from 'ws';
const WebSocketAsPromised = require('websocket-as-promised');

export declare type EzloIdentifier = string;
export declare type HubIdentifier = EzloIdentifier;
export declare type Message = Record<string, any>;
export declare type ObservationHandler = (message: Message) => void;
export declare type MessagePredicate = (message: Message) => boolean;

export const UIBroadcastPredicate: MessagePredicate = (msg: Message) => msg.id === 'ui_broadcast';

export const UIBroadcastRunScenePredicate: MessagePredicate = (msg: Message) =>
  UIBroadcastPredicate(msg) && msg.msg_subclass === 'hub.scene.run.progress';

export const UIBroadcastRunSceneDonePredicate: MessagePredicate = (msg: Message) =>
  UIBroadcastRunScenePredicate(msg) && msg.result?.status === 'finished';

interface Observer {
  readonly predicate: MessagePredicate;
  readonly handler: ObservationHandler;
}

export class BaliGateway {
  public identity!: HubIdentifier;
  private _isConnected = false;
  private wsp: typeof WebSocketAsPromised;
  private observers: Observer[] = [];
  private keepAliveDelegate!: KeepAliveAgent;
  private credentials!: ServerRelayCredentials;
  private connectMutex: Mutex = new Mutex();

  constructor(private credentialsResolver: CredentialsResolver, private hubSerial: HubIdentifier) {
  }

  private compareCredentials(a: ServerRelayCredentials, b: ServerRelayCredentials): boolean {
    if (!a || !b) {
      return false;
    }
    return a.hubIdentity === b.hubIdentity && a.signature === b.signature && a.token === b.token && 
      a.url === b.url;
  }

  public async initialize() {
    const newCredentials = await this.credentialsResolver.credentials(this.hubSerial);
    if (this.compareCredentials(newCredentials, this.credentials)) {
      return;
    }

    if (this.keepAliveDelegate) {
      this.keepAliveDelegate.stopHeartbeat();
    }

    if (this.wsp) {
      await this._disconnect();
    }

    this.credentials = newCredentials;
    this.identity = this.credentials.hubIdentity;
    // Create the websocket and register observer dispatch handlers
    // NOTE: Override ECC ciphers to prevent over-burdening crytpo on Atom w/ESP32
    this.wsp = new WebSocketAsPromised(this.credentials.url, {
      createWebSocket: (url: string) => new WebSocket(url, { rejectUnauthorized: false, ciphers: 'AES256-SHA256' }),
      extractMessageData: (event: unknown) => event,
      packMessage: (data: unknown) => JSON.stringify(data),
      unpackMessage: (data: string) => deserialize(data, this.identity),
      attachRequestId: (data: unknown, requestId: string|number) => Object.assign({ id: requestId }, data),
      extractRequestId: (data: Record<string, string|number>) => data && data.id,
    });

    this.keepAliveDelegate = new KeepAliveAgent(this, this.wsp);
    this.wsp.onUnpackedMessage.addListener((message: Message) => this.notifyObservers(message));

    // TO-DO - Remove once Ezlo fixes ATOM2 bug to always return properly-formed JSON
    function deserialize(data: string, hub: EzloIdentifier): any {
      try {
        const obj = JSON.parse(data);
        return obj;
      } catch (e) {
        throw new Error(`Invalid JSON response from hub ${hub} - ${data} - err: ${e}`);
      }
    }
  }

  /**
   * Creates a hub instance given a hub serial number and a credentials resolver
   *
   * @param hubSerial - the serial number for the hub
   * @param credentialsResolver - a credentials resolver that provides the credentials for the
   * given serial number
   * @returns EzloHub instance
   */
  static async createHub(hubSerial: HubIdentifier, credentialsResolver: CredentialsResolver): Promise<BaliGateway> {
    try {
      const gateway = new BaliGateway(credentialsResolver, hubSerial);
      await gateway.initialize();
      return gateway;
    } catch(err) {
      console.log('Failed to instantiate bali gateway due to error: ', err);
      throw err;
    }
  }

  /**
   * Establishes a local authenticated secure websocket connection with the ezlo hub
   *
   * Note, EzloHub automatically manages the connection state.  Application developers
   * do not need to invoke this method.  It is declared public purely for unit testing.
   *
   * @returns {Promise<BaliGateway>} hub instance that connected.
   */
  async connect(): Promise<BaliGateway> {
    const release = await this.connectMutex.acquire();
    await this.initialize();

    if (this._isConnected === true) {
      return Promise.resolve(this).finally(release);
    }

    return new Promise((resolve, reject) => {
      this.wsp.open()
        .then(() => {
          return this.wsp.sendRequest({method: 'loginUserMios',
            params: { PK_Device: this.credentials.hubIdentity, MMSAuthSig: this.credentials.signature, MMSAuth: this.credentials.token }});
        })
        .then((response: any) => {
          if (response.error !== null && response.error.data !== 'user.login.alreadylogged') {
            reject(new Error(`Login failed for ${this.credentials.url} due to error ${response.error.data}`));
          }
        })
        .then(() => {
          return this.wsp.sendRequest({method: 'register',
            params: {serial: this.credentials.hubIdentity}})
        })
        .then((response: any) => {
          if (response.error !== null) {
            reject(new Error(`Device registration failed due to ${response.error.data}`));
          }
          this._isConnected = true;
          resolve(this);
        })
        .catch(err => {
          reject(new Error(`Login failed - unable to connect to ${this.credentials.url} due to error ${err}`));
        })
        .finally(() => {
          release();
        });
    });
  }

  /**
   * Terminates secure websocket connection
   *
   * NOTE:  Apps should call this to dispose of resources when the
   * EzloHub instance is no longer needed.
   *
   * @return Promise<void> - disconnect complete
   */
  public async disconnect(): Promise<void> {
    return this.connectMutex.acquire()
      .then((release) => {
        this._disconnect().finally(release);
      });
  }

  private _disconnect(): Promise<void> {
    this._isConnected = false;
    return this.wsp.close();
  }

  /**
   * Connected/disconnected
   *
   * @returns {boolean} Connected = true, not yet connected/disconnected = false.
   */
  public isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Information about the hub such as architecture, build, model, serial #, etc.
   *
   * @returns an info object
   */
  public info(): Promise<Record<string, unknown>> {
    return this.sendRequest({ method: 'hub.info.get', params: {} });
  }

  /**
   * Hub data (devices, items, scenes)
   * 
   * This appears to make Ezlo Hub version 100 (ATOM32) crash hence being a private method. 
   * TODO: Consider deleting this. 
   *
   * @returns collection of devices, items, rooms and scenes
   */
  private data(): Promise<Array<any>> {
    const request = {
      method: 'hub.data.list',
      'params': {
        'devices':{
          'ids':[], 'fields': { 'include':[] },
        },
        'items':{
          'ids':[], 'fields': { 'include':[] },
        },
        'rooms':{
          'ids':[], 'fields': { 'include':[] },
        },
        'scenes':{
          'ids':[], 'fields': { 'include':[] },
        },
      },
    };
    return this.sendRequest(request);
  }

  /**
   * Devices paired with the hub
   *
   * @returns collection of devices
   */
  public devices(): Promise<Array<any>> {
    return this.sendRequest({ method: 'hub.devices.list', params: {} }).then(res => res.devices);
  }

  /**
   * Device with name
   *
   * @param name - device name
   * @returns devices with name
   */
  public device(name: EzloIdentifier): Promise<EzloIdentifier> {
    return this.devices().then(devices => devices.filter(dev => dev.name === name)[0]);
  }

  /**
   * Collection of items, optionally limited to a device
   *
   * @param EzloIdentifier - optional, only return items for device 'id'
   * @returns collection of items
   */
  public items(device?: EzloIdentifier): Promise<any[]> {
    const request = {
      method: 'hub.items.list',
      params: {},
    };
    if (device) {
      request.params = {deviceIds: [device]};
    }
    return this.sendRequest(request).then(res => res.items);
  }

  /**
   * Collection of items with name, optionally limited to a device
   *
   * @param device - optional, only return items for device 'id'
   * @returns collection of items | undefined if no items with name exist
   */
  public item(name: EzloIdentifier, device?: EzloIdentifier): Promise<any[]> {
    return this.items(device).then(items => items.filter(item => item.name === name));
  }

  /**
   * Scenes collection
   *
   * @returns collection of scenes | undefined if no scenes exist on hub
   */
  public scenes(): Promise<Array<any>> {
    return this.sendRequest({ method: 'hub.scenes.list', params: {} }).then(res => res.scenes);
  }

  /**
   * Scene with name
   *
   * @param name - scene name
   * @returns scene | undefined if scene with name doesn't exist
   */
  public scene(name: string): Promise<Record<EzloIdentifier, unknown>> {
    return this.scenes().then(scenes => scenes.filter(scn => scn.name === name)[0]);
  }

  /**
   * Room collection
   *
   * @returns collection of rooms
   */
  public rooms(): Promise<any[]> {
    return this.sendRequest({ method: 'hub.room.list', params: {} }).then(res => res);
  }

  /**
   * Room with name
   *
   * @param name - name of room
   * @returns room with name | undefined if room with name doesn't exist
   */
  public room(name: EzloIdentifier): Promise<EzloIdentifier> {
    return this.rooms().then(rooms => rooms.filter(room => room.name === name)[0]);
  }

  /**
   * Network Interface objects for the hub
   *
   * @return collection of network interfaces
   */
  public networkInterfaces(): Promise<Array<any>> {
    return this.sendRequest({method: 'hub.network.get', params: {} }).then(res => res.interfaces);
  }

  /**
   * Set the value for one or more items.  In the case of multiple items,
   * a z-wave multicast message will be sent to the list of items
   *
   * @param items - items for which to set value
   * @param value - the value to set on item
   */
  public setItemValue(items: EzloIdentifier | [EzloIdentifier], value: unknown): Promise<any> {
    let params;
    if (typeof items === 'string') {
      params = {_id: items, value: value};
    } else {
      params = {ids: items, value: value};  //multicast
    }
    return this.sendRequest({method: 'hub.item.value.set', params: params});
  }

  /**
   * Run a scene
   *
   * This method runs a scene returning a promise that resolves to the requested Scene id once the
   * hub acknowledges that the scene execution is done.
   *
   * @param scene - scene identifier
   * @returns msg - response result from json rpc request
   */
  public runScene(scene: EzloIdentifier): Promise<EzloIdentifier> {
    return new Promise((resolve, reject) => {
      let expiry: NodeJS.Timeout;

      // Observe Scene completion for this scene
      const sceneCompletePredicate = (msg: Message) => UIBroadcastRunSceneDonePredicate(msg) && msg.result?.scene_id === scene;
      const completionObserver = this.addObserver(sceneCompletePredicate, (msg) => {
        clearTimeout(expiry);
        this.removeObserver(completionObserver);
        resolve(msg.result.scene_id);
      });

      // Run the scene
      this.sendRequest({method: 'hub.scenes.run', params: { sceneId: scene} })
        .then((result) => {
          expiry = setTimeout(() => {
            this.removeObserver(completionObserver);
            clearTimeout(expiry);
            reject(new Error(`Hub ${this.identity} did not acknowlege Scene ${result.scene_id} completion within 60 seconds`));
          }, 60 * 1000);
        })
        .catch(err => reject(err));
    });
  }

  /**
   * Register an observer of a given message using an introspection predicate
   *
   * @param predicate - represents the messages of interest
   * @param handler - callback to invoke when the predicate is true
   * @returns Observer instance constructed with predictate and handler (convenience for removeObserver)
   */
  public addObserver(predicate: MessagePredicate, handler: ObservationHandler): Observer {
    const observer: Observer = { predicate: predicate, handler: handler };
    this.observers.push( observer );
    return observer;
  }

  /**
   * Remove an observer
   *
   * @param predicate - represents the messages of interest
   * @param handler - callback to invoke when the predicate is true
   */
  public removeObserver(observer: Observer) {
    return this.observers.filter(elem => elem !== observer);
  }

  /**
   * Notifies subscribed observers when the registered predicate is true
   *
   * @param message - message to evaluate against registered predicates
   */
  private notifyObservers(message: Message): void {
    this.observers.filter(observer => observer.predicate( message ))
      .forEach(observer => observer.handler(message));
  }

  /**
   * Override object description to return hub identity
   */
  public toString = (): string => this.identity;

  /**
   * Send a json-rpc request to the hub and parse the result
   *
   * @param request - json-rpc request object
   * @returns the json parsed result object from the response json.
   */
  private sendRequest(request: Record<string, unknown>): Promise<any> {
    return new Promise((resolve, reject) => {
      this.connect()
        .then(() => this.wsp.sendRequest(request))
        .then((response) => {
          if (response.error !== null) {
            return reject(
              new Error(`Request to ${this.identity} failed with ${response.error.data} - Request: ${JSON.stringify(request)}`),
            );
          }
          resolve(response.result);
        })
        .catch(err => {
          console.log('Request to %s failed: %O\nResult: %O', this, request, err);
          reject(new Error(`Request to ${this.identity} failed due to error ${err}`));
        });
    });
  }
}

/**
 * Hub Connection Keep Alive Agent
 *
 * Re-establish the hub connection if remote-hub pings cease
 */
class KeepAliveAgent {
  private pingExpiry?: NodeJS.Timeout = undefined;
  private reconnectInterval?: NodeJS.Timeout = undefined;

  constructor(private hub: BaliGateway, private wsp: typeof WebSocketAsPromised) {
    wsp.onOpen.addListener(() => this.startHeartbeat());
  }

  /**
   * Ensure the physical hub pings within 60 seconds (normative is 20).
   * If not, disconnect and start the reconnect interval.
   */
  private startHeartbeat() {
    const heartbeat = () => {
      this.pingExpiry && clearTimeout(this.pingExpiry!);
      this.pingExpiry = setTimeout(() => {
        console.log(`Connection with ${this.hub.identity} dormant... attempting to reconnect.`);
        this.hub.disconnect()
          .then(() => this.reconnect());
      }, 60 * 1000).unref();
    };

    // Guard single Keep-alive for the lifecycle of a connection
    if (this.pingExpiry === undefined) {
      this.wsp.ws.on('ping', heartbeat);
      heartbeat();
    }
  }

  /**
   * Attempt to reconnect every 5 seconds until the connection is
   * re-established at which point the reconnect interval is terminated.
   */
  private reconnect() {
    console.log('Attempting reconnect');
    this.stopHeartbeat();
    let reconnectInProgress = false;
    this.reconnectInterval = setInterval(() => {
      if (!reconnectInProgress && !this.hub.isConnected()) {
        reconnectInProgress = true;
        this.hub.connect()
          .then(() => {
            clearInterval(this.reconnectInterval!);
            console.log(`Reconnected to ${this.hub.identity}`);
          })
          .catch(err => {
            reconnectInProgress = false;
            console.log(`Reconnect attempt failed due to ${err} - will retry`);
          });
      }
    }, 5 * 1000);
  }

  public stopHeartbeat() {
    clearInterval(this.pingExpiry!);
    this.pingExpiry = undefined;
  }
}