const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const yaml = require('js-yaml');

// Use built-in fetch if available (Node 18+), otherwise require node-fetch
let fetch;
try {
  fetch = globalThis.fetch;
} catch (e) {
  // Fallback for older Node versions
  try {
    fetch = require('node-fetch');
  } catch (e2) {
    throw new Error('fetch is not available. Please use Node 18+ or install node-fetch');
  }
}

/**
 * Parse OpenAPI schema and extract endpoint information
 */
class OpenAPIParser {
  constructor(schemaPathOrUrl) {
    this.schemaPathOrUrl = schemaPathOrUrl;
    this.schema = null;
    this.endpoints = [];
    this.version = null;
  }

  /**
   * Check if the path is a URL
   */
  isUrl(pathOrUrl) {
    return pathOrUrl && (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://'));
  }

  /**
   * Get cache directory path
   */
  getCacheDir() {
    const projectRoot = path.resolve(__dirname, '../..');
    return path.join(projectRoot, 'schema-cache');
  }

  /**
   * Get cache file path
   * For URLs, creates a unique filename based on the URL hash
   * For file paths, uses the filename
   */
  getCachePath() {
    if (this.isUrl(this.schemaPathOrUrl)) {
      // Create a hash of the URL to ensure unique cache files per URL
      const urlHash = crypto.createHash('md5').update(this.schemaPathOrUrl).digest('hex').substring(0, 8);
      // Extract a sanitized domain name for readability
      try {
        const urlObj = new URL(this.schemaPathOrUrl);
        const domain = urlObj.hostname.replace(/[^a-zA-Z0-9]/g, '_');
        return path.join(this.getCacheDir(), `openapi-${domain}-${urlHash}.yaml`);
      } catch (e) {
        // Fallback if URL parsing fails
        return path.join(this.getCacheDir(), `openapi-${urlHash}.yaml`);
      }
    } else {
      // For file paths, use the original filename
      const basename = path.basename(this.schemaPathOrUrl, path.extname(this.schemaPathOrUrl));
      return path.join(this.getCacheDir(), `${basename}.yaml`);
    }
  }

  /**
   * Ensure cache directory exists
   */
  ensureCacheDir() {
    const cacheDir = this.getCacheDir();
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
  }

  /**
   * Fetch schema from URL
   */
  async fetchFromUrl(url) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch OpenAPI schema: ${response.status} ${response.statusText}`);
      }
      const text = await response.text();
      return text;
    } catch (error) {
      throw new Error(`Error fetching OpenAPI schema from ${url}: ${error.message}`);
    }
  }

  /**
   * Load schema from cache if it exists
   */
  loadFromCache() {
    const cachePath = this.getCachePath();
    if (fs.existsSync(cachePath)) {
      return fs.readFileSync(cachePath, 'utf8');
    }
    return null;
  }

  /**
   * Save schema to cache
   */
  saveToCache(content) {
    this.ensureCacheDir();
    const cachePath = this.getCachePath();
    fs.writeFileSync(cachePath, content, 'utf8');
  }

  /**
   * Load and parse the OpenAPI YAML file or URL
   */
  async load(forceUpdate = false) {
    let content;

    if (this.isUrl(this.schemaPathOrUrl)) {
      // It's a URL - check cache first unless force update
      if (!forceUpdate) {
        content = this.loadFromCache();
      }

      // If no cache or force update, fetch from URL
      if (!content || forceUpdate) {
        content = await this.fetchFromUrl(this.schemaPathOrUrl);
        this.saveToCache(content);
      }
    } else {
      // It's a file path
      if (!fs.existsSync(this.schemaPathOrUrl)) {
        throw new Error(`OpenAPI schema file not found: ${this.schemaPathOrUrl}`);
      }
      content = fs.readFileSync(this.schemaPathOrUrl, 'utf8');
    }

    this.schema = yaml.load(content);
    
    // Extract version from schema
    if (this.schema && this.schema.info && this.schema.info.version) {
      this.version = this.schema.info.version;
    }

    return this;
  }

  /**
   * Resolve $ref references in the schema
   */
  resolveRef(ref) {
    if (!ref || !ref.startsWith('#/')) {
      return null;
    }

    const parts = ref.replace('#/', '').split('/');
    let current = this.schema;

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
   * Extract all endpoints from the schema
   */
  extractEndpoints() {
    if (!this.schema || !this.schema.paths) {
      throw new Error('Schema not loaded or missing paths');
    }

    this.endpoints = [];

    for (const [path, methods] of Object.entries(this.schema.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        if (['get', 'post', 'put', 'patch', 'delete'].includes(method.toLowerCase())) {
          const endpoint = this.extractEndpoint(path, method, operation);
          if (endpoint) {
            this.endpoints.push(endpoint);
          }
        }
      }
    }

    return this.endpoints;
  }

  /**
   * Extract a single endpoint's information
   */
  extractEndpoint(path, method, operation) {
    const endpoint = {
      path,
      method: method.toLowerCase(),
      operationId: operation.operationId,
      summary: operation.summary || '',
      description: operation.description || operation.summary || '',
      tags: operation.tags || [],
      parameters: this.extractParameters(operation.parameters || []),
      requestBody: this.extractRequestBody(operation.requestBody),
      responses: this.extractResponses(operation.responses || {}),
      security: operation.security || this.schema.security || [],
    };

    return endpoint;
  }

  /**
   * Extract parameters (query, path, header)
   */
  extractParameters(parameters) {
    return parameters.map(param => {
      const paramData = {
        name: param.name,
        in: param.in, // query, path, header
        required: param.required || false,
        description: param.description || '',
        schema: this.resolveSchema(param.schema || {}),
        examples: param.examples || (param.example ? { default: param.example } : {}),
      };

      return paramData;
    });
  }

  /**
   * Extract request body
   */
  extractRequestBody(requestBody) {
    if (!requestBody) {
      return null;
    }

    const content = requestBody.content || {};
    const jsonContent = content['application/json'];

    if (!jsonContent) {
      return null;
    }

    return {
      required: requestBody.required || false,
      description: requestBody.description || '',
      schema: this.resolveSchema(jsonContent.schema || {}),
      examples: jsonContent.examples || (jsonContent.example ? { default: jsonContent.example } : {}),
    };
  }

  /**
   * Extract responses
   */
  extractResponses(responses) {
    const extracted = {};

    for (const [statusCode, response] of Object.entries(responses)) {
      if (response.$ref) {
        const resolved = this.resolveRef(response.$ref);
        if (resolved) {
          extracted[statusCode] = this.extractResponse(resolved);
        }
      } else {
        extracted[statusCode] = this.extractResponse(response);
      }
    }

    return extracted;
  }

  /**
   * Extract a single response
   */
  extractResponse(response) {
    const content = response.content || {};
    const jsonContent = content['application/json'];

    if (!jsonContent) {
      return {
        description: response.description || '',
        schema: null,
        examples: {},
      };
    }

    return {
      description: response.description || '',
      schema: this.resolveSchema(jsonContent.schema || {}),
      examples: jsonContent.examples || (jsonContent.example ? { default: jsonContent.example } : {}),
    };
  }

  /**
   * Resolve schema, handling $ref references
   */
  resolveSchema(schema) {
    if (!schema) {
      return null;
    }

    if (schema.$ref) {
      const resolved = this.resolveRef(schema.$ref);
      if (resolved) {
        return this.resolveSchema(resolved);
      }
      return null;
    }

    // Handle allOf, oneOf, anyOf
    if (schema.allOf) {
      const merged = { type: 'object', properties: {}, required: [] };
      for (const item of schema.allOf) {
        const resolved = this.resolveSchema(item);
        if (resolved) {
          if (resolved.properties) {
            merged.properties = { ...merged.properties, ...resolved.properties };
          }
          if (resolved.required) {
            merged.required = [...merged.required, ...(resolved.required || [])];
          }
        }
      }
      return merged;
    }

    if (schema.oneOf || schema.anyOf) {
      // For oneOf/anyOf, we'll use the first option or merge properties
      const options = schema.oneOf || schema.anyOf;
      if (options && options.length > 0) {
        return this.resolveSchema(options[0]);
      }
    }

    // Copy schema and resolve nested references
    const resolved = { ...schema };

    if (resolved.properties) {
      resolved.properties = {};
      for (const [key, value] of Object.entries(schema.properties)) {
        resolved.properties[key] = this.resolveSchema(value);
      }
    }

    if (resolved.items) {
      resolved.items = this.resolveSchema(schema.items);
    }

    return resolved;
  }

  /**
   * Get the base URL from servers
   */
  getBaseUrl() {
    if (!this.schema || !this.schema.servers || this.schema.servers.length === 0) {
      // If no servers defined, return empty string (relative URLs)
      // This allows the OpenAPI spec to define relative paths
      return '';
    }
    return this.schema.servers[0].url;
  }

  /**
   * Get security schemes
   */
  getSecuritySchemes() {
    if (!this.schema || !this.schema.components || !this.schema.components.securitySchemes) {
      return {};
    }
    return this.schema.components.securitySchemes;
  }

  /**
   * Get all schemas from components
   */
  getSchemas() {
    if (!this.schema || !this.schema.components || !this.schema.components.schemas) {
      return {};
    }
    return this.schema.components.schemas;
  }

  /**
   * Get version from schema
   */
  getVersion() {
    return this.version;
  }
}

module.exports = OpenAPIParser;

