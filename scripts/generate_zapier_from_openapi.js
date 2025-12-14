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
function parseJsonWithComments(configContent) {
  let result = '';
  let inString = false;
  let stringChar = null;
  let escaped = false;
  let i = 0;

  while (i < configContent.length) {
    const ch = configContent[i];
    const next = configContent[i + 1];

    if (escaped) {
      result += ch;
      escaped = false;
      i += 1;
      continue;
    }

    if (ch === '\\' && inString) {
      escaped = true;
      result += ch;
      i += 1;
      continue;
    }

    if (!inString && ch === '/' && next === '*') {
      // Skip block comment
      i += 2;
      while (i < configContent.length && !(configContent[i] === '*' && configContent[i + 1] === '/')) {
        i += 1;
      }
      i += 2; // skip closing */
      continue;
    }

    if (!inString && ch === '/' && next === '/') {
      // Skip line comment
      i += 2;
      while (i < configContent.length && configContent[i] !== '\n') {
        i += 1;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      if (!inString) {
        inString = true;
        stringChar = ch;
      } else if (stringChar === ch) {
        inString = false;
        stringChar = null;
      }
      result += ch;
      i += 1;
      continue;
    }

    result += ch;
    i += 1;
  }

  return JSON.parse(result);
}

// ============================================================================
// Helper Functions for Code Generation
// ============================================================================

/**
 * Escape a string for use in a JavaScript string literal (single quotes)
 */
function escapeForJsString(str) {
  if (!str) return '';
  return str
    .replace(/\\/g, '\\\\')  // Escape backslashes first
    .replace(/'/g, "\\'")     // Escape single quotes
    .replace(/\n/g, '\\n')    // Escape newlines
    .replace(/\r/g, '\\r');   // Escape carriage returns
}

/**
 * Escape a string for use in a JavaScript template literal (backticks)
 * Escapes backticks and backslashes, but NOT $ signs (so ${var} remains)
 */
function escapeForTemplate(str) {
  return str
    .replace(/\\/g, '\\\\')  // Escape backslashes first
    .replace(/`/g, '\\`');   // Escape backticks
}

/**
 * Escape a string for use in a Function constructor string
 * Escapes backticks, backslashes, single quotes, and $ signs
 */
function escapeForFunctionString(str) {
  return str
    .replace(/\\/g, '\\\\')  // Escape backslashes first
    .replace(/`/g, '\\`')    // Escape backticks
    .replace(/'/g, "\\'")     // Escape single quotes
    .replace(/\$/g, '\\$');  // Escape $ to prevent evaluation in our string
}

/**
 * Replace template variables (${varExpr}) with their mapped variable names (${varName})
 * Used for simple templates where variables are extracted to const declarations
 */
function replaceTemplateVars(template, varMap) {
  let processed = template;
  varMap.forEach((varName, varExpr) => {
    // Match ${varExpr} in the template
    // Escape special regex characters in varExpr (like . in transaction_criteria.payee)
    const escapedVarExpr = varExpr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Build regex to match ${varExpr} - need to escape $ and { in the pattern
    const regex = new RegExp('\\$\\{' + escapedVarExpr + '\\}', 'g');
    // Replace with ${varName} - use string concatenation to create literal string
    const replacement = '$' + '{' + varName + '}';
    processed = processed.replace(regex, replacement);
  });
  return processed;
}

/**
 * Replace template variables with item.property access for nested templates
 * Used when template has nested template literals and needs Function constructor
 */
function replaceTemplateVarsForNested(template) {
  return template.replace(/\$\{([a-zA-Z_][a-zA-Z0-9_.]*)\}/g, (match, varName) => {
    if (varName.startsWith('item.')) {
      return match;
    }
    return '${item.' + varName + '}';
  });
}

/**
 * Generate label code for "simple template + complex fallback" case
 * This is used when the main template is simple but the fallback has nested templates
 */
function generateSimpleTemplateComplexFallbackCode(varCode, escapedTemplate, escapedFallback) {
  return '\n  // Add name field for dynamic dropdown display (Zapier uses \'name\' field for labels)\n' +
    '  results = results.map((item) => {\n' +
    varCode +
    '    // Use simple template literal for main template\n' +
    '    let name = `' + escapedTemplate + '`.trim();\n' +
    '    \n' +
    '    // Use Function constructor for complex fallback if main template is empty\n' +
    '    if (!name || name.trim() === \'\') {\n' +
    '      try {\n' +
    '        const fallbackFunc = new Function(\'item\', \'return \\`' + escapedFallback + '\\`;\');\n' +
    '        name = fallbackFunc(item);\n' +
    '      } catch (e) {\n' +
    '        name = \'Item \' + (item.id || \'\');\n' +
    '      }\n' +
    '    }\n' +
    '    \n' +
    '    return {\n' +
    '      ...item,\n' +
    '      name: name || item.description || (\'Item \' + (item.id || \'\')),\n' +
    '    };\n' +
    '  });';
}

/**
 * Generate label code for "complex template + complex fallback" case
 * Both template and fallback use Function constructor
 */
function generateComplexTemplateComplexFallbackCode(varCode, escapedTemplate, escapedFallback) {
  return '\n  // Add name field for dynamic dropdown display (Zapier uses \'name\' field for labels)\n' +
    '  results = results.map((item) => {\n' +
    varCode +
    '    // Evaluate complex template with nested literals\n' +
    '    let name = \'\';\n' +
    '    try {\n' +
    '      const templateFunc = new Function(\'item\', \'return \\`' + escapedTemplate + '\\`;\');\n' +
    '      name = templateFunc(item);\n' +
    '      if (!name || name.trim() === \'\') {\n' +
    '        const fallbackFunc = new Function(\'item\', \'return \\`' + escapedFallback + '\\`;\');\n' +
    '        name = fallbackFunc(item);\n' +
    '      }\n' +
    '    } catch (e) {\n' +
    '      try {\n' +
    '        const fallbackFunc = new Function(\'item\', \'return \\`' + escapedFallback + '\\`;\');\n' +
    '        name = fallbackFunc(item);\n' +
    '      } catch (e2) {\n' +
    '        name = \'Item \' + (item.id || \'\');\n' +
    '      }\n' +
    '    }\n' +
    '    \n' +
    '    return {\n' +
    '      ...item,\n' +
    '      name: name || item.description || (\'Item \' + (item.id || \'\')),\n' +
    '    };\n' +
    '  });';
}

/**
 * Generate label code for "simple template + simple fallback" case
 * Both use simple template literals
 */
function generateSimpleTemplateSimpleFallbackCode(varCode, escapedTemplate, escapedFallback) {
  return '\n  // Add name field for dynamic dropdown display (Zapier uses \'name\' field for labels)\n' +
    '  results = results.map((item) => {\n' +
    varCode +
    '    const name = `' + escapedTemplate + '`.trim();\n' +
    '    \n' +
    '    return {\n' +
    '      ...item,\n' +
    '      name: name || `' + escapedFallback + '` || item.description || `Item ${item.id}`,\n' +
    '    };\n' +
    '  });';
}

function loadTriggerConfig() {
  const configPath = TRIGGER_CONFIG_PATH;
  if (!fs.existsSync(configPath)) {
    return { triggers: {} };
  }
  
  try {
    const configContent = fs.readFileSync(configPath, 'utf8');
    const config = parseJsonWithComments(configContent);
    const triggers = config.triggers || {};
    
    // Validate that all triggers have the required 'endpoint' property
    for (const [triggerKey, triggerConfig] of Object.entries(triggers)) {
      if (!triggerConfig.endpoint) {
        console.error(`❌ Error: Trigger "${triggerKey}" is missing required "endpoint" property.`);
        console.error(`   Each trigger must specify an "endpoint" property with the API path (e.g., "/categories").`);
        process.exit(1);
      }
    }
    
    return { triggers };
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
    return parseJsonWithComments(configContent);
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
    return parseJsonWithComments(configContent);
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
    version: null, // Override version from OpenAPI spec
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
    } else if (arg === '--version' && args[i + 1]) {
      config.version = args[++i];
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
function generateAction(endpoint, baseUrl, mapper, generator, actionConfig = {}, triggerConfig = {}) {
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
  
  // Get dynamic fields config early (needed for request body code generation)
  const dynamicFieldsConfig = actionConfig.dynamicFields || {};
  const dynamicFieldKeys = new Set(Object.keys(dynamicFieldsConfig));
  
  // Get helper fields config (UI-only fields that map to API properties)
  const helperFieldsConfig = actionConfig.helperFields || {};
  
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
          // Filter out hidden properties from item fields (for nested objects)
          const filteredItemFields = itemFields.filter(field => !hideRequestBodyProperties.has(field.key));
          
          // Create a parent object field with the filtered item fields as children
          const parentKey = publicName.toLowerCase().replace(/\s+/g, '_'); // Convert "New Transaction" to "new_transaction"
          const parentField = {
            key: parentKey,
            label: publicName,
            type: 'object',
            children: filteredItemFields,
            required: true
          };
          bodyFields.push(parentField);
          
          // Store reference to parent field for later use (for adding helper fields as children)
          // We'll add this to a variable that can be accessed when processing helper fields
          if (!inputFields._parentFieldRefs) {
            inputFields._parentFieldRefs = {};
          }
          inputFields._parentFieldRefs[parentKey] = parentField;
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
    // For nested parent fields, also filter their children
    bodyFields = bodyFields.map(field => {
      if (field.children && Array.isArray(field.children)) {
        // Filter children of nested objects
        return {
          ...field,
          children: field.children.filter(child => !hideRequestBodyProperties.has(child.key))
        };
      }
      return field;
    }).filter(field => !hideRequestBodyProperties.has(field.key));
    
    // Filter out body fields that have the same key as path/query params
    const uniqueBodyFields = bodyFields.filter(field => !existingFieldKeys.has(field.key));
    inputFields.push(...uniqueBodyFields);
    // Update the set for any future checks
    uniqueBodyFields.forEach(field => existingFieldKeys.add(field.key));
    
    // Clean up the temporary reference storage
    if (inputFields._parentFieldRefs) {
      delete inputFields._parentFieldRefs;
    }
  }
  
  // Add helper fields (UI-only fields that map to API properties)
  if (Object.keys(helperFieldsConfig).length > 0) {
    // For simplified actions with nested objects, check if helper fields map to nested properties
    let parentFieldForNested = null;
    if (isSimplified && simplify.flattenArray && simplify.flattenArray.publicName) {
      const parentKey = simplify.flattenArray.publicName.toLowerCase().replace(/\s+/g, '_');
      
      // Try to find parent field from the stored reference first, then from inputFields
      if (inputFields._parentFieldRefs && inputFields._parentFieldRefs[parentKey]) {
        parentFieldForNested = inputFields._parentFieldRefs[parentKey];
      } else {
        parentFieldForNested = inputFields.find(field => field.key === parentKey && field.children);
      }
      
      // Check which helper fields map to properties in the nested item schema
      if (parentFieldForNested) {
        const schemas = mapper.schemas || {};
        const itemSchema = schemas[simplify.flattenArray.itemSchema];
        const itemSchemaProperties = itemSchema && itemSchema.properties ? Object.keys(itemSchema.properties) : [];
        
        Object.entries(helperFieldsConfig).forEach(([helperKey, helperConfig]) => {
          // If helper field maps to a property in the nested item schema, add it as a child
          if (helperConfig.mapTo && itemSchemaProperties.includes(helperConfig.mapTo)) {
            const helperField = {
              key: helperKey,
              label: helperConfig.label || helperKey,
              type: helperConfig.type || 'string',
              helpText: helperConfig.helpText || '',
              required: false,
            };
            
            // Add dynamic dropdown support if configured
            if (helperConfig.dynamicFields && helperConfig.dynamicFields.sourceTrigger) {
              const sourceTrigger = helperConfig.dynamicFields.sourceTrigger;
              const valueField = helperConfig.dynamicFields.valueField || 'id';
              
              const triggerConfigs = triggerConfig.triggers || {};
              const triggerExists = triggerConfigs[sourceTrigger] !== undefined;
              
              if (triggerExists) {
                helperField.dynamic = true;
                helperField.dynamicKey = `${sourceTrigger}.${valueField}`;
              } else {
                console.warn(`  ⚠️  Warning: Source trigger "${sourceTrigger}" for helper field "${helperKey}" not found in trigger config. Skipping dynamic field.`);
              }
            }
            
            // Add as child of parent field
            parentFieldForNested.children.push(helperField);
            existingFieldKeys.add(helperKey);
            return; // Skip adding as top-level field
          }
        });
      }
    }
    
    // Add remaining helper fields as top-level fields (those that don't map to nested properties)
    Object.entries(helperFieldsConfig).forEach(([helperKey, helperConfig]) => {
      // Skip if already added as nested child
      if (existingFieldKeys.has(helperKey)) {
        return;
      }
      
      // Create field object for helper field
      const helperField = {
        key: helperKey,
        label: helperConfig.label || helperKey,
        type: helperConfig.type || 'string',
        helpText: helperConfig.helpText || '',
        required: false, // Helper fields are always optional
      };
      
      // Add dynamic dropdown support if configured
      if (helperConfig.dynamicFields && helperConfig.dynamicFields.sourceTrigger) {
        const sourceTrigger = helperConfig.dynamicFields.sourceTrigger;
        const valueField = helperConfig.dynamicFields.valueField || 'id';
        
        // Look up trigger config to verify it exists
        const triggerConfigs = triggerConfig.triggers || {};
        const triggerExists = triggerConfigs[sourceTrigger] !== undefined;
        
        if (triggerExists) {
          helperField.dynamic = true;
          helperField.dynamicKey = `${sourceTrigger}.${valueField}`;
        } else {
          console.warn(`  ⚠️  Warning: Source trigger "${sourceTrigger}" for helper field "${helperKey}" not found in trigger config. Skipping dynamic field.`);
        }
      }
      
      inputFields.push(helperField);
      existingFieldKeys.add(helperKey);
    });
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
        
        if (parentKey) {
          requestBodyCode += `  const get${arrayFieldName}Field = (key) => {\n`;
          requestBodyCode += `    const parent = bundle.inputData.${parentKey};\n`;
          requestBodyCode += `    if (parent && Object.prototype.hasOwnProperty.call(parent, key)) {\n`;
          requestBodyCode += `      return parent[key];\n`;
          requestBodyCode += `    }\n`;
          requestBodyCode += `    const flattenedKey = \`${parentKey}__\${key}\`;\n`;
          requestBodyCode += `    if (Object.prototype.hasOwnProperty.call(bundle.inputData, flattenedKey)) {\n`;
          requestBodyCode += `      return bundle.inputData[flattenedKey];\n`;
          requestBodyCode += `    }\n`;
          requestBodyCode += `    if (Object.prototype.hasOwnProperty.call(bundle.inputData, key)) {\n`;
          requestBodyCode += `      return bundle.inputData[key];\n`;
          requestBodyCode += `    }\n`;
          requestBodyCode += `    return undefined;\n`;
          requestBodyCode += `  };\n`;
        }
        
        itemFields.forEach(fieldKey => {
          // Check if this is a date field that needs format conversion
          const itemFieldSchema = itemSchema.properties[fieldKey];
          const isDateField = itemFieldSchema && itemFieldSchema.type === 'string' && itemFieldSchema.format === 'date';
          const isNumberField = itemFieldSchema && (itemFieldSchema.type === 'number' || itemFieldSchema.type === 'integer');
          const isBooleanField = itemFieldSchema && itemFieldSchema.type === 'boolean';
          
          if (isDateField) {
            // For date fields, extract just the date part (YYYY-MM-DD) if a datetime was provided
            // This handles cases where Zapier or the user provides a datetime string
            const accessor = parentKey ? `get${arrayFieldName}Field('${fieldKey}')` : `${inputDataPrefix}.${fieldKey}`;
            const valueVar = `${fieldKey}Value`;
            requestBodyCode += `  const ${valueVar} = ${accessor};\n`;
            requestBodyCode += `  if (${valueVar} !== undefined && ${valueVar} !== '') {\n`;
            requestBodyCode += `    // Extract date part (YYYY-MM-DD) from input, handling both date strings and datetime strings\n`;
            requestBodyCode += `    const ${valueVar}Str = String(${valueVar});\n`;
            requestBodyCode += `    ${arrayFieldName}Item.${fieldKey} = ${valueVar}Str.includes('T') ? ${valueVar}Str.split('T')[0] : ${valueVar}Str.split(' ')[0];\n`;
            requestBodyCode += `  }\n`;
          } else if (isNumberField) {
            const accessor = parentKey ? `get${arrayFieldName}Field('${fieldKey}')` : `${inputDataPrefix}.${fieldKey}`;
            const valueVar = `${fieldKey}Value`;
            requestBodyCode += `  const ${valueVar} = ${accessor};\n`;
            // Check if this is a dynamic field (ID field) that needs cleared value handling
            const isDynamicField = dynamicFieldKeys.has(fieldKey);
            if (isDynamicField) {
              // Only include if value is provided and not 0/null/empty (cleared dropdowns may send 0)
              requestBodyCode += `  // Only include ${fieldKey} if value is provided and not 0/null/empty (cleared dropdowns may send 0)\n`;
              requestBodyCode += `  if (${valueVar} !== undefined && ${valueVar} !== '' && ${valueVar} !== null && ${valueVar} !== 0) {\n`;
              requestBodyCode += `    const parsed = Number(${valueVar});\n`;
              requestBodyCode += `    if (!Number.isNaN(parsed) && parsed !== 0) {\n`;
              requestBodyCode += `      ${arrayFieldName}Item.${fieldKey} = parsed;\n`;
              requestBodyCode += `    }\n`;
              requestBodyCode += `  }\n`;
            } else {
              // Regular number field
              requestBodyCode += `  if (${valueVar} !== undefined && ${valueVar} !== '') {\n`;
              requestBodyCode += `    const parsed = Number(${valueVar});\n`;
              requestBodyCode += `    ${arrayFieldName}Item.${fieldKey} = Number.isNaN(parsed) ? ${valueVar} : parsed;\n`;
              requestBodyCode += `  }\n`;
            }
          } else if (isBooleanField) {
            const accessor = parentKey ? `get${arrayFieldName}Field('${fieldKey}')` : `${inputDataPrefix}.${fieldKey}`;
            const valueVar = `${fieldKey}Value`;
            requestBodyCode += `  const ${valueVar} = ${accessor};\n`;
            requestBodyCode += `  if (${valueVar} !== undefined && ${valueVar} !== '') {\n`;
            requestBodyCode += `    if (typeof ${valueVar} === 'boolean') {\n`;
            requestBodyCode += `      ${arrayFieldName}Item.${fieldKey} = ${valueVar};\n`;
            requestBodyCode += `    } else if (typeof ${valueVar} === 'string') {\n`;
            requestBodyCode += `      ${arrayFieldName}Item.${fieldKey} = ${valueVar}.toLowerCase() === 'true';\n`;
            requestBodyCode += `    } else {\n`;
            requestBodyCode += `      ${arrayFieldName}Item.${fieldKey} = Boolean(${valueVar});\n`;
            requestBodyCode += `    }\n`;
            requestBodyCode += `  }\n`;
          } else {
            const accessor = parentKey ? `get${arrayFieldName}Field('${fieldKey}')` : `${inputDataPrefix}.${fieldKey}`;
            const valueVar = `${fieldKey}Value`;
            requestBodyCode += `  const ${valueVar} = ${accessor};\n`;
            
            // Check if this is an array field that should be parsed from comma-separated string (e.g., tag_ids)
            const isArrayField = itemFieldSchema && (itemFieldSchema.type === 'array' || (itemFieldSchema.$ref && mapper.resolveRef(itemFieldSchema.$ref)?.type === 'array'));
            
            if (isArrayField) {
              // Array field - parse comma-separated string into array of numbers
              requestBodyCode += `  // Parse comma-separated string into array of numbers for ${fieldKey}\n`;
              requestBodyCode += `  if (${valueVar} !== undefined && ${valueVar} !== '') {\n`;
              requestBodyCode += `    // Parse comma-separated string into array of numbers\n`;
              requestBodyCode += `    if (typeof ${valueVar} === 'string') {\n`;
              requestBodyCode += `      const ${fieldKey}Array = ${valueVar}\n`;
              requestBodyCode += `        .split(',')\n`;
              requestBodyCode += `        .map((id) => parseInt(id.trim(), 10))\n`;
              requestBodyCode += `        .filter((id) => !isNaN(id));\n`;
              requestBodyCode += `      ${arrayFieldName}Item.${fieldKey} = ${fieldKey}Array;\n`;
              requestBodyCode += `    } else if (Array.isArray(${valueVar})) {\n`;
              requestBodyCode += `      // Already an array, use as-is (for backwards compatibility)\n`;
              requestBodyCode += `      ${arrayFieldName}Item.${fieldKey} = ${valueVar};\n`;
              requestBodyCode += `    }\n`;
              requestBodyCode += `  }\n`;
            } else {
              // Regular string field
              requestBodyCode += `  if (${valueVar} !== undefined && ${valueVar} !== '') {\n`;
              requestBodyCode += `    ${arrayFieldName}Item.${fieldKey} = ${valueVar};\n`;
              requestBodyCode += `  }\n`;
            }
          }
        });
        
        // Handle helper fields that map to properties in the nested item
        if (Object.keys(helperFieldsConfig).length > 0) {
          // Group helper fields by their mapTo property
          const helperFieldsByTarget = {};
          Object.entries(helperFieldsConfig).forEach(([helperKey, helperConfig]) => {
            if (helperConfig.mapTo) {
              // Check if this helper field maps to a nested property
              const itemSchemaProperties = itemSchema && itemSchema.properties ? Object.keys(itemSchema.properties) : [];
              const mapsToNested = itemSchemaProperties.includes(helperConfig.mapTo);
              
              if (!helperFieldsByTarget[helperConfig.mapTo]) {
                helperFieldsByTarget[helperConfig.mapTo] = {
                  helperKeys: [],
                  isNested: mapsToNested
                };
              }
              helperFieldsByTarget[helperConfig.mapTo].helperKeys.push(helperKey);
            }
          });
          
          // Generate merging code for each target property in the nested item
          Object.entries(helperFieldsByTarget).forEach(([targetProperty, config]) => {
            const helperKeys = config.helperKeys;
            const isNestedHelper = config.isNested;
            
            // Check if target property is an array field in the item schema
            let isArrayField = false;
            if (itemSchema && itemSchema.properties && itemSchema.properties[targetProperty]) {
              const targetSchema = itemSchema.properties[targetProperty];
              if (targetSchema.type === 'array') {
                isArrayField = true;
              } else if (targetSchema.$ref) {
                const resolved = mapper.resolveRef(targetSchema.$ref);
                if (resolved && resolved.type === 'array') {
                  isArrayField = true;
                }
              }
            }
            
            if (isArrayField) {
              // Generate code to merge helper fields into array property in nested item
              requestBodyCode += `  // Merge helper fields into ${arrayFieldName}Item.${targetProperty}\n`;
              requestBodyCode += `  const ${targetProperty}HelperIds = [];\n`;
              helperKeys.forEach(helperKey => {
                // Use the getField helper function if helper fields are nested, otherwise direct access
                const accessor = isNestedHelper && parentKey 
                  ? `get${arrayFieldName}Field('${helperKey}')` 
                  : `bundle.inputData.${helperKey}`;
                requestBodyCode += `  const ${helperKey}Value = ${accessor};\n`;
                requestBodyCode += `  if (${helperKey}Value !== undefined && ${helperKey}Value !== '' && ${helperKey}Value !== null && ${helperKey}Value !== 0) {\n`;
                requestBodyCode += `    const parsed = Number(${helperKey}Value);\n`;
                requestBodyCode += `    if (!Number.isNaN(parsed) && parsed !== 0) {\n`;
                requestBodyCode += `      ${targetProperty}HelperIds.push(parsed);\n`;
                requestBodyCode += `    }\n`;
                requestBodyCode += `  }\n`;
              });
              
              // Merge with existing property value (if any) from nested object
              requestBodyCode += `  let ${targetProperty}Existing = [];\n`;
              requestBodyCode += `  if (${arrayFieldName}Item.${targetProperty} && Array.isArray(${arrayFieldName}Item.${targetProperty})) {\n`;
              requestBodyCode += `    ${targetProperty}Existing = ${arrayFieldName}Item.${targetProperty};\n`;
              requestBodyCode += `  } else {\n`;
              const accessor = parentKey ? `get${arrayFieldName}Field('${targetProperty}')` : `${inputDataPrefix}.${targetProperty}`;
              requestBodyCode += `    const ${targetProperty}Value = ${accessor};\n`;
              requestBodyCode += `    if (${targetProperty}Value !== undefined && ${targetProperty}Value !== '') {\n`;
              requestBodyCode += `      if (typeof ${targetProperty}Value === 'string') {\n`;
              requestBodyCode += `        ${targetProperty}Existing = ${targetProperty}Value\n`;
              requestBodyCode += `          .split(',')\n`;
              requestBodyCode += `          .map((id) => parseInt(id.trim(), 10))\n`;
              requestBodyCode += `          .filter((id) => !isNaN(id));\n`;
              requestBodyCode += `      } else if (Array.isArray(${targetProperty}Value)) {\n`;
              requestBodyCode += `        ${targetProperty}Existing = ${targetProperty}Value;\n`;
              requestBodyCode += `      }\n`;
              requestBodyCode += `    }\n`;
              requestBodyCode += `  }\n`;
              
              // Merge and deduplicate
              requestBodyCode += `  const ${targetProperty}Merged = [...new Set([...${targetProperty}Existing, ...${targetProperty}HelperIds])].filter(id => id > 0);\n`;
              requestBodyCode += `  if (${targetProperty}Merged.length > 0) {\n`;
              requestBodyCode += `    ${arrayFieldName}Item.${targetProperty} = ${targetProperty}Merged;\n`;
              requestBodyCode += `  }\n`;
            } else {
              // For non-array fields, just use the first helper field value
              requestBodyCode += `  // Merge helper fields into ${arrayFieldName}Item.${targetProperty}\n`;
              // Use the getField helper function if helper fields are nested, otherwise direct access
              const accessor = isNestedHelper && parentKey 
                ? `get${arrayFieldName}Field('${helperKeys[0]}')` 
                : `bundle.inputData.${helperKeys[0]}`;
              requestBodyCode += `  const ${helperKeys[0]}Value = ${accessor};\n`;
              requestBodyCode += `  if (${helperKeys[0]}Value !== undefined && ${helperKeys[0]}Value !== '' && ${helperKeys[0]}Value !== null && ${helperKeys[0]}Value !== 0) {\n`;
              requestBodyCode += `    const parsed = Number(${helperKeys[0]}Value);\n`;
              requestBodyCode += `    if (!Number.isNaN(parsed) && parsed !== 0) {\n`;
              requestBodyCode += `      ${arrayFieldName}Item.${targetProperty} = parsed;\n`;
              requestBodyCode += `    }\n`;
              requestBodyCode += `  }\n`;
            }
          });
        }
        
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
        const fieldSchema = endpoint.requestBody && endpoint.requestBody.schema && endpoint.requestBody.schema.properties ? endpoint.requestBody.schema.properties[field.key] : null;
        const isNumberField = fieldSchema && (fieldSchema.type === 'number' || fieldSchema.type === 'integer');
        const isBooleanField = fieldSchema && fieldSchema.type === 'boolean';
        
        if (isDateField) {
          // For date fields, extract just the date part (YYYY-MM-DD) if a datetime was provided
          requestBodyCode += `  if (bundle.inputData.${field.key} !== undefined && bundle.inputData.${field.key} !== '') {\n`;
          requestBodyCode += `    // Extract date part (YYYY-MM-DD) from input, handling both date strings and datetime strings\n`;
          requestBodyCode += `    const ${field.key}Value = String(bundle.inputData.${field.key});\n`;
          requestBodyCode += `    requestBody.${field.key} = ${field.key}Value.includes('T') ? ${field.key}Value.split('T')[0] : ${field.key}Value.split(' ')[0];\n`;
          requestBodyCode += `  }\n`;
        } else if (isNumberField) {
          // Check if this is a dynamic field (ID field) that needs cleared value handling
          const isDynamicField = dynamicFieldKeys.has(field.key);
          if (isDynamicField) {
            // Only include if value is provided and not 0/null/empty (cleared dropdowns may send 0)
            requestBodyCode += `  // Only include ${field.key} if value is provided and not 0/null/empty (cleared dropdowns may send 0)\n`;
            requestBodyCode += `  if (bundle.inputData.${field.key} !== undefined && bundle.inputData.${field.key} !== '' && bundle.inputData.${field.key} !== null && bundle.inputData.${field.key} !== 0) {\n`;
            requestBodyCode += `    const parsed = Number(bundle.inputData.${field.key});\n`;
            requestBodyCode += `    if (!Number.isNaN(parsed) && parsed !== 0) {\n`;
            requestBodyCode += `      requestBody.${field.key} = parsed;\n`;
            requestBodyCode += `    }\n`;
            requestBodyCode += `  }\n`;
          } else {
            // Regular number field
            requestBodyCode += `  if (bundle.inputData.${field.key} !== undefined && bundle.inputData.${field.key} !== '') {\n`;
            requestBodyCode += `    const parsed = Number(bundle.inputData.${field.key});\n`;
            requestBodyCode += `    requestBody.${field.key} = Number.isNaN(parsed) ? bundle.inputData.${field.key} : parsed;\n`;
            requestBodyCode += `  }\n`;
          }
        } else if (isBooleanField) {
          requestBodyCode += `  if (bundle.inputData.${field.key} !== undefined && bundle.inputData.${field.key} !== '') {\n`;
          requestBodyCode += `    if (typeof bundle.inputData.${field.key} === 'boolean') {\n`;
          requestBodyCode += `      requestBody.${field.key} = bundle.inputData.${field.key};\n`;
          requestBodyCode += `    } else if (typeof bundle.inputData.${field.key} === 'string') {\n`;
          requestBodyCode += `      requestBody.${field.key} = bundle.inputData.${field.key}.toLowerCase() === 'true';\n`;
          requestBodyCode += `    } else {\n`;
          requestBodyCode += `      requestBody.${field.key} = Boolean(bundle.inputData.${field.key});\n`;
          requestBodyCode += `    }\n`;
          requestBodyCode += `  }\n`;
        } else {
          // Check if this is an array field that should be parsed from comma-separated string (e.g., tag_ids)
          const fieldSchema = endpoint.requestBody && endpoint.requestBody.schema && endpoint.requestBody.schema.properties ? endpoint.requestBody.schema.properties[field.key] : null;
          const isArrayField = fieldSchema && (fieldSchema.type === 'array' || (fieldSchema.$ref && mapper.resolveRef(fieldSchema.$ref)?.type === 'array'));
          
          if (isArrayField && field.type === 'string') {
            // Array field configured as string input - parse comma-separated values
            requestBodyCode += `  // Parse comma-separated string into array of numbers for ${field.key}\n`;
            requestBodyCode += `  if (bundle.inputData.${field.key} !== undefined && bundle.inputData.${field.key} !== '') {\n`;
            requestBodyCode += `    // Parse comma-separated string into array of numbers\n`;
            requestBodyCode += `    if (typeof bundle.inputData.${field.key} === 'string') {\n`;
            requestBodyCode += `      const ${field.key}Array = bundle.inputData.${field.key}\n`;
            requestBodyCode += `        .split(',')\n`;
            requestBodyCode += `        .map((id) => parseInt(id.trim(), 10))\n`;
            requestBodyCode += `        .filter((id) => !isNaN(id));\n`;
            requestBodyCode += `      requestBody.${field.key} = ${field.key}Array;\n`;
            requestBodyCode += `    } else if (Array.isArray(bundle.inputData.${field.key})) {\n`;
            requestBodyCode += `      // Already an array, use as-is (for backwards compatibility)\n`;
            requestBodyCode += `      requestBody.${field.key} = bundle.inputData.${field.key};\n`;
            requestBodyCode += `    }\n`;
            requestBodyCode += `  }\n`;
          } else {
            // Regular string field
            requestBodyCode += `  if (bundle.inputData.${field.key} !== undefined && bundle.inputData.${field.key} !== '') {\n`;
            requestBodyCode += `    requestBody.${field.key} = bundle.inputData.${field.key};\n`;
            requestBodyCode += `  }\n`;
          }
        }
      });
      
      // Handle helper fields - merge them into their target properties
      if (Object.keys(helperFieldsConfig).length > 0) {
        // Group helper fields by their mapTo property
        const helperFieldsByTarget = {};
        Object.entries(helperFieldsConfig).forEach(([helperKey, helperConfig]) => {
          if (helperConfig.mapTo) {
            if (!helperFieldsByTarget[helperConfig.mapTo]) {
              helperFieldsByTarget[helperConfig.mapTo] = [];
            }
            helperFieldsByTarget[helperConfig.mapTo].push(helperKey);
          }
        });
        
        // Generate merging code for each target property
        Object.entries(helperFieldsByTarget).forEach(([targetProperty, helperKeys]) => {
          // Check if target property is an array field
          let isArrayField = false;
          if (endpoint.requestBody && endpoint.requestBody.schema && endpoint.requestBody.schema.properties) {
            const targetSchema = endpoint.requestBody.schema.properties[targetProperty];
            if (targetSchema) {
              if (targetSchema.type === 'array') {
                isArrayField = true;
              } else if (targetSchema.$ref) {
                const resolved = mapper.resolveRef(targetSchema.$ref);
                if (resolved && resolved.type === 'array') {
                  isArrayField = true;
                }
              }
            }
          }
          
          if (isArrayField) {
            // Generate code to merge helper fields into array property
            requestBodyCode += `  // Merge helper fields into ${targetProperty}\n`;
            requestBodyCode += `  const ${targetProperty}HelperIds = [];\n`;
            helperKeys.forEach(helperKey => {
              requestBodyCode += `  if (bundle.inputData.${helperKey} !== undefined && bundle.inputData.${helperKey} !== '' && bundle.inputData.${helperKey} !== null && bundle.inputData.${helperKey} !== 0) {\n`;
              requestBodyCode += `    const parsed = Number(bundle.inputData.${helperKey});\n`;
              requestBodyCode += `    if (!Number.isNaN(parsed) && parsed !== 0) {\n`;
              requestBodyCode += `      ${targetProperty}HelperIds.push(parsed);\n`;
              requestBodyCode += `    }\n`;
              requestBodyCode += `  }\n`;
            });
            
            // Merge with existing property value (if any)
            // Check requestBody first (in case it was already set by normal field handling), then bundle.inputData
            requestBodyCode += `  let ${targetProperty}Existing = [];\n`;
            requestBodyCode += `  if (requestBody.${targetProperty} && Array.isArray(requestBody.${targetProperty})) {\n`;
            requestBodyCode += `    ${targetProperty}Existing = requestBody.${targetProperty};\n`;
            requestBodyCode += `  } else if (bundle.inputData.${targetProperty} !== undefined && bundle.inputData.${targetProperty} !== '') {\n`;
            requestBodyCode += `    if (typeof bundle.inputData.${targetProperty} === 'string') {\n`;
            requestBodyCode += `      ${targetProperty}Existing = bundle.inputData.${targetProperty}\n`;
            requestBodyCode += `        .split(',')\n`;
            requestBodyCode += `        .map((id) => parseInt(id.trim(), 10))\n`;
            requestBodyCode += `        .filter((id) => !isNaN(id));\n`;
            requestBodyCode += `    } else if (Array.isArray(bundle.inputData.${targetProperty})) {\n`;
            requestBodyCode += `      ${targetProperty}Existing = bundle.inputData.${targetProperty};\n`;
            requestBodyCode += `    }\n`;
            requestBodyCode += `  }\n`;
            
            // Merge and deduplicate
            requestBodyCode += `  const ${targetProperty}Merged = [...new Set([...${targetProperty}Existing, ...${targetProperty}HelperIds])].filter(id => id > 0);\n`;
            requestBodyCode += `  if (${targetProperty}Merged.length > 0) {\n`;
            requestBodyCode += `    requestBody.${targetProperty} = ${targetProperty}Merged;\n`;
            requestBodyCode += `  }\n`;
          } else {
            // For non-array fields, just use the first helper field value (or existing value)
            requestBodyCode += `  // Merge helper fields into ${targetProperty}\n`;
            requestBodyCode += `  if (bundle.inputData.${helperKeys[0]} !== undefined && bundle.inputData.${helperKeys[0]} !== '' && bundle.inputData.${helperKeys[0]} !== null && bundle.inputData.${helperKeys[0]} !== 0) {\n`;
            requestBodyCode += `    const parsed = Number(bundle.inputData.${helperKeys[0]});\n`;
            requestBodyCode += `    if (!Number.isNaN(parsed) && parsed !== 0) {\n`;
            requestBodyCode += `      requestBody.${targetProperty} = parsed;\n`;
            requestBodyCode += `    }\n`;
            requestBodyCode += `  }\n`;
          }
        });
      }
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
        // Check if response extraction is configured (for simplified actions)
        const responseExtraction = simplify && simplify.responseExtraction;
        if (responseExtraction && responseExtraction.extractSingle === true) {
          const arrayProperty = responseExtraction.arrayProperty || arrayProp;
          // Extract single item from array for simplified response
          responseCode = `  // Extract single item from ${arrayProperty} array for simplified response\n` +
            `  // When simplify.flattenArray is used, we expect a single item in the response\n` +
            `  if (response.json && response.json.${arrayProperty} && Array.isArray(response.json.${arrayProperty}) && response.json.${arrayProperty}.length > 0) {\n` +
            `    return response.json.${arrayProperty}[0];\n` +
            `  }\n` +
            `  \n` +
            `  // Fallback to full response if structure is unexpected\n` +
            `  return response.json;`;
        } else {
          // Default behavior: return the full response object
          // This preserves all properties like skipped_duplicates, has_more, pagination, etc.
          // Return the full response object (includes all properties)
          responseCode = '  return response.json;';
        }
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
        // Add dynamic property if this child field is dynamic
        if (child.dynamic && child.dynamicKey) {
          // Zapier uses just the function name for dynamic dropdowns that return {label, value}
          childParts.push(`${childIndent}dynamic: '${child.dynamicKey}'`);
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
  
  // Generate array format for input fields
  let inputFieldsCode = inputFields.length > 0
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

  // Generate dynamicFields code if configured
  let dynamicFieldsCode = '';
  
  if (dynamicFieldKeys.size > 0) {
    // Mark fields as dynamic in inputFields (including nested child fields)
    // Use sourceTrigger to look up trigger key and generate dynamic: "triggerKey.fieldName" format
    inputFields.forEach(field => {
      if (dynamicFieldKeys.has(field.key)) {
        const fieldConfig = dynamicFieldsConfig[field.key];
        const sourceTrigger = fieldConfig.sourceTrigger;
        const valueField = fieldConfig.valueField || 'id';
        
        if (sourceTrigger) {
          // Look up trigger config to verify it exists
          // The JSON key IS the trigger key
          const triggerConfigs = triggerConfig.triggers || {};
          const triggerExists = triggerConfigs[sourceTrigger] !== undefined;
          
          if (triggerExists) {
            // Add dynamic property using trigger key format: "triggerKey.fieldName"
            field.dynamic = true;
            field.dynamicKey = `${sourceTrigger}.${valueField}`;
          } else {
            console.warn(`  ⚠️  Warning: Source trigger "${sourceTrigger}" for dynamic field "${field.key}" not found in trigger config. Skipping dynamic field.`);
          }
        }
      }
      // Also check child fields (for nested object fields like simplify.flattenArray)
      if (field.children && Array.isArray(field.children)) {
        field.children.forEach(childField => {
          if (dynamicFieldKeys.has(childField.key)) {
            const fieldConfig = dynamicFieldsConfig[childField.key];
            const sourceTrigger = fieldConfig.sourceTrigger;
            const valueField = fieldConfig.valueField || 'id';
            
            if (sourceTrigger) {
              // Look up trigger config to verify it exists
              // The JSON key IS the trigger key
              const triggerConfigs = triggerConfig.triggers || {};
              const triggerExists = triggerConfigs[sourceTrigger] !== undefined;
              
              if (triggerExists) {
                // Add dynamic property using trigger key format: "triggerKey.fieldName"
                childField.dynamic = true;
                childField.dynamicKey = `${sourceTrigger}.${valueField}`;
              } else {
                console.warn(`  ⚠️  Warning: Source trigger "${sourceTrigger}" for dynamic field "${childField.key}" not found in trigger config. Skipping dynamic field.`);
              }
            }
          }
        });
      }
    });
    
    // Regenerate inputFieldsCode with dynamic fields marked
    // Note: generateFieldCode now handles dynamic properties for child fields directly
    const generateFieldCodeWithDynamic = (field) => {
      const baseCode = generateFieldCode(field);
      if (field.dynamic && field.dynamicKey) {
        // Add dynamic property before the closing brace for top-level fields
        // Format: dynamic: "triggerKey.fieldName"
        return baseCode.replace(/\n      \}$/, ',\n      dynamic: \'' + field.dynamicKey + '\'\n      }');
      }
      return baseCode;
    };
    
    const updatedInputFieldsCode = inputFields.length > 0
      ? '[\n' + inputFields.map(generateFieldCodeWithDynamic).join(',\n') + '\n    ]'
      : '[]';
    
    // Update inputFieldsCode with dynamic fields
    inputFieldsCode = updatedInputFieldsCode;
    
    // No need to generate functions - dynamic dropdowns use triggers directly
    dynamicFieldsCode = '';
  }

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
    dynamicFieldsCode,
  };

  return generator.generate('action.template.js', templateData);
}

// Generate trigger file for an endpoint (similar to action but for polling,
// webhooks or dynamic dropdowns)
function generateTrigger(triggerConfig, baseUrl, mapper, generator) {
  const endpoint = triggerConfig.endpoint;
  const key = triggerConfig.key; // Key is always set when creating trigger objects
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

  // Detect if pagination is supported (has limit and offset params, and response has has_more)
  // Limit can be auto-set or user-provided - we just need it to exist
  const hasLimitParam = queryParams.some(p => p.name === 'limit');
  const hasOffsetParam = queryParams.some(p => p.name === 'offset');
  
  // We'll check for has_more after we resolve the schema for responseCode
  // This ensures we use the same resolved schema for both checks
  let hasHasMoreProperty = false;
  let resolvedSchemaForPagination = null;

  // Build response code (for triggers, return array or array property)
  // Triggers must return an array of items for Zapier to process and deduplicate
  // Zapier will automatically extract 'id' from each item and deduplicate all items
  let responseCode = '';
  
  // Check if arrayProperty is explicitly configured in trigger config
  const configuredArrayProp = triggerConfig.arrayProperty;
  
  // Track the array property found (for pagination fallback detection)
  let detectedArrayProp = null;
  
  if (configuredArrayProp) {
    // Use explicitly configured array property (most reliable)
    // Zapier will process ALL items in this array and deduplicate each by 'id'
    // Handle nested structures like { recurring_items: { recurring_items: [...] } }
    detectedArrayProp = configuredArrayProp;
    if (configuredArrayProp === 'recurring_items') {
      // Special handling for recurring_items which may have nested structure
      responseCode = `let results = [];\n  if (response.json && response.json.recurring_items) {\n    // Handle nested structure: { recurring_items: { recurring_items: [...] } }\n    if (Array.isArray(response.json.recurring_items)) {\n      results = response.json.recurring_items;\n    } else if (response.json.recurring_items.recurring_items && Array.isArray(response.json.recurring_items.recurring_items)) {\n      results = response.json.recurring_items.recurring_items;\n    }\n  } else if (Array.isArray(response.json)) {\n    results = response.json;\n  }\n  results`;
    } else {
      responseCode = `response.json.${configuredArrayProp} || []`;
    }
  } else if (successResponse && successResponse.schema) {
    // Auto-detect: First, resolve $ref if present to get the actual schema structure
    let schemaToCheck = successResponse.schema;
    if (schemaToCheck.$ref) {
      const resolved = mapper.resolveRef(schemaToCheck.$ref);
      if (resolved) {
        schemaToCheck = resolved;
      }
    }
    
    // Store resolved schema for has_more detection later
    resolvedSchemaForPagination = schemaToCheck;
    
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
      detectedArrayProp = arrayProp;
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
  
  // Now check for has_more property using the resolved schema (if we have one)
  // Also use fallback: if we have limit/offset and found an array property, assume pagination
  if (resolvedSchemaForPagination) {
    if (resolvedSchemaForPagination.type === 'object' && resolvedSchemaForPagination.properties && resolvedSchemaForPagination.properties.has_more) {
      hasHasMoreProperty = true;
    }
  }
  
  // Fallback: if we have limit/offset params and found an array property in response, assume pagination
  // This handles cases where has_more isn't in the schema but the API supports it
  if (!hasHasMoreProperty && hasLimitParam && hasOffsetParam && detectedArrayProp) {
    hasHasMoreProperty = true; // Assume pagination is supported
  }
  
  // Determine if pagination should be used (for polling triggers only, not hidden triggers)
  const isHidden = triggerConfig.hidden === true;
  const shouldUsePagination = !isHidden && hasLimitParam && hasOffsetParam && hasHasMoreProperty;
  
  // Add default limit handling if pagination is supported
  // We need to ensure 'limit' variable exists for the pagination loop
  if (shouldUsePagination) {
    // Check if limit is auto-set or user-provided
    const limitIsAutoSet = autoQueryParamKeys.has('limit');
    const limitParam = queryParams.find(p => p.name === 'limit');
    
    if (limitIsAutoSet) {
      // Limit is auto-set - we still need the limit variable for pagination loop
      // Extract the auto-set value and create limit variable
      const autoLimitValue = autoQueryParams.limit;
      const limitValueStr = typeof autoLimitValue === 'string' ? `'${autoLimitValue}'` : JSON.stringify(autoLimitValue);
      // Replace the auto-set line with one that also creates the limit variable
      queryParamsCode = queryParamsCode.replace(
        new RegExp(`params\\.limit = ${limitValueStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')};`),
        `const limit = bundle.inputData.limit || ${limitValueStr};\n  params.limit = limit;`
      );
    } else if (limitParam) {
      // Limit param is user-provided - ensure we create the limit variable with default
      // The queryParamsCode will have: if (bundle.inputData.limit) { params.limit = bundle.inputData.limit; }
      // We need to change it to: const limit = bundle.inputData.limit || 100; params.limit = limit;
      if (queryParamsCode.includes(`if (bundle.inputData.limit)`)) {
        queryParamsCode = queryParamsCode.replace(
          /if \(bundle\.inputData\.limit\) \{\s+params\.limit = bundle\.inputData\.limit;\s+\}/,
          'const limit = bundle.inputData.limit || 100;\n  params.limit = limit;'
        );
      } else if (!queryParamsCode.includes('const limit')) {
        // Limit param handling not generated yet - add it explicitly
        queryParamsCode = queryParamsCode.replace(
          /(const params = \{\};)/,
          '$1\n  // Set a default limit to ensure we get results\n  const limit = bundle.inputData.limit || 100;\n  params.limit = limit;'
        );
      }
    } else {
      // Limit param doesn't exist - add it (shouldn't happen if hasLimitParam is true)
      queryParamsCode += '  // Set a default limit to ensure we get results\n';
      queryParamsCode += '  const limit = bundle.inputData.limit || 100;\n';
      queryParamsCode += '  params.limit = limit;\n';
    }
  }
  
  // Generate sorting code for polling triggers (sort by id descending for better deduplication)
  // Only add sorting for non-hidden triggers (polling triggers)
  let sortCode = '';
  if (!isHidden) {
    sortCode = `
  // Ensure each result has a unique id for deduplication
  // Zapier uses the 'id' field automatically for deduplication
  // Sort by id descending (newest first) for better polling performance
  // NOTE: If API already returns sorted by ID descending, this is redundant but safe
  results = results.sort((a, b) => (b.id || 0) - (a.id || 0));`;
  }

  // Generate filter code from filters config (for hidden triggers) or filterCode (for custom JavaScript)
  let filterCode = '';
  const filters = triggerConfig.filters || {};
  
  if (Object.keys(filters).length > 0) {
    // Generate filter code from filters object (simple property-based filtering)
    const filterConditions = Object.entries(filters).map(([filterKey, filterValue]) => {
      if (typeof filterValue === 'boolean') {
        return `item.${filterKey} === ${filterValue}`;
      } else if (typeof filterValue === 'string') {
        return `item.${filterKey} === '${filterValue.replace(/'/g, "\\'")}'`;
      } else if (typeof filterValue === 'number') {
        return `item.${filterKey} === ${filterValue}`;
      } else if (filterValue === null) {
        return `item.${filterKey} === null`;
      } else {
        return `item.${filterKey} === ${JSON.stringify(filterValue)}`;
      }
    });
    
    filterCode = `\n  // Filter results based on config\n  results = results.filter((item) => {\n    return ${filterConditions.join(' &&\n    ')};\n  });`;
  } else if (triggerConfig.filterCode && triggerConfig.filterCode.trim() !== '// No custom filtering') {
    // Use custom filter code from config (for complex JavaScript filtering logic)
    // The filterCode may contain newlines, so we need to preserve them
    filterCode = '\n  ' + triggerConfig.filterCode;
  } else {
    filterCode = '\n  // Add custom filtering logic here if needed';
  }
  
  // Generate label template code (for hidden triggers with label config)
  // Only generate if label config is provided (not all triggers need labels)
  let labelCode = '';
  const labelConfig = triggerConfig.label || null;
  if (isHidden && labelConfig && labelConfig.template) {
    const template = labelConfig.template;
    const fallback = labelConfig.fallback || '`${item.id}`';
    
    // Generate code matching the manual implementation (like getAllRecurring)
    // Extract simple property accesses from template and use optional chaining
    // Example: "${transaction_criteria.payee} - ${transaction_criteria.amount}"
    // becomes: const payee = item.transaction_criteria?.payee || ""; const amount = item.transaction_criteria?.amount || "";
    // then: const name = `${payee} - ${amount}`.trim();
    
    // Find all ${variable} references (only simple property accesses, not complex expressions)
    const simpleVarPattern = /\$\{([a-zA-Z_][a-zA-Z0-9_.]*)\}/g;
    const templateVars = new Set();
    let match;
    while ((match = simpleVarPattern.exec(template)) !== null) {
      templateVars.add(match[1]);
    }
    while ((match = simpleVarPattern.exec(fallback)) !== null) {
      templateVars.add(match[1]);
    }
    
    // Generate variable extraction code
    let varCode = '';
    const varMap = new Map();
    Array.from(templateVars).forEach(varExpr => {
      const parts = varExpr.split('.');
      let varName = parts[parts.length - 1]; // Use last part as variable name
      // Avoid conflict with 'name' variable (used for the final label)
      // If varName is 'name', use a different name like 'itemName'
      if (varName === 'name') {
        varName = 'itemName';
      }
      let accessor = 'item';
      parts.forEach(part => {
        accessor += `?.${part}`;
      });
      varCode += `    const ${varName} = ${accessor} || '';\n`;
      varMap.set(varExpr, varName);
    });
    
    // Check if template or fallback has nested template literals (complex expressions)
    // Examples: "${description || `Recurring ${id}`}"
    const templateHasNested = template.includes('`') || template.match(/\$\{[^}]*\$\{/);
    const fallbackHasNested = fallback.includes('`') || fallback.match(/\$\{[^}]*\$\{/);
    const hasNestedTemplates = templateHasNested || fallbackHasNested;
    
    // Process templates based on complexity
    let processedTemplate = template;
    let processedFallback = fallback;
    
    if (hasNestedTemplates) {
      // Complex template with nested literals - use Function constructor to evaluate
      // If template is simple, process it like a simple template
      if (!templateHasNested) {
        processedTemplate = replaceTemplateVars(template, varMap);
      } else {
        // Template has nested templates - replace all variables with item.property access
        processedTemplate = replaceTemplateVarsForNested(template);
      }
      
      // Fallback has nested templates - replace all variables with item.property access
      processedFallback = replaceTemplateVarsForNested(fallback);
      
      // If template is simple but fallback is complex, use simple template literals for template
      // and Function constructor only for fallback
      if (!templateHasNested && fallbackHasNested) {
        const escapedTemplate = escapeForTemplate(processedTemplate);
        const escapedFallback = escapeForFunctionString(processedFallback);
        labelCode = generateSimpleTemplateComplexFallbackCode(varCode, escapedTemplate, escapedFallback);
      } else if (templateHasNested) {
        // Both template and fallback are complex - use Function constructor for both
        const escapedTemplate = escapeForFunctionString(processedTemplate);
        const escapedFallback = escapeForFunctionString(processedFallback);
        labelCode = generateComplexTemplateComplexFallbackCode(varCode, escapedTemplate, escapedFallback);
      }
    } else {
      // Simple template - replace variables and use directly
      processedTemplate = replaceTemplateVars(template, varMap);
      processedFallback = replaceTemplateVars(fallback, varMap);
      
      const escapedTemplate = escapeForTemplate(processedTemplate);
      const escapedFallback = escapeForTemplate(processedFallback);
      labelCode = generateSimpleTemplateSimpleFallbackCode(varCode, escapedTemplate, escapedFallback);
    }
  }
  
  // For hidden triggers, add placeholder input field if none exist (D009 requirement)
  if (isHidden && inputFields.length === 0) {
    inputFields.push({
      key: 'id_placeholder',
      label: 'ID Placeholder',
      type: 'string',
      helpText: 'This is a placeholder field to satisfy Zapier validation (D009).',
      default: 'placeholder',
      required: false,
    });
  }

  // Build input fields code
  const inputFieldsCode = inputFields.length > 0
    ? '\n' + inputFields.map(field => {
        const parts = [`      key: '${field.key}'`, `label: '${field.label}'`, `type: '${field.type}'`];
        if (field.helpText) {
          parts.push(`helpText: '${escapeForJsString(field.helpText)}'`);
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

  // Use title from config (required and validated for non-hidden), fallback to endpoint description
  let description = '';
  if (isHidden) {
    description = 'Hidden trigger for dynamic dropdowns.';
  } else {
    description = triggerConfig.title || endpoint.description || endpoint.summary || '';
    // Ensure description ends with a period (Zapier requirement D021)
    if (description && !description.trim().endsWith('.')) {
      description = description.trim() + '.';
    }
    // Truncate description to 1000 characters (Zapier limit)
    if (description.length > 1000) {
      description = description.substring(0, 997) + '...';
    }
  }
  
  // Build hidden property for display object
  const hiddenProperty = isHidden ? ',\n    hidden: true' : '';

  // Generate request code - either single request or pagination loop
  let requestCode = '';
  if (shouldUsePagination) {
    // Generate pagination loop that fetches all pages
    // First, we need to determine the array property name for pageResults
    let arrayPropForPagination = '';
    if (configuredArrayProp) {
      arrayPropForPagination = configuredArrayProp === 'recurring_items' 
        ? 'response.json.recurring_items || (response.json.recurring_items?.recurring_items || [])'
        : `response.json.${configuredArrayProp} || []`;
    } else if (successResponse && successResponse.schema) {
      let schemaToCheck = successResponse.schema;
      if (schemaToCheck.$ref) {
        const resolved = mapper.resolveRef(schemaToCheck.$ref);
        if (resolved) {
          schemaToCheck = resolved;
        }
      }
      let arrayProp = mapper.getArrayPropertyName(schemaToCheck);
      if (!arrayProp && schemaToCheck.type === 'object' && schemaToCheck.properties) {
        const commonArrayNames = ['transactions', 'items', 'data', 'results', 'records', 'list'];
        for (const propName of commonArrayNames) {
          if (schemaToCheck.properties[propName]) {
            const prop = schemaToCheck.properties[propName];
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
        arrayPropForPagination = `response.json.${arrayProp} || []`;
      } else if (schemaToCheck && schemaToCheck.type === 'array') {
        arrayPropForPagination = 'response.json || []';
      } else {
        arrayPropForPagination = 'response.json || []';
      }
    } else {
      arrayPropForPagination = 'response.json || []';
    }
    
    requestCode = `  // For polling triggers, Zapier doesn't automatically paginate
  // We need to manually fetch all pages by looping until has_more is false
  // This ensures we get all items, not just the first page
  let allResults = [];
  let offset = 0;
  let hasMore = true;
  
  while (hasMore) {
    // Create a fresh params object for each page request to avoid mutating
    const pageParams = { ...params };
    pageParams.offset = offset;
    
    const response = await z.request({
      method: '${endpoint.method.toUpperCase()}',
      url: url,
      params: pageParams,
      headers: {
        Authorization: \`Bearer \${bundle.authData.access_token}\`,
        'Content-Type': 'application/json',
      },
    });
    
    const pageResults = ${arrayPropForPagination};
    
    if (pageResults.length > 0) {
      allResults = allResults.concat(pageResults);
    }
    
    // Check if there are more pages
    // Continue if API says has_more AND we got a full page (indicating there might be more)
    hasMore = response.json.has_more === true && pageResults.length === limit;
    if (hasMore) {
      offset += limit;
    }
  }
  
  // Use allResults from pagination
  let results = allResults;`;
  } else {
    // Single request (no pagination)
    requestCode = `  const response = await z.request({
    method: '${endpoint.method.toUpperCase()}',
    url: url,
    ${paramsCode}
    headers: {
      Authorization: \`Bearer \${bundle.authData.access_token}\`,
      'Content-Type': 'application/json',
    },
  });

  let results = ${responseCode};`;
  }

  const templateData = {
    key,
    noun,
    displayLabel,
    description: escapeForJsString(description),
    hiddenProperty,
    operationId: endpoint.operationId,
    method: endpoint.method.toUpperCase(),
    path: endpoint.path,
    baseUrl,
    pathParamsCode,
    queryParamsCode,
    paramsCode,
    responseCode,
    requestCode,
    sortCode,
    filterCode,
    labelCode,
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
    // Check if it's an async function (contains await or starts with {)
    const isAsync = authConfig.connectionLabel.value.includes('await') || authConfig.connectionLabel.value.trim().startsWith('{');
    if (isAsync) {
      // Async function format: async (z, bundle) => { ... }
      connectionLabelCode = `async (z, bundle) => ${authConfig.connectionLabel.value}`;
    } else {
      // Regular function format: (bundle) => { ... }
      connectionLabelCode = `(bundle) => ${authConfig.connectionLabel.value}`;
    }
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
  // Build requires - handle case where same key exists as both action and trigger
  const actionKeys = new Set(actions.map(a => a.key));
  const triggerKeys = new Set(triggers.map(t => t.key));
  
  // For keys that exist in both, we need to use different variable names
  const actionsRequires = actions.map(a => {
    const key = a.key;
    // If this key also exists as a trigger, use a suffix for the action
    if (triggerKeys.has(key)) {
      return `const ${key}Action = require('./actions/${key}');`;
    }
    return `const ${key} = require('./actions/${key}');`;
  }).join('\n') || '// No actions';
  
  const triggersRequires = triggers.map(t => {
    const key = t.key;
    // If this key also exists as an action, use a suffix for the trigger
    if (actionKeys.has(key)) {
      return `const ${key}Trigger = require('./triggers/${key}');`;
    }
    return `const ${key} = require('./triggers/${key}');`;
  }).join('\n') || '// No triggers';
  
  const actionsCode = actions.map(a => {
    const key = a.key;
    // Use the appropriate variable name based on whether trigger exists
    const varName = triggerKeys.has(key) ? `${key}Action` : key;
    return `    ${key}: ${varName}`;
  }).join(',\n') || '    // No actions';
  
  const triggersCode = triggers.map(t => {
    const key = t.key;
    // Use the appropriate variable name based on whether action exists
    const varName = actionKeys.has(key) ? `${key}Trigger` : key;
    return `    ${key}: ${varName}`;
  }).join(',\n') || '    // No triggers';
  
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
    process.stdout.write(`  📦 Fetching version for ${packageName}... `);
    let version;
    const timeout = 10000; // 10 second timeout
    if (packageName === 'zapier-platform-core' || packageName === 'zapier-platform-cli') {
      // Use version 18.x (requires Node 22+)
      // Get all versions and find the latest 18.x
      const versionsJson = execSync(`npm view ${packageName} versions --json`, { 
        encoding: 'utf8',
        timeout: timeout,
        maxBuffer: 1024 * 1024 * 10 // 10MB buffer
      });
      const versions = JSON.parse(versionsJson);
      // Filter for 18.x versions and get the latest
      const v18Versions = versions.filter(v => v.startsWith('18.'));
      if (v18Versions.length > 0) {
        version = v18Versions[v18Versions.length - 1];
      } else {
        // Fallback to latest if no 18.x found
        version = execSync(`npm view ${packageName} version`, { 
          encoding: 'utf8',
          timeout: timeout,
          maxBuffer: 1024 * 1024
        }).trim();
      }
    } else {
      version = execSync(`npm view ${packageName} version`, { 
        encoding: 'utf8',
        timeout: timeout,
        maxBuffer: 1024 * 1024
      }).trim();
    }
    console.log(version);
    return version;
  } catch (error) {
    console.log('(using fallback)');
    console.warn(`  ⚠️  Warning: Could not fetch version for ${packageName}, using fallback`);
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

  // Use override version if provided, otherwise get from OpenAPI spec
  let version = config.version;
  if (!version) {
    version = parser.getVersion();
    if (!version) {
      console.error('❌ Error: Could not extract version from OpenAPI schema and no --version override provided');
      process.exit(1);
    }
    console.log(`📌 Detected version from OpenAPI spec: ${version}`);
  } else {
    console.log(`📌 Using override version: ${version}`);
  }

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
    // Find all triggers that match this endpoint path
    const endpointPath = endpoint.path;
    const allTriggerConfigs = triggerConfig.triggers || {};
    
    for (const [triggerKey, triggerConfigForPath] of Object.entries(allTriggerConfigs)) {
      // Match triggers by endpoint property
      if (triggerConfigForPath.endpoint === endpointPath) {
        const isHidden = triggerConfigForPath.hidden === true;
        
        // Validate required title field (only for non-hidden triggers)
        if (!isHidden && !triggerConfigForPath.title) {
          console.error(`❌ Error: Trigger config "${triggerKey}" is missing required "title" field`);
          process.exit(1);
        }
        
        // Validate title format (must start with "Triggers when ") - only for non-hidden triggers
        if (!isHidden && triggerConfigForPath.title && !triggerConfigForPath.title.startsWith('Triggers when ')) {
          console.error(`❌ Error: Trigger config "${triggerKey}" has invalid title format. Title must start with "Triggers when "`);
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
            filterCode: triggerConfigForPath.filterCode || '  // No custom filtering',
            hidden: triggerConfigForPath.hidden || false,
            filters: triggerConfigForPath.filters || {},
            label: triggerConfigForPath.label || null,
          });
          addedTriggerKeys.add(triggerKey);
        }
      }
    }
    // Auto-detection disabled: only create triggers explicitly defined in triggers-config.json
  }
  
  // Also generate hidden triggers that are referenced in dynamicFields but might not match endpoints
  // This ensures all triggers needed for dynamic dropdowns are generated
  const allTriggerConfigs = triggerConfig.triggers || {};
  for (const [triggerKey, triggerConfigForPath] of Object.entries(allTriggerConfigs)) {
    if (triggerConfigForPath.hidden === true) {
      if (triggerKey && !addedTriggerKeys.has(triggerKey)) {
        // Find the endpoint for this trigger's endpoint path
        const endpointPath = triggerConfigForPath.endpoint;
        const matchingEndpoint = endpoints.find(e => e.path === endpointPath && e.method.toLowerCase() === 'get');
        if (matchingEndpoint) {
          triggers.push({
            endpoint: matchingEndpoint,
            key: triggerKey,
            customName: triggerConfigForPath.name,
            title: triggerConfigForPath.title || 'Hidden trigger for dynamic dropdowns.',
            arrayProperty: triggerConfigForPath.arrayProperty,
            queryParams: triggerConfigForPath.queryParams || {},
            filterCode: triggerConfigForPath.filterCode || '  // No custom filtering',
            hidden: true,
            filters: triggerConfigForPath.filters || {},
            label: triggerConfigForPath.label || null,
          });
          addedTriggerKeys.add(triggerKey);
        }
      }
    }
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
    const code = generateAction(
      action.endpoint,
      baseUrl,
      mapper,
      generator,
      action.actionConfig || {},
      triggerConfig
    );
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
    console.log(`   4. npx zapier-platform push`);
  console.log(`\n💡 Tip: Use 'npm run generate:clean' to remove generated directory before generation`);
}

// Run the generator
generate().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

 