const path = require('path');
const {tests, utils} = require('@iobroker/testing');
const { expect } = require('chai');

// Run tests
tests.unit(path.join(__dirname, '..'), {
    // Overwrite the default adapter config
    overwriteAdapterConfig(config) {
        config.host = 'localhost';
        return config;
    },

    // optionally define an array of objects that need to be present in the objects DB
    // instance objects from io-package.json are pre-loaded by default
    predefinedObjects: [
        {
            _id: 'test.0.object1',
            type: 'state',
            common: {
                type: 'boolean',
                customs: {
                    'mqtt-client.0': {
                        enabled: true,
                        publish: true,
                        subscribe: true
                    }
                }
            },
            native: {/* ... */},
        },
        {
            _id: 'test.0.object2',
            type: 'state',
            common: {
                type: 'number',
                customs: {
                    'mqtt-client.0': {
                        enabled: true,
                        publish: true,
                        subscribe: true
                    }
                }
            },
            native: {/* ... */},
        }
    ],

    // Optionally define which states need to exist in the states DB
    // You can set all properties that are usually available on a state
    predefinedStates: {
        'test.0.object1': {val: true, ack: false},
        'test.0.object2': {val: 2, ack: false, ts: 1},
    },

    // If the startup tests need require specific behavior of the mocks
    // or if you are using methods that don't have a default implementation on the mocks,
    // you can define the behavior here. This method is called before every predefined test
    defineMockBehavior(database, adapter) {
        adapter.getObjectView = (schema, type, options, callback) =>
            callback && callback(null, [{
                id: 'test.0.object1',
                value: {
                    'mqtt-client.0': {
                        enabled: true,
                        publish: true,
                        subscribe: true
                    }
                }
            }, {
                id: 'test.0.object2',
                value: {
                    'mqtt-client.0': {
                        enabled: true,
                        publish: true,
                        subscribe: true
                    }
                }
            }]);
        // or
        adapter.objects.getUserGroup.returns('a string');
    },

    // Define your own tests inside defineAdditionalTests.
    // If you need predefined objects etc. here, you need to take care of it yourself
    defineAdditionalTests() {
        // Create mocks and asserts
        const { adapter, database }  = utils.unit.createMocks();
        const { assertObjectExists } = utils.unit.createAsserts(database, adapter);

        describe('test start', () => {
            afterEach(() => {
                // The mocks keep track of all method invocations - reset them after each single test
                adapter.resetMockHistory();
                // We want to start each test with a fresh database
                database.clear();
            });

            it('works', () => {
                // Create an object in the fake db we will use in this test
                const theObject = {
                    _id: "test.0.whatever",
                    type: "state",
                    common: {
                        role: "whatever",
                    },
                };

                database.publishObject(theObject);

                // Do something that should be tested

                // Assert that the object still exists
                expect(database.hasObject(theObject._id)).to.be.true;
            });
        });
    },
});