'use strict';

/*
 * Created with @iobroker/create-adapter v1.26.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const api = require('growatt');
const utils = require('@iobroker/adapter-core');

// Load your modules here, e.g.:
// const fs = require("fs");

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
        this.objNames = {};
        this.on('ready', this.onReady.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        this.getForeignObject('system.config', (err, obj) => {
            if (!this.supportsFeature || !this.supportsFeature('ADAPTER_AUTO_DECRYPT_NATIVE')) {
                if (obj && obj.native && obj.native.secret) {
                    this.config.password = this.decrypt(obj.native.secret, this.config.password);
                    this.config.shareKey = this.decrypt(obj.native.secret, this.config.shareKey);
                } else {
                    this.config.password = this.decrypt('Zgfr56gFe87jJOM', this.config.password);
                    this.config.shareKey = this.decrypt('Zgfr56gFe87jJOM', this.config.shareKey);
                }
            }
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
            clearTimeout(this.callTimeout);
            this.setStateAsync('info.connection', { val: false, ack: true});

            callback();
        } catch (e) {
            callback();
        }
    }

    /**
     * Parses the data from the website into objects. Is called recrusively.
     * @param {object} plantData
     * @param {path} path to object
     */
    async parseData(plantData, path) {
        if (plantData) {
            let keys = Object.keys(plantData)
            keys.forEach(async key => {
                let ele = path+key;
                this.log.silly('ParseData for '+ele);
                let data = plantData[key];
                if (typeof data === 'object'){
                    this.parseData(data,ele+'.');
                } else {
                    let objType = 'string';
                    let objRole = 'value';
                    if (key.toLowerCase().includes('name'.toLowerCase())) {
                        data = data.toString();
                    } if (typeof data === 'number') {
                        objType = 'number';
                    } else {
                        data = data.toString();
                        // Date: yyyy-mm-dd hh:mi:ss
                        if (data.match('^\\d\\d\\d\\d-\\d\\d-\\d\\d \\d\\d:\\d\\d:\\d\\d$')) {
                            data = new Date(data);
                            objType = 'number';
                            objRole = 'value.time';
                        // Date: yyyy-mm-dd hh:mi
                        } else if (data.match('^\\d\\d\\d\\d-\\d\\d-\\d\\d \\d\\d:\\d\\d$')) {
                            data = new Date(data+':00');
                            objType = 'number';
                            objRole = 'value.time';
                        // Date: yyyy-mm-dd
                        } else if (data.match('^\\d\\d\\d\\d-\\d\\d-\\d\\d$')) {
                            data = new Date(data);
                            objType = 'number';
                            objRole = 'date';
                        // number: -123 or +123.45
                        } else if (data.match('^(\\+|\\-)?\\d+(\\.\\d*)?$')) {
                            data = parseFloat(data)
                            objType = 'number';
                        // json: {...} or [...]
                        } else if (data.match('^({.*}|\\[.*\\])$')) {
                            objRole = 'json';
                        // boolean: true or false
                        } else if (data.match('^(true)|(false)$')) {
                            data = (data==='true');
                            objType = 'boolean';
                        }
                    }
                    if (!this.objNames[ele]) {
                        this.log.debug('Create object not exists '+ele+' type:'+objType+ ' role:'+objRole);
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
                        }).catch(e => {this.log.error('setObjectNotExists:'+e)});
                        this.objNames[ele] = true;
                    }
                    this.log.debug('Set value '+ele+':'+data);
                    this.setStateAsync(ele, { val: data, ack: true });
                }
            })
        }
    }

    /**
     * ic Called to get Data
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    async growattData() {
        try {
            if (this.config.keyLogin) {
                this.log.debug('Growatt share plant login');
                await api.sharePlantLogin(this.config.shareKey).catch(e => {this.log.error('Login to share plant:'+((typeof e === 'object')?JSON.stringify(e):e))});
            } else {
                this.log.debug('Growatt login');
                await api.login(this.config.user,this.config.password).catch(e => {this.log.error('Login:'+((typeof e === 'object')?JSON.stringify(e):e))});
            }
            this.log.debug('Growatt connected '+api.isConnected());
            if (api.isConnected()) {
                let allPlantData = await api.getAllPlantData({
                    weather : this.config.weather,
                    totalData : this.config.totalData,
                    statusData : this.config.statusData,
                    chartLast : this.config.chartLast,
                    chartLastArray : this.config.chartLastArray,
                    plantData : this.config.plantData,
                    deviceData : this.config.deviceData,
                    historyLast : this.config.historyLast
                }).catch(e => {this.log.error('Get all plant data:'+e)});
                this.parseData(allPlantData,'');
                api.logout().catch(e => {this.log.error('Logout:'+e)});
                if (this.callRun) {
                    this.setStateAsync('info.connection', { val: true, ack: true});
                    this.callTimeout = setTimeout(() => {this.growattData()}, 30000);
                    return
                }
            } else {
                this.log.info('not connected');
                this.setStateAsync('info.connection', { val: false, ack: true });
            }
        } catch (e) {
           this.log.error('Get all plant data exception: '+e);
           this.setStateAsync('info.connection', { val: false, ack: true });
        }
        if (this.callRun) {
            this.callTimeout = setTimeout(() => {this.growattData()}, 300000);
        }
    }

}

// @ts-ignore parent is a valid property on module
if (module.parent) {
    // Export the constructor in compact mode
    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    module.exports = (options) => new Growatt(options);
} else {
    // otherwise start the instance directly
    new Growatt();
}