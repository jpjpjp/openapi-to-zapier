// Trigger: {{displayLabel}}
// Generated from OpenAPI operation: {{operationId}}
// Endpoint: {{method}} {{path}}

const perform = async (z, bundle) => {
  const baseUrl = '{{baseUrl}}';
  let url = `${baseUrl}{{path}}`;
  
  {{pathParamsCode}}

  {{queryParamsCode}}

  const response = await z.request({
    method: '{{method}}',
    url: url,
    {{paramsCode}}
    headers: {
      Authorization: `Bearer ${bundle.authData.access_token}`,
      'Content-Type': 'application/json',
    },
  });

  let results = {{responseCode}};
  
  // Filter results if needed (e.g., only unreviewed transactions)
  // Example: results = results.filter(item => item.status === 'unreviewed');
  {{filterCode}}
  
  return results;
};

module.exports = {
  key: '{{key}}',
  noun: '{{noun}}',
  display: {
    label: '{{displayLabel}}',
    description: '{{description}}',
  },
  operation: {
    inputFields: [{{inputFieldsCode}}],
    perform,
    cleanInputData: false,
    {{sampleCode}}
  },
};

