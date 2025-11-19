# TODO

This document tracks remaining work items from the original plan and new features to implement.

## From Original Plan (PLAN.md)

### ⚠️ Partially Completed

#### 1. Searches (Step 5)
- **Status**: Not implemented
- **Description**: The plan mentions creating "Searches" for GET endpoints with search/filter capabilities (can be both trigger and search action)
- **Note**: This is optional in Zapier - actions can serve this purpose, but dedicated searches might provide better UX
- **Priority**: Low

#### 2. Pagination Logic (Considerations #5)
- **Status**: Partial - response structure preserved but no automatic pagination logic
- **Description**: Handle paginated endpoints (e.g., `has_more` in transactions) and implement proper pagination in triggers
- **Current State**: The generator preserves pagination properties like `has_more` in the response, but doesn't implement automatic pagination logic in triggers
- **Note**: Zapier handles pagination via polling, so preserving the structure may be sufficient
- **Priority**: Medium

#### 3. Rate Limiting Documentation (Considerations #4)
- **Status**: Not implemented
- **Description**: Document rate limits from OpenAPI and configure Zapier rate limiting if needed
- **Current State**: No automatic extraction or documentation of rate limits
- **Priority**: Low

### ❌ Not Started

#### 4. Circular Reference Validation (Step 8)
- **Status**: Not implemented
- **Description**: Check for circular references in schema resolution
- **Priority**: Low (may not be needed if OpenAPI schemas are well-formed)

## New Features / Issues

### 🔴 High Priority

#### 1. Conditional Fields / Dynamic Input Fields
- **Status**: Partially implemented but disabled
- **Description**: Implement conditional field visibility (e.g., hide `group_id` when `is_group` is `true`)
- **Current State**: 
  - Configuration structure exists in `actions-config.json` (`conditionalFields` property)
  - README documents the feature but notes it's disabled
  - Generator code has conditional fields detection but skips implementation with a warning
  - Issue: Zapier validation fails when `inputFields` is a function (which is required for dynamic fields)
- **Problem**: 
  - Zapier's `validate` command expects `inputFields` to be an array, not a function
  - However, Zapier's runtime supports function-based `inputFields` for dynamic fields
  - Need to find a way to make this work with validation
- **Possible Solutions**:
  1. Investigate if there's a way to make function-based `inputFields` pass validation
  2. Use a different approach (e.g., computed fields, or conditional logic in the perform function)
  3. Document that validation will fail but runtime will work
  4. Check if newer Zapier CLI versions support this
- **Priority**: High (feature is documented and expected to work)
- **Related Files**:
  - `scripts/generate_zapier_from_openapi.js` (lines ~660-750)
  - `README.md` (lines ~215-245)
  - `actions-config.json` (example configuration)

### 🟡 Medium Priority

#### 2. Test File Generation
- **Status**: Manual test files only
- **Description**: Automatically generate test files for actions/triggers from configuration
- **Current State**: Test files must be created manually
- **Priority**: Medium

#### 3. Better Error Messages for Validation Failures
- **Status**: Basic error handling
- **Description**: Provide more helpful error messages when schema validation fails or config properties don't exist
- **Priority**: Medium

### 🟢 Low Priority

#### 4. Support for Multiple Authentication Types
- **Status**: Only Bearer token supported
- **Description**: Support other authentication types from OpenAPI (OAuth, Basic Auth, etc.)
- **Priority**: Low

#### 5. Support for Webhooks (as Triggers)
- **Status**: Not implemented
- **Description**: Generate webhook-based triggers from OpenAPI webhook definitions
- **Priority**: Low

#### 6. Automatic Test Data Generation
- **Status**: Uses OpenAPI examples, but could be smarter
- **Description**: Generate more realistic test data when examples aren't available
- **Priority**: Low

#### 7. Support for File Uploads
- **Status**: Basic support (string type)
- **Description**: Better handling of file upload fields (detect `format: binary` in OpenAPI)
- **Priority**: Low

## Completed Items ✅

All core functionality from PLAN.md has been completed:
- ✅ OpenAPI Schema Parser
- ✅ Zapier Integration Structure Generator
- ✅ Schema Mapping
- ✅ Code Generation Templates
- ✅ Endpoint Classification (triggers/actions)
- ✅ Authentication Generation
- ✅ Test Data Generation
- ✅ Post-Processing and Validation
- ✅ Path Parameters handling
- ✅ Query Parameters handling
- ✅ Error Handling (4XX responses)
- ✅ 204 No Content response handling
- ✅ Date format handling
- ✅ Array simplification
- ✅ Field hiding
- ✅ Field defaults
- ✅ Configuration files (triggers, actions, authentication)
- ✅ Environment variable support
- ✅ Schema caching
- ✅ Test directory with symlink support

## Notes

- The generator is fully functional for the core use case
- Most remaining items are enhancements or edge cases
- Conditional fields is the main blocker for a fully documented feature

