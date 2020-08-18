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
        this.callInterval = null;
        this.objNames = {};
        this.on('ready', this.onReady.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {

        this.growattData();
        this.callInterval = setInterval(() => {this.growattData()}, 30000);

    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
    onUnload(callback) {
        try {
            clearInterval(this.callInterval);
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

    /**
     * ic Called to get Data
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    async growattData() {
        this.log.debug('Growatt login');
        await api.login(this.config.user,this.config.password).catch(e => {this.log.error('Login:'+((typeof e === 'object')?JSON.stringify(e):e))});
        this.log.debug('Growatt connected '+api.isConnected());
        if (api.isConnected()) {
            this.setStateAsync('info.connection', { val: true, ack: true});
            let allPlantData = await api.getAllPlantData({
                weather : this.config.weather,
                totalData : this.config.totalData,
                statusData : this.config.statusData,
                plantData : this.config.plantData,
                deviceData : this.config.deviceData
            }).catch(e => {this.log.error('Get all plant data:'+e)});
            this.parseData(allPlantData,'');
            api.logout().catch(e => {this.log.error('Logout:'+e)});
        } else {
            this.log.info('not connected');
            this.setStateAsync('info.connection', { val: false, ack: true });
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