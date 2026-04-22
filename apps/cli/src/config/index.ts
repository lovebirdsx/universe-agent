export {
  CliConfigSchema,
  FileConfigSchema,
  ReplayConfigSchema,
  type CliConfig,
  type FileConfig,
  type ReplayConfig,
} from './schema.js';
export { loadConfigFile, type LoadFileOptions } from './load-file.js';
export { createConfig, type ConfigSources, type ConfigResult } from './create-config.js';

import type { ConfigResult } from './create-config.js';
import { createConfig, type ConfigSources } from './create-config.js';

let _config: ConfigResult | undefined;

export function initConfig(sources?: ConfigSources): ConfigResult {
  _config = createConfig(sources);
  return _config;
}

export function getConfig(): ConfigResult {
  if (!_config) {
    throw new Error('Config not initialized. Call initConfig() first.');
  }
  return _config;
}

export function resetConfig(): void {
  _config = undefined;
}
