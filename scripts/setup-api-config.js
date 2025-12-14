#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const SUBMODULE_DIR = 'api-config';
const CONFIG_DIR = path.join(SUBMODULE_DIR, 'config');
const PROJECT_ROOT = process.cwd();

// Files to symlink from submodule config directory
const CONFIG_FILES = [
  'actions-config.json',
  'triggers-config.json',
  'authentication-config.json'
];

// Create readline interface for interactive prompts
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.trim().toLowerCase());
    });
  });
}

function formatTimestamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}-${hours}${minutes}${seconds}`;
}

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
      fs.unlinkSync(target);
    }
    
    // Create symlink (use relative path for portability)
    const relativeSource = path.relative(path.dirname(target), source);
    fs.symlinkSync(relativeSource, target, 'file');
    return true;
  } catch (err) {
    console.error(`  ❌ Error creating symlink: ${err.message}`);
    return false;
  }
}

function backupFile(filePath) {
  const timestamp = formatTimestamp();
  const backupPath = `${filePath}.bak-${timestamp}`;
  try {
    fs.copyFileSync(filePath, backupPath);
    return backupPath;
  } catch (err) {
    console.error(`  ❌ Error creating backup: ${err.message}`);
    return null;
  }
}

async function handleEnvTemplate() {
  const envTemplateSourcePath = path.join(SUBMODULE_DIR, 'env-template');
  const envTemplateTargetPath = path.join(PROJECT_ROOT, 'env-template');
  const envTemplateExists = fileExists(envTemplateSourcePath);
  const targetExists = fileExists(envTemplateTargetPath);
  const targetIsSymlink = targetExists && isSymlink(envTemplateTargetPath);

  if (!envTemplateExists) {
    console.log(`  ⚠️  Skipping env-template: not found in ${SUBMODULE_DIR}/`);
    return false;
  }

  // If target doesn't exist, create symlink directly
  if (!targetExists) {
    if (createSymlink(envTemplateSourcePath, envTemplateTargetPath)) {
      console.log(`  ✅ Created symlink: env-template`);
      return true;
    }
    return false;
  }

  // If target is already a symlink, check if it points to the right place
  if (targetIsSymlink) {
    try {
      const actualTarget = fs.readlinkSync(envTemplateTargetPath);
      const expectedTarget = path.relative(path.dirname(envTemplateTargetPath), envTemplateSourcePath);
      if (actualTarget === expectedTarget || path.resolve(path.dirname(envTemplateTargetPath), actualTarget) === envTemplateSourcePath) {
        console.log(`  ✓ env-template is already linked to submodule`);
        return true;
      }
    } catch (err) {
      // If we can't read the symlink, treat it as a regular file
    }
  }

  // Target exists - prompt user
  console.log(`  ⚠️  env-template already exists in project root`);
  const answer = await question(`    Replace with symlink to ${SUBMODULE_DIR} version? (y/n): `);
  
  if (answer === 'y' || answer === 'yes') {
    const backupPath = backupFile(envTemplateTargetPath);
    if (backupPath) {
      console.log(`  📦 Backed up to: ${path.basename(backupPath)}`);
    }
    
    if (createSymlink(envTemplateSourcePath, envTemplateTargetPath)) {
      console.log(`  ✅ Replaced with symlink: env-template`);
      return true;
    }
    return false;
  } else {
    console.log(`  ⏭️  Skipped env-template`);
    return false;
  }
}

async function handleFile(sourcePath, targetPath, fileName) {
  const sourceExists = fileExists(sourcePath);
  const targetExists = fileExists(targetPath);
  const targetIsSymlink = targetExists && isSymlink(targetPath);

  // Check if source exists in submodule
  if (!sourceExists) {
    console.log(`  ⚠️  Skipping ${fileName}: not found in ${SUBMODULE_DIR}/config/`);
    return false;
  }

  // If target doesn't exist, create symlink directly
  if (!targetExists) {
    if (createSymlink(sourcePath, targetPath)) {
      console.log(`  ✅ Created symlink: ${fileName}`);
      return true;
    }
    return false;
  }

  // If target is already a symlink, check if it points to the right place
  if (targetIsSymlink) {
    try {
      const actualTarget = fs.readlinkSync(targetPath);
      const expectedTarget = path.relative(path.dirname(targetPath), sourcePath);
      if (actualTarget === expectedTarget || path.resolve(path.dirname(targetPath), actualTarget) === sourcePath) {
        console.log(`  ✓ ${fileName} is already linked to submodule`);
        return true;
      }
    } catch (err) {
      // If we can't read the symlink, treat it as a regular file
    }
  }

  // Target exists - prompt user
  console.log(`  ⚠️  ${fileName} already exists in project root`);
  const answer = await question(`    Replace with symlink to ${SUBMODULE_DIR} version? (y/n): `);
  
  if (answer === 'y' || answer === 'yes') {
    const backupPath = backupFile(targetPath);
    if (backupPath) {
      console.log(`  📦 Backed up to: ${path.basename(backupPath)}`);
    }
    
    if (createSymlink(sourcePath, targetPath)) {
      console.log(`  ✅ Replaced with symlink: ${fileName}`);
      return true;
    }
    return false;
  } else {
    console.log(`  ⏭️  Skipped ${fileName}`);
    return false;
  }
}

async function setupConfigFiles() {
  console.log(`\n🔗 Setting up API config files from ${SUBMODULE_DIR} submodule...\n`);

  // Check if submodule directory exists
  if (!fileExists(SUBMODULE_DIR)) {
    console.error(`❌ Error: ${SUBMODULE_DIR} submodule directory not found.`);
    console.error(`   Please initialize the submodule first:`);
    console.error(`   git submodule add <repo-url> ${SUBMODULE_DIR}`);
    process.exit(1);
  }

  // Check if config directory exists in submodule
  if (!fileExists(CONFIG_DIR)) {
    console.error(`❌ Error: ${CONFIG_DIR} directory not found in submodule.`);
    console.error(`   Expected structure: ${SUBMODULE_DIR}/config/`);
    process.exit(1);
  }

  let successCount = 0;
  let skipCount = 0;

  // Handle config files
  for (const configFile of CONFIG_FILES) {
    const sourcePath = path.join(CONFIG_DIR, configFile);
    const targetPath = path.join(PROJECT_ROOT, configFile);
    
    const result = await handleFile(sourcePath, targetPath, configFile);
    if (result) {
      successCount++;
    } else {
      skipCount++;
    }
  }

  // Handle env-template file (copy to .env, not symlink)
  const envResult = await handleEnvTemplate();
  if (envResult) {
    successCount++;
  } else {
    skipCount++;
  }

  console.log(`\n📊 Summary: ${successCount} file(s) linked, ${skipCount} skipped\n`);
  console.log(`💡 Next step: Copy env-template to .env and update it with any user-specific secrets as needed:`);
  console.log(`   cp env-template .env\n`);

  rl.close();
}

// Run the setup
setupConfigFiles().catch((err) => {
  console.error(`\n❌ Error: ${err.message}`);
  rl.close();
  process.exit(1);
});

