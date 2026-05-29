/**
 * Plugin System for Colab
 *
 * This module provides the plugin infrastructure allowing third-party
 * extensions via npm packages with "colab-plugin" configuration.
 */

export * from './types';
export { pluginManager } from './pluginManager';
export * from './npmRegistry';
