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

## API-Specific Configuration

This generator is designed to work with any OpenAPI specification. To keep API-specific configuration, tests, and environment variables separate from the generic generator, you can use a Git submodule named `api-config`.

For more details see [Working with an API Config Submodule](#working-with-an-api-config-submodule)

If using an api-config submodule, make sure to initialize it as part of your initial setup:

   **Basic setup** (tracks default branch):
   ```bash
   git submodule add <your-repo-url> api-config
   ```
   
   **Track a specific branch** (recommended for active development):
   ```bash
   git submodule add -b <branch-name> <your-repo-url> api-config
   ```
### Working Without a Submodule

If you prefer not to use a submodule, you can create config files directly in the project root:
- `actions-config.json`
- `triggers-config.json`
- `authentication-config.json`
- `.env`

See the `*-config-example.json` files for templates.


## Environment Variables

Create a `.env` file in the project root with the following variables (or use the template provided when initializing an api-config submodule):

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
3. **Classification**. By default:

    - **All endpoints** become **actions** (available in Action dropdown)
    - **All query params and/or response body properties** are exposed in the generated zap
    - **The entire response object** is returned
   - This behavior can be overridden via custom configuration. 
  
    See [Action Configuration](#action-configuration) 

4. An endpoint can be both a trigger AND an action:
   - **As a trigger**: Used to start a Zap (polling) 
   - **As an action**: Used as a step in a Zap (on-demand execution)
   
   See [Trigger Configuration](#trigger-configuration)

   
5. **Code Generation**: Generates Zapier-compatible JavaScript files for:
   - Actions (in `actions/` directory)
   - Triggers (in `triggers/` directory)
   - Authentication configuration
   - Main integration file (`index.js`)
   - Package configuration
6. **Output**: All generated files are placed in the `generated/` directory

## Configuration

### Authentication Configuration
APIs that require authentication, must configure an endpoint to use for authentication.

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

### Trigger Configuration
The generator does not configure any triggers by default.
To configure triggers, create a`triggers-config.json` file in the project root. See `triggers-config-example.json` for a template.

Triggers can be made available as zaps (for example a polling trigger).

You can also configure hidden triggers that don't appear in the Zapier UI but are used internally to power dynamic dropdowns. They fetch data from GET endpoints and format it for use in action input fields.


#### Trigger Configuration Fields

- **Trigger Key** (JSON object key): A unique identifier for the trigger. This is used as the trigger's `key` in the generated code and when referencing the trigger in `dynamicFields` configuration.
- **`endpoint`**: **Required.** The API endpoint path (e.g., `/pets`, `/items`). This specifies which endpoint the trigger will use.
- **`name`**: **Optional, only useful for visible triggers.** Display name for the trigger in Zapier (used in the action/trigger dropdown). This is only used for display purposes and is not needed for hidden triggers (triggers with `hidden: true`).
- **`title`**: **Required for visible triggers.** Description text that appears in Zapier UI. Must start with "Triggers when " to comply with Zapier's requirements (D021). This is used as the trigger's description. Not required for hidden triggers (used for dynamic dropdowns).
- **`arrayProperty`**: **Optional.** Specifies which property in the API response contains the array of items to process. If omitted, the generator will automatically detect the array property:
  - **Single array property**: If the response has exactly one property that is an array (e.g., `{ items: [...] }` or `{ data: [...] }`), it will be automatically detected. No configuration needed for endpoints that return a single array property.
  - **Multiple properties**: If the response has multiple properties (e.g., `{ items: [...], has_more: true }` or `{ data: [...], pagination: {...} }`), you should explicitly specify `arrayProperty` to avoid ambiguity. Example: `"arrayProperty": "items"` tells the trigger to use `response.json.items` as the array of items.
- **`queryParams`**: Optional object of query parameters to automatically include in the API request. These parameters are set automatically and won't appear as input fields. Useful for server-side filtering to make API calls more efficient. Example: `{"status": "available"}` will always include `?status=available` in the request.

- **`filters`**: Optional object for simple property-based client-side filtering. Specifies property-value pairs to filter results after the API response is received. Only items matching all specified filters will be included. Example: `{"archived": false, "status": "active"}` filters for items where `archived` is `false` AND `status` is `"active"`. This is applied automatically in the generated trigger code.

  **Important**: For hidden triggers used in dynamic dropdowns, prefer using `queryParams` for server-side filtering when your API supports it. Only use `filters` when query parameters aren't available or for additional client-side filtering that can't be done server-side.

- **`filterCode`**: Optional JavaScript code string for custom client-side filtering. The code is inserted directly into the generated trigger and runs on the array of results returned from the API. Use this for complex filtering logic that can't be expressed with simple property-value pairs. The code should modify the `results` array. Example: `"filterCode": "const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);\nresults = results.filter(item => new Date(item.created_at) > oneDayAgo);"`

  **When to use `filterCode` vs `filters`** 
  - Use `filters` (plural) for simple property-value matching (e.g., `{"archived": false}`)
  - Use `filterCode` for complex JavaScript logic (e.g., date comparisons, computed values, OR conditions)

- **`hidden`**: Optional boolean. If set to `true`, the trigger will be hidden from the Zapier UI and can only be used internally for dynamic dropdowns. See [Dynamic Dropdowns](#dynamic-dropdowns) section below.

- **`label`**: Optional object for hidden triggers. Configures how items are displayed in dynamic dropdowns. See [Label Templates](#label-templates) section below.

#### Query Parameters vs Filtering

**Query Parameters (`queryParams`)**: Use for server-side filtering. These are sent to the API and reduce the amount of data returned, making the trigger more efficient. Parameters specified here are automatically included in every API request and won't appear as user input fields.

**For Hidden Triggers**: When creating hidden triggers for dynamic dropdowns, prefer `queryParams` over `filters` whenever your API supports the filtering via query parameters. This is especially important for dynamic dropdowns since they're called frequently and efficiency matters.

**Filter Code (`filterCode`)**: Use for complex client-side filtering with custom JavaScript code. This is useful when:
- You need complex filtering logic that the API doesn't support
- You want to combine multiple conditions with OR logic
- You need to filter based on computed values or date comparisons
- You need custom logic that can't be expressed as simple property-value pairs

**Example:**
```json
"filterCode": "const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);\nresults = results.filter(item => new Date(item.created_at) > oneDayAgo);"
```

**Filters (`filters`)**: Use for simple property-based client-side filtering. This is an object with property-value pairs that gets automatically converted to filter code. Use this when:
- You need simple AND conditions (all properties must match)
- The filtering can be expressed as property-value pairs
- You want a cleaner, more declarative configuration

**Example:**
```json
"filters": {
  "archived": false,
  "status": "active"
}
```

**Best Practice**: 
1. Check your API documentation for available query parameters
2. Use `queryParams` for simple server-side filtering (like `status: "available"`, `is_group: false`, `archived: false`)
3. Use `filters` (plural) for simple client-side property-based filtering
4. Use `filterCode` (JavaScript code) only for complex client-side filtering logic that can't be expressed with `filters`

#### Filter Examples

```javascript
// Filter by status (client-side backup)
"filterCode": "results = results.filter(item => item.status === 'available');"

// Filter for items created in the last 24 hours
"filterCode": "const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);\nresults = results.filter(item => new Date(item.created_at) > oneDayAgo);"

// Filter by specific property value
"filterCode": "results = results.filter(item => item.status === 'active');"
```

**Note**: The `filter` logic receives a `results` variable containing the array of items from the API response. Modify this array to control which items trigger your Zap.

**Example Polling Trigger using Petstore API:**

```json
{
  "triggers": {
    "pollAvailablePets": {
      "endpoint": "/pet/findByStatus",
      "name": "Poll for Available Pets",
      "title": "Triggers when new available pets are found",
      "arrayProperty": "pets",
      "queryParams": {
        "status": "available"
      },
      "filterCode": "// Optional: Add custom filtering logic here if needed"
    },
    "pollPets": {
      "endpoint": "/pets",
      "name": "Poll for New Pets",
      "title": "Triggers when new pets are found"
      // arrayProperty not needed - will auto-detect "pets" from single-property response
    }
  }
}
```

#### Hidden Triggers for Dynamic Dropdowns

Hidden triggers are special triggers that don't appear in the Zapier UI but are used internally to power dynamic dropdowns. They fetch data from GET endpoints and format it for use in action input fields.

**Example:**

```json
{
  "triggers": {
    "getAllCategories": {
      "endpoint": "/categories",
      "hidden": true,
      "queryParams": {
        "is_group": false,
        "archived": false
      },
      "label": {
        "template": "${name} (ID: ${id})",
        "fallback": "${name}"
      }
    },
    "getAllCategoryGroups": {
      "endpoint": "/categories",
      "hidden": true,
      "queryParams": {
        "is_group": true,
        "archived": false
      },
      "label": {
        "template": "${name} (Group ID: ${id})",
        "fallback": "${name}"
      }
    }
  }
}
```

This configuration:
- Creates two hidden triggers that both fetch from `/categories` but with different filters
- `getAllCategories` uses server-side filtering via `queryParams` to only fetch non-group, non-archived categories
- `getAllCategoryGroups` fetches only category groups (where `is_group` is `true`)
- Both format each item's label using the template (e.g., "Groceries (ID: 123)")
- Falls back to just the name if the template evaluates to empty

**When to use `queryParams` vs `filters` for hidden triggers:**

- **`queryParams`** (Recommended): Use when your API supports query parameters for filtering. This is more efficient because:
  - Filtering happens on the server, reducing data transfer
  - Faster response times (less data to process)
  - Better performance for large datasets
  
  Check your API documentation to see what query parameters are available. Common examples: `is_group`, `archived`, `status`, `active`, etc.

- **`filters`**: Use only when:
  - The API doesn't support query parameters for the filtering you need
  - You need to filter based on computed values or complex logic
  - You need to combine multiple conditions that can't be expressed as query params

**Best Practice**: Always check your API documentation first to see if query parameters are available. Use `queryParams` for server-side filtering whenever possible, and only fall back to `filters` for client-side filtering when necessary.

#### Label Templates

Label templates control how items are displayed in dynamic dropdowns. They support:

- **Simple property access**: `${name}`, `${id}`, `${title}`
- **Nested property access**: `${user.name}`, `${metadata.created_at}`
- **Template literals**: Combine multiple properties: `${name} - ${id}`
- **Complex expressions**: Use JavaScript expressions with fallbacks: `${description || \`Item ${id}\`}`

**Template Syntax:**

```json
{
  "label": {
    "template": "${property1} - ${property2}",
    "fallback": "${property3 || 'Default Label'}"
  }
}
```

- **`template`**: Primary template for the label. If this evaluates to a non-empty string, it's used.
- **`fallback`**: Fallback template used when the main template is empty. Supports nested template literals for complex expressions.

**Examples:**

```json
// Simple: Display name and ID
{
  "label": {
    "template": "${name} (ID: ${id})",
    "fallback": "${name}"
  }
}

// Nested properties: Access nested object properties
{
  "label": {
    "template": "${user.first_name} ${user.last_name}",
    "fallback": "${user.email}"
  }
}

// Complex: Multiple properties with fallback
{
  "label": {
    "template": "${title} - ${amount} - ${date}",
    "fallback": "${description || \`Item ${id}\`}"
  }
}
```

**Note**: When using nested template literals in the fallback, write and escape your expression so it will be parsed properly as JSON (e.g., `` `\`Item ${id}\`` ``).

### Trigger Configuration -- Webhooks

Not yet supported. 

### Action Configuration

To customize how actions are generated, create an `actions-config.json` file in the project root. See `actions-config-example.json` for a template. This allows you to:

- Omit endpoints from generation
- Hide specific query parameters or request body properties
- Set default values for fields
- Simplify complex endpoints (e.g., convert array inputs to single object inputs)
- Control duplicate detection for endpoints that return `skipped_duplicates` arrays
- Configure dynamic dropdowns for ID fields
- Extract single items from array responses

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

- **`simplify`**: Optional object for simplifying complex endpoints. Useful for creating a simple "Create" Action that calls an API that accepts and array of complex items to insert.
  - **`enabled`**: Boolean to enable simplification
  - **`name`**: Optional custom display name for the simplified action
  - **`flattenArray`**: Configuration for converting array inputs to single object inputs
    - **`arrayField`**: Name of the array field in the request body (e.g., `"items"` or `"users"`)
    - **`itemSchema`**: Name of the schema that defines the array item structure (e.g., `"User"` or `"Pet"`)
    - **`publicName`**: Optional string. If provided, creates a nested object field with this name containing all the array item fields as children. The additional properties will appear as top-level siblings. Example: `"publicName": "New Transaction"` creates a "New Transaction" object containing all transaction fields, with additional properties like `apply_rules` as siblings.
  - **`additionalProperties`**: Optional array of property names from the request body schema to include as input fields (in addition to the flattened array item fields). Useful for properties like `apply_rules`, `skip_duplicates`, etc.
  - **`responseExtraction`**: Optional object for extracting a single item from array responses. Useful when an action returns an array but you want to return just the first item.
    - **`arrayProperty`**: The property in the response that contains the array (e.g., `"items"`, `"results"`)
    - **`extractSingle`**: Boolean. If `true`, extracts the first item from the array instead of returning the full response object.
- **`dynamicFields`**: Optional object for configuring dynamic dropdowns. Maps field names to their dynamic dropdown configuration. See [Dynamic Dropdowns](#dynamic-dropdowns) section below. This can be used with or without `simplify`.

- **`helperFields`**: Optional object for creating UI-only helper fields that map to API properties. Useful for replacing complex array fields with multiple dropdown fields. See [Helper Fields](#helper-fields) section below.

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

#### Dynamic Dropdowns

Dynamic dropdowns allow users to select values from a list fetched from your API, rather than typing IDs manually. This requires:

1. **Hidden Trigger**: A hidden trigger in `triggers-config.json` that fetches the list of options
2. **Action Configuration**: Reference to that trigger in `actions-config.json` via `dynamicFields`

**Step 1: Create Hidden Trigger**

In `triggers-config.json`, create a hidden trigger that fetches your options. Use `queryParams` for server-side filtering when your API supports it:

```json
{
  "triggers": {
    "getAllCategories": {
      "endpoint": "/categories",
      "hidden": true,
      "queryParams": {
        "is_group": false,
        "archived": false
      },
      "label": {
        "template": "${name} (ID: ${id})",
        "fallback": "${name}"
      }
    }
  }
}
```

**Note**: Check your API documentation to see what query parameters are available. If the API doesn't support query parameters for your filtering needs, you can use `filters` instead for client-side filtering.

**Step 2: Configure Dynamic Field in Action**

In `actions-config.json`, reference the hidden trigger for the field:

```json
{
  "actions": {
    "createItem": {
      "dynamicFields": {
        "category_id": {
          "sourceTrigger": "getAllCategories",
          "valueField": "id"
        }
      }
    }
  }
}
```

This configuration:
- Makes `category_id` a dynamic dropdown field
- Fetches options from the `getAllCategories` hidden trigger
- Uses the `id` property as the value sent to the API
- Displays items using the label template from the trigger config

**Dynamic Fields Configuration:**

- **Field name** (key): The name of the input field in your action (e.g., `"category_id"`, `"account_id"`)
- **`sourceTrigger`**: The `key` of the hidden trigger that provides the options (must match the trigger's `key` in `triggers-config.json`)
- **`valueField`**: The property from the trigger results to use as the value (typically `"id"`)

**Supported Field Types:**

Dynamic dropdowns work with:
- Top-level fields in the action
- Nested fields within objects (e.g., `new_item.category_id`)
- Numeric ID fields (automatically converted to numbers)
- String ID fields

**Example: Multiple Dynamic Fields**

```json
{
  "actions": {
    "createTransaction": {
      "dynamicFields": {
        "category_id": {
          "sourceTrigger": "getAllCategories",
          "valueField": "id"
        },
        "account_id": {
          "sourceTrigger": "getAllAccounts",
          "valueField": "id"
        },
        "tag_ids": {
          "sourceTrigger": "getAllTags",
          "valueField": "id"
        }
      }
    }
  }
}
```

**Note**: For multi-select fields (arrays), use comma-separated input. The generator automatically converts comma-separated strings to arrays of numbers.

#### Helper Fields

Helper fields allow you to create UI-only fields that provide a better user experience than raw array properties. Instead of requiring users to enter comma-separated IDs, you can provide multiple dropdown fields that automatically merge into the target API property.

**Use Cases:**
- Replace array fields (like `children`, `tag_ids`) with multiple individual dropdown fields
- Provide a more intuitive interface for selecting multiple items
- Hide complex array properties while offering simpler alternatives

**Configuration:**

```json
{
  "actions": {
    "createCategory": {
      "hideRequestBodyProperties": ["children"],
      "helperFields": {
        "child1_id": {
          "label": "Child Category 1",
          "type": "number",
          "helpText": "Optional: Select a category to add as a child when creating a category group.",
          "dynamicFields": {
            "sourceTrigger": "getAllCategories",
            "valueField": "id"
          },
          "mapTo": "children"
        },
        "child2_id": {
          "label": "Child Category 2",
          "type": "number",
          "helpText": "Optional: Select a second category to add as a child.",
          "dynamicFields": {
            "sourceTrigger": "getAllCategories",
            "valueField": "id"
          },
          "mapTo": "children"
        },
        "child3_id": {
          "label": "Child Category 3",
          "type": "number",
          "helpText": "Optional: Select a third category to add as a child.",
          "dynamicFields": {
            "sourceTrigger": "getAllCategories",
            "valueField": "id"
          },
          "mapTo": "children"
        }
      }
    }
  }
}
```

**Helper Fields Configuration:**
- **Field name** (key): The name of the helper field (e.g., `"child1_id"`, `"tag1_id"`)
- **`label`**: Display label for the field in Zapier UI
- **`type`**: Field type (typically `"number"` for ID fields)
- **`helpText`**: Help text shown to users in the Zapier UI
- **`dynamicFields`**: Optional dynamic dropdown configuration (same structure as top-level `dynamicFields`)
  - **`sourceTrigger`**: The trigger key that provides the dropdown options
  - **`valueField`**: The property from trigger results to use as the value (typically `"id"`)
- **`mapTo`**: **Required.** The API property name this helper field maps to (e.g., `"children"`, `"tag_ids"`)

**How It Works:**
1. Helper fields appear as separate input fields in the Zapier UI
2. Each helper field can have its own dynamic dropdown
3. Values from all helper fields that map to the same property are automatically merged
4. The merged values are combined with any existing values from the original property (if not hidden)
5. Duplicates are automatically removed
6. The final merged array is sent to the API in the target property

**Example: Multiple Helper Fields Mapping to Same Property**

```json
{
  "actions": {
    "updateTransaction": {
      "hideRequestBodyProperties": ["additional_tag_ids"],
      "helperFields": {
        "additional_tag1_id": {
          "label": "Additional Tag 1",
          "type": "number",
          "helpText": "Optional: Select a tag to add to the transaction.",
          "dynamicFields": {
            "sourceTrigger": "getAllTags",
            "valueField": "id"
          },
          "mapTo": "additional_tag_ids"
        },
        "additional_tag2_id": {
          "label": "Additional Tag 2",
          "type": "number",
          "helpText": "Optional: Select a second tag to add to the transaction.",
          "dynamicFields": {
            "sourceTrigger": "getAllTags",
            "valueField": "id"
          },
          "mapTo": "additional_tag_ids"
        },
        "additional_tag3_id": {
          "label": "Additional Tag 3",
          "type": "number",
          "helpText": "Optional: Select a third tag to add to the transaction.",
          "dynamicFields": {
            "sourceTrigger": "getAllTags",
            "valueField": "id"
          },
          "mapTo": "additional_tag_ids"
        }
      }
    }
  }
}
```

This configuration:
- Hides the `additional_tag_ids` array property
- Provides three dropdown fields (`additional_tag1_id`, `additional_tag2_id`, `additional_tag3_id`)
- Automatically merges all selected tag IDs into the `additional_tag_ids` array
- Works with simplified actions (nested objects) as well as regular actions

**Best Practice**: Use `hideRequestBodyProperties` to hide the original array property when using helper fields, providing a cleaner user experience.

## Authentication

The generator creates custom API key authentication based on your `authentication-config.json` file. By default, it uses:
- Bearer token in `Authorization` header
- Configurable field key (default: `access_token`)
- Configurable test endpoint for authentication validation
- Configurable connection label (static string or dynamic function)

### Response Handling

#### Response Extraction

By default all properties in the response objects (e.g., an `items` array and a `has_more` boolean, are exposed to the zap user.  

By default, Zapier converts arrays of objects into [Line items](https://help.zapier.com/hc/en-us/articles/8496275165709-Create-line-items-in-Zaps#h_01JAFJE6KV6AKW36BQ63YJ40W3)

When an action returns an array but you want to return just a single item, use `responseExtraction`:

```json
{
  "actions": {
    "createItem": {
      "simplify": {
        "enabled": true,
        "name": "Create a New Item",
        "flattenArray": {
          "arrayField": "items",
          "itemSchema": "Item"
        },
        "responseExtraction": {
          "arrayProperty": "items",
          "extractSingle": true
        }
      }
    }
  }
}
```

This configuration:
- Extracts the first item from the `items` array in the response
- Returns that single item instead of the full response object
- Makes the action output easier to use in subsequent Zap steps

**Note**: Endpoints not listed in the config file are generated using default behavior from the OpenAPI schema.

## Usage

### Setup

```bash
# Install dependencies and set up API config (if using submodule)
npm run setup

# Or just set up config files from submodule
npm run setup-api-config
```

### Generate Integration

```bash
# Generate integration (uses cached schema if available)
npm run generate

# Clean and regenerate (removes generated/ directory first)
npm run generate:clean

# Update schema cache and regenerate
npm run generate -- --update-cache

# Override version number (useful when OpenAPI spec doesn't include version or you want a different version)
npm run generate -- --version 1.2.3

# Combine options
npm run generate -- --update-cache --version 2.0.0
```

#### Generation Options

- **`--update-cache`**: Forces the generator to fetch a fresh copy of the OpenAPI schema, ignoring any cached version.
- **`--version <version>`**: Overrides the version number extracted from the OpenAPI spec. Useful when:
  - The OpenAPI spec doesn't include a version
  - You want to use a different version number than what's in the spec
  - You need to follow semantic versioning (MAJOR.MINOR.PATCH) for Zapier
- **`--clean`**: Removes the `generated/` directory before generating (same as `npm run generate:clean`).
- **`--schema-url <url>`**: Overrides the schema URL from environment variables for this run only.

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

# Delete a version (requires version number as argument)
# Note: You cannot delete a version if there are active users or live Zaps using it.
# You may need to deprecate it first. See: https://docs.zapier.com/platform/manage/deprecate
npm run zapier:version:delete -- 1.0.27

# List all versions
npm run zapier:versions

# Manage users
npm run zapier:users:invite
npm run zapier:users:list
npm run zapier:users:links
```

## Project Structure

```
.
├── .env                          # Environment variables (symlinked from api-config/ if using submodule)
├── triggers-config.json          # Trigger configuration (symlinked from api-config/config/ if using submodule)
├── actions-config.json           # Action configuration (symlinked from api-config/config/ if using submodule)
├── authentication-config.json    # Authentication configuration (symlinked from api-config/config/ if using submodule)
├── triggers-config-example.json  # Example trigger configuration
├── actions-config-example.json   # Example action configuration
├── authentication-config-example.json  # Example authentication configuration
├── api-config/                   # Git submodule (optional) - contains API-specific configs and tests
│   ├── config/                   # API-specific configuration files
│   ├── test/                     # API-specific test files
│   └── .env                      # API-specific environment variables
├── scripts/
│   ├── generate_zapier_from_openapi.js  # Main generator script
│   ├── setup-api-config.js       # Script to set up config symlinks from submodule
│   ├── ensure-test-symlink.js    # Script to ensure test symlink exists
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
│   ├── test/                     # Symlink to api-config/test/ (if using submodule)
│   ├── index.js                  # Main integration file
│   ├── authentication.js         # Authentication config
│   └── package.json              # Zapier package config
└── schema-cache/                 # Cached OpenAPI schemas (not in git)
```


## Working with an api-config submodule
If you use this tool to generate zaps for your API, you may wish to setup a github repo that contains the configurations and tests that are specific to your api.

### Setting Up an API Config Submodule

1. **Create a separate repository** for your API-specific configuration:
   - Create a new GitHub repository (e.g., `my-api-zapier-config`)
   - This repository will contain your API-specific configs and tests

2. **Structure your submodule repository** as follows:
   ```
   api-config/
   ├── config/
   │   ├── actions-config.json
   │   ├── triggers-config.json
   │   └── authentication-config.json
   ├── test/
   │   ├── actions/
   │   │   ├── createCategory.js
   │   │   └── ... (other test files)
   │   └── triggers/
   │       └── pollUnreviewedTransactions.js
   └── .env
   ```

3. **Add the submodule to this project**:
   
   **Basic setup** (tracks default branch):
   ```bash
   git submodule add <your-repo-url> api-config
   ```
   
   **Track a specific branch** (recommended for active development):
   ```bash
   git submodule add -b <branch-name> <your-repo-url> api-config
   ```
   
   For example, to track the `main` branch:
   ```bash
   git submodule add -b main https://github.com/your-org/your-repo-name.git api-config
   ```
   
   **Important**: Always specify `api-config` as the target directory name, regardless of your repository's name. This ensures the setup scripts can find your configuration files in the expected location.
   
   **Note**: If you've already added the submodule without specifying a branch, you can configure it to track a branch later:
   ```bash
   cd api-config
   git checkout <branch-name>
   cd ..
   git config -f .gitmodules submodule.api-config.branch <branch-name>
   ```

4. **Initialize and set up the config files**:
   ```bash
   # Install dependencies and set up config symlinks
   npm run setup
   
   # Or just set up config files (if dependencies are already installed)
   npm run setup-api-config
   ```

   This will:
   - Create symlinks from `api-config/config/` to the project root for all config files
   - Create a symlink from `api-config/env-template` to `env-template` in the project root (if it exists)
   - Prompt you if files already exist (with option to backup and replace)
   
   After running the setup, copy `env-template` to `.env` and update it with your user-specific secrets:
   ```bash
   cp env-template .env
   # Then edit .env with your secrets
   ```

5. **Update the submodule** when changes are made:
   ```bash
   # If tracking a branch, this will pull the latest from that branch
   git submodule update --remote api-config
   
   # Or update and initialize all submodules at once
   git submodule update --remote --init --recursive
   ```
   
   **Note**: If you configured the submodule to track a branch, `--remote` will automatically pull from that branch. Otherwise, it will pull from the commit that the main repository references.

### Running API Specific tests
If your API submodule contains tests, you can run them after generating:
  ```bash
  # If not previously run after generating
  npm run zapier:install

  # Creates a symlink to submodule test files on first run
  npm run zapier:test
  ```

**Important for test files**: Since test files are symlinked from `api-config/test/` to `generated/test/`, use `process.cwd()` instead of `__dirname` when referencing files in the generated directory. This is because `__dirname` points to the original file location in the submodule, not the symlinked location.

**Example test file structure:**
```javascript
// Load environment variables from .env file (in generated/ directory)
require('dotenv').config({ path: require('path').join(process.cwd(), '.env') });

const should = require('should');
const zapier = require('zapier-platform-core');
const path = require('path');
const App = require(path.join(process.cwd(), 'index')); // Use process.cwd(), not __dirname

const appTester = zapier.createAppTester(App);
// ... rest of test code
```

When tests run, `process.cwd()` will be the `generated/` directory, so:
- `path.join(process.cwd(), 'index')` resolves to `generated/index`
- `path.join(process.cwd(), '.env')` resolves to `generated/.env`

See the [Zapier Docs](https://docs.zapier.com/platform/build-cli/overview#writing-unit-tests) for more details on writing tests.

### Benefits of Using a Submodule

- **Separation of concerns**: Keep API-specific configs separate from the generic generator
- **Version control**: Track different versions of your API configs independently
- **Reusability**: The generator can work with any OpenAPI spec by switching submodules
- **Collaboration**: Multiple teams can maintain their own API config repositories
- **Easy updates**: Edit configs in the submodule, and changes are immediately available via symlinks


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

### Tests fail with authentication errors

If your api uses authentication, make sure your .env file includes any necessary environment variables. 

Since the tests are run from the generated directory, the npm test and install scripts will copy your .env file there, but check to make sure it isn't missing.

### Array Response Errors

If you see "Got a non-object result" errors, the generator should automatically wrap arrays in objects. If issues persist, check the generated action file's response handling.

## License

MIT

