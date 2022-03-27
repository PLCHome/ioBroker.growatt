'use strict';

// TEST
/*
 * Created with @iobroker/create-adapter v1.26.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const api = require('growatt');
const utils = require('@iobroker/adapter-core');

// Load your modules here, e.g.:
// const fs = require("fs");

function getTime() {
  return new Date().getTime();
}
function getTimeDiff(start) {
  return getTime() - start;
}

class Growatt extends utils.Adapter {
  /**
   * @param {Partial<utils.AdapterOptions>} [options={}]
   */
  constructor(options) {
    super({
      ...options,
      name: 'growatt',
    });
    this.callTimeout = null;
    this.processTimeout = null;
    this.objNames = {};
    this.on('ready', this.onReady.bind(this));
    this.on('unload', this.onUnload.bind(this));
  }

  /**
   * Is called when databases are connected and adapter received configuration.
   */
  async onReady() {
    this.getForeignObject('system.config', (err, obj) => {
      this.config.objUpdate = this.config.objUpdate || {};
      this.getStates(this.name + '.' + this.instance + '.*', (err, states) => {
        for (var id in states) {
          let ebene = id.toString().split('.');
          ebene.shift();
          ebene.shift();
          if (ebene[0] != 'info' && ebene.length > 1) {
            let ownID = ebene.join('.');
            let ownIDsearch = ownID.toLowerCase();
            if (this.config.objUpdate[ownIDsearch] && this.config.objUpdate[ownIDsearch].action == 'delete') {
              this.delObject(ownID);
              this.log.info('deleted: ' + ownID);
            } else {
              if (
                (!this.config.weather && ebene.length > 1 && ebene[1].toLowerCase() == 'weather') ||
                (!this.config.totalData && ebene.length > 3 && ebene[3].toLowerCase() == 'totaldata') ||
                (!this.config.statusData && ebene.length > 3 && ebene[3].toLowerCase() == 'statusdata') ||
                (!this.config.plantData && ebene.length > 1 && ebene[1].toLowerCase() == 'plantdata') ||
                (!this.config.deviceData && ebene.length > 3 && ebene[3].toLowerCase() == 'devicedata') ||
                (!this.config.historyLast && ebene.length > 3 && ebene[3].toLowerCase() == 'historylast') ||
                (!this.config.chartLast && ebene.length > 3 && ebene[3].toLowerCase() == 'chart')
              ) {
                this.delObject(ownID);
                this.log.info('deleted: ' + ownID);
              } else if (this.objNames[ownIDsearch]) {
                this.log.warn(this.objNames[ownIDsearch] + ' exists twice: ' + ownID);
              } else if (
                ebene.length > 5 &&
                ebene[3].toLowerCase() == 'historylast' &&
                (ebene[4] == 'calendar' || ebene[4] == 'time') &&
                (ebene[5] == 'year' ||
                  ebene[5] == 'month' ||
                  ebene[5] == 'dayOfMonth' ||
                  ebene[5] == 'hourOfDay' ||
                  ebene[5] == 'minute' ||
                  ebene[5] == 'second')
              ) {
                this.delObject(ownID);
                this.log.info('deleted: ' + ownID);
              } else {
                this.objNames[ownIDsearch] = ownID;
              }
            }
          }
        }
      });
      if (!this.supportsFeature || !this.supportsFeature('ADAPTER_AUTO_DECRYPT_NATIVE')) {
        if (obj && obj.native && obj.native.secret) {
          this.config.password = this.decrypt(obj.native.secret, this.config.password);
          this.config.shareKey = this.decrypt(obj.native.secret, this.config.shareKey);
        } else {
          this.config.password = this.decrypt('Zgfr56gFe87jJOM', this.config.password);
          this.config.shareKey = this.decrypt('Zgfr56gFe87jJOM', this.config.shareKey);
        }
      }

      if (typeof this.config.webTimeout === 'undefined' || this.config.webTimeout == '') this.config.webTimeout = 60;
      if (typeof this.config.processTimeout === 'undefined' || this.config.processTimeout == '') this.config.processTimeout = 600;
      if (typeof this.config.sessionHold === 'undefined' || this.config.sessionHold == '') this.config.sessionHold = true;
      if (typeof this.config.sessionTime === 'undefined' || this.config.sessionTime == '') this.config.sessionTime = 0;
      if (typeof this.config.cycleTime === 'undefined' || this.config.cycleTime == '') this.config.cycleTime = 30;
      if (typeof this.config.errorCycleTime === 'undefined' || this.config.errorCycleTime == '') this.config.errorCycleTime = 120;

      this.callRun = true;
      this.growattData();
    });
  }

  /**
   * Is called to decrypt the Password
   * @param {key} the secret
   * @param {value} the encrypted password
   **/
  decrypt(key, value) {
    let result = '';
    for (let i = 0; i < value.length; ++i) {
      result += String.fromCharCode(key[i % key.length].charCodeAt(0) ^ value.charCodeAt(i));
    }
    return result;
  }

  /**
   * Is called when adapter shuts down - callback has to be called under any circumstances!
   * @param {() => void} callback
   */
  onUnload(callback) {
    try {
      this.callRun = false;
      clearTimeout(this.processTimeout);
      clearTimeout(this.callTimeout);
      this.growattLogout();
      this.setStateAsync('info.connection', { val: false, ack: true });

      callback();
    } catch (e) {
      callback();
    }
  }

  /**
   * Parses the data from the website into objects. Is called recrusively.
   * @param {object} plantData
   * @param {path} path to object
   * @param {key} the key in the object
   */
  async storeData(plantData, path, key) {
    let ele = path + key;
    let eleSearch = ele.toLowerCase();
    this.log.silly('ParseData for ' + ele);
    let data = plantData[key];
    if (typeof data === 'object') {
      this.parseData(data, ele + '.');
    } else {
      if (!(typeof this.config.objUpdate[eleSearch] === 'undefined') && this.config.objUpdate[eleSearch].action != 'normal') {
        return;
      }
      let objType = 'string';
      let objRole = 'value';
      if (key.toLowerCase().includes('name'.toLowerCase())) {
        data = data.toString();
      }
      if (typeof data === 'number') {
        objType = 'number';
      } else {
        data = data.toString();
        // Date: yyyy-mm-dd hh:mi:ss
        if (
          data.match('^\\d\\d\\d\\d-\\d\\d-\\d\\d \\d\\d:\\d\\d:\\d\\d$') ||
          data.match('^\\d\\d\\d\\d-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d\\.\\d\\d\\dZ$')
        ) {
          data = new Date(data).getTime();
          objType = 'number';
          objRole = 'value.time';
          // Date: yyyy-mm-dd hh:mi
        } else if (data.match('^\\d\\d\\d\\d-\\d\\d-\\d\\d \\d\\d:\\d\\d$')) {
          data = new Date(data + ':00').getTime();
          objType = 'number';
          objRole = 'value.time';
          // Date: yyyy-mm-dd
        } else if (data.match('^\\d\\d\\d\\d-\\d\\d-\\d\\d$')) {
          data = new Date(data).getTime();
          objType = 'number';
          objRole = 'date';
          // number: -123 or +123.45
        } else if (data.match('^(\\+|\\-)?\\d+(\\.\\d*)?$')) {
          data = parseFloat(data);
          objType = 'number';
          // json: {...} or [...]
        } else if (data.match('^({.*}|\\[.*\\])$')) {
          objRole = 'json';
          // boolean: true or false
        } else if (data.match('^(true)|(false)$')) {
          data = data === 'true';
          objType = 'boolean';
        }
      }
      if (typeof this.objNames[eleSearch] === 'undefined') {
        this.log.silly('Create object not exists ' + ele + ' type:' + objType + ' role:' + objRole);
        await this.setObjectNotExistsAsync(ele, {
          type: 'state',
          common: {
            name: key,
            type: objType,
            role: objRole,
            read: true,
            write: false,
          },
          native: {},
        }).catch(e => {
          this.log.error('setObjectNotExists:' + e);
        });
        this.log.info('added: ' + ele);
        this.objNames[eleSearch] = ele;
      }
      this.log.silly('Set value ' + this.objNames[eleSearch] + ':' + data);
      this.setStateAsync(this.objNames[eleSearch], { val: data, ack: true });
    }
  }

  /**
   * Parses the data from the website into objects. Is called recrusively.
   * @param {object} plantData
   * @param {path} path to object
   */
  async parseData(plantData, path) {
    if (plantData) {
      let keys = Object.keys(plantData);
      //Duplicate keys are transmitted, we try to filter them here.
      let processed = {};
      keys.forEach(key => {
        if (typeof processed[key.toLowerCase()] === 'undefined') {
          processed[key.toLowerCase()] = true;
          this.storeData(plantData, path, key);
        }
      });
    }
  }

  /**
   * Is Called to get Data
   */
  async growattLogout(ndel) {
    if (this.log && this.log.debug) this.log.debug('Enter growattLogout');
    let allTimeDiff = getTime();
    delete this.connectTime;
    let growatt = this.growatt;
    if (!ndel) delete this.growatt;
    if (typeof growatt !== 'undefined') {
      if (growatt.isConnected()) {
        await growatt.logout().catch(e => {});
      }
    }
    if (this.log && this.log.debug) 'Leave growattLogout :' + getTimeDiff(allTimeDiff) + 'ms';
  }

  lifeSignCallback() {
    this.log.debug('Enter lifeSignCallback ' + this.config.processTimeout * 1000 + 'ms');
    clearTimeout(this.processTimeout);
    if (this.callRun && this.config.processTimeout && this.config.processTimeout > 0) {
      this.processTimeout = setTimeout(
        (() => {
          this.growattLogout(true);
          this.log.warn('Process timeout reached');
          if (this.callRun) {
            clearTimeout(this.callTimeout);
            this.callTimeout = setTimeout(
              (() => {
                this.growattData();
              }).bind(this),
              this.config.errorCycleTime * 1000
            );
          }
        }).bind(this),
        this.config.processTimeout * 1000
      );
    }
  }

  /**
   * Is Called to get Data
   */
  async growattData() {
    this.log.debug('Enter growattData, Param: sessionHold:' + this.config.sessionHold);
    let allTimeDiff = getTime();
    let debugTimeDiff = getTime();
    let timeout = this.config.errorCycleTime * 1000;
    this.lifeSignCallback();
    try {
      if (typeof this.growatt === 'undefined') {
        this.log.debug('Growatt new API');
        this.growatt = new api({ timeout: this.config.webTimeout * 1000, lifeSignCallback: this.lifeSignCallback.bind(this) });
      }
      this.log.debug('Growatt isConnected() : ' + this.growatt.isConnected());
      if (!this.growatt.isConnected()) {
        if (this.config.keyLogin) {
          this.log.debug('Growatt share plant login');
          await this.growatt.sharePlantLogin(this.config.shareKey).catch(e => {
            this.log.warn('Login to share plant:' + (typeof e === 'object' ? JSON.stringify(e) : e));
          });
        } else {
          this.log.debug('Growatt login with user and password');
          await this.growatt.login(this.config.user, this.config.password).catch(e => {
            this.log.warn('Login:' + (typeof e === 'object' ? JSON.stringify(e) : e));
          });
        }
        this.log.debug('Growatt isConnected() : ' + this.growatt.isConnected());
        if (this.growatt.isConnected() && this.config.sessionHold) {
          this.connectTime = getTime();
        }
        this.log.debug('Growatt time for login : ' + getTimeDiff(debugTimeDiff) + 'ms');
        debugTimeDiff = getTime();
      }
      if (this.growatt.isConnected()) {
        let allPlantData = await this.growatt.getAllPlantData({
          weather: this.config.weather,
          totalData: this.config.totalData,
          statusData: this.config.statusData,
          plantData: this.config.plantData,
          deviceData: this.config.deviceData,
          historyLast: this.config.historyLast,
        });
        this.log.debug('Growatt time for allPlantData : ' + getTimeDiff(debugTimeDiff) + 'ms');
        debugTimeDiff = getTime();
        this.parseData(allPlantData, '');
        this.log.debug('Growatt time for parseData : ' + getTimeDiff(debugTimeDiff) + 'ms');
        debugTimeDiff = getTime();
        if (this.callRun) {
          this.setStateAsync('info.connection', { val: true, ack: true });
          timeout = this.config.cycleTime * 1000 - getTimeDiff(allTimeDiff);
          if (timeout < 100) {
            timeout = 100;
          }
        }
        return;
      } else {
        this.log.info('not connected');
        this.setStateAsync('info.connection', { val: false, ack: true });
      }
    } catch (e) {
      if (e.toString().toLowerCase().includes('errornologin')) {
        this.log.warn('Growatt Login: ' + e);
      } else {
        this.log.error('Growatt exception: ' + e);
      }
      this.setStateAsync('info.connection', { val: false, ack: true });
      this.growattLogout();
      if (this.supportsFeature && this.supportsFeature('PLUGINS')) {
        const sentryInstance = this.getPluginInstance('sentry');
        if (sentryInstance) {
          if (e.toString().toLowerCase().includes('errornologin')) {
            sentryInstance.getSentryObject().captureException(e);
          } else {
            sentryInstance.getSentryObject().captureException(e);
          }
        }
      }
    } finally {
      if (!this.config.sessionHold) {
        this.growattLogout();
      } else {
        if (
          typeof this.connectTime !== 'undefined' &&
          this.config.sessionTime > 0 &&
          getTimeDiff(this.connectTime) > this.config.sessionTime * 60000
        ) {
          this.log.debug('Connection time of the session reached');
          this.growattLogout();
        }
      }
      clearTimeout(this.processTimeout);
      clearTimeout(this.callTimeout);
      if (this.callRun) {
        this.callTimeout = setTimeout(
          (() => {
            this.growattData();
          }).bind(this),
          timeout
        );
      }
      this.log.debug('Leave growattData :' + getTimeDiff(allTimeDiff) + 'ms');
    }
  }
}

// @ts-ignore parent is a valid property on module
if (module.parent) {
  // Export the constructor in compact mode
  /**
   * @param {Partial<utils.AdapterOptions>} [options={}]
   */
  module.exports = options => new Growatt(options);
} else {
  // otherwise start the instance directly
  new Growatt();
}
