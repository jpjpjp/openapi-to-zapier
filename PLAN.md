# Automated Zapier Integration Generation Plan

## Overview

Create an automated system to generate Zapier CLI integration code from the OpenAPI schema (`src/public_api/v2/schema.yaml`). This will parse the OpenAPI spec and generate Zapier triggers and actions for each endpoint, minimizing manual work.

## Goals

1. Parse OpenAPI 3.0.2 schema to extract all endpoints
2. Generate Zapier CLI integration code automatically
3. Create appropriate triggers (GET endpoints that return lists) and actions (POST/PUT/PATCH/DELETE endpoints)
4. Map OpenAPI schemas to Zapier input/output schemas
5. Generate authentication configuration
6. Create test data from OpenAPI examples

## Approach

### Step 1: OpenAPI Schema Parser

**Create:** `scripts/generate_zapier_from_openapi.js` or `scripts/generate_zapier_from_openapi.ts`

**Functionality:**
- Parse `src/public_api/v2/schema.yaml` using a YAML parser (e.g., `js-yaml`)
- Extract all paths and their HTTP methods
- Extract request/response schemas from `components/schemas`
- Extract parameters (query, path, header)
- Extract request bodies
- Extract response schemas
- Extract examples from OpenAPI spec

**Key Data Structures:**
```javascript
{
  path: '/transactions',
  method: 'get',
  operationId: 'getAllTransactions',
  summary: 'Get all transactions',
  description: '...',
  parameters: [...],
  requestBody: {...},
  responses: {...},
  tags: ['transactions (bulk)']
}
```

### Step 2: Zapier Integration Structure Generator

**Zapier CLI Structure:**
```
zapier-integration/
├── index.js (main integration file)
├── package.json
├── .zapierapprc
├── triggers/
│   ├── getAllTransactions.js
│   ├── getAllCategories.js
│   └── ...
├── actions/
│   ├── createTransaction.js
│   ├── updateTransaction.js
│   └── ...
├── authentication.js
├── test/
│   ├── triggers/
│   └── actions/
└── README.md
```

**Generate:**
1. **Base Integration Files:**
   - `index.js` - Main integration file with all triggers/actions registered
   - `package.json` - Dependencies and metadata
   - `.zapierapprc` - Zapier app configuration
   - `authentication.js` - Bearer token authentication

2. **Trigger Files** (for GET endpoints that return arrays):
   - Generate from GET endpoints that return list responses
   - Include polling configuration
   - Map query parameters to input fields
   - Map response schema to output fields

3. **Action Files** (for POST/PUT/PATCH/DELETE endpoints):
   - Generate from POST/PUT/PATCH/DELETE endpoints
   - Map request body schema to input fields
   - Map path parameters to input fields
   - Map response schema to output fields

### Step 3: Schema Mapping

**OpenAPI to Zapier Schema Conversion:**
- `string` → `z.string()`
- `integer` → `z.number().int()`
- `boolean` → `z.boolean()`
- `array` → `z.array(...)`
- `object` → `z.object({...})`
- `enum` → `z.enum([...])`
- `date` / `date-time` → `z.string()` with format hints
- `$ref` → Resolve references from `components/schemas`

**Field Properties:**
- `description` → Zapier field `helpText`
- `required` → Zapier field `required`
- `default` → Zapier field `default`
- `enum` → Zapier field `choices`
- `format` → Zapier field `type` hints

### Step 4: Code Generation Templates

**Template Structure:**
- Use template literals or a templating engine (e.g., Handlebars)
- Generate JavaScript code for each trigger/action
- Include proper error handling
- Include authentication headers
- Map OpenAPI examples to Zapier test data

**Example Generated Trigger:**
```javascript
const perform = async (z, bundle) => {
  const response = await z.request({
    method: 'GET',
    url: 'https://api.lunchmoney.dev/v2/transactions',
    params: {
      start_date: bundle.inputData.start_date,
      end_date: bundle.inputData.end_date,
      // ... other query params
    },
    headers: {
      'Authorization': `Bearer ${bundle.authData.api_key}`,
    },
  });
  return response.json.transactions;
};

module.exports = {
  key: 'getAllTransactions',
  noun: 'Transaction',
  display: {
    label: 'Get All Transactions',
    description: 'Retrieve a list of all transactions',
  },
  operation: {
    inputFields: [
      {
        key: 'start_date',
        label: 'Start Date',
        type: 'string',
        helpText: 'Denotes the beginning of the time period',
      },
      // ... more fields
    ],
    perform,
    sample: {
      // From OpenAPI example
    },
  },
};
```

### Step 5: Endpoint Classification

**Classify endpoints as:**
- **Triggers:** GET endpoints that return arrays (e.g., `GET /transactions`, `GET /categories`)
- **Actions:** POST/PUT/PATCH/DELETE endpoints (e.g., `POST /transactions`, `PUT /transactions/{id}`)
- **Searches:** GET endpoints with search/filter capabilities (can be both trigger and search action)

**Special Cases:**
- GET endpoints with `{id}` path param → Create as "Get by ID" action
- Bulk operations → Create as separate actions
- Nested resources → Handle path parameters correctly

### Step 6: Authentication Generation

**Generate `authentication.js`:**
- Use Bearer token authentication (from OpenAPI `securitySchemes.bearerSecurity`)
- Generate test function
- Generate connection label

### Step 7: Test Data Generation

**Extract from OpenAPI:**
- Use `examples` from response schemas
- Use `example` from schema properties
- Generate sample data for testing

### Step 8: Post-Processing and Validation

**Validation:**
- Ensure all required fields are marked
- Validate schema references are resolved
- Check for circular references
- Validate Zapier CLI structure

**Post-Processing:**
- Format generated code
- Add comments with source OpenAPI operationId
- Generate README with usage instructions

## Implementation Details

### Dependencies
- `js-yaml` or `yaml` - Parse OpenAPI YAML
- `@zapier/zapier-platform-cli` - Zapier CLI tools
- Template engine (optional) - For code generation

### File Structure
```
scripts/
├── generate_zapier_from_openapi.js (main generator script)
├── templates/
│   ├── trigger.template.js
│   ├── action.template.js
│   ├── authentication.template.js
│   └── index.template.js
└── utils/
    ├── openapi_parser.js (parse OpenAPI spec)
    ├── schema_mapper.js (map OpenAPI to Zapier schemas)
    └── code_generator.js (generate code from templates)

zapier-integration/ (generated output)
├── [generated files]
```

### Execution Flow

1. **Parse OpenAPI:**
   ```bash
   node scripts/generate_zapier_from_openapi.js
   ```

2. **Generate Integration:**
   - Parse `src/public_api/v2/schema.yaml`
   - Extract all endpoints
   - Classify as triggers/actions
   - Generate code files
   - Output to `zapier-integration/` directory

3. **Manual Review:**
   - Review generated code
   - Adjust any edge cases
   - Add custom logic where needed

4. **Test:**
   ```bash
   cd zapier-integration
   zapier test
   ```

5. **Deploy:**
   ```bash
   zapier push
   ```

## Considerations

1. **OpenAPI Schema Completeness:**
   - Ensure all endpoints have proper schemas
   - Handle optional vs required fields correctly
   - Handle nested objects and arrays

2. **Zapier Limitations:**
   - Some complex OpenAPI schemas may need simplification
   - Zapier has field type limitations
   - Dynamic fields may need manual configuration

3. **Error Handling:**
   - Map OpenAPI error responses to Zapier error handling
   - Include proper error messages

4. **Rate Limiting:**
   - Document rate limits from OpenAPI
   - Configure Zapier rate limiting if needed

5. **Pagination:**
   - Handle paginated endpoints (e.g., `has_more` in transactions)
   - Implement proper pagination in triggers

6. **Path Parameters:**
   - Handle dynamic path parameters (e.g., `/transactions/{id}`)
   - Map to Zapier input fields

7. **Query Parameters:**
   - Convert all query parameters to input fields
   - Handle optional vs required parameters
   - Handle default values

## Next Steps

1. ✅ Create OpenAPI parser utility
2. ✅ Create schema mapper utility
3. ✅ Create code generation templates
4. ✅ Create main generator script
5. ✅ Test with a few endpoints first
6. ✅ Generate full integration
7. ✅ Review and refine generated code
8. ✅ Test with Zapier CLI
9. ✅ Iterate based on testing results

## Implementation Status

### ✅ Completed Steps

- ✅ **Step 1: OpenAPI Schema Parser** - Fully implemented with caching, URL support, and $ref resolution
- ✅ **Step 2: Zapier Integration Structure Generator** - All base files generated (index.js, package.json, .zapierapprc, authentication.js, triggers/, actions/)
- ✅ **Step 3: Schema Mapping** - All OpenAPI types mapped to Zapier field types, enums, dates, defaults, etc.
- ✅ **Step 4: Code Generation Templates** - All templates created with error handling and authentication
- ✅ **Step 5: Endpoint Classification** - Triggers and actions properly classified (searches not implemented - see TODO.md)
- ✅ **Step 6: Authentication Generation** - Bearer token authentication with configurable settings
- ✅ **Step 7: Test Data Generation** - Examples extracted from OpenAPI and used as sample data
- ✅ **Step 8: Post-Processing and Validation** - Code formatting, validation, and comments added

### ⚠️ Partially Completed

- ⚠️ **Searches (Step 5)**: Not implemented - only triggers and actions are generated
- ⚠️ **Pagination (Considerations #5)**: Response structure preserved but no automatic pagination logic
- ⚠️ **Rate Limiting (Considerations #4)**: No automatic extraction/documentation

### ❌ Not Started

- ❌ **Circular Reference Validation (Step 8)**: Not implemented

### Additional Features (Beyond Plan)

- ✅ Configuration files (triggers-config.json, actions-config.json, authentication-config.json)
- ✅ Array simplification with nested object fields
- ✅ Field hiding and defaults
- ✅ 204 No Content response handling
- ✅ Generic 4XX error handling
- ✅ Date format conversion
- ✅ Test directory with symlink support
- ✅ Environment variable support
- ✅ README documentation

### Known Issues

- ❌ **Conditional Fields**: Configuration exists but feature is disabled due to Zapier validation limitations (see TODO.md)

