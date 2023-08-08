/*
 * Created with @iobroker/create-adapter v1.26.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const API = require('growatt');
const utils = require('@iobroker/adapter-core');

const growartyp = {
  INUM_0_100: { type: 'number', role: 'value', min: 0, max: 100, step: 1, read: true, write: true },
  INUM_0_24: { type: 'number', role: 'value', min: 0, max: 24, step: 1, read: true, write: true },
  INUM_0_60: { type: 'number', role: 'value', min: 0, max: 60, step: 1, read: true, write: true },
  BOOL: { type: 'boolean', role: 'value', read: true, write: true },
  STIME_H_MIN: { type: 'string', role: 'value', read: true, write: true },
  DATETIME: { type: 'number', role: 'value.time', read: true, write: true },
  INUM_0_1: { type: 'number', role: 'value', min: 0, max: 1, step: 1, read: true, write: true },
};
const SETTINGS = 'settings';

// Load your modules here, e.g.:
// const fs = require("fs");

function getTime() {
  return new Date().getTime();
}
function getTimeDiff(start) {
  return getTime() - start;
}
const getJSONCircularReplacer = () => {
  const seen = new WeakMap();
  return (key, val) => {
    const value = val;
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return `loop on ${seen.get(value)}`;
      }
      seen.set(value, key);
    }
    return value;
  };
};

/**
 * Is called to decrypt the Password
 * @param {key} the secret
 * @param {value} the encrypted password
 * */
function decrypt(key, value) {
  let result = '';
  for (let i = 0; i < value.length; i += 1) {
    /* eslint-disable-next-line no-bitwise */
    result += String.fromCharCode(key[i % key.length].charCodeAt(0) ^ value.charCodeAt(i));
  }
  return result;
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
    this.on('stateChange', this.onStateChange.bind(this));
    this.on('unload', this.onUnload.bind(this));
    this.on('message', this.onMessage.bind(this));
  }

  /**
   * Is called when databases are connected and adapter received configuration.
   */
  async onReady() {
    this.getForeignObject('system.config', (errFO, obj) => {
      this.config.objUpdate = this.config.objUpdate || {};
      this.config.objOffset = this.config.objOffset || {};
      // ! for stateChange
      this.subscribeStates('*.read');
      this.subscribeStates('*.write');

      if (!this.supportsFeature || !this.supportsFeature('ADAPTER_AUTO_DECRYPT_NATIVE')) {
        if (obj && obj.native && obj.native.secret) {
          this.config.password = decrypt(obj.native.secret, this.config.password);
          this.config.shareKey = decrypt(obj.native.secret, this.config.shareKey);
        } else {
          this.config.password = decrypt('Zgfr56gFe87jJOM', this.config.password);
          this.config.shareKey = decrypt('Zgfr56gFe87jJOM', this.config.shareKey);
        }
      }

      if (typeof this.config.webTimeout === 'undefined' || this.config.webTimeout === '') this.config.webTimeout = 60;
      if (typeof this.config.processTimeout === 'undefined' || this.config.processTimeout === '') this.config.processTimeout = 600;
      if (typeof this.config.sessionHold === 'undefined' || this.config.sessionHold === '') this.config.sessionHold = true;
      if (typeof this.config.sessionTime === 'undefined' || this.config.sessionTime === '') this.config.sessionTime = 0;
      if (typeof this.config.cycleTime === 'undefined' || this.config.cycleTime === '') this.config.cycleTime = 30;
      if (typeof this.config.errorCycleTime === 'undefined' || this.config.errorCycleTime === '') this.config.errorCycleTime = 120;
      if (typeof this.config.indexCandI === 'undefined' || this.config.indexCandI === '') this.config.indexCandI = false;

      this.getStates(`${this.name}.${this.instance}.*`, (errGS, states) => {
        Object.keys(states).forEach(id => {
          const ebene = id.toString().split('.');
          ebene.shift();
          ebene.shift();
          if (ebene[0] !== 'info' && ebene[3] !== SETTINGS && ebene.length > 1) {
            const ownID = ebene.join('.');
            const ownIDsearch = ownID.toLowerCase();
            if (this.config.objUpdate[ownIDsearch] && this.config.objUpdate[ownIDsearch].action === 'delete') {
              this.delObject(ownID);
              this.log.info(`deleted: ${ownID}`);
            } else if (
              (!this.config.weather && ebene.length > 1 && ebene[1].toLowerCase() === 'weather') ||
              (!this.config.totalData && ebene.length > 3 && ebene[3].toLowerCase() === 'totaldata') ||
              (!this.config.statusData && ebene.length > 3 && ebene[3].toLowerCase() === 'statusdata') ||
              (!this.config.plantData && ebene.length > 1 && ebene[1].toLowerCase() === 'plantdata') ||
              (!this.config.deviceData && ebene.length > 3 && ebene[3].toLowerCase() === 'devicedata') ||
              (!this.config.historyLast && ebene.length > 3 && ebene[3].toLowerCase() === 'historylast') ||
              (!this.config.chartLast && ebene.length > 3 && ebene[3].toLowerCase() === 'chart')
            ) {
              this.delObject(ownID);
              this.log.info(`deleted: ${ownID}`);
            } else if (this.objNames[ownIDsearch]) {
              this.log.warn(`${this.objNames[ownIDsearch]} exists twice: ${ownID}`);
            } else if (
              ebene.length > 5 &&
              ebene[3].toLowerCase() === 'historylast' &&
              (ebene[4] === 'calendar' || ebene[4] === 'time') &&
              (ebene[5] === 'year' ||
                ebene[5] === 'month' ||
                ebene[5] === 'dayOfMonth' ||
                ebene[5] === 'hourOfDay' ||
                ebene[5] === 'minute' ||
                ebene[5] === 'second')
            ) {
              this.delObject(ownID);
              this.log.info(`deleted: ${ownID}`);
            } else {
              this.objNames[ownIDsearch] = ownID;
            }
          } else if (!this.config.settings && ebene.length > 1 && ebene[3] === SETTINGS) {
            const ownID = ebene.join('.');
            this.delObject(ownID);
            this.log.info(`deleted: ${ownID}`);
          }
        });
        this.callRun = true;
        this.growattData();
      });
    });
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
    const ele = path + key;
    const eleSearch = ele.toLowerCase();
    this.log.silly(`storeData for ${ele}`);
    let data = plantData[key];
    if (typeof data === 'object') {
      this.parseData(data, `${ele}.`);
    } else {
      if (!(typeof this.config.objUpdate[eleSearch] === 'undefined') && this.config.objUpdate[eleSearch].action !== 'normal') {
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
          data = new Date(`${data}:00`).getTime();
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
      if (objType === 'number' && !(typeof this.config.objOffset[eleSearch] === 'undefined') && this.config.objOffset[eleSearch].offset) {
        data += this.config.objOffset[eleSearch].offset;
      }
      if (typeof this.objNames[eleSearch] === 'undefined') {
        this.log.silly(`Create object not exists ${ele} type:${objType} role:${objRole}`);
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
          this.log.error(`setObjectNotExists:${e}`);
        });
        this.log.info(`added: ${ele}`);
        this.objNames[eleSearch] = ele;
      }
      this.log.silly(`Set value ${this.objNames[eleSearch]} type ${objType} : ${data}`);
      this.setStateAsync(this.objNames[eleSearch], { val: data, ack: true });
    }
  }

  /**
   * 
   loads the settings of the inverter and pastes the settings.
   * @param {string} path to id
   * @param {string} growattType
   * @param {string} setting
   * @param {string} sn
   */
  async readSetting(path, growattType, setting, sn) {
    if (this.growatt) {
      this.growatt
        .getInverterSetting(growattType, setting, sn)
        .then(r => {
          this.log.debug(`Read inverter setting ${setting} : ${JSON.stringify(r, getJSONCircularReplacer())}`);
          if (r.success) {
            const params = Object.keys(r);
            params.forEach(p => {
              if (p.startsWith('param')) {
                this.setStateAsync(`${path}.values.${p}`, { val: r[p], ack: true });
              }
            });
          }
          this.setStateAsync(`${path}.read`, { val: r.success, ack: true });
        })
        .catch(e => {
          this.log.warn(`Read inverter settings ${setting}:${e}`);
        });
    }
  }

  /**
   * 
   writes the settings to the inverter.
   * @param {string} path to id
   * @param {string} growattType
   * @param {string} setting
   * @param {string} sn
   * @param {object param} set
   */
  async writeSetting(path, growattType, setting, sn, set) {
    if (this.growatt && set && set.param) {
      const runState = [];
      const values = {};
      const paramKeys = Object.keys(set.param);
      paramKeys.forEach(param => {
        runState.push(
          this.getStateAsync(`${path}.values.${param}`).then(s => {
            values[param] = s.val;
          })
        );
      });
      await Promise.all(runState);
      this.growatt
        .setInverterSetting(growattType, setting, sn, values)
        .then(a => {
          this.setStateAsync(`${path}.write`, { val: a.success, ack: true });
          this.setStateAsync(`${path}.msg`, { val: a.msg, ack: true });
          this.log.debug(`${typeof a === 'object' ? JSON.stringify(a, getJSONCircularReplacer()) : a}`);
          if (a.success) {
            this.readSetting(path, growattType, setting, sn);
          }
        })
        .catch(e => {
          this.setStateAsync(`${path}.write`, { val: false, ack: true });
          this.setStateAsync(`${path}.msg`, { val: `${e}`, ack: true });
        });
      this.log.debug(`write inverter setting ${growattType}, ${setting}, ${sn}, ${JSON.stringify(values, getJSONCircularReplacer())}`);
    }
  }

  /**
   * Called when a subscribed status changes
   * @param {string} id
   * @param {ioBroker.State | null | undefined} state
   */
  async onStateChange(id, state) {
    if (state) {
      if (!state.ack && state.val === true) {
        const obj = await this.getObjectAsync(id);
        const splitid = id.split('.');
        splitid.pop();
        const path = splitid.join('.');
        if (obj.native && obj.native.action === 'read') {
          this.readSetting(path, obj.native.growattType, obj.native.setting, obj.native.sn);
          if (obj.native.set && obj.native.set.subRead) {
            obj.native.set.subRead.forEach(read => {
              this.readSetting(path, obj.native.growattType, read, obj.native.sn);
            });
          }
        } else if (obj.native && obj.native.action === 'write') {
          this.writeSetting(path, obj.native.growattType, obj.native.setting, obj.native.sn, obj.native.set);
        }
      }
    }
  }

  /**
   * 
   loads the settings of the inverter and pastes the settings.
   * @param {object} plantData
   */
  async loadSettings(plantDatas) {
    /**
     Creates an iobroker state or update the properties
     * @param {this} t
     * @param {string} ele
     * @param {string} name
     * @param {object} common
     * @param {any} def
     * @param {object} native
     */
    function createS(t, ele, name, common, def, native) {
      t.log.silly(`Create object not exists ${ele} type:${common} def:${def} native:${native}`);
      const o = {
        type: 'state',
        common: {
          name,
        },
        native: {},
      };
      Object.assign(o.common, common);
      if (typeof def !== 'undefined' && def !== null) {
        o.common.def = def;
      }
      if (typeof native !== 'undefined' && native !== null) {
        Object.assign(o.native, native);
      }
      t.setObjectNotExists(ele, o);
      t.setObject(ele, o);
    }
    /**
     Creates an iobroker channel or update the properties
     * @param {this} t
     * @param {string} ele
     * @param {string} name
     */
    function createC(t, ele, name) {
      t.log.silly(`Create object not exists ${ele} `);
      const o = {
        type: 'channel',
        common: {
          name,
        },
        native: {},
      };
      t.setObjectNotExists(ele, o);
      t.setObject(ele, o);
    }
    if (plantDatas) {
      const plantDataKeys = Object.keys(plantDatas);
      plantDataKeys.forEach(plantDataKey => {
        const plantData = plantDatas[plantDataKey];
        if (plantData.devices) {
          const snKeys = Object.keys(plantData.devices);
          if (snKeys) {
            snKeys.forEach(sn => {
              if (plantData.devices[sn].growattType) {
                const { growattType } = plantData.devices[sn];
                const path = `${plantDataKey}.devices.${sn}.${SETTINGS}.`;
                if (this.growatt) {
                  const com = this.growatt.getInverterCommunication(growattType);
                  if (com) {
                    const sets = Object.keys(com);
                    sets.forEach(setting => {
                      const set = com[setting];
                      this.log.silly(`getInverterCommunication ${path} answers ${setting} ${JSON.stringify(set, getJSONCircularReplacer())}`);
                      if (!set.isSubread) {
                        createC(this, path + setting, set.name);
                        createS(
                          this,
                          `${path + setting}.write`,
                          'Write to the inverter',
                          { type: 'boolean', role: 'value', read: true, write: true },
                          false,
                          {
                            set,
                            sn,
                            growattType,
                            setting,
                            action: 'write',
                          }
                        );
                        createS(
                          this,
                          `${path + setting}.read`,
                          'read from the inverter',
                          { type: 'boolean', role: 'value', read: true, write: true },
                          false,
                          {
                            set,
                            sn,
                            growattType,
                            setting,
                            action: 'read',
                          }
                        );
                        createS(this, `${path + setting}.msg`, 'answer for write from the inverter', {
                          type: 'string',
                          role: 'value',
                          read: true,
                          write: false,
                        });
                        const paramKeys = Object.keys(set.param);
                        paramKeys.forEach(param => {
                          const p = set.param[param];
                          const t = growartyp[p.type];
                          if (t) {
                            if (p.values) {
                              t.states = {};
                              Object.assign(t.states, p.values);
                            }
                            if (p.unit) {
                              t.unit = p.unit;
                            }
                            createS(this, `${path + setting}.values.${param}`, p.name, t, p.def);
                          }
                        });
                        this.readSetting(path + setting, growattType, setting, sn);
                      } else {
                        this.readSetting(path + set.isSubread, growattType, setting, sn);
                      }
                    });
                  }
                }
              }
            });
          }
        }
      });
    }
  }

  /**
   * Parses the data from the website into objects. Is called recrusively.
   * @param {object} plantData
   * @param {path} path to object
   */
  async parseData(plantData, path) {
    if (plantData) {
      const keys = Object.keys(plantData);
      // Duplicate keys are transmitted, we try to filter them here.
      const processed = {};
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
   * @param {bool} ndel no delete
   */
  async growattLogout(ndel) {
    if (this.log && this.log.debug) this.log.debug('Enter growattLogout');
    const allTimeDiff = getTime();
    delete this.connectTime;
    const { growatt } = this;
    if (!ndel) delete this.growatt;
    if (typeof growatt !== 'undefined') {
      if (growatt.isConnected()) {
        await growatt.logout().catch({});
      }
    }
    if (this.log && this.log.debug) this.log.debug(`Leave growattLogout :${getTimeDiff(allTimeDiff)}ms`);
  }

  /**
   * Is Called to get a lifesign
   */
  lifeSignCallback() {
    this.log.debug(`Enter lifeSignCallback ${this.config.processTimeout * 1000}ms`);
    clearTimeout(this.processTimeout);
    if (this.callRun && this.config.processTimeout && this.config.processTimeout > 0) {
      this.processTimeout = setTimeout(() => {
        this.growattLogout(true);
        this.log.warn('Process timeout reached');
        if (this.callRun) {
          clearTimeout(this.callTimeout);
          this.callTimeout = setTimeout(() => {
            this.growattData();
          }, this.config.errorCycleTime * 1000);
        }
      }, this.config.processTimeout * 1000);
    }
  }

  /**
   * Is Called to get Data
   */
  async growattData() {
    this.log.debug(`Enter growattData, Param: sessionHold:${this.config.sessionHold}`);
    const allTimeDiff = getTime();
    let debugTimeDiff = getTime();
    let afterConnect = false;
    let timeout = this.config.errorCycleTime * 1000;
    this.lifeSignCallback();
    try {
      if (typeof this.growatt === 'undefined') {
        this.log.debug('Growatt new API');
        /* eslint-disable-next-line no-new */
        this.growatt = new API({
          timeout: this.config.webTimeout * 1000,
          lifeSignCallback: this.lifeSignCallback.bind(this),
          server: this.config.growattServer || '',
          indexCandI: this.config.indexCandI,
        });
      }
      this.log.debug(`Growatt isConnected() : ${this.growatt.isConnected()}`);
      if (!this.growatt.isConnected()) {
        afterConnect = true;
        if (this.config.keyLogin) {
          this.log.debug('Growatt share plant login');
          await this.growatt.sharePlantLogin(this.config.shareKey).catch(e => {
            this.log.warn(`Login to share plant:${typeof e === 'object' ? JSON.stringify(e, getJSONCircularReplacer()) : e}`);
          });
        } else {
          this.log.debug('Growatt login with user and password');
          await this.growatt.login(this.config.user, this.config.password).catch(e => {
            this.log.warn(`Login:${typeof e === 'object' ? JSON.stringify(e, getJSONCircularReplacer()) : e}`);
          });
        }
        this.log.debug(`Growatt isConnected() : ${this.growatt.isConnected()}`);
        if (this.growatt.isConnected() && this.config.sessionHold) {
          this.connectTime = getTime();
        }
        this.log.debug(`Growatt time for login : ${getTimeDiff(debugTimeDiff)}ms`);
        debugTimeDiff = getTime();
      }
      if (this.growatt.isConnected()) {
        const allPlantData = await this.growatt.getAllPlantData({
          weather: this.config.weather,
          totalData: this.config.totalData,
          statusData: this.config.statusData,
          plantData: this.config.plantData,
          deviceData: this.config.deviceData,
          historyLast: this.config.historyLast,
        });
        delete this.relogin;
        this.log.debug(`Growatt time for allPlantData : ${getTimeDiff(debugTimeDiff)}ms`);
        debugTimeDiff = getTime();
        this.parseData(allPlantData, '');
        this.log.debug(`Growatt time for parseData : ${getTimeDiff(debugTimeDiff)}ms`);
        if (afterConnect && this.config.settings) {
          this.log.debug(`Growatt time for settings : ${getTimeDiff(debugTimeDiff)}ms`);
          debugTimeDiff = getTime();
          this.loadSettings(allPlantData);
          this.log.debug(`Growatt time for settings : ${getTimeDiff(debugTimeDiff)}ms`);
        }
        debugTimeDiff = getTime();
        if (this.callRun) {
          this.setStateAsync('info.connection', { val: true, ack: true });
          timeout = this.config.cycleTime * 1000 - getTimeDiff(allTimeDiff);
          if (timeout < 100) {
            timeout = 100;
          }
        }
        return;
      }
      this.log.info('not connected');
      this.setStateAsync('info.connection', { val: false, ack: true });
    } catch (e) {
      if (e.toString().toLowerCase().includes('errornologin')) {
        if (!this.config.sessionHold || this.relogin) {
          this.log.warn(`Growatt login: ${e}`);
          if (this.config.keyLogin) {
            this.log.info('If this message appears continuously, your key has expired. Please generate a new one.');
          }
        } else {
          this.log.info(`Growatt relogin on session failed: ${e}`);
          this.relogin = true;
          timeout = 1;
        }
      } else {
        this.log.error(`Growatt exception: ${e}`);
      }
      this.setStateAsync('info.connection', { val: false, ack: true });
      this.growattLogout();
      if (this.supportsFeature && this.supportsFeature('PLUGINS')) {
        const sentryInstance = this.getPluginInstance('sentry');
        if (sentryInstance && sentryInstance.getSentryObject() && !e.toString().toLowerCase().includes('errornologin')) {
          sentryInstance.getSentryObject().captureException(e);
        }
      }
    } finally {
      if (!this.config.sessionHold) {
        this.growattLogout();
      } else if (
        typeof this.connectTime !== 'undefined' &&
        this.config.sessionTime > 0 &&
        getTimeDiff(this.connectTime) > this.config.sessionTime * 60000
      ) {
        this.log.debug('Connection time of the session reached');
        this.growattLogout();
      }
      clearTimeout(this.processTimeout);
      clearTimeout(this.callTimeout);
      if (this.callRun) {
        this.callTimeout = setTimeout(() => {
          this.growattData();
        }, timeout);
      }
      this.log.debug(`Leave growattData :${getTimeDiff(allTimeDiff)}ms`);
    }
  }

  /**
   * spinoff onMessage, reads a register
   * @param {string} sn serielnumber of datalogger
   * @param {integer} register to read
   * @param {object} obj the messageoject
   */
  readLoggerRegister(register, obj) {
    if (this.growatt && this.growatt.isConnected()) {
      const data = JSON.parse(obj.message);
      this.growatt
        .getDataLoggerRegister(data.sn, register)
        .then(res => {
          this.log.debug(`readLoggerRegister: ${JSON.stringify(res, getJSONCircularReplacer())}`);
          if (obj.callback && typeof res.success !== 'undefined') {
            this.sendTo(obj.from, obj.command, JSON.stringify(res, getJSONCircularReplacer()), obj.callback);
          }
        })
        .catch(e => {
          this.log.error(e);
        });
    }
  }

  /**
   * spinoff onMessage, writes a register
   * @param {string} sn serielnumber of datalogger
   * @param {integer} register to write
   * @param {string} value to write
   * @param {object} obj the messageoject
   */
  writeLoggerRegister(register, obj) {
    if (this.growatt && this.growatt.isConnected()) {
      const data = JSON.parse(obj.message);
      this.growatt
        .setDataLoggerRegister(data.sn, register, data.value)
        .then(res => {
          this.log.debug(`writeLoggerRegister: ${JSON.stringify(res, getJSONCircularReplacer())}`);
          if (obj.callback && typeof res.success !== 'undefined') {
            this.sendTo(obj.from, obj.command, JSON.stringify(res, getJSONCircularReplacer()), obj.callback);
          }
        })
        .catch(e => {
          this.log.error(e);
        });
    }
  }

  /**
   * spinoff onMessage, writes with function
   * @param {string} sn serielnumber of datalogger
   * @param {integer} function to use
   * @param {string} value to write
   * @param {object} obj the messageoject
   */
  writeLoggerFunction(func, obj) {
    if (this.growatt && this.growatt.isConnected()) {
      const data = JSON.parse(obj.message);
      this.growatt
        .setDataLoggerParam(data.sn, func, data.value)
        .then(res => {
          this.log.debug(`writeLoggerFunction: ${JSON.stringify(res, getJSONCircularReplacer())}`);
          if (obj.callback && typeof res.success !== 'undefined') {
            this.sendTo(obj.from, obj.command, JSON.stringify(res, getJSONCircularReplacer()), obj.callback);
          }
        })
        .catch(e => {
          this.log.error(e);
        });
    }
  }

  /**
   * onMessage, from Admin interface
   * @param {object} obj the messageoject
   */
  onMessage(obj) {
    let wait = false;
    this.log.debug(JSON.stringify(obj, getJSONCircularReplacer()));
    if (obj) {
      switch (obj.command) {
        case 'getDatalogger':
          if (this.growatt && this.growatt.isConnected()) {
            wait = true;
            this.growatt
              .getDataLoggers()
              .then(res => {
                this.log.debug(`getDatalogger: ${JSON.stringify(res, getJSONCircularReplacer())}`);
                if (obj.callback) {
                  this.sendTo(obj.from, obj.command, JSON.stringify(res, getJSONCircularReplacer()), obj.callback);
                }
              })
              .catch(e => {
                this.log.error(e);
              });
          }
          break;
        case 'getDataLoggerIntervalRegister':
          wait = true;
          this.readLoggerRegister(API.LOGGERREGISTER.INTERVAL, obj);
          break;
        case 'setDataLoggerIntervalRegister':
          wait = true;
          this.writeLoggerRegister(API.LOGGERREGISTER.INTERVAL, obj);
          break;
        case 'getDataLoggerIpRegister':
          wait = true;
          this.readLoggerRegister(API.LOGGERREGISTER.SERVERIP, obj);
          break;
        case 'setDataLoggerIp':
          wait = true;
          this.writeLoggerFunction(API.LOGGERFUNCTION.SERVERIP, obj);
          break;
        case 'getDataLoggerPortRegister':
          wait = true;
          this.readLoggerRegister(API.LOGGERREGISTER.SERVERPORT, obj);
          break;
        case 'setDataLoggerPort':
          wait = true;
          this.writeLoggerFunction(API.LOGGERFUNCTION.SERVERPORT, obj);
          break;
        case 'checkLoggerFirmware':
          if (this.growatt && this.growatt.isConnected()) {
            wait = true;
            const data = JSON.parse(obj.message);
            this.growatt
              .checkDataLoggerFirmware(data.type, data.version)
              .then(res => {
                this.log.debug(`checkDataLoggerFirmware: ${JSON.stringify(res, getJSONCircularReplacer())}`);
                if (obj.callback && typeof res.success !== 'undefined') {
                  this.sendTo(obj.from, obj.command, JSON.stringify(res, getJSONCircularReplacer()), obj.callback);
                }
              })
              .catch(e => {
                this.log.error(e);
              });
          }
          break;
        case 'restartDatalogger':
          if (this.growatt && this.growatt.isConnected()) {
            wait = true;
            const data = JSON.parse(obj.message);
            this.growatt
              .setDataLoggerRestart(data.sn)
              .then(res => {
                if (obj.callback) {
                  this.sendTo(obj.from, obj.command, res.msg, obj.callback);
                }
              })
              .catch(e => {
                this.log.error(e);
              });
          }
          break;
        default:
          this.log.warn(`Unknown command: ${obj.command}`);
          return false;
      }
    }
    if (!wait && obj.callback) {
      this.sendTo(obj.from, obj.command, obj.message, obj.callback);
    }
    return true;
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
  /* eslint-disable-next-line no-new */
  new Growatt();
}
