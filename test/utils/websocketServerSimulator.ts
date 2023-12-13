import { WebSocketServer } from 'ws';
import * as mockHttpServer from './baliHttpApiSimulator';

export class MockBaliWebsocketServer {
  private server: WebSocketServer;

  constructor() {
    this.server = new WebSocketServer({ port: 8080 });
  }

  public setup() {
    this.server.on('connection', socket => {
      socket.on('message', (data) => {
        const response = this.handleMessage(data.toString());
        socket.send(JSON.stringify(response));
      });
      socket.on('error', console.error);
    });
  }

  private handleMessage(data: string): any {
    const jsonData = JSON.parse(data);
    switch (jsonData['method']) {
      case 'loginUserMios':
        return this.loginUserMios(jsonData);
      case 'register':
        return this.register(jsonData);
      case 'hub.info.get':
        return { 'method': 'hub.info.get', 'id': jsonData.id, 'error': null, result: this.hubInfo() };
      case 'hub.scenes.list':
        return { 'method': 'hub.scenes.list', 'id': jsonData.id, 'error': null, result: { 'scenes': this.scenes() }};
      case 'hub.room.list':
        return { 'method': 'hub.rooms.list', 'id': jsonData.id, 'error': null, result: this.rooms() };
      case 'hub.items.list':
        return { 'method': 'hub.items.list', 'id': jsonData.id, 'error': null, result: { 'items': this.items(jsonData) }};
      case 'hub.devices.list':
        return { 'method': 'hub.devices.list', 'id': jsonData.id, 'error': null, result: { 'devices': this.devices(jsonData)} };
      default:
        console.log('unexpected method in request %s', jsonData);
        return {};
    }
  }

  public close() {
    this.server.close();
  }

  private loginUserMios(data: any): any {
    // Perform fake auth
    return { 'id': data.id, 'method': 'loginUserMios', 'error': null, 'result': {} };
  }

  private register(data: any): any {
    return { 'id': data.id, 'method': 'registered', 'error': null, 'result': {} };
  }

  private hubInfo(): any {
    return {
      'model': 'ATOM32',
      'architecture': 'esp32',
      'firmware': '0.8.537',
      'kernel': 'v4.1-rc-4-gbd72a9ab2',
      'hardware': 'rev1',
      'serial': mockHttpServer.fakeHubIdentity,
      'build': {
        'time': '2021-02-26T13:54:29+0000',
        'builder': 'root@2ee9b1df7da3',
        'branch': 'HEAD',
        'commit': '3b0747976c6342f064a6edf31f3b1cad5378f673',
      },
      'uptime': '167d 3h 42m 3s',
      'localtime': '2023-12-11T14:54:24-0700',
      'location': {
        'latitude': 39.83385,
        'longitude': -74.87183,
        'timezone': 'America/Denver',
        'state': 'customTimezone',
      },
    };
  }

  private items(data: any): any {
    // Returns dimmer and battery item's list for two different devices
    const myItems = [
      {
        _id: '69E588B3',
        deviceId: 'ZCAEA8A46',
        hasGetter: true,
        hasSetter: true,
        name: 'dimmer',
        show: true,
        valueType: 'int',
        value: 100,
        minValue: 0,
        maxValue: 100,
        status: 'synced',
      },
      {
        _id: '36932F16',
        deviceId: 'ZCAEA8A46',
        hasGetter: true,
        hasSetter: false,
        name: 'battery',
        show: true,
        valueType: 'int',
        value: 42,
        status: 'synced',
      },
      {
        _id: '9D4541D1',
        deviceId: 'Z10E940B4',
        hasGetter: true,
        hasSetter: false,
        name: 'battery',
        show: true,
        valueType: 'int',
        value: 40,
        status: 'synced',
      },
      {
        _id: '8FA30866',
        deviceId: 'Z10E940B4',
        hasGetter: true,
        hasSetter: true,
        name: 'dimmer',
        show: true,
        valueType: 'int',
        value: 100,
        minValue: 0,
        maxValue: 100,
        status: 'synced',
      },
    ];

    if (data.params.deviceIds) {
      return myItems.filter((d) => data.params.deviceIds.includes(d.deviceId));
    } else {
      return myItems;
    }
  }

  private scenes(): any {
    return [
      {
        _id: 'scene_ABC123',
        enabled: true,
        name: 'raise blinds',
      },
      {
        _id: 'scene_E17F60C53CFD8F02',
        enabled: true,
        name: 'nighty night',
        // Much of a real scene response is removed for this test class
      },
    ];
  }

  private rooms(): any {
    return [{ _id: '74102315', name: 'Kitchen' }];
  }

  private devices(data: any): any {
    const myDevices = [
      {
        _id: 'ZCAEA8A46',
        deviceTypeId: '622_21075_23089',
        parentDeviceId: '',
        category: 'window_cov',
        subcategory: 'window_cov',
        gatewayId: 'zwave',
        name: 'Shade D',
        type: 'shutter.roller',
        batteryPowered: true,
        reachable: true,
        persistent: false,
        serviceNotification: false,
        roomId: '74102315',
        security: 'no',
        ready: true,
        status: 'idle',
        info: {
          'firmware.stack': '6.8',
          hardware: '255',
          manufacturer: 'Springs Window Fashions',
          model: 'RSZ1',
          protocol: 'zwave',
          'zwave.node': '3',
          'zwave.smartstart': 'no',
        },
      },
      {
        _id: 'Z10E940B4',
        deviceTypeId: '622_21075_23089',
        parentDeviceId: '',
        category: 'window_cov',
        subcategory: 'window_cov',
        gatewayId: 'zwave',
        name: 'Shade C',
        type: 'shutter.roller',
        batteryPowered: true,
        reachable: true,
        persistent: false,
        serviceNotification: false,
        roomId: '74102315',
        security: 'no',
        ready: true,
        status: 'idle',
        info: {
          'firmware.stack': '6.8',
          hardware: '255',
          manufacturer: 'Springs Window Fashions',
          model: 'RSZ1',
          protocol: 'zwave',
          'zwave.node': '4',
          'zwave.smartstart': 'no',
        },
      },
    ];

    if (data.params.deviceIds) {
      return myDevices.filter((d) => data.params.deviceIds.includes(d._id));
    } else {
      return myDevices;
    }
  }
}