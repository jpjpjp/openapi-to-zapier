// Action: {{displayLabel}}
// Generated from OpenAPI operation: {{operationId}}
// Endpoint: {{method}} {{path}}

{{#if dynamicFieldsCode}}{{dynamicFieldsCode}}

{{/if}}const perform = async (z, bundle) => {
  const baseUrl = '{{baseUrl}}';
  let url = `${baseUrl}{{path}}`;
  
  {{pathParamsCode}}

  {{queryParamsCode}}

  {{requestBodyCode}}

  const response = await z.request({
    method: '{{method}}',
    url: url,
    {{paramsCode}}
    {{bodyCode}}
    headers: {
      Authorization: `Bearer ${bundle.authData.access_token}`,
      'Content-Type': 'application/json',
    },
  });

  {{responseCode}}
};

module.exports = {
  key: '{{key}}',
  noun: '{{noun}}',
  display: {
    label: '{{displayLabel}}',
    description: '{{description}}',
  },
  operation: {
    inputFields: {{inputFieldsCode}},
    perform,
    {{cleanInputDataCode}}
    {{sampleCode}}
  },
};

