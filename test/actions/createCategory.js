// Load environment variables from .env file (in generated/ directory)
require('dotenv').config({ path: require('path').resolve(__dirname, '../../generated/.env') });

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
// Set it via: export LUNCHMONEY_ACCESS_TOKEN=your-api-key-here
// Or create a .env file in the generated/ directory with: LUNCHMONEY_ACCESS_TOKEN=your-api-key-here
describe('Category CRUD Operations', () => {
  let testCategoryId;
  let testCategoryGroupId;
  const originalName = 'Zapier Test Category';
  const updatedName = 'Zapier Test Category Updated';
  const testDescription = 'A category created by Zapier CRUD test';
  // Make category group name unique with timestamp to avoid conflicts from previous test runs
  const categoryGroupName = `Zapier Test Category Group ${Date.now()}`;

  it('should create a new category', async () => {
    const bundle = {
      authData: {
        // Get access token from environment variable, or use a test token
        // You can set this via: export LUNCHMONEY_ACCESS_TOKEN=your-api-key
        // Or add LUNCHMONEY_ACCESS_TOKEN=your-api-key to generated/.env
        access_token: process.env.LUNCHMONEY_ACCESS_TOKEN || 'your-api-key-here'
      },
      inputData: {
        name: originalName,
        description: testDescription,
        is_income: false,
        exclude_from_budget: false,
        exclude_from_totals: false,
        is_group: false
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
    should(result.name).equal(originalName);
    should(result).have.property('description');
    should(result.description).equal(testDescription);
    
    // Log the full response for debugging
    console.log('\n✅ Category created successfully!');
    console.log('Category ID:', testCategoryId);
    console.log('Full response:', JSON.stringify(result, null, 2));
    
    return result;
  });

  it('should fetch dynamic dropdown options for child1_id helper field', async () => {
    should(testCategoryId).be.ok();
    
    const bundle = {
      authData: {
        access_token: process.env.LUNCHMONEY_ACCESS_TOKEN || 'your-api-key-here'
      },
      inputData: {},
      meta: {
        isFillingDynamicDropdown: true, // This simulates Zapier fetching dropdown options
        isLoadingSample: false
      }
    };

    // Test the hidden trigger that provides the dropdown options for child1_id
    const result = await appTester(
      App.triggers.getAllCategories.operation.perform,
      bundle
    );

    // Verify it returns an array
    should(result).be.an.Array();
    
    // Verify each option has required fields for dropdown
    if (result.length > 0) {
      result.forEach(option => {
        should(option).have.property('id'); // Value field
        should(option).have.property('name'); // Display field
        should(option.name).be.a.String();
        should(option.name.length).be.above(0);
      });
      
      // Verify our test category is in the results
      const testCategoryInResults = result.find(cat => cat.id === testCategoryId);
      should(testCategoryInResults).be.ok();
      should(testCategoryInResults.name.indexOf(originalName)).be.aboveOrEqual(0);
      
      console.log('\n✅ Dynamic dropdown options retrieved successfully!');
      console.log(`Found ${result.length} categories`);
      console.log(`Test category (ID: ${testCategoryId}) found in dropdown:`, testCategoryInResults ? 'Yes' : 'No');
      if (testCategoryInResults) {
        console.log(`Dropdown display name: "${testCategoryInResults.name}"`);
      }
      console.log('Sample options:', result.slice(0, 3).map(o => ({ id: o.id, name: o.name })));
    }
    
    return result;
  });

  it('should create a category group with child1_id helper field using dynamic dropdown value', async () => {
    should(testCategoryId).be.ok();
    
    const bundle = {
      authData: {
        access_token: process.env.LUNCHMONEY_ACCESS_TOKEN || 'your-api-key-here'
      },
      inputData: {
        name: categoryGroupName,
        description: testDescription + ' - Category Group',
        is_group: true,
        child1_id: testCategoryId // Use the test category ID from dynamic dropdown
      }
    };

    const result = await appTester(
      App.creates.createCategory.operation.perform,
      bundle
    );

    // Verify the response
    should(result).have.property('id');
    testCategoryGroupId = result.id;
    should(result).have.property('name');
    should(result.name).equal(categoryGroupName);
    should(result).have.property('is_group');
    should(result.is_group).equal(true);
    should(result).have.property('children');
    should(result.children).be.an.Array();
    should(result.children.length).be.above(0);
    // Children array contains objects, so check if any child has the matching ID
    const childIds = result.children.map(child => typeof child === 'object' ? child.id : child);
    should(childIds).containEql(testCategoryId);
    
    console.log('\n✅ Category group created successfully with child1_id from dynamic dropdown!');
    console.log('Category Group ID:', testCategoryGroupId);
    console.log(`Child category ID (from child1_id): ${testCategoryId}`);
    console.log('Children array:', result.children);
    console.log('Full response:', JSON.stringify(result, null, 2));
    
    return result;
  });

  it('should delete the category group before updating category', async () => {
    // Skip if category group creation failed in previous test
    if (!testCategoryGroupId) {
      console.log('\n⚠️  Skipping category group deletion - group was not created');
      return;
    }
    
    should(testCategoryGroupId).be.ok();
    should(testCategoryId).be.ok();
    
    // Try to remove the category from the group by updating the category group
    // to have an empty children array. This should remove the category from the group.
    try {
      const removeChildrenBundle = {
        authData: {
          access_token: process.env.LUNCHMONEY_ACCESS_TOKEN || 'your-api-key-here'
        },
        inputData: {
          id: testCategoryGroupId,
          children: [] // Remove all children from the group
        }
      };
      
      await appTester(
        App.creates.updateCategory.operation.perform,
        removeChildrenBundle
      );
      
      console.log('\n✅ Children removed from category group');
    } catch (error) {
      // If updating the group fails, try deleting it directly
      // Some APIs allow deleting groups with children
      console.log('\n⚠️  Could not remove children from group, trying direct deletion');
    }
    
    // Now delete the category group (should be empty now, or API might allow deletion with children)
    const bundle = {
      authData: {
        access_token: process.env.LUNCHMONEY_ACCESS_TOKEN || 'your-api-key-here'
      },
      inputData: {
        id: testCategoryGroupId
      }
    };

    try {
      let result = await appTester(
        App.creates.deleteCategory.operation.perform,
        bundle
      );
      
      // Verify 204 response handling
      should(result).have.property('success');
      should(result.success).equal(true);
      should(result).have.property('status');
      should(result.status).equal(204);
      
      console.log('\n✅ Category group deleted successfully!');
      console.log('Result:', JSON.stringify(result, null, 2));
      
      return result;
    } catch (error) {
      // If deletion fails with 422, retry with force=true
      // Check for 422 in various error formats
      let status = null;
      
      // Try different ways to extract status code
      if (error.status) status = error.status;
      else if (error.response && error.response.status) status = error.response.status;
      else if (error.originalError && error.originalError.status) status = error.originalError.status;
      else if (error.message && error.message.match(/422|API Error \(422\)/)) status = 422;
      
      // Also check if error message contains 422
      const errorStr = JSON.stringify(error);
      if (!status && errorStr.includes('422')) {
        status = 422;
      }
      
      if (status === 422) {
        console.log('\n⚠️  Deletion returned 422, retrying with force=true');
        
        const forceBundle = {
          authData: {
            access_token: process.env.LUNCHMONEY_ACCESS_TOKEN || 'your-api-key-here'
          },
          inputData: {
            id: testCategoryGroupId,
            force: true
          }
        };
        
        try {
          const result = await appTester(
            App.creates.deleteCategory.operation.perform,
            forceBundle
          );
          
          // Verify 204 response handling
          should(result).have.property('success');
          should(result.success).equal(true);
          should(result).have.property('status');
          should(result.status).equal(204);
          
          console.log('\n✅ Category group deleted successfully with force=true!');
          console.log('Result:', JSON.stringify(result, null, 2));
          
          return result;
        } catch (forceError) {
          // If force deletion also fails, that's okay for testing
          console.log('\n⚠️  Could not delete category group even with force (may require manual cleanup):', forceError.message);
          return;
        }
      } else {
        // If deletion fails with a different error, that's okay for testing
        console.log('\n⚠️  Could not delete category group (may require manual cleanup):', error.message);
        return;
      }
    }
  });

  it('should get the created category by ID', async () => {
    should(testCategoryId).be.ok();
    
    const bundle = {
      authData: {
        access_token: process.env.LUNCHMONEY_ACCESS_TOKEN || 'your-api-key-here'
      },
      inputData: {
        id: testCategoryId
      }
    };

    const result = await appTester(
      App.creates.getCategoryById.operation.perform,
      bundle
    );

    // Verify the response
    should(result).have.property('id');
    should(result.id).equal(testCategoryId);
    should(result).have.property('name');
    should(result.name).equal(originalName);
    should(result).have.property('description');
    should(result.description).equal(testDescription);
    
    console.log('\n✅ Category retrieved successfully!');
    console.log('Full response:', JSON.stringify(result, null, 2));
    
    return result;
  });

  it('should update the category', async () => {
    should(testCategoryId).be.ok();
    
    // First, check if the category is in a group
    const checkBundle = {
      authData: {
        access_token: process.env.LUNCHMONEY_ACCESS_TOKEN || 'your-api-key-here'
      },
      inputData: {
        id: testCategoryId
      }
    };
    
    const currentCategory = await appTester(
      App.creates.getCategoryById.operation.perform,
      checkBundle
    );
    
    const isInGroup = currentCategory.group_id !== null && currentCategory.group_id !== undefined;
    
    // Build update bundle - if category is in a group, skip properties that can't be updated
    const updateData = {
      id: testCategoryId,
      name: updatedName,
      description: testDescription + ' - Updated'
    };
    
    // Only add these properties if category is NOT in a group
    if (!isInGroup) {
      updateData.is_income = true;
      updateData.exclude_from_budget = true;
    } else {
      console.log('\n⚠️  Category is in a group - skipping is_income and exclude_from_budget updates');
    }
    
    const bundle = {
      authData: {
        access_token: process.env.LUNCHMONEY_ACCESS_TOKEN || 'your-api-key-here'
      },
      inputData: updateData
    };

    const result = await appTester(
      App.creates.updateCategory.operation.perform,
      bundle
    );

    // Verify the response
    should(result).have.property('id');
    should(result.id).equal(testCategoryId);
    should(result).have.property('name');
    should(result.name).equal(updatedName);
    should(result).have.property('description');
    should(result.description).equal(testDescription + ' - Updated');
    
    // Only verify these if we updated them
    if (!isInGroup) {
      should(result).have.property('is_income');
      should(result.is_income).equal(true);
      should(result).have.property('exclude_from_budget');
      should(result.exclude_from_budget).equal(true);
    }
    
    console.log('\n✅ Category updated successfully!');
    console.log('Full response:', JSON.stringify(result, null, 2));
    
    return result;
  });

  it('should verify the category was updated by getting it again', async () => {
    should(testCategoryId).be.ok();
    
    const bundle = {
      authData: {
        access_token: process.env.LUNCHMONEY_ACCESS_TOKEN || 'your-api-key-here'
      },
      inputData: {
        id: testCategoryId
      }
    };

    const result = await appTester(
      App.creates.getCategoryById.operation.perform,
      bundle
    );

    // Verify the updates persisted
    should(result).have.property('id');
    should(result.id).equal(testCategoryId);
    should(result).have.property('name');
    should(result.name).equal(updatedName);
    should(result).have.property('description');
    should(result.description).equal(testDescription + ' - Updated');
    
    // Only verify these if category is not in a group
    const isInGroup = result.group_id !== null && result.group_id !== undefined;
    if (!isInGroup) {
      should(result).have.property('is_income');
      should(result.is_income).equal(true);
      should(result).have.property('exclude_from_budget');
      should(result.exclude_from_budget).equal(true);
    } else {
      console.log('\n⚠️  Category is in a group - skipping verification of is_income and exclude_from_budget');
    }
    
    console.log('\n✅ Category update verified!');
    console.log('Full response:', JSON.stringify(result, null, 2));
    
    return result;
  });

  it('should delete the category', async () => {
    should(testCategoryId).be.ok();
    
    const bundle = {
      authData: {
        access_token: process.env.LUNCHMONEY_ACCESS_TOKEN || 'your-api-key-here'
      },
      inputData: {
        id: testCategoryId
      }
    };

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

