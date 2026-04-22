export { CliConfigSchema, FileConfigSchema, type CliConfig, type FileConfig } from './schema.js';
export { loadConfigFile, type LoadFileOptions } from './load-file.js';
export { createConfig, type ConfigSources } from './create-config.js';

import type { CliConfig } from './schema.js';
import { createConfig, type ConfigSources } from './create-config.js';

let _config: (CliConfig & { prompt: string | undefined }) | undefined;

export function initConfig(sources?: ConfigSources): CliConfig & { prompt: string | undefined } {
  _config = createConfig(sources);
  return _config;
}

export function getConfig(): CliConfig & { prompt: string | undefined } {
  if (!_config) {
    throw new Error('Config not initialized. Call initConfig() first.');
  }
  return _config;
}

export function resetConfig(): void {
  _config = undefined;
}
