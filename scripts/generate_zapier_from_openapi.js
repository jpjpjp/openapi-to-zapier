#!/usr/bin/env node

// Load environment variables from .env file
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const prettier = require('prettier');
const OpenAPIParser = require('./utils/openapi_parser');
const SchemaMapper = require('./utils/schema_mapper');
const CodeGenerator = require('./utils/code_generator');

// Configuration from environment variables
const DEFAULT_SCHEMA_URL = process.env.ZAPIER_SCHEMA_URL || 'https://petstore3.swagger.io/api/v3/openapi.json';
const DEFAULT_APP_ID = process.env.ZAPIER_APP_ID ? parseInt(process.env.ZAPIER_APP_ID, 10) : null;
// Default to a 'generated' directory to avoid conflicts with generator project files
const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), 'generated');
const TRIGGER_CONFIG_PATH = path.join(process.cwd(), 'triggers-config.json');
const ACTION_CONFIG_PATH = path.join(process.cwd(), 'actions-config.json');
const AUTH_CONFIG_PATH = path.join(process.cwd(), 'authentication-config.json');

// Load trigger configuration file
function loadTriggerConfig() {
  const configPath = TRIGGER_CONFIG_PATH;
  if (!fs.existsSync(configPath)) {
    return { triggers: {} };
  }
  
  try {
    const configContent = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(configContent);
  } catch (error) {
    console.warn(`⚠️  Warning: Could not parse trigger config file at ${configPath}: ${error.message}`);
    return { triggers: {} };
  }
}

// Load action configuration file
function loadActionConfig() {
  const configPath = ACTION_CONFIG_PATH;
  if (!fs.existsSync(configPath)) {
    return { actions: {} };
  }
  
  try {
    const configContent = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(configContent);
  } catch (error) {
    console.warn(`⚠️  Warning: Could not parse action config file at ${configPath}: ${error.message}`);
    return { actions: {} };
  }
}

// Load authentication configuration file
function loadAuthConfig() {
  const configPath = AUTH_CONFIG_PATH;
  if (!fs.existsSync(configPath)) {
    // Return defaults if config doesn't exist
    return {
      testEndpoint: '/me',
      authType: 'custom',
      fieldKey: 'access_token',
      fieldLabel: 'API Key',
      fieldType: 'password',
      helpText: 'Enter your API key',
      helpLink: null,
      connectionLabel: {
        type: 'string',
        value: 'API Account'
      }
    };
  }
  
  try {
    const configContent = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(configContent);
  } catch (error) {
    console.warn(`⚠️  Warning: Could not parse authentication config file at ${configPath}: ${error.message}`);
    // Return defaults on error
    return {
      testEndpoint: '/me',
      authType: 'custom',
      fieldKey: 'access_token',
      fieldLabel: 'API Key',
      fieldType: 'password',
      helpText: 'Enter your API key',
      helpLink: null,
      connectionLabel: {
        type: 'string',
        value: 'API Account'
      }
    };
  }
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    schemaUrl: DEFAULT_SCHEMA_URL,
    updateCache: false,
    clean: false,
    outputDir: DEFAULT_OUTPUT_DIR,
    endpoint: null, // For Phase 1: single endpoint mode
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--update-cache') {
      config.updateCache = true;
    } else if (arg === '--clean') {
      config.clean = true;
    } else if (arg === '--schema-url' && args[i + 1]) {
      config.schemaUrl = args[++i];
    } else if (arg === '--output-dir' && args[i + 1]) {
      config.outputDir = args[++i];
    } else if (arg === '--endpoint' && args[i + 1]) {
      config.endpoint = args[++i];
    }
  }

  return config;
}

// Format code with Prettier
async function formatCode(code, filePath) {
  try {
    const options = await prettier.resolveConfig(filePath) || {};
    options.parser = filePath.endsWith('.json') ? 'json' : 'babel';
    return prettier.format(code, options);
  } catch (error) {
    console.warn(`Warning: Could not format ${filePath}: ${error.message}`);
    return code;
  }
}

// Titlecase a string (proper title case with minor words lowercase)
// Handles: minor words (a, an, the, to, of, in, on, at, by, for, with, etc.)
//          acronyms (ID, URL, API, etc.)
//          special cases (Id -> ID, Url -> URL, etc.)
function titleCase(str) {
  if (!str) return str;
  
  // Common minor words that should be lowercase (unless first word)
  // Note: Prepositions of 4+ letters (like "with", "into", "from") are typically capitalized
  const minorWords = new Set([
    'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in',
    'nor', 'of', 'on', 'or', 'the', 'to', 'via', 'per', 'vs', 'vs.'
  ]);
  
  // Prepositions of 4+ letters that should be capitalized (AP Style)
  const capitalizePrepositions = new Set([
    'with', 'into', 'from', 'over', 'under', 'through', 'during', 'before',
    'after', 'above', 'below', 'between', 'among', 'within', 'without',
    'against', 'across', 'around', 'behind', 'beyond', 'inside', 'outside',
    'throughout', 'toward', 'towards', 'upon', 'until', 'while'
  ]);
  
  // Acronym mappings (case-insensitive)
  const acronyms = {
    'id': 'ID',
    'url': 'URL',
    'urls': 'URLs',
    'api': 'API',
    'http': 'HTTP',
    'https': 'HTTPS',
    'json': 'JSON',
    'xml': 'XML',
    'csv': 'CSV',
    'pdf': 'PDF',
    'html': 'HTML',
    'css': 'CSS',
    'js': 'JS',
    'ui': 'UI',
    'ux': 'UX',
    'ip': 'IP',
    'dns': 'DNS',
    'ssl': 'SSL',
    'tls': 'TLS',
    'oauth': 'OAuth',
    'oauth2': 'OAuth2',
    'jwt': 'JWT',
    'rest': 'REST',
    'soap': 'SOAP',
    'gdp': 'GDP',
    'gdpr': 'GDPR',
    'crm': 'CRM',
    'erp': 'ERP',
    'sdk': 'SDK',
    'sso': 'SSO'
  };
  
  // Split by spaces and process each word
  const words = str.trim().split(/\s+/);
  
  return words
    .map((word, index) => {
      // Remove trailing punctuation temporarily
      const trailingPunct = word.match(/[.,!?;:]+$/);
      const punct = trailingPunct ? trailingPunct[0] : '';
      const cleanWord = word.replace(/[.,!?;:]+$/, '');
      
      if (!cleanWord) return word; // Return original if empty after removing punctuation
      
      const lowerWord = cleanWord.toLowerCase();
      
      // Check if it's an acronym first
      if (acronyms[lowerWord]) {
        return acronyms[lowerWord] + punct;
      }
      
      // Check if it's a minor word (lowercase unless first word)
      if (index > 0 && minorWords.has(lowerWord)) {
        return lowerWord + punct;
      }
      
      // Check if it's a preposition of 4+ letters (capitalize these)
      if (capitalizePrepositions.has(lowerWord)) {
        return cleanWord.charAt(0).toUpperCase() + cleanWord.slice(1).toLowerCase() + punct;
      }
      
      // Capitalize first letter, lowercase rest
      return cleanWord.charAt(0).toUpperCase() + cleanWord.slice(1).toLowerCase() + punct;
    })
    .join(' ');
}

// Generate action file for an endpoint
function generateAction(endpoint, baseUrl, mapper, generator, actionConfig = {}) {
  const key = endpoint.operationId || endpoint.path.replace(/\//g, '_').replace(/^_/, '');
  let noun = mapper.getNoun(endpoint.operationId, endpoint.path);
  
  // Improve noun: "AllCategory" -> "Category", "AllTransaction" -> "Transaction"
  if (noun.startsWith('All')) {
    noun = noun.replace(/^All/, '');
  }
  
  // Handle simplify configuration (array flattening)
  const simplify = actionConfig.simplify;
  const isSimplified = simplify && simplify.enabled;
  
  // Titlecase the display label for Zapier compliance (D018)
  // Use custom name from simplify config if provided
  let rawLabel = endpoint.summary || endpoint.operationId || endpoint.path;
  if (isSimplified && simplify.name) {
    rawLabel = simplify.name;
  }
  const displayLabel = titleCase(rawLabel);

  // Extract input fields
  const pathParams = endpoint.parameters.filter(p => p.in === 'path');
  const queryParams = endpoint.parameters.filter(p => p.in === 'query');
  
  // Get fields to hide from config
  const hideQueryParams = new Set(actionConfig.hideQueryParams || []);
  const hideRequestBodyProperties = new Set(actionConfig.hideRequestBodyProperties || []);
  
  // Filter query params based on hideQueryParams
  const visibleQueryParams = queryParams.filter(p => !hideQueryParams.has(p.name));
  let inputFields = mapper.parametersToZapierFields(
    [...pathParams, ...visibleQueryParams]
  );

  // Track field keys to avoid duplicates (path params take precedence)
  const existingFieldKeys = new Set(inputFields.map(f => f.key));

  // Handle request body fields
  if (endpoint.requestBody) {
    let bodyFields = [];
    
    // Handle simplify.flattenArray: extract fields from array item schema
    if (isSimplified && simplify.flattenArray) {
      const arrayFieldName = simplify.flattenArray.arrayField;
      const itemSchemaName = simplify.flattenArray.itemSchema;
      const publicName = simplify.flattenArray.publicName; // Optional: name for the parent object field
      
      // Get the schema for the array item
      const schemas = mapper.schemas || {};
      const itemSchema = schemas[itemSchemaName];
      
      if (itemSchema && itemSchema.properties) {
        // Extract fields from the item schema
        const itemFields = mapper.schemaPropertiesToZapierFields(
          itemSchema,
          itemSchema.required || []
        );
        
        // If publicName is specified, create a parent object field with children
        if (publicName) {
          // Create a parent object field with the item fields as children
          const parentKey = publicName.toLowerCase().replace(/\s+/g, '_'); // Convert "New Transaction" to "new_transaction"
          const parentField = {
            key: parentKey,
            label: publicName,
            type: 'object',
            children: itemFields,
            required: true
          };
          bodyFields.push(parentField);
        } else {
          // No publicName: add item fields directly (backward compatibility)
          bodyFields = itemFields;
        }
      }
      
      // Include additional properties explicitly configured in simplify.additionalProperties
      // This allows properties like apply_rules, skip_duplicates, etc. to be included
      // These are added as top-level siblings (not nested under the parent object)
      if (simplify.additionalProperties && Array.isArray(simplify.additionalProperties)) {
        if (endpoint.requestBody.schema && endpoint.requestBody.schema.properties) {
          const requestBodySchema = endpoint.requestBody.schema;
          const requestBodyProperties = requestBodySchema.properties || {};
          
          // Validate that all additionalProperties exist in the request body schema
          const invalidProperties = simplify.additionalProperties.filter(
            propName => !requestBodyProperties.hasOwnProperty(propName)
          );
          
          if (invalidProperties.length > 0) {
            throw new Error(
              `Action "${endpoint.operationId}": The following properties in simplify.additionalProperties do not exist in the request body schema: ${invalidProperties.join(', ')}`
            );
          }
          
          // Extract all properties from request body schema
          const allRequestBodyFields = mapper.requestBodyToZapierFields(endpoint.requestBody);
          
          // Filter to only include properties explicitly listed in additionalProperties
          const additionalFields = allRequestBodyFields.filter(
            field => simplify.additionalProperties.includes(field.key) && field.key !== arrayFieldName
          );
          
          // Add additional fields to bodyFields (they'll be filtered for duplicates/hidden later)
          bodyFields.push(...additionalFields);
        } else {
          throw new Error(
            `Action "${endpoint.operationId}": Cannot use simplify.additionalProperties because the request body schema has no properties`
          );
        }
      }
    } else {
      // Normal case: extract from request body schema
      bodyFields = mapper.requestBodyToZapierFields(endpoint.requestBody);
    }
    
    // Filter out hidden body properties
    bodyFields = bodyFields.filter(field => !hideRequestBodyProperties.has(field.key));
    
    // Filter out body fields that have the same key as path/query params
    const uniqueBodyFields = bodyFields.filter(field => !existingFieldKeys.has(field.key));
    inputFields.push(...uniqueBodyFields);
    // Update the set for any future checks
    uniqueBodyFields.forEach(field => existingFieldKeys.add(field.key));
  }
  
  // Apply field defaults from config
  // Note: Zapier only supports string defaults, so we only apply defaults to string fields
  if (actionConfig.fieldDefaults) {
    // Validate that all fieldDefaults properties exist in the input fields
    const inputFieldKeys = new Set(inputFields.map(f => f.key));
    const invalidDefaults = Object.keys(actionConfig.fieldDefaults).filter(
      key => !inputFieldKeys.has(key)
    );
    
    if (invalidDefaults.length > 0) {
      throw new Error(
        `Action "${endpoint.operationId}": The following properties in fieldDefaults do not exist in the input fields: ${invalidDefaults.join(', ')}`
      );
    }
    
    inputFields.forEach(field => {
      if (actionConfig.fieldDefaults.hasOwnProperty(field.key)) {
        // Only set default for string fields (Zapier doesn't support boolean/number defaults)
        if (field.type === 'string') {
          field.default = actionConfig.fieldDefaults[field.key];
        }
        // For boolean/number fields, we skip setting the default
        // The field will still be included but without a default value
      }
    });
  }

  // Get sample from response
  // Check for 200, 201, or 204 responses
  const successResponse = endpoint.responses['200'] || endpoint.responses['201'] || endpoint.responses['204'];
  const is204Response = !!endpoint.responses['204'] && !endpoint.responses['200'] && !endpoint.responses['201'];
  let sample = successResponse ? mapper.extractResponseSample(successResponse) : null;
  
  // For 204 responses, set a default sample since there's no response body
  if (is204Response) {
    sample = { success: true, status: 204 };
  }
  
  // For simplified actions with publicName, restructure sample to match nested input structure
  // This ensures the Data In section shows the correct nested structure
  if (isSimplified && simplify.flattenArray && simplify.flattenArray.publicName && sample) {
    const arrayFieldName = simplify.flattenArray.arrayField;
    const publicName = simplify.flattenArray.publicName;
    const parentKey = publicName.toLowerCase().replace(/\s+/g, '_');
    
    // Check if sample has the array property (e.g., transactions: [...])
    if (sample && typeof sample === 'object' && !Array.isArray(sample) && sample[arrayFieldName] && Array.isArray(sample[arrayFieldName]) && sample[arrayFieldName].length > 0) {
      // Extract the first item from the array as the nested transaction object
      const transactionItem = sample[arrayFieldName][0];
      
      // Get the list of input field keys for the nested transaction object
      // These are the fields that should appear in the sample
      const schemas = mapper.schemas || {};
      const itemSchemaName = simplify.flattenArray.itemSchema;
      const itemSchema = schemas[itemSchemaName];
      const allowedTransactionFields = new Set();
      
      if (itemSchema && itemSchema.properties) {
        // Get all field keys from the item schema (these are the input fields)
        Object.keys(itemSchema.properties).forEach(key => {
          // Exclude hidden fields
          if (!hideRequestBodyProperties.has(key)) {
            allowedTransactionFields.add(key);
          }
        });
      }
      
      // Filter transactionItem to only include fields that are in the input fields
      const filteredTransactionItem = {};
      if (allowedTransactionFields.size > 0) {
        Object.keys(transactionItem).forEach(key => {
          if (allowedTransactionFields.has(key)) {
            filteredTransactionItem[key] = transactionItem[key];
          }
        });
      } else {
        // Fallback: include all fields if we couldn't determine the schema
        Object.assign(filteredTransactionItem, transactionItem);
      }
      
      // Create a new sample structure that matches the input fields
      const restructuredSample = {
        [parentKey]: filteredTransactionItem
      };
      
      // Include additional properties as top-level siblings
      if (simplify.additionalProperties && Array.isArray(simplify.additionalProperties)) {
        simplify.additionalProperties.forEach(prop => {
          // Use value from sample if available, otherwise use default from fieldDefaults
          if (sample.hasOwnProperty(prop)) {
            restructuredSample[prop] = sample[prop];
          } else if (actionConfig.fieldDefaults && actionConfig.fieldDefaults.hasOwnProperty(prop)) {
            restructuredSample[prop] = actionConfig.fieldDefaults[prop];
          }
        });
      }
      
      sample = restructuredSample;
    }
  }

  // Build path parameters code
  let pathParamsCode = '';
  if (pathParams.length > 0) {
    pathParams.forEach(param => {
      pathParamsCode += `  url = url.replace('{${param.name}}', bundle.inputData.${param.name});\n`;
    });
  } else {
    pathParamsCode = '  // No path parameters';
  }

  // Build query parameters code
  // Filter out hidden query params
  const visibleQueryParamsForRequest = queryParams.filter(p => !hideQueryParams.has(p.name));
  let queryParamsCode = '';
  let paramsCode = '';
  if (visibleQueryParamsForRequest.length > 0) {
    queryParamsCode = '  const params = {};\n';
    visibleQueryParamsForRequest.forEach(param => {
      // Check if this is a date query parameter that needs format conversion
      const paramSchema = param.schema || {};
      const isDateParam = paramSchema.type === 'string' && paramSchema.format === 'date';
      
      if (isDateParam) {
        // For date query params, extract just the date part (YYYY-MM-DD) if a datetime was provided
        queryParamsCode += `  if (bundle.inputData.${param.name}) {\n`;
        queryParamsCode += `    // Extract date part (YYYY-MM-DD) from input, handling both date strings and datetime strings\n`;
        queryParamsCode += `    const ${param.name}Value = String(bundle.inputData.${param.name});\n`;
        queryParamsCode += `    params.${param.name} = ${param.name}Value.includes('T') ? ${param.name}Value.split('T')[0] : ${param.name}Value.split(' ')[0];\n`;
        queryParamsCode += `  }\n`;
      } else {
        queryParamsCode += `  if (bundle.inputData.${param.name}) {\n`;
        queryParamsCode += `    params.${param.name} = bundle.inputData.${param.name};\n`;
        queryParamsCode += `  }\n`;
      }
    });
    paramsCode = 'params: params,';
  } else {
    queryParamsCode = '  // No query parameters';
  }

  // Build request body code
  // Exclude fields that are path parameters (they're already in the URL)
  const pathParamKeys = new Set(pathParams.map(p => p.name));
  let requestBodyCode = '';
  let bodyCode = '';
  if (endpoint.requestBody) {
    // Handle simplify.flattenArray: wrap single object in array
    if (isSimplified && simplify.flattenArray) {
      const arrayFieldName = simplify.flattenArray.arrayField;
      const publicName = simplify.flattenArray.publicName; // Optional: name for the parent object field
      const schemas = mapper.schemas || {};
      const itemSchema = schemas[simplify.flattenArray.itemSchema];
      
      if (itemSchema && itemSchema.properties) {
        // Get all fields from the item schema (excluding path params)
        const itemFields = Object.keys(itemSchema.properties).filter(
          key => !pathParamKeys.has(key) && !hideRequestBodyProperties.has(key)
        );
        
        // Determine the source path for input data
        // If publicName is set, fields are nested under a parent object
        // Otherwise, they're at the top level (backward compatibility)
        const parentKey = publicName ? publicName.toLowerCase().replace(/\s+/g, '_') : null;
        const inputDataPrefix = parentKey ? `bundle.inputData.${parentKey}` : 'bundle.inputData';
        
        requestBodyCode = '  const requestBody = {};\n';
        requestBodyCode += `  const ${arrayFieldName}Item = {};\n`;
        
        itemFields.forEach(fieldKey => {
          // Check if this is a date field that needs format conversion
          const itemFieldSchema = itemSchema.properties[fieldKey];
          const isDateField = itemFieldSchema && itemFieldSchema.type === 'string' && itemFieldSchema.format === 'date';
          
          if (isDateField) {
            // For date fields, extract just the date part (YYYY-MM-DD) if a datetime was provided
            // This handles cases where Zapier or the user provides a datetime string
            requestBodyCode += `  if (${inputDataPrefix}.${fieldKey} !== undefined && ${inputDataPrefix}.${fieldKey} !== '') {\n`;
            requestBodyCode += `    // Extract date part (YYYY-MM-DD) from input, handling both date strings and datetime strings\n`;
            requestBodyCode += `    const ${fieldKey}Value = String(${inputDataPrefix}.${fieldKey});\n`;
            requestBodyCode += `    ${arrayFieldName}Item.${fieldKey} = ${fieldKey}Value.includes('T') ? ${fieldKey}Value.split('T')[0] : ${fieldKey}Value.split(' ')[0];\n`;
            requestBodyCode += `  }\n`;
          } else {
            requestBodyCode += `  if (${inputDataPrefix}.${fieldKey} !== undefined && ${inputDataPrefix}.${fieldKey} !== '') {\n`;
            requestBodyCode += `    ${arrayFieldName}Item.${fieldKey} = ${inputDataPrefix}.${fieldKey};\n`;
            requestBodyCode += `  }\n`;
          }
        });
        
        requestBodyCode += `  requestBody.${arrayFieldName} = [${arrayFieldName}Item];\n`;
        
        // Handle additional properties explicitly configured in simplify.additionalProperties
        if (simplify.additionalProperties && Array.isArray(simplify.additionalProperties)) {
          const originalBodyFields = mapper.requestBodyToZapierFields(endpoint.requestBody);
          const otherFields = originalBodyFields.filter(
            field => simplify.additionalProperties.includes(field.key) && 
                     field.key !== arrayFieldName && 
                     !pathParamKeys.has(field.key) && 
                     !hideRequestBodyProperties.has(field.key)
          );
          
          otherFields.forEach(field => {
            // Check if this field has a default value in fieldDefaults config
            const hasDefault = actionConfig.fieldDefaults && actionConfig.fieldDefaults.hasOwnProperty(field.key);
            const defaultValue = hasDefault ? actionConfig.fieldDefaults[field.key] : undefined;
            
            if (hasDefault && (field.type === 'boolean' || field.type === 'number')) {
              // For boolean/number fields with defaults, set the default if not provided
              // Since Zapier doesn't support boolean/number defaults in inputFields,
              // we set them in the request body code instead
              requestBodyCode += `  requestBody.${field.key} = bundle.inputData.${field.key} !== undefined ? bundle.inputData.${field.key} : ${JSON.stringify(defaultValue)};\n`;
            } else {
              // For other fields, only include if provided
              requestBodyCode += `  if (bundle.inputData.${field.key} !== undefined) {\n`;
              requestBodyCode += `    requestBody.${field.key} = bundle.inputData.${field.key};\n`;
              requestBodyCode += `  }\n`;
            }
          });
        }
      }
    } else {
      // Normal case: build request body from all body fields
      let bodyFields = mapper.requestBodyToZapierFields(endpoint.requestBody);
      // Filter out hidden properties
      bodyFields = bodyFields.filter(field => !hideRequestBodyProperties.has(field.key));
      // Filter out body fields that are path parameters (they're already in URL)
      const bodyFieldsForRequest = bodyFields.filter(field => !pathParamKeys.has(field.key));
      requestBodyCode = '  const requestBody = {};\n';
      bodyFieldsForRequest.forEach(field => {
        // Check if this is a date field that needs format conversion
        // We need to check the original schema to see if it's a date field
        const isDateField = field.type === 'string' && 
          endpoint.requestBody && 
          endpoint.requestBody.schema && 
          endpoint.requestBody.schema.properties && 
          endpoint.requestBody.schema.properties[field.key] &&
          endpoint.requestBody.schema.properties[field.key].format === 'date';
        
        if (isDateField) {
          // For date fields, extract just the date part (YYYY-MM-DD) if a datetime was provided
          requestBodyCode += `  if (bundle.inputData.${field.key} !== undefined && bundle.inputData.${field.key} !== '') {\n`;
          requestBodyCode += `    // Extract date part (YYYY-MM-DD) from input, handling both date strings and datetime strings\n`;
          requestBodyCode += `    const ${field.key}Value = String(bundle.inputData.${field.key});\n`;
          requestBodyCode += `    requestBody.${field.key} = ${field.key}Value.includes('T') ? ${field.key}Value.split('T')[0] : ${field.key}Value.split(' ')[0];\n`;
          requestBodyCode += `  }\n`;
        } else {
          requestBodyCode += `  if (bundle.inputData.${field.key} !== undefined && bundle.inputData.${field.key} !== '') {\n`;
          requestBodyCode += `    requestBody.${field.key} = bundle.inputData.${field.key};\n`;
          requestBodyCode += `  }\n`;
        }
      });
    }
    bodyCode = 'body: requestBody,';
  } else {
    requestBodyCode = '  // No request body';
  }

  // Build response code
  // For actions, Zapier expects a single object, not an array
  // If the response is an array (directly or after extraction), wrap it in an object
  // Handle 204 No Content responses (no body) by returning a success object
  let responseCode = '';
  
  if (is204Response) {
    // 204 No Content: API returns no body, but Zapier requires an object
    // Return a success object to satisfy Zapier's requirement
    responseCode = '  // 204 No Content response - return success object\n  return { success: true, status: 204 };';
  } else if (successResponse && successResponse.schema) {
    if (successResponse.schema.type === 'array') {
      // Direct array response - wrap in object
      const noun = mapper.getNoun(endpoint.operationId, endpoint.path);
      const arrayKey = noun.toLowerCase() + 's'; // e.g., "categories", "transactions"
      responseCode = `  const result = response.json;\n  return Array.isArray(result) ? { ${arrayKey}: result } : result;`;
    } else if (successResponse.schema.type === 'object') {
      // Resolve $ref if present to check for skipped_duplicates
      let schemaToCheck = successResponse.schema;
      if (schemaToCheck.$ref) {
        const resolved = mapper.resolveRef(schemaToCheck.$ref);
        if (resolved) {
          schemaToCheck = resolved;
        }
      }
      
      const arrayProp = mapper.getArrayPropertyName(schemaToCheck);
      
      if (arrayProp) {
        // Default behavior: return the full response object
        // This preserves all properties like skipped_duplicates, has_more, pagination, etc.
        // Return the full response object (includes all properties)
        responseCode = '  return response.json;';
      } else {
        // No array property, just return the response object
        responseCode = '  return response.json;';
      }
    } else {
      responseCode = '  return response.json;';
    }
  } else {
    // Unknown response structure - handle both array and object cases
    responseCode = `  const result = response.json;\n  return Array.isArray(result) ? { data: result } : result;`;
  }

  // Build input fields code
  // NOTE: Conditional fields support is temporarily disabled due to Zapier validation issues
  // Check if conditional fields are configured (but we'll skip them for now)
  const conditionalFields = actionConfig.conditionalFields || [];
  const hasConditionalFields = conditionalFields.length > 0;
  
  if (hasConditionalFields) {
    console.warn(`  ⚠️  Warning: Conditional fields configured for "${endpoint.operationId}" but support is temporarily disabled. Fields will be generated as a static array.`);
  }
  
  // Helper function to generate a single field definition
  const generateFieldCode = (field) => {
    const indent = '      ';
    const parts = [`${indent}key: '${field.key}'`, `${indent}label: '${field.label}'`];
    
    // Handle children for nested object fields
    // Note: In Zapier, fields with children should NOT have a type property
    // They are mutually exclusive - if children exists, omit type
    if (field.children && Array.isArray(field.children) && field.children.length > 0) {
      const childIndent = '        ';
      const childrenCode = field.children.map(child => {
        const childParts = [`${childIndent}key: '${child.key}'`, `${childIndent}label: '${child.label}'`, `${childIndent}type: '${child.type}'`];
        if (child.helpText) {
          const escapedHelpText = child.helpText
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r');
          childParts.push(`${childIndent}helpText: '${escapedHelpText}'`);
        }
        if (child.required) {
          childParts.push(`${childIndent}required: true`);
        }
        if (child.choices && Array.isArray(child.choices) && child.choices.length > 0) {
          childParts.push(`${childIndent}choices: ${JSON.stringify(child.choices)}`);
        }
        if (child.default !== undefined && child.default !== null && child.type === 'string') {
          childParts.push(`${childIndent}default: ${JSON.stringify(String(child.default))}`);
        }
        // Add placeholder for date fields
        if (child.placeholder) {
          childParts.push(`${childIndent}placeholder: '${child.placeholder}'`);
        }
        // Note: Zapier doesn't support validate property on input fields
        // Date format validation is handled in the perform function instead
        return `        {\n${childParts.join(',\n')}\n        }`;
      }).join(',\n');
      parts.push(`${indent}children: [\n${childrenCode}\n${indent}]`);
    } else {
      // Only include type if there are no children
      parts.push(`${indent}type: '${field.type}'`);
    }
    
    if (field.helpText) {
      // Escape single quotes and newlines for JavaScript string
      const escapedHelpText = field.helpText
        .replace(/\\/g, '\\\\')  // Escape backslashes first
        .replace(/'/g, "\\'")     // Escape single quotes
        .replace(/\n/g, '\\n')    // Escape newlines
        .replace(/\r/g, '\\r');   // Escape carriage returns
      parts.push(`${indent}helpText: '${escapedHelpText}'`);
    }
    if (field.required) {
      parts.push(`${indent}required: true`);
    }
    // Include choices for enum fields (dropdown support)
    if (field.choices && Array.isArray(field.choices) && field.choices.length > 0) {
      parts.push(`${indent}choices: ${JSON.stringify(field.choices)}`);
    }
    // Only include default for string fields (Zapier validation is strict about defaults)
    // Zapier only accepts string defaults, not boolean or number defaults
    if (field.default !== undefined && field.default !== null && field.type === 'string') {
      parts.push(`${indent}default: ${JSON.stringify(String(field.default))}`);
    }
    // Add placeholder for date fields (replaces "Enter text or insert data...")
    if (field.placeholder) {
      parts.push(`${indent}placeholder: '${field.placeholder}'`);
    }
    // Note: Zapier doesn't support validate property on input fields
    // Date format validation is handled in the perform function instead
    // Note: boolean and number defaults are omitted - Zapier doesn't support them
    // Note: null defaults are omitted to make fields truly optional
    return `      {\n${parts.join(',\n')}\n      }`;
  };
  
  // NOTE: Conditional fields support is temporarily disabled
  // Always generate array format (normal case)
  // TODO: Re-enable conditional fields when Zapier validation supports function-based inputFields
  /*
  let inputFieldsCode = '';
  if (hasConditionalFields) {
    // Generate function format for conditional fields
    const allFieldsCode = inputFields.map(generateFieldCode).join(',\n');
    
    // Build conditional logic
    let conditionalLogic = '';
    conditionalLogic += `    // Handle undefined bundle.inputData during validation\n`;
    conditionalLogic += `    if (!bundle || !bundle.inputData) {\n`;
    conditionalLogic += `      return fields;\n`;
    conditionalLogic += `    }\n`;
    conditionalLogic += `    \n`;
    
    conditionalFields.forEach(cond => {
      const fieldKey = cond.field;
      const hideWhen = cond.hideWhen || {};
      const conditions = Object.entries(hideWhen).map(([key, value]) => {
        // Handle boolean, string, number comparisons
        // Use != null to check for both null and undefined
        if (typeof value === 'boolean') {
          return `bundle.inputData.${key} != null && bundle.inputData.${key} === ${JSON.stringify(value)}`;
        } else if (typeof value === 'string') {
          return `bundle.inputData.${key} != null && bundle.inputData.${key} === '${value.replace(/'/g, "\\'")}'`;
        } else {
          return `bundle.inputData.${key} != null && bundle.inputData.${key} === ${JSON.stringify(value)}`;
        }
      }).join(' && ');
      
      conditionalLogic += `    // Hide ${fieldKey} when: ${Object.entries(hideWhen).map(([k, v]) => `${k} === ${JSON.stringify(v)}`).join(' && ')}\n`;
      conditionalLogic += `    if (${conditions}) {\n`;
      conditionalLogic += `      fields = fields.filter(f => f.key !== '${fieldKey}');\n`;
      conditionalLogic += `    }\n`;
    });
    
    inputFieldsCode = `(z, bundle) => {
    let fields = [
${allFieldsCode}
    ];
${conditionalLogic}
    return fields;
  }`;
  } else {
    // Generate array format (normal case)
    inputFieldsCode = inputFields.length > 0
      ? '[\n' + inputFields.map(generateFieldCode).join(',\n') + '\n    ]'
      : '[]';
  }
  */
  
  // Always generate array format (conditional fields disabled)
  const inputFieldsCode = inputFields.length > 0
    ? '[\n' + inputFields.map(generateFieldCode).join(',\n') + '\n    ]'
    : '[]';

  // Build sample code
  // Zapier requires sample to be an object, not an array, and must have at least one property
  // If sample is an array, use the first item; if empty/null, use empty object
  let sampleObject = null;
  if (sample) {
    if (Array.isArray(sample)) {
      // For arrays, use the first item as the sample, or empty object if array is empty
      sampleObject = sample.length > 0 ? sample[0] : {};
    } else if (typeof sample === 'object') {
      sampleObject = sample;
    } else {
      // For primitives, wrap in an object
      sampleObject = { value: sample };
    }
  } else {
    // No sample available, use empty object (Zapier requires an object)
    sampleObject = {};
  }
  
  // Remove sensitive fields from sample (Zapier requirement D001 - no password fields)
  // Also remove fields that are hidden from inputFields
  if (typeof sampleObject === 'object' && !Array.isArray(sampleObject)) {
    const sensitiveFields = ['password', 'passwd', 'pwd', 'secret', 'token', 'apiKey', 'api_key'];
    const fieldsToRemove = new Set([...sensitiveFields, ...hideRequestBodyProperties]);
    Object.keys(sampleObject).forEach(key => {
      if (fieldsToRemove.has(key)) {
        delete sampleObject[key];
      }
    });
  }
  
  // Ensure sample has at least one property (Zapier validation requirement)
  if (typeof sampleObject === 'object' && !Array.isArray(sampleObject) && Object.keys(sampleObject).length === 0) {
    // Add a placeholder property to satisfy Zapier's minimum property requirement
    sampleObject = { id: 0 };
  }
  
  const sampleCode = `sample: ${JSON.stringify(sampleObject, null, 2)},`;

  // Add cleanInputData: false for better predictability (D028)
  const cleanInputDataCode = 'cleanInputData: false,';

  // Escape description for JavaScript string (handle newlines, quotes, etc.)
  const escapeForJsString = (str) => {
    if (!str) return '';
    return str
      .replace(/\\/g, '\\\\')  // Escape backslashes first
      .replace(/'/g, "\\'")     // Escape single quotes
      .replace(/\n/g, '\\n')    // Escape newlines
      .replace(/\r/g, '\\r');   // Escape carriage returns
  };

  // Truncate description to 1000 characters (Zapier limit)
  let description = endpoint.description || endpoint.summary || '';
  if (description.length > 1000) {
    description = description.substring(0, 997) + '...';
  }

  const templateData = {
    key,
    noun,
    displayLabel,
    description: escapeForJsString(description),
    operationId: endpoint.operationId,
    method: endpoint.method.toUpperCase(),
    path: endpoint.path,
    baseUrl,
    pathParamsCode,
    queryParamsCode,
    requestBodyCode,
    paramsCode,
    bodyCode,
    responseCode,
    inputFieldsCode,
    sampleCode,
    cleanInputDataCode,
  };

  return generator.generate('action.template.js', templateData);
}

// Generate trigger file for an endpoint (similar to action but for polling)
function generateTrigger(triggerConfig, baseUrl, mapper, generator) {
  const endpoint = triggerConfig.endpoint;
  const key = triggerConfig.key || endpoint.operationId || endpoint.path.replace(/\//g, '_').replace(/^_/, '');
  const noun = mapper.getNoun(endpoint.operationId, endpoint.path);
  // Use custom name if provided, otherwise use title case of summary
  // Apply titleCase to custom name if provided, otherwise use titleCase on endpoint info
  const displayLabel = triggerConfig.customName 
    ? titleCase(triggerConfig.customName)
    : titleCase(endpoint.summary || endpoint.operationId || endpoint.path);

  // Extract input fields (triggers typically only have query params, no request body)
  const pathParams = endpoint.parameters.filter(p => p.in === 'path');
  const queryParams = endpoint.parameters.filter(p => p.in === 'query');
  
  // Get auto-set query params from config (these won't be in inputFields)
  const autoQueryParams = triggerConfig.queryParams || {};
  const autoQueryParamKeys = new Set(Object.keys(autoQueryParams));
  
  // Filter out auto-set params from input fields (user doesn't need to provide them)
  const allInputFields = mapper.parametersToZapierFields(endpoint.parameters);
  const inputFields = allInputFields.filter(field => !autoQueryParamKeys.has(field.key));

  // Get sample from response
  const successResponse = endpoint.responses['200'] || endpoint.responses['201'];
  const sample = successResponse ? mapper.extractResponseSample(successResponse) : null;

  // Build path parameters code
  let pathParamsCode = '';
  if (pathParams.length > 0) {
    pathParams.forEach(param => {
      pathParamsCode += `  url = url.replace('{${param.name}}', bundle.inputData.${param.name});\n`;
    });
  } else {
    pathParamsCode = '  // No path parameters';
  }

  // Build query parameters code
  // Auto-set params from config are always included
  // User-provided params are conditionally included
  let queryParamsCode = '';
  let paramsCode = '';
  const hasAutoParams = Object.keys(autoQueryParams).length > 0;
  const hasUserParams = queryParams.some(p => !autoQueryParamKeys.has(p.name));
  
  if (hasAutoParams || hasUserParams) {
    queryParamsCode = '  const params = {};\n';
    
    // Add auto-set params first (always included)
    if (hasAutoParams) {
      Object.entries(autoQueryParams).forEach(([key, value]) => {
        // Handle string values (need quotes) vs other types
        const valueStr = typeof value === 'string' ? `'${value}'` : JSON.stringify(value);
        queryParamsCode += `  params.${key} = ${valueStr};\n`;
      });
    }
    
    // Add user-provided params (conditionally)
    queryParams.forEach(param => {
      if (!autoQueryParamKeys.has(param.name)) {
        // Check if this is a date query parameter that needs format conversion
        const paramSchema = param.schema || {};
        const isDateParam = paramSchema.type === 'string' && paramSchema.format === 'date';
        
        if (isDateParam) {
          // For date query params, extract just the date part (YYYY-MM-DD) if a datetime was provided
          queryParamsCode += `  if (bundle.inputData.${param.name}) {\n`;
          queryParamsCode += `    // Extract date part (YYYY-MM-DD) from input, handling both date strings and datetime strings\n`;
          queryParamsCode += `    const ${param.name}Value = String(bundle.inputData.${param.name});\n`;
          queryParamsCode += `    params.${param.name} = ${param.name}Value.includes('T') ? ${param.name}Value.split('T')[0] : ${param.name}Value.split(' ')[0];\n`;
          queryParamsCode += `  }\n`;
        } else {
          queryParamsCode += `  if (bundle.inputData.${param.name}) {\n`;
          queryParamsCode += `    params.${param.name} = bundle.inputData.${param.name};\n`;
          queryParamsCode += `  }\n`;
        }
      }
    });
    
    paramsCode = 'params: params,';
  } else {
    queryParamsCode = '  // No query parameters';
  }

  // Build response code (for triggers, return array or array property)
  // Triggers must return an array of items for Zapier to process and deduplicate
  // Zapier will automatically extract 'id' from each item and deduplicate all items
  let responseCode = '';
  
  // Check if arrayProperty is explicitly configured in trigger config
  const configuredArrayProp = triggerConfig.arrayProperty;
  
  if (configuredArrayProp) {
    // Use explicitly configured array property (most reliable)
    // Zapier will process ALL items in this array and deduplicate each by 'id'
    responseCode = `response.json.${configuredArrayProp} || []`;
  } else if (successResponse && successResponse.schema) {
    // Auto-detect: First, resolve $ref if present to get the actual schema structure
    let schemaToCheck = successResponse.schema;
    if (schemaToCheck.$ref) {
      const resolved = mapper.resolveRef(schemaToCheck.$ref);
      if (resolved) {
        schemaToCheck = resolved;
      }
    }
    
    // getArrayPropertyName handles $ref resolution internally, so call it first
    let arrayProp = mapper.getArrayPropertyName(schemaToCheck);
    
    // If not found, try common array property names as fallback
    if (!arrayProp && schemaToCheck.type === 'object' && schemaToCheck.properties) {
      const commonArrayNames = ['transactions', 'items', 'data', 'results', 'records', 'list'];
      for (const propName of commonArrayNames) {
        if (schemaToCheck.properties[propName]) {
          const prop = schemaToCheck.properties[propName];
          // Check if it's an array (handle $ref)
          let propSchema = prop;
          if (prop.$ref) {
            propSchema = mapper.resolveRef(prop.$ref) || prop;
          }
          if (propSchema && propSchema.type === 'array') {
            arrayProp = propName;
            break;
          }
        }
      }
    }
    
    if (arrayProp) {
      // Response is an object with an array property (e.g., { transactions: [...] })
      // Extract the array property - Zapier will process ALL items in the array
      // and deduplicate each one by comparing their 'id' fields against previously seen IDs
      responseCode = `response.json.${arrayProp} || []`;
    } else if (schemaToCheck && schemaToCheck.type === 'array') {
      // Response is directly an array
      responseCode = 'response.json || []';
    } else {
      // Fallback: wrap in array (shouldn't happen for proper triggers)
      responseCode = '[response.json]';
    }
  } else {
    // No schema info, try to return as-is or wrap in array
    responseCode = 'response.json || []';
  }
  
  // Use filter code from config if provided, otherwise placeholder
  const filterCode = triggerConfig.filterCode || '  // Add custom filtering logic here if needed';

  // Build input fields code
  const inputFieldsCode = inputFields.length > 0
    ? '\n' + inputFields.map(field => {
        const parts = [`      key: '${field.key}'`, `label: '${field.label}'`, `type: '${field.type}'`];
        if (field.helpText) {
          const escapedHelpText = field.helpText
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r');
          parts.push(`helpText: '${escapedHelpText}'`);
        }
        if (field.required) {
          parts.push('required: true');
        }
        // Include choices for enum fields (dropdown support)
        if (field.choices && Array.isArray(field.choices) && field.choices.length > 0) {
          // Zapier supports both string arrays and {label, value} objects
          // Use the format that was generated by schema_mapper
          parts.push(`choices: ${JSON.stringify(field.choices)}`);
        }
        // Only include default for string fields (Zapier validation is strict about defaults)
        if (field.default !== undefined && field.type === 'string') {
          parts.push(`default: ${JSON.stringify(String(field.default))}`);
        }
        return `      {\n        ${parts.join(',\n        ')}\n      }`;
      }).join(',\n') + '\n    '
    : '';

  // Build sample code for triggers
  // Zapier requires sample to be a single object (one item from the array the trigger returns)
  // This object MUST have an 'id' field at the top level for deduplication (D010)
  // Zapier automatically deduplicates by tracking all IDs it has seen
  let sampleObject = null;
  if (sample) {
    if (Array.isArray(sample)) {
      // For arrays, use the first item as the sample (represents one item from trigger results)
      sampleObject = sample.length > 0 ? sample[0] : {};
    } else if (typeof sample === 'object') {
      // Check if this is a wrapper object with an array property (e.g., { transactions: [...] })
      // For triggers, we need to extract the first item from the array
      const arrayKeys = Object.keys(sample).filter(key => 
        Array.isArray(sample[key]) && sample[key].length > 0
      );
      
      if (arrayKeys.length > 0) {
        // Extract first item from the first array property found
        // This handles cases like { transactions: [{id: 1, ...}], has_more: false }
        sampleObject = sample[arrayKeys[0]][0];
      } else {
        // It's already a single object, use it directly
        sampleObject = sample;
      }
    } else {
      // For primitives, wrap in an object
      sampleObject = { value: sample };
    }
  } else {
    // No sample available, use empty object (Zapier requires an object)
    sampleObject = {};
  }
  
  // Remove sensitive fields from sample (Zapier requirement D001 - no password fields)
  if (typeof sampleObject === 'object' && !Array.isArray(sampleObject)) {
    const sensitiveFields = ['password', 'passwd', 'pwd', 'secret', 'token', 'apiKey', 'api_key'];
    sensitiveFields.forEach(key => {
      if (sampleObject.hasOwnProperty(key)) {
        delete sampleObject[key];
      }
    });
  }
  
  // Ensure sample has at least one property (Zapier validation requirement)
  if (typeof sampleObject === 'object' && !Array.isArray(sampleObject) && Object.keys(sampleObject).length === 0) {
    // Add a placeholder property to satisfy Zapier's minimum property requirement
    sampleObject = { id: 0 };
  }
  
  // Ensure sample has an 'id' field for deduplication (D010 requirement)
  // If it doesn't have one, try to find a common ID field name
  if (typeof sampleObject === 'object' && !Array.isArray(sampleObject)) {
    if (!sampleObject.hasOwnProperty('id')) {
      // Check for common ID field names
      const idFieldNames = ['_id', 'ID', 'Id', 'transaction_id', 'item_id', 'record_id'];
      for (const idField of idFieldNames) {
        if (sampleObject.hasOwnProperty(idField)) {
          // Copy the ID field to 'id' for Zapier deduplication
          sampleObject.id = sampleObject[idField];
          break;
        }
      }
      
      // If still no ID, add a placeholder (but this will cause D010 warning)
      if (!sampleObject.hasOwnProperty('id')) {
        sampleObject.id = 0;
      }
    }
  }
  
  const sampleCode = `sample: ${JSON.stringify(sampleObject, null, 2)},`;

  // Escape description
  const escapeForJsString = (str) => {
    if (!str) return '';
    return str
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r');
  };

  // Use title from config (required and validated), fallback to endpoint description
  let description = triggerConfig.title || endpoint.description || endpoint.summary || '';
  
  // Ensure description ends with a period (Zapier requirement D021)
  if (description && !description.trim().endsWith('.')) {
    description = description.trim() + '.';
  }
  
  // Truncate description to 1000 characters (Zapier limit)
  if (description.length > 1000) {
    description = description.substring(0, 997) + '...';
  }

  const templateData = {
    key,
    noun,
    displayLabel,
    description: escapeForJsString(description),
    operationId: endpoint.operationId,
    method: endpoint.method.toUpperCase(),
    path: endpoint.path,
    baseUrl,
    pathParamsCode,
    queryParamsCode,
    paramsCode,
    responseCode,
    filterCode,
    inputFieldsCode,
    sampleCode,
  };

  return generator.generate('trigger.template.js', templateData);
}

// Generate authentication file
function generateAuthentication(baseUrl, generator, authConfig) {
  // Build helpLink code (only if helpLink is provided)
  const helpLinkCode = authConfig.helpLink 
    ? `      helpLink: "${authConfig.helpLink}",`
    : '';
  
  // Build connectionLabel code
  let connectionLabelCode;
  if (authConfig.connectionLabel.type === 'function') {
    // Function format: (bundle) => { ... }
    connectionLabelCode = `(bundle) => ${authConfig.connectionLabel.value}`;
  } else {
    // String format: just the string value
    connectionLabelCode = `"${authConfig.connectionLabel.value}"`;
  }
  
  // Build Authorization header string (fieldKey needs to be inserted into template literal)
  const authHeader = `Authorization: \`Bearer \${bundle.authData.${authConfig.fieldKey}}\`,`;
  
  const templateData = {
    baseUrl,
    testEndpoint: authConfig.testEndpoint,
    authType: authConfig.authType,
    fieldKey: authConfig.fieldKey,
    fieldLabel: authConfig.fieldLabel,
    fieldType: authConfig.fieldType,
    helpText: authConfig.helpText,
    helpLinkCode,
    connectionLabel: connectionLabelCode,
    authHeader,
  };
  return generator.generate('authentication.template.js', templateData);
}

// Generate index.js
function generateIndex(version, actions, triggers, generator, authConfig) {
  const actionsRequires = actions.map(a => `const ${a.key} = require('./actions/${a.key}');`).join('\n') || '// No actions';
  const triggersRequires = triggers.map(t => `const ${t.key} = require('./triggers/${t.key}');`).join('\n') || '// No triggers';
  const actionsCode = actions.map(a => `    ${a.key}: ${a.key}`).join(',\n') || '    // No actions';
  const triggersCode = triggers.map(t => `    ${t.key}: ${t.key}`).join(',\n') || '    // No triggers';
  
  // Build beforeRequest hook code with dynamic fieldKey
  const fieldKey = authConfig.fieldKey || 'access_token';
  const beforeRequestCode = `    (request, z, bundle) => {
      // Remove ${fieldKey} from query params if Zapier added it automatically
      if (request.params && request.params.${fieldKey}) {
        delete request.params.${fieldKey};
      }
      // Remove from URL if it was added as a query string
      if (request.url && request.url.includes('${fieldKey}=')) {
        request.url = request.url.replace(/[?&]${fieldKey}=[^&]*/, '');
        // Clean up any trailing ? or & after removal
        request.url = request.url.replace(/[?&]$/, '');
        request.url = request.url.replace(/\\?&/, '?');
      }
      // Add authentication header if not already present
      if (!request.headers.Authorization) {
        request.headers.Authorization = \`Bearer \${bundle.authData.${fieldKey}}\`;
      }
      return request;
    }`;
  
  // Build afterResponse hook to handle 4XX errors nicely
  const afterResponseCode = `    (response, z, bundle) => {
      // Handle 4XX client errors with user-friendly messages
      if (response.status >= 400 && response.status < 500) {
        let errorMessage = \`API Error (\${response.status})\`;
        let errorDetails = [];
        
        try {
          // Try to parse the error response body
          const errorBody = typeof response.content === 'string' 
            ? JSON.parse(response.content) 
            : response.json || response.content;
          
          // Extract error message if available
          if (errorBody && errorBody.message) {
            errorMessage = errorBody.message;
          }
          
          // Extract detailed errors if available
          if (errorBody && Array.isArray(errorBody.errors) && errorBody.errors.length > 0) {
            errorDetails = errorBody.errors.map(err => {
              // Handle different error formats
              if (typeof err === 'string') {
                return err;
              } else if (err.errMsg) {
                return err.errMsg;
              } else if (err.message) {
                return err.message;
              } else if (err.field && err.message) {
                return \`\${err.field}: \${err.message}\`;
              }
              return JSON.stringify(err);
            });
          } else if (errorBody && errorBody.error) {
            // Some APIs return a single error object
            errorDetails = [typeof errorBody.error === 'string' ? errorBody.error : JSON.stringify(errorBody.error)];
          }
        } catch (e) {
          // If parsing fails, use the raw content or status text
          if (response.content) {
            errorDetails = [String(response.content).substring(0, 200)];
          }
        }
        
        // Combine message and details
        let fullErrorMessage = errorMessage;
        if (errorDetails.length > 0) {
          fullErrorMessage += '\\n\\n' + errorDetails.join('\\n');
        }
        
        // Throw a Zapier error with the formatted message
        throw new z.errors.Error(fullErrorMessage, 'API_ERROR', response.status);
      }
      
      // For other errors, let Zapier handle them normally
      return response;
    }`;
  
  const templateData = {
    version,
    actionsRequires,
    triggersRequires,
    actionsCode,
    triggersCode,
    beforeRequestCode,
    afterResponseCode,
  };
  return generator.generate('index.template.js', templateData);
}

// Get exact version of a package from npm
// For zapier-platform-core, we use version 18.x which requires Node 22+
function getExactVersion(packageName) {
  try {
    let version;
    if (packageName === 'zapier-platform-core' || packageName === 'zapier-platform-cli') {
      // Use version 18.x (requires Node 22+)
      // Get all versions and find the latest 18.x
      const versionsJson = execSync(`npm view ${packageName} versions --json`, { encoding: 'utf8' });
      const versions = JSON.parse(versionsJson);
      // Filter for 18.x versions and get the latest
      const v18Versions = versions.filter(v => v.startsWith('18.'));
      if (v18Versions.length > 0) {
        version = v18Versions[v18Versions.length - 1];
      } else {
        // Fallback to latest if no 18.x found
        version = execSync(`npm view ${packageName} version`, { encoding: 'utf8' }).trim();
      }
    } else {
      version = execSync(`npm view ${packageName} version`, { encoding: 'utf8' }).trim();
    }
    return version;
  } catch (error) {
    console.warn(`Warning: Could not fetch version for ${packageName}, using fallback`);
    // Fallback to a known working version
    if (packageName === 'zapier-platform-core') {
      return '18.0.1';
    } else if (packageName === 'zapier-platform-cli') {
      return '18.0.1';
    }
    return 'latest';
  }
}

// Generate package.json
async function generatePackageJson(version, generator) {
  // Fetch exact versions required by Zapier
  const zapierCoreVersion = getExactVersion('zapier-platform-core');
  const zapierCliVersion = getExactVersion('zapier-platform-cli');
  
  const templateData = {
    version,
    zapierCoreVersion,
    zapierCliVersion,
  };
  return generator.generate('package.template.json', templateData);
}

// Generate .zapierapprc
function generateZapierAppRc(appId, version, generator) {
  const templateData = {
    appId,
    version,
  };
  return generator.generate('.zapierapprc.template', templateData);
}

// Clean output directory
function cleanOutputDir(outputDir) {
  if (fs.existsSync(outputDir)) {
    console.log(`🧹 Cleaning output directory: ${outputDir}`);
    fs.rmSync(outputDir, { recursive: true, force: true });
    console.log('✅ Output directory cleaned');
  } else {
    console.log('ℹ️  Output directory does not exist, nothing to clean');
  }
}

// Main generation function
async function generate() {
  const config = parseArgs();
  const generator = new CodeGenerator();

  console.log('🚀 Starting Zapier integration generation...');
  console.log(`📥 Schema URL: ${config.schemaUrl}`);
  console.log(`📂 Output directory: ${config.outputDir}`);

  // Clean output directory if requested
  if (config.clean) {
    cleanOutputDir(config.outputDir);
  }

  // Parse OpenAPI schema
  console.log('\n📖 Parsing OpenAPI schema...');
  const parser = new OpenAPIParser(config.schemaUrl);
  
  try {
    await parser.load(config.updateCache);
    if (config.updateCache) {
      console.log('✅ Schema cache updated');
    } else {
      console.log('✅ Schema loaded from cache');
    }
  } catch (error) {
    console.error(`❌ Error loading schema: ${error.message}`);
    process.exit(1);
  }

  const version = parser.getVersion();
  if (!version) {
    console.error('❌ Error: Could not extract version from OpenAPI schema');
    process.exit(1);
  }
  console.log(`📌 Detected version: ${version}`);

  const baseUrl = parser.getBaseUrl();
  console.log(`🌐 Base URL: ${baseUrl}`);

  // Extract endpoints
  console.log('\n🔍 Extracting endpoints...');
  const endpoints = parser.extractEndpoints();
  console.log(`✅ Found ${endpoints.length} endpoints`);

  // Filter endpoints based on config, or use all endpoints
  let targetEndpoints = endpoints;
  if (config.endpoint) {
    targetEndpoints = endpoints.filter(e => e.path === config.endpoint);
    if (targetEndpoints.length === 0) {
      console.error(`❌ Error: Endpoint ${config.endpoint} not found`);
      process.exit(1);
    }
    console.log(`📋 Generating for specific endpoint: ${targetEndpoints.map(e => `${e.method.toUpperCase()} ${e.path}`).join(', ')}`);
  } else {
    // Generate for all endpoints
    console.log(`📋 Generating for all ${targetEndpoints.length} endpoint(s) in the schema`);
  }

  console.log(`🎯 Generating integration for ${targetEndpoints.length} endpoint(s)...`);

  // Initialize schema mapper
  const schemas = parser.getSchemas();
  const mapper = new SchemaMapper(schemas);

  // Load trigger configuration
  const triggerConfig = loadTriggerConfig();
  console.log(`📋 Loaded trigger config: ${Object.keys(triggerConfig.triggers || {}).length} trigger(s) defined`);

  // Load action configuration
  const actionConfig = loadActionConfig();
  console.log(`📋 Loaded action config: ${Object.keys(actionConfig.actions || {}).length} action(s) configured`);

  // Load authentication configuration
  const authConfig = loadAuthConfig();
  console.log(`📋 Loaded authentication config: testEndpoint="${authConfig.testEndpoint}", fieldKey="${authConfig.fieldKey}"`);

  // Classify endpoints
  const actions = [];
  const triggers = [];
  const addedTriggerKeys = new Set(); // Track triggers already added to avoid duplicates

  for (const endpoint of targetEndpoints) {
    // Check if this action should be omitted
    const endpointActionConfig = actionConfig.actions?.[endpoint.operationId];
    if (endpointActionConfig && endpointActionConfig.omit === true) {
      console.log(`  ⏭️  Skipping omitted action: ${endpoint.operationId}`);
      continue;
    }
    
    // Add as action (endpoints can be both trigger and action)
    actions.push({ endpoint, key: endpoint.operationId, actionConfig: endpointActionConfig || {} });
    
    // Only create triggers for GET endpoints (triggers poll for data, which is what GET does)
    // PUT, POST, DELETE are actions only, not triggers
    if (endpoint.method.toLowerCase() !== 'get') {
      continue;
    }
    
    // Check if this endpoint should also be a trigger (from config only)
    const pathKey = endpoint.path;
    const triggerConfigForPath = triggerConfig.triggers?.[pathKey];
    
    if (triggerConfigForPath) {
      const triggerKey = triggerConfigForPath.key || endpoint.operationId;
      
      // Validate required title field
      if (!triggerConfigForPath.title) {
        console.error(`❌ Error: Trigger config for "${pathKey}" is missing required "title" field`);
        process.exit(1);
      }
      
      // Validate title format (must start with "Triggers when ")
      if (!triggerConfigForPath.title.startsWith('Triggers when ')) {
        console.error(`❌ Error: Trigger config for "${pathKey}" has invalid title format. Title must start with "Triggers when "`);
        console.error(`   Current title: "${triggerConfigForPath.title}"`);
        process.exit(1);
      }
      
      // Only add trigger once per key (avoid duplicates when multiple methods share same path)
      if (!addedTriggerKeys.has(triggerKey)) {
        triggers.push({
          endpoint,
          key: triggerKey,
          customName: triggerConfigForPath.name,
          title: triggerConfigForPath.title,
          arrayProperty: triggerConfigForPath.arrayProperty,
          queryParams: triggerConfigForPath.queryParams || {},
          filterCode: triggerConfigForPath.filter || '  // No custom filtering',
        });
        addedTriggerKeys.add(triggerKey);
      }
    }
    // Auto-detection disabled: only create triggers explicitly defined in triggers-config.json
  }

  // Generate files
  console.log('\n📝 Generating files...');

  // Create output directories
  const actionsDir = path.join(config.outputDir, 'actions');
  const triggersDir = path.join(config.outputDir, 'triggers');
  fs.mkdirSync(actionsDir, { recursive: true });
  fs.mkdirSync(triggersDir, { recursive: true });

  // Generate action files
  for (const action of actions) {
    const code = generateAction(action.endpoint, baseUrl, mapper, generator, action.actionConfig || {});
    const filePath = path.join(actionsDir, `${action.key}.js`);
    const formatted = await formatCode(code, filePath);
    generator.writeFile(filePath, formatted);
    console.log(`  ✅ Generated: actions/${action.key}.js`);
  }

  // Generate trigger files
  for (const trigger of triggers) {
    const code = generateTrigger(trigger, baseUrl, mapper, generator);
    const triggerPath = path.join(triggersDir, `${trigger.key}.js`);
    const formattedTrigger = await formatCode(code, triggerPath);
    generator.writeFile(triggerPath, formattedTrigger);
    const triggerName = trigger.customName || trigger.key;
    console.log(`  ✅ Generated: triggers/${trigger.key}.js (${triggerName})`);
  }

  // Generate authentication.js
  const authCode = generateAuthentication(baseUrl, generator, authConfig);
  const authPath = path.join(config.outputDir, 'authentication.js');
  const formattedAuth = await formatCode(authCode, authPath);
  generator.writeFile(authPath, formattedAuth);
  console.log(`  ✅ Generated: authentication.js`);

  // Generate index.js
  const indexCode = generateIndex(version, actions, triggers, generator, authConfig);
  const indexPath = path.join(config.outputDir, 'index.js');
  const formattedIndex = await formatCode(indexCode, indexPath);
  generator.writeFile(indexPath, formattedIndex);
  console.log(`  ✅ Generated: index.js`);

  // Generate package.json
  const packageCode = await generatePackageJson(version, generator);
  const packagePath = path.join(config.outputDir, 'package.json');
  const formattedPackage = await formatCode(packageCode, packagePath);
  generator.writeFile(packagePath, formattedPackage);
  console.log(`  ✅ Generated: package.json`);

  // Generate .zapierapprc (only if appId is provided)
  if (DEFAULT_APP_ID) {
    const zapierAppRcCode = generateZapierAppRc(DEFAULT_APP_ID, version, generator);
    const zapierAppRcPath = path.join(config.outputDir, '.zapierapprc');
    // Don't format JSON files with Prettier's babel parser
    generator.writeFile(zapierAppRcPath, zapierAppRcCode);
    console.log(`  ✅ Generated: .zapierapprc`);
  } else {
    console.log(`  ⚠️  Skipped: .zapierapprc (ZAPIER_APP_ID not set - configure manually or set in .env)`);
  }

  // Generate .gitignore
  const gitignoreCode = generator.generate('.gitignore.template', {});
  const gitignorePath = path.join(config.outputDir, '.gitignore');
  generator.writeFile(gitignorePath, gitignoreCode);
  console.log(`  ✅ Generated: .gitignore`);

  // Create symlink to top-level test directory if it exists
  const topLevelTestDir = path.join(process.cwd(), 'test');
  const generatedTestLink = path.join(config.outputDir, 'test');
  
  if (fs.existsSync(topLevelTestDir)) {
    // Remove existing symlink or directory if it exists
    try {
      if (fs.existsSync(generatedTestLink)) {
        const stats = fs.lstatSync(generatedTestLink);
        if (stats.isSymbolicLink()) {
          fs.unlinkSync(generatedTestLink);
        } else if (stats.isDirectory()) {
          // If it's a directory (not a symlink), we should warn but not remove it
          // as it might contain user's test files
          console.log(`  ⚠️  Warning: ${generatedTestLink} already exists as a directory. Skipping symlink creation.`);
          console.log(`     To use the top-level test directory, remove ${generatedTestLink} and regenerate.`);
        }
      }
      
      // Create symlink only if the target doesn't exist or was successfully removed
      if (!fs.existsSync(generatedTestLink)) {
        // Use relative path for symlink to make it portable
        const relativeTestPath = path.relative(config.outputDir, topLevelTestDir);
        fs.symlinkSync(relativeTestPath, generatedTestLink, 'dir');
        console.log(`  ✅ Created symlink: test/ -> ${relativeTestPath}`);
      }
    } catch (error) {
      console.warn(`  ⚠️  Warning: Could not create symlink to test directory: ${error.message}`);
    }
  } else {
    // Create empty test directory structure if it doesn't exist
    const testActionsDir = path.join(topLevelTestDir, 'actions');
    const testTriggersDir = path.join(topLevelTestDir, 'triggers');
    try {
      fs.mkdirSync(testActionsDir, { recursive: true });
      fs.mkdirSync(testTriggersDir, { recursive: true });
      // Create a .gitkeep file to ensure the directories are tracked
      fs.writeFileSync(path.join(testActionsDir, '.gitkeep'), '');
      fs.writeFileSync(path.join(testTriggersDir, '.gitkeep'), '');
      
      // Now create the symlink
      const relativeTestPath = path.relative(config.outputDir, topLevelTestDir);
      if (fs.existsSync(generatedTestLink)) {
        const stats = fs.lstatSync(generatedTestLink);
        if (stats.isSymbolicLink()) {
          fs.unlinkSync(generatedTestLink);
        }
      }
      fs.symlinkSync(relativeTestPath, generatedTestLink, 'dir');
      console.log(`  ✅ Created test directory structure and symlink: test/ -> ${relativeTestPath}`);
    } catch (error) {
      console.warn(`  ⚠️  Warning: Could not create test directory or symlink: ${error.message}`);
    }
  }

  console.log('\n✨ Generation complete!');
  console.log(`\n📋 Next steps (run from project root):`);
  console.log(`   1. npm run zapier:install  (install dependencies in generated/)`);
  console.log(`   2. npm run zapier:test     (test the integration)`);
  console.log(`   3. npm run zapier:push     (deploy to Zapier)`);
  console.log(`\n   Or work directly in ${config.outputDir}:`);
  console.log(`   1. cd ${config.outputDir}`);
  console.log(`   2. npm install`);
  console.log(`   3. npm test`);
  console.log(`   4. npx zapier-platform-cli push`);
  console.log(`\n💡 Tip: Use 'npm run generate:clean' to remove generated directory before generation`);
}

// Run the generator
generate().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

 