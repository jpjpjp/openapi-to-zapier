#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const SUBMODULE_DIR = 'api-config';
const SUBMODULE_TEST_DIR = path.join(SUBMODULE_DIR, 'test');
const GENERATED_DIR = 'generated';
const GENERATED_TEST_DIR = path.join(GENERATED_DIR, 'test');

function isSymlink(filePath) {
  try {
    const stats = fs.lstatSync(filePath);
    return stats.isSymbolicLink();
  } catch (err) {
    return false;
  }
}

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch (err) {
    return false;
  }
}

function createSymlink(source, target) {
  try {
    // Remove existing file/symlink if it exists
    if (fileExists(target)) {
      const stats = fs.lstatSync(target);
      if (stats.isSymbolicLink()) {
        fs.unlinkSync(target);
      } else if (stats.isDirectory()) {
        // If it's a directory (not a symlink), don't remove it
        // as it might contain user's test files
        console.log(`  ⚠️  ${target} already exists as a directory. Skipping symlink creation.`);
        return false;
      } else {
        fs.unlinkSync(target);
      }
    }
    
    // Create symlink (use relative path for portability)
    const relativeSource = path.relative(path.dirname(target), source);
    fs.symlinkSync(relativeSource, target, 'dir');
    return true;
  } catch (err) {
    console.error(`  ❌ Error creating symlink: ${err.message}`);
    return false;
  }
}

function ensureTestSymlink() {
  // Check if generated directory exists
  if (!fileExists(GENERATED_DIR)) {
    console.log(`  ⚠️  ${GENERATED_DIR} directory not found. Run 'npm run generate' first.`);
    return false;
  }

  // If generated/test already exists, check if it's already linked correctly
  if (fileExists(GENERATED_TEST_DIR)) {
    if (isSymlink(GENERATED_TEST_DIR)) {
      try {
        const actualTarget = fs.readlinkSync(GENERATED_TEST_DIR);
        const expectedTarget = path.relative(GENERATED_DIR, SUBMODULE_TEST_DIR);
        if (actualTarget === expectedTarget || path.resolve(GENERATED_DIR, actualTarget) === path.resolve(SUBMODULE_TEST_DIR)) {
          // Already linked correctly
          return true;
        }
      } catch (err) {
        // If we can't read the symlink, continue to recreate it
      }
    } else {
      // It's a directory, not a symlink - don't overwrite
      return true;
    }
  }

  // Check if submodule test directory exists
  if (!fileExists(SUBMODULE_TEST_DIR)) {
    console.log(`  ⚠️  ${SUBMODULE_TEST_DIR} not found. Skipping test symlink creation.`);
    return false;
  }

  // Create symlink
  if (createSymlink(SUBMODULE_TEST_DIR, GENERATED_TEST_DIR)) {
    console.log(`  ✅ Created symlink: ${GENERATED_TEST_DIR} -> ${SUBMODULE_TEST_DIR}`);
    return true;
  }

  return false;
}

// Run the check
ensureTestSymlink();

