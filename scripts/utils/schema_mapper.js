/**
 * Map OpenAPI schemas to Zapier input/output field definitions
 */
class SchemaMapper {
  constructor(schemas = {}) {
    this.schemas = schemas;
  }

  /**
   * Convert OpenAPI schema to Zapier input field
   * @param {Object} schema - The OpenAPI schema object
   * @param {string} fieldName - The name of the field
   * @param {boolean} isRequired - Whether the field is required
   * @param {string} description - Optional description to use instead of schema.description
   */
  schemaToZapierField(schema, fieldName, isRequired = false, description = null) {
    if (!schema) {
      return {
        key: fieldName,
        label: this.formatLabel(fieldName),
        type: 'string',
        helpText: description || '',
      };
    }

    const field = {
      key: fieldName,
      label: this.formatLabel(fieldName),
      helpText: description || schema.description || '',
      required: isRequired,
    };

    // Handle type
    if (schema.type === 'string') {
      if (schema.format === 'date') {
        // Use string type for date fields (YYYY-MM-DD format)
        // Zapier's datetime type converts to Date objects which include time/timezone
        // but APIs often expect just the date string in YYYY-MM-DD format
        field.type = 'string';
        // Add format hint to helpText
        // Note: Zapier doesn't support validate property on input fields
        // Date format validation is handled in the perform function instead
        if (field.helpText && !field.helpText.includes('YYYY-MM-DD')) {
          field.helpText = (field.helpText || '') + ' (Format: YYYY-MM-DD)';
        } else if (!field.helpText) {
          field.helpText = 'Format: YYYY-MM-DD';
        }
        // Set placeholder to replace "Enter text or insert data..." with format hint
        field.placeholder = 'YYYY-MM-DD';
      } else if (schema.format === 'date-time') {
        // Use datetime type for date-time fields (full ISO 8601 datetime)
        field.type = 'datetime';
      } else if (schema.enum) {
        field.type = 'string';
        // Zapier expects choices as a simple array of strings
        // The values will be displayed as-is in the dropdown
        field.choices = schema.enum.map(val => String(val));
      } else {
        field.type = 'string';
      }
    } else if (schema.type === 'integer' || schema.type === 'number') {
      field.type = 'number';
      // Handle enum for numbers too
      if (schema.enum) {
        // Zapier expects choices as a simple array of strings
        field.choices = schema.enum.map(val => String(val));
      }
    } else if (schema.type === 'boolean') {
      field.type = 'boolean';
    } else if (schema.type === 'array') {
      // For arrays, we'll use string input and let users provide JSON
      // or we could create dynamic fields, but that's more complex
      field.type = 'string';
      field.helpText = (schema.description || '') + ' (JSON array format)';
    } else if (schema.type === 'object') {
      // For objects, use string input with JSON format
      field.type = 'string';
      field.helpText = (schema.description || '') + ' (JSON object format)';
    } else {
      field.type = 'string';
    }

    // Handle default value
    // Note: Zapier only supports string defaults, so we only set defaults for string fields
    if (schema.default !== undefined) {
      // Only set default for string fields (Zapier doesn't support boolean/number defaults)
      if (field.type === 'string') {
        field.default = schema.default;
      }
      // For boolean/number fields, skip setting the default even if schema has one
    }

    return field;
  }

  /**
   * Convert OpenAPI parameters to Zapier input fields
   */
  parametersToZapierFields(parameters) {
    if (!parameters || parameters.length === 0) {
      return [];
    }

    return parameters
      .filter(param => param.in === 'query' || param.in === 'path')
      .map(param => {
        const schema = param.schema || {};
        // Use parameter description if available, otherwise fall back to schema description
        const description = param.description || schema.description || null;
        return this.schemaToZapierField(schema, param.name, param.required, description);
      });
  }

  /**
   * Convert OpenAPI request body schema to Zapier input fields
   */
  requestBodyToZapierFields(requestBody) {
    if (!requestBody || !requestBody.schema) {
      return [];
    }

    return this.schemaPropertiesToZapierFields(
      requestBody.schema,
      requestBody.schema.required || []
    );
  }

  /**
   * Convert schema properties to Zapier input fields
   */
  schemaPropertiesToZapierFields(schema, requiredFields = []) {
    if (!schema || !schema.properties) {
      return [];
    }

    const fields = [];

    for (const [key, value] of Object.entries(schema.properties)) {
      const isRequired = requiredFields.includes(key);
      const field = this.schemaToZapierField(value, key, isRequired);
      fields.push(field);
    }

    return fields;
  }

  /**
   * Extract sample data from schema examples
   */
  extractSample(schema, examples = {}) {
    // Try to get example from examples object
    if (examples && Object.keys(examples).length > 0) {
      const firstExample = examples[Object.keys(examples)[0]];
      if (firstExample && firstExample.value !== undefined) {
        return firstExample.value;
      }
      // Sometimes examples are just values
      const firstKey = Object.keys(examples)[0];
      if (examples[firstKey] && typeof examples[firstKey] === 'object' && examples[firstKey].value === undefined) {
        return examples[firstKey];
      }
    }

    // Try to get example from schema
    if (schema && schema.example !== undefined) {
      return schema.example;
    }

    // Generate a sample based on type
    if (!schema || !schema.type) {
      return null;
    }

    switch (schema.type) {
      case 'string':
        if (schema.format === 'date') {
          return '2025-01-01';
        } else if (schema.format === 'date-time') {
          return '2025-01-01T00:00:00Z';
        } else if (schema.enum && schema.enum.length > 0) {
          return schema.enum[0];
        }
        return 'example';
      case 'integer':
      case 'number':
        return 0;
      case 'boolean':
        return false;
      case 'array':
        return [];
      case 'object':
        if (schema.properties) {
          const sample = {};
          for (const [key, value] of Object.entries(schema.properties)) {
            sample[key] = this.extractSample(value, {});
          }
          return sample;
        }
        return {};
      default:
        return null;
    }
  }

  /**
   * Extract sample from response
   */
  extractResponseSample(response) {
    if (!response || !response.schema) {
      return null;
    }

    // Try examples first
    if (response.examples && Object.keys(response.examples).length > 0) {
      const firstExample = response.examples[Object.keys(response.examples)[0]];
      if (firstExample && firstExample.value !== undefined) {
        return firstExample.value;
      }
    }

    // Try to extract from schema
    return this.extractSample(response.schema, response.examples || {});
  }

  /**
   * Format field name to label
   */
  formatLabel(name) {
    return name
      .replace(/_/g, ' ')
      .replace(/([A-Z])/g, ' $1')
      .trim()
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  /**
   * Determine if an endpoint should be a trigger (returns array)
   */
  isTriggerEndpoint(endpoint) {
    if (endpoint.method !== 'get') {
      return false;
    }

    // Check if response returns an array
    const successResponse = endpoint.responses['200'] || endpoint.responses['201'];
    if (!successResponse || !successResponse.schema) {
      return false;
    }

    const schema = successResponse.schema;

    // Check if it's an array type
    if (schema.type === 'array') {
      return true;
    }

    // Check if it's an object with an array property (common pattern)
    if (schema.type === 'object' && schema.properties) {
      // Look for common array property names
      const arrayProps = Object.entries(schema.properties).filter(
        ([key, value]) => value.type === 'array'
      );
      if (arrayProps.length > 0) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get the array property name from response schema
   * Handles nested schemas and $ref references
   * 
   * If the response object has only one property and it's an array,
   * that property is automatically returned (common pattern like { categories: [...] })
   * Otherwise, returns the first array property found.
   */
  getArrayPropertyName(schema) {
    if (!schema) {
      return null;
    }

    // Handle $ref references
    if (schema.$ref) {
      const resolved = this.resolveRef(schema.$ref);
      if (resolved) {
        return this.getArrayPropertyName(resolved);
      }
      return null;
    }

    if (schema.type === 'array') {
      return null; // The response itself is an array
    }

    if (schema.type === 'object' && schema.properties) {
      const propertyEntries = Object.entries(schema.properties);
      const arrayProperties = [];
      
      // Find all array properties
      for (const [key, value] of propertyEntries) {
        // Handle nested $ref in properties
        let propSchema = value;
        if (value.$ref) {
          propSchema = this.resolveRef(value.$ref) || value;
        }
        
        if (propSchema && propSchema.type === 'array') {
          arrayProperties.push(key);
        }
      }
      
      // If there's exactly one array property, return it (common pattern)
      // This handles cases like { categories: [...] } or { manual_accounts: [...] }
      if (arrayProperties.length === 1) {
        return arrayProperties[0];
      }
      
      // If multiple array properties, return the first one
      // (caller should use explicit arrayProperty config for clarity)
      if (arrayProperties.length > 0) {
        return arrayProperties[0];
      }
    }

    return null;
  }

  /**
   * Resolve $ref reference
   */
  resolveRef(ref) {
    if (!ref || !ref.startsWith('#/')) {
      return null;
    }

    const parts = ref.replace('#/', '').split('/');
    let current = this.schemas;

    for (const part of parts) {
      if (current && current[part]) {
        current = current[part];
      } else {
        return null;
      }
    }

    return current;
  }

  /**
   * Get the noun (singular form) from operation ID or path
   * The noun is used by Zapier in UI text like "Send {noun} to {app}"
   */
  getNoun(operationId, path) {
    // Try to extract from operationId
    if (operationId) {
      // Remove common prefixes
      let cleaned = operationId
        .replace(/^(get|create|update|delete|list|find)/i, '')
        .replace(/All$/, '')
        .replace(/ById$/, '');

      // Handle special cases
      if (cleaned === 'Me' || cleaned === 'me') {
        return 'User';
      }

      // Convert to singular
      if (cleaned.endsWith('ies')) {
        cleaned = cleaned.slice(0, -3) + 'y';
      } else if (cleaned.endsWith('s') && cleaned.length > 1) {
        cleaned = cleaned.slice(0, -1);
      }
      
      // Capitalize first letter for better display
      return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }

    // Fallback to path
    const pathParts = path.split('/').filter(p => p && !p.startsWith('{'));
    if (pathParts.length > 0) {
      let lastPart = pathParts[pathParts.length - 1];
      
      // Handle special cases
      if (lastPart === 'me') {
        return 'User';
      }
      
      // Remove plural
      if (lastPart.endsWith('ies')) {
        lastPart = lastPart.slice(0, -3) + 'y';
      } else if (lastPart.endsWith('s') && lastPart.length > 1) {
        lastPart = lastPart.slice(0, -1);
      }
      
      // Capitalize first letter
      return lastPart.charAt(0).toUpperCase() + lastPart.slice(1);
    }

    return 'Item';
  }
}

module.exports = SchemaMapper;

