// Trigger: {{displayLabel}}
// Generated from OpenAPI operation: {{operationId}}
// Endpoint: {{method}} {{path}}

const perform = async (z, bundle) => {
  const baseUrl = '{{baseUrl}}';
  let url = `${baseUrl}{{path}}`;
  
  {{pathParamsCode}}

  {{queryParamsCode}}

  {{requestCode}}
  
  {{sortCode}}
  
  // Filter results if needed (e.g., only unreviewed transactions)
  // Example: results = results.filter(item => item.status === 'unreviewed');
  {{filterCode}}{{labelCode}}
  
  return results;
};

module.exports = {
  key: '{{key}}',
  noun: '{{noun}}',
  display: {
    label: '{{displayLabel}}',
    description: '{{description}}'{{hiddenProperty}},
  },
  operation: {
    inputFields: [{{inputFieldsCode}}],
    perform,
    cleanInputData: false,
    {{sampleCode}}
  },
};

