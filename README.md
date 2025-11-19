# OpenAPI to Zapier Integration Generator

Automatically generate Zapier CLI integration code from an OpenAPI 3.0.2 schema. This tool parses your OpenAPI specification and generates Zapier triggers, actions, and authentication configuration, minimizing manual work.

## Overview

This generator reads an OpenAPI schema (from a URL or local file) and automatically creates a complete Zapier integration with:

- **Actions**: Generated for all endpoints (GET, POST, PUT, PATCH, DELETE)
- **Triggers**: Configurable via `triggers-config.json` for polling endpoints
- **Authentication**: Custom API key authentication with Bearer token support
- **Input/Output Fields**: Automatically mapped from OpenAPI schemas
- **Type Safety**: Proper handling of arrays, objects, and nested structures

## Requirements

- Node.js >= 22.0.0
- npm or yarn

## Installation

```bash
npm install
```

## Environment Variables

Create a `.env` file in the project root with the following variables:

```env
# OpenAPI schema URL or path (defaults to Petstore example if not set)
ZAPIER_SCHEMA_URL=https://petstore3.swagger.io/api/v3/openapi.json

# Zapier App ID (from https://developer.zapier.com) - required for pushing to Zapier
ZAPIER_APP_ID=12345
```

### Environment Variable Details

- **`ZAPIER_SCHEMA_URL`**: The URL or file path to your OpenAPI 3.0.2 schema. Can be:
  - A URL (e.g., `https://api.example.com/openapi`)
  - A local file path (e.g., `./schema.yaml`)
  - The schema will be cached locally in `schema-cache/` for faster subsequent runs

- **`ZAPIER_APP_ID`**: Your Zapier integration's App ID. You can find this in the Zapier Developer Portal at `https://developer.zapier.com/app/{APP_ID}`. This is only required when pushing to Zapier. If not set, you'll need to configure it in the generated `.zapierapprc` file.

## How It Works

1. **Schema Parsing**: The generator fetches and parses your OpenAPI schema
2. **Endpoint Extraction**: Identifies all API endpoints and their methods
3. **Classification**: 
   - All endpoints become **actions** (available in the Action dropdown)
   - Endpoints can also be configured as **triggers** (for polling) via config file
4. **Code Generation**: Generates Zapier-compatible JavaScript files for:
   - Actions (in `actions/` directory)
   - Triggers (in `triggers/` directory)
   - Authentication configuration
   - Main integration file (`index.js`)
   - Package configuration
5. **Output**: All generated files are placed in the `generated/` directory

## Configuration

### Authentication Configuration

To configure authentication settings, create an `authentication-config.json` file in the project root. See `authentication-config-example.json` for a template.

```json
{
  "testEndpoint": "/store/inventory",
  "authType": "custom",
  "fieldKey": "api_key",
  "fieldLabel": "API Key",
  "fieldType": "password",
  "helpText": "Enter any API key for testing (Petstore accepts any value for testing purposes)",
  "helpLink": "https://petstore.swagger.io/",
  "connectionLabel": {
    "type": "string",
    "value": "Petstore Account"
  }
}
```

#### Authentication Configuration Fields

- **`testEndpoint`**: The endpoint path to use for testing authentication (e.g., `/store/inventory`, `/me`, `/user/login`). This endpoint should be accessible with the provided credentials.
- **`authType`**: Authentication type (typically `"custom"` for API key auth)
- **`fieldKey`**: The key name for the authentication field (e.g., `"api_key"`, `"access_token"`). This must match the key used in your API's security scheme.
- **`fieldLabel`**: Display label for the authentication field (e.g., `"API Key"`)
- **`fieldType`**: Field type (typically `"password"` for API keys to hide the value)
- **`helpText`**: Instructions for users on how to obtain their API key or credentials
- **`helpLink`**: Optional link to documentation (Zapier requirement D002)
- **`connectionLabel`**: How to display the connected account in Zapier
  - **`type: "string"`**: Static label (e.g., `"Petstore Account"`, `"API Account"`)
  - **`type: "function"`**: Dynamic label using a function (e.g., `"bundle.authData.email || 'API Account'"`). The function receives the authentication test response and can extract user information.

### Trigger Configuration -- Polling

To create triggers (polling endpoints), create a `triggers-config.json` file in the project root. See `triggers-config-example.json` for a template.

**Example using Petstore API:**

```json
{
  "triggers": {
    "/pet/findByStatus": {
      "name": "Poll for Available Pets",
      "key": "pollAvailablePets",
      "title": "Triggers when new available pets are found",
      "arrayProperty": "pets",
      "queryParams": {
        "status": "available"
      },
      "filter": "// Optional: Add custom filtering logic here if needed"
    },
    "/pets": {
      "name": "Poll for New Pets",
      "key": "pollPets",
      "title": "Triggers when new pets are found"
      // arrayProperty not needed - will auto-detect "pets" from single-property response
    }
  }
}
```

#### Trigger Configuration Fields

- **Path** (key): The API endpoint path (e.g., `/pets`, `/items`)
- **`name`**: Display name for the trigger in Zapier (used in the action/trigger dropdown)
- **`key`**: Unique identifier for the trigger (used in code)
- **`title`**: **Required.** Description text that appears in Zapier UI. Must start with "Triggers when " to comply with Zapier's requirements (D021). This is used as the trigger's description.
- **`arrayProperty`**: **Optional.** Specifies which property in the API response contains the array of items to process. If omitted, the generator will automatically detect the array property:
  - **Single array property**: If the response has exactly one property that is an array (e.g., `{ items: [...] }` or `{ data: [...] }`), it will be automatically detected. No configuration needed for endpoints that return a single array property.
  - **Multiple properties**: If the response has multiple properties (e.g., `{ items: [...], has_more: true }` or `{ data: [...], pagination: {...} }`), you should explicitly specify `arrayProperty` to avoid ambiguity. Example: `"arrayProperty": "items"` tells the trigger to use `response.json.items` as the array of items.
- **`queryParams`**: Optional object of query parameters to automatically include in the API request. These parameters are set automatically and won't appear as input fields. Useful for server-side filtering to make API calls more efficient. Example: `{"status": "available"}` will always include `?status=available` in the request.
- **`filter`**: Optional JavaScript code to filter results before triggering. This code runs on the array of results returned from the API. Use this for client-side filtering when server-side filtering via `queryParams` isn't sufficient.

#### Query Parameters vs Filtering

**Query Parameters (`queryParams`)**: Use for server-side filtering. These are sent to the API and reduce the amount of data returned, making the trigger more efficient. Parameters specified here are automatically included in every API request and won't appear as user input fields.

**Filter (`filter`)**: Use for client-side filtering after the API response is received. This is useful when:
- You need complex filtering logic that the API doesn't support
- You want to combine multiple conditions
- You need to filter based on computed values

**Best Practice**: Use `queryParams` for simple server-side filtering (like `status: "available"`), and `filter` for additional client-side filtering if needed.

#### Filter Examples

```javascript
// Filter by status (client-side backup)
"filter": "results = results.filter(item => item.status === 'available');"

// Filter for items created in the last 24 hours
"filter": "const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);\nresults = results.filter(item => new Date(item.created_at) > oneDayAgo);"

// Filter by specific property value
"filter": "results = results.filter(item => item.status === 'active');"
```

**Note**: The `filter` code receives a `results` variable containing the array of items from the API response. Modify this array to control which items trigger your Zap.

### Trigger Configuration -- Webhooks

Not yet supported. 

### Action Configuration

To customize how actions are generated, create an `actions-config.json` file in the project root. See `actions-config-example.json` for a template. This allows you to:

- Omit endpoints from generation
- Hide specific query parameters or request body properties
- Set default values for fields
- Conditionally show/hide fields based on other field values
- Simplify complex endpoints (e.g., convert array inputs to single object inputs)
- Control duplicate detection for endpoints that return `skipped_duplicates` arrays

**Example Configuration (using Petstore API):**

```json
{
  "actions": {
    "addPet": {
      "fieldDefaults": {
        "status": "available"
      }
    },
    "createUsersWithListInput": {
      "simplify": {
        "enabled": true,
        "name": "Create a New User",
        "flattenArray": {
          "arrayField": "users",
          "itemSchema": "User"
        }
      }
    }
  }
}
```

#### Action Configuration Fields

- **`operationId`** (key): The OpenAPI operation ID for the endpoint (e.g., `addPet`, `createUsersWithListInput`). This is the unique identifier used to match endpoints in the OpenAPI schema.

- **`omit`**: Optional boolean. If set to `true`, no Zap will be generated for this endpoint. Useful for excluding endpoints that aren't suitable for Zapier integration.

- **`hideQueryParams`**: Optional array of strings. Names of query parameters to hide from the input fields. These parameters won't appear in the Zapier UI, but can still be set programmatically if needed.

- **`hideRequestBodyProperties`**: Optional array of strings. Names of request body properties to hide from the input fields. Useful for hiding advanced or system-managed fields.

- **`fieldDefaults`**: Optional object. Key-value pairs where keys are field names and values are default values to set. Example: `{"is_group": false}` sets the `is_group` field to `false` by default.

- **`conditionalFields`**: Optional array of conditional field configurations. Each entry specifies a field that should be conditionally shown/hidden based on other field values.
  - **`field`**: The name of the field to conditionally show/hide
  - **`hideWhen`**: Object specifying conditions. The field will be hidden when all conditions are met. Example: `{"is_group": true}` hides the field when `is_group` is `true`.

- **`simplify`**: Optional object for simplifying complex endpoints. Useful for creating a simple "Create" Action that calls an API that accepts and array of complex items to insert.
  - **`enabled`**: Boolean to enable simplification
  - **`name`**: Optional custom display name for the simplified action
  - **`flattenArray`**: Configuration for converting array inputs to single object inputs
    - **`arrayField`**: Name of the array field in the request body (e.g., `"items"` or `"users"`)
    - **`itemSchema`**: Name of the schema that defines the array item structure (e.g., `"User"` or `"Pet"`)
    - **`publicName`**: Optional string. If provided, creates a nested object field with this name containing all the array item fields as children. The additional properties will appear as top-level siblings. Example: `"publicName": "New Transaction"` creates a "New Transaction" object containing all transaction fields, with additional properties like `apply_rules` as siblings.
  - **`additionalProperties`**: Optional array of property names from the request body schema to include as input fields (in addition to the flattened array item fields). Useful for properties like `apply_rules`, `skip_duplicates`, etc.

#### Conditional Fields Example

The `conditionalFields` feature allows you to hide fields based on other field values. **Note:** This feature is currently disabled due to Zapier validation limitations, but the configuration structure is preserved for future use.

```json
{
  "conditionalFields": [
    {
      "field": "group_id",
      "hideWhen": {
        "is_group": true
      }
    }
  ]
}
```

This would hide `group_id` when `is_group` is set to `true`.

#### Array Simplification Example

Some endpoints accept arrays of objects, which can be complex for users. The `simplify.flattenArray` feature converts these to single object inputs:

```json
{
  "createUsersWithListInput": {
    "simplify": {
      "enabled": true,
      "name": "Create a New User",
      "flattenArray": {
        "arrayField": "users",
        "itemSchema": "User"
      }
    }
  }
}
```

This configuration:
- Changes the action name to "Create a New User" (singular)
- Replaces the `users` array field with individual fields from the `User` schema (username, email, etc.)
- Automatically wraps the single object in an array when making the API call

#### Nested Object Fields with `publicName`

To create a nested structure in the Zapier UI, use the `publicName` property:

```json
{
  "createNewTransactions": {
    "simplify": {
      "enabled": true,
      "name": "Create a New Transaction",
      "flattenArray": {
        "arrayField": "transactions",
        "itemSchema": "insertTransactionObject",
        "publicName": "New Transaction"
      },
      "additionalProperties": ["apply_rules", "skip_duplicates", "skip_balance_update"]
    }
  }
}
```

This configuration:
- Creates a nested "New Transaction" object containing all transaction fields (date, amount, payee, etc.)
- Displays `apply_rules`, `skip_duplicates`, and `skip_balance_update` as top-level siblings to "New Transaction"
- Provides a cleaner, more organized UI structure in Zapier

**Note**: Endpoints not listed in the config file are generated using default behavior from the OpenAPI schema.

## Usage

### Generate Integration

```bash
# Generate integration (uses cached schema if available)
npm run generate

# Clean and regenerate (removes generated/ directory first)
npm run generate:clean

# Update schema cache and regenerate
npm run generate -- --update-cache
```

### Work with Generated Integration

```bash
# Install dependencies in generated integration
npm run zapier:install

# Test the integration
npm run zapier:test

# Validate the integration
npm run zapier:validate

# Push to Zapier
npm run zapier:push

# Login to Zapier
npm run zapier:login

# Manage users
npm run zapier:users:invite
npm run zapier:users:list
npm run zapier:users:links
```

## Project Structure

```
.
├── .env                          # Environment variables (not in git)
├── triggers-config.json          # Trigger configuration (not in git, use example as template)
├── actions-config.json           # Action configuration (not in git, use example as template)
├── authentication-config.json    # Authentication configuration (not in git, use example as template)
├── triggers-config-example.json  # Example trigger configuration
├── actions-config-example.json   # Example action configuration
├── authentication-config-example.json  # Example authentication configuration
├── scripts/
│   ├── generate_zapier_from_openapi.js  # Main generator script
│   ├── templates/                # Code generation templates
│   │   ├── action.template.js
│   │   ├── trigger.template.js
│   │   ├── authentication.template.js
│   │   └── ...
│   └── utils/                    # Utility modules
│       ├── openapi_parser.js     # OpenAPI schema parser
│       ├── schema_mapper.js      # Schema to Zapier field mapper
│       └── code_generator.js     # Template renderer
├── generated/                    # Generated Zapier integration (not in git)
│   ├── actions/                  # Generated action files
│   ├── triggers/                 # Generated trigger files
│   ├── index.js                  # Main integration file
│   ├── authentication.js         # Authentication config
│   └── package.json              # Zapier package config
└── schema-cache/                 # Cached OpenAPI schemas (not in git)
```

## How Triggers Work

Triggers in Zapier are used to start workflows (Zaps) when certain conditions are met. They work by:

1. **Polling**: Zapier automatically polls your trigger endpoint periodically (every 1-15 minutes)
2. **Filtering**: Your custom filter code runs on the results to determine which items should trigger
3. **Deduplication**: Zapier tracks which items it has already seen and only triggers for new items
4. **Execution**: When new matching items are found, your Zap runs with that item as input

### Example: Petstore API Trigger

```json
{
  "triggers": {
    "/pet/findByStatus": {
      "name": "Poll for Available Pets",
      "key": "pollAvailablePets",
      "title": "Triggers when new available pets are found",
      "queryParams": {
        "status": "available"
      },
      "filter": "// Optional: Add custom filtering logic here if needed"
    }
  }
}
```

This configuration:
- Polls the `/pet/findByStatus` endpoint
- Automatically includes `?status=available` in the API request (server-side filtering)
- Has a properly formatted title that starts with "Triggers when "
- Triggers your Zap whenever new available pets are found

**Note**: The `queryParams` makes the API call more efficient by filtering server-side, while the `filter` provides an optional client-side check for additional filtering logic.

## Endpoint Classification

By default:
- **All endpoints** become **actions** (available in Action dropdown)
- **GET endpoints that return arrays** can be auto-detected as triggers
- **Endpoints in trigger config** become triggers in addition to being actions

An endpoint can be both a trigger AND an action:
- **As a trigger**: Used to start a Zap (polling)
- **As an action**: Used as a step in a Zap (on-demand execution)

## Schema Mapping

The generator automatically maps OpenAPI types to Zapier field types:

- `string` → `string`
- `integer` / `number` → `number`
- `boolean` → `boolean`
- `date` / `date-time` → `datetime`
- `array` → Handled appropriately (wrapped in objects for actions)
- `object` → Preserved as object structure
- `enum` → Field with choices (currently disabled due to validation issues)

## Authentication

The generator creates custom API key authentication based on your `authentication-config.json` file. By default, it uses:
- Bearer token in `Authorization` header
- Configurable field key (default: `access_token`)
- Configurable test endpoint for authentication validation
- Configurable connection label (static string or dynamic function)

### Response Handling

For endpoints that return responses with both a main array (e.g., `transactions`) and a `skipped_duplicates` array, the full response object is returned by default. This preserves all properties, allowing users to see both successfully created items and any duplicates that were skipped.

## Troubleshooting

### Schema Cache Issues

If your schema changes but the generator uses cached data:
```bash
npm run generate -- --update-cache
```

### Validation Errors

Run validation to see detailed errors:
```bash
npm run zapier:validate
```

### Array Response Errors

If you see "Got a non-object result" errors, the generator should automatically wrap arrays in objects. If issues persist, check the generated action file's response handling.

## License

MIT

