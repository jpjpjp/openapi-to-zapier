const fs = require('fs');
const path = require('path');

/**
 * Code generator utility for creating Zapier integration files from templates
 */
class CodeGenerator {
  constructor(templatesDir) {
    this.templatesDir = templatesDir || path.join(__dirname, '../templates');
  }

  /**
   * Load a template file
   */
  loadTemplate(templateName) {
    const templatePath = path.join(this.templatesDir, templateName);
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Template not found: ${templatePath}`);
    }
    return fs.readFileSync(templatePath, 'utf8');
  }

  /**
   * Generate code from a template with data
   */
  generate(templateName, data) {
    const template = this.loadTemplate(templateName);
    return this.render(template, data);
  }

  /**
   * Simple template rendering (replace {{variable}} with data)
   */
  render(template, data) {
    let result = template;
    
    // Replace {{variable}} with data.variable
    result = result.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return data[key] !== undefined ? String(data[key]) : match;
    });

    // Replace {{#if variable}}...{{/if}} blocks
    result = result.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (match, key, content) => {
      return data[key] ? content : '';
    });

    // Replace {{#each array}}...{{/each}} blocks
    result = result.replace(/\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (match, arrayKey, content) => {
      const array = data[arrayKey] || [];
      return array.map(item => {
        let itemContent = content;
        // Replace {{this}} or {{.}} with the item
        itemContent = itemContent.replace(/\{\{(this|\.)\}\}/g, () => {
          return typeof item === 'object' ? JSON.stringify(item, null, 2) : String(item);
        });
        // Replace {{@key}} with the key
        itemContent = itemContent.replace(/\{\{@key\}\}/g, () => {
          return typeof item === 'object' && item.key ? item.key : '';
        });
        // Replace other properties
        if (typeof item === 'object') {
          Object.keys(item).forEach(key => {
            const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
            itemContent = itemContent.replace(regex, () => {
              const value = item[key];
              if (typeof value === 'object') {
                return JSON.stringify(value, null, 2);
              }
              return String(value);
            });
          });
        }
        return itemContent;
      }).join('');
    });

    // Replace {{variable.property}} with nested access
    result = result.replace(/\{\{(\w+(?:\.\w+)+)\}\}/g, (match, path) => {
      const keys = path.split('.');
      let value = data;
      for (const key of keys) {
        if (value && typeof value === 'object' && key in value) {
          value = value[key];
        } else {
          return match;
        }
      }
      if (typeof value === 'object') {
        return JSON.stringify(value, null, 2);
      }
      return String(value);
    });

    return result;
  }

  /**
   * Write generated code to a file
   */
  writeFile(filePath, content) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content, 'utf8');
  }

  /**
   * Format JavaScript code (basic formatting)
   */
  formatCode(code) {
    // Basic formatting - in a real implementation, you might use Prettier
    // For now, just ensure consistent indentation
    return code;
  }
}

module.exports = CodeGenerator;

