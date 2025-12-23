// Authentication configuration
// Generated from OpenAPI schema

const authentication = {
  type: '{{authType}}',
  test: async (z, bundle) => {
    const response = await z.request({
      url: '{{baseUrl}}{{testEndpoint}}',
      method: 'GET',
      headers: {
        {{authHeader}}{{#if customHeaderCode}}
        {{customHeaderCode}}{{/if}}
      },
    });
    return response.json;
  },
  fields: [
    {
      key: '{{fieldKey}}',
      label: '{{fieldLabel}}',
      type: '{{fieldType}}',
      required: true,
      helpText: '{{helpText}}',
{{helpLinkCode}}
    },
  ],
  connectionLabel: {{connectionLabel}},
};

module.exports = authentication;

