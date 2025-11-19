// Zapier Integration v{{version}}
// Generated from OpenAPI schema

const authentication = require('./authentication');

{{actionsRequires}}

{{triggersRequires}}

const App = {
  version: require('./package.json').version,
  platformVersion: require('zapier-platform-core').version,

  authentication,

  beforeRequest: [
{{beforeRequestCode}},
  ],

  afterResponse: [
{{afterResponseCode}},
  ],

  triggers: {
    {{triggersCode}}
  },

  searches: {},

  creates: {
    {{actionsCode}}
  },
};

module.exports = App;

