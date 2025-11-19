const should = require('should');
const zapier = require('zapier-platform-core');
// Path resolution: When tests run from generated/ directory, they access
// test files via symlink at generated/test/actions/createCategory.js
// However, Node.js resolves relative paths from the actual file location,
// so we need to use a path relative to the actual file location (test/actions/)
// which goes up to project root, then into generated/
const path = require('path');
const App = require(path.resolve(__dirname, '../../generated/index'));

const appTester = zapier.createAppTester(App);

// Authentication: The test will use the access_token from your environment
// Set it via: export ACCESS_TOKEN=your-api-key-here
// Or create a .env file in the generated/ directory with: ACCESS_TOKEN=your-api-key-here
describe('createCategory', () => {
  let testCategoryId
  it('should create a new category named "Zapier category"', async () => {
    const bundle = {
      authData: {
        // Get access token from environment variable, or use a test token
        // You can set this via: export ACCESS_TOKEN=your-api-key
        access_token: process.env.ACCESS_TOKEN || process.env.ZAPIER_ACCESS_TOKEN || 'your-api-key-here'
      },
      inputData: {
        name: 'Zapier category',
        // Optional fields can be added here:
        // description: 'A category created by Zapier test',
        // is_income: false,
        // exclude_from_budget: false,
        // exclude_from_totals: false,
        // is_group: false
      }
    };

    const result = await appTester(
      App.creates.createCategory.operation.perform,
      bundle
    );

    // Verify the response
    should(result).have.property('id');
    testCategoryId = result.id;
    should(result).have.property('name');
    should(result.name).equal('Zapier category');
    
    // Log the full response for debugging
    console.log('\n✅ Category created successfully!');
    console.log('Full response:', JSON.stringify(result, null, 2));
    
    return result;
  });
  it('should delete the a new category named "Zapier category"', async () => {
    const bundle = {
      authData: {
        // Get access token from environment variable, or use a test token
        // You can set this via: export ACCESS_TOKEN=your-api-key
        access_token: process.env.ACCESS_TOKEN || process.env.ZAPIER_ACCESS_TOKEN || 'your-api-key-here'
      },
      inputData: {
        id: testCategoryId,
      }
    };

    // Note: appTester returns the result (what the perform function returns)
    // To access the full HTTP response (including status code), you would need to
    // call the perform function directly and capture the response object:
    //   const response = await App.creates.deleteCategory.operation.perform(z, bundle);
    //   console.log('Status:', response.status);
    //   console.log('Headers:', response.headers);
    const result = await appTester(
      App.creates.deleteCategory.operation.perform,
      bundle
    );
    
    // Verify 204 response handling - the generator now returns { success: true, status: 204 }
    // for 204 No Content responses
    should(result).have.property('success');
    should(result.success).equal(true);
    should(result).have.property('status');
    should(result.status).equal(204);
    
    console.log('\n✅ Category deleted successfully!');
    console.log('Result:', JSON.stringify(result, null, 2));
    
    return result;
  });
});

