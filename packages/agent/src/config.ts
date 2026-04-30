/**
 * Configuration and settings for universe-agent.
 *
 * Provides project detection, path management, and environment configuration
 * for skills and agent memory middleware.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Options for creating a Settings instance.
 */
export interface SettingsOptions {
  /** Starting directory for project detection (defaults to cwd) */
  startPath?: string;
}

/**
 * Settings interface for project detection and path management.
 *
 * Provides access to:
 * - Project root detection (via .git directory)
 * - User-level universe-agent directory (~/.universe-agent)
 * - Agent-specific directories and files
 * - Skills directories (user and project level)
 * - Multi-tool memory file discovery (Copilot, Claude Code, Codex)
 */
export interface Settings {
  /** Detected project root directory, or undefined if not in a git project */
  readonly projectRoot: string | undefined;

  /** Base user-level .universe-agent directory (~/.universe-agent) */
  readonly userUniverseAgentDir: string;

  /** Check if currently in a git project */
  readonly hasProject: boolean;

  /**
   * Get the agent directory path.
   * @param agentName - Name of the agent
   * @returns Path to ~/.universe-agent/{agentName}
   * @throws Error if agent name is invalid
   */
  getAgentDir(agentName: string): string;

  /**
   * Ensure agent directory exists and return path.
   * @param agentName - Name of the agent
   * @returns Path to ~/.universe-agent/{agentName}
   * @throws Error if agent name is invalid
   */
  ensureAgentDir(agentName: string): string;

  /**
   * Get user-level AGENTS.md path.
   * @returns Path to ~/.universe-agent/AGENTS.md
   */
  getUserAgentMdPath(): string;

  /**
   * Get project-level AGENTS.md path.
   * @returns Path to {projectRoot}/.universe-agent/AGENTS.md, or undefined if not in a project
   */
  getProjectAgentMdPath(): string | undefined;

  /**
   * Get user-level skills directory path for a specific agent.
   * @param agentName - Name of the agent
   * @returns Path to ~/.universe-agent/{agentName}/skills/
   */
  getUserSkillsDir(agentName: string): string;

  /**
   * Ensure user-level skills directory exists and return path.
   * @param agentName - Name of the agent
   * @returns Path to ~/.universe-agent/{agentName}/skills/
   */
  ensureUserSkillsDir(agentName: string): string;

  /**
   * Get project-level skills directory path.
   * @returns Path to {projectRoot}/.universe-agent/skills/, or undefined if not in a project
   */
  getProjectSkillsDir(): string | undefined;

  /**
   * Ensure project-level skills directory exists and return path.
   * @returns Path to {projectRoot}/.universe-agent/skills/, or undefined if not in a project
   */
  ensureProjectSkillsDir(): string | undefined;

  /**
   * Ensure project .universe-agent directory exists.
   * @returns Path to {projectRoot}/.universe-agent/, or undefined if not in a project
   */
  ensureProjectUniverseAgentDir(): string | undefined;

  /**
   * Get all candidate memory file paths across supported AI coding tools.
   *
   * Returns paths for universe-agent, GitHub Copilot, Claude Code, and OpenAI Codex.
   * User/global paths come first, project-level paths come last (later = higher precedence).
   * Missing files are handled gracefully by the memory middleware.
   *
   * Order (first loaded = lowest precedence):
   * 1. ~/.claude/CLAUDE.md (Claude Code global)
   * 2. ~/.universe-agent/AGENTS.md (Universe Agent global)
   * 3. {projectRoot}/.github/copilot-instructions.md (Copilot)
   * 4. {projectRoot}/AGENTS.md (Codex)
   * 5. {projectRoot}/CLAUDE.md (Claude Code)
   * 6. {projectRoot}/.universe-agent/AGENTS.md (Universe Agent, highest)
   *
   * @returns Array of candidate file paths, ordered by precedence (last wins)
   */
  getAllMemorySources(): string[];
}

/**
 * Find the project root by looking for .git directory.
 *
 * Walks up the directory tree from startPath (or cwd) looking for a .git
 * directory, which indicates the project root.
 *
 * @param startPath - Directory to start searching from. Defaults to current working directory.
 * @returns Path to the project root if found, undefined otherwise.
 */
export function findProjectRoot(startPath?: string): string | undefined {
  let current = path.resolve(startPath || process.cwd());

  // Walk up the directory tree
  while (current !== path.dirname(current)) {
    const gitDir = path.join(current, '.git');
    if (fs.existsSync(gitDir)) {
      return current;
    }
    current = path.dirname(current);
  }

  // Check root directory as well
  const rootGitDir = path.join(current, '.git');
  if (fs.existsSync(rootGitDir)) {
    return current;
  }

  return undefined;
}

/**
 * Validate agent name to prevent invalid filesystem paths and security issues.
 *
 * @param agentName - The agent name to validate
 * @returns True if valid, false otherwise
 */
function isValidAgentName(agentName: string): boolean {
  if (!agentName || !agentName.trim()) {
    return false;
  }
  // Allow only alphanumeric, hyphens, underscores, and whitespace
  return /^[a-zA-Z0-9_\-\s]+$/.test(agentName);
}

/**
 * Create a Settings instance with detected environment.
 *
 * @param options - Configuration options
 * @returns Settings instance with project detection and path management
 */
export function createSettings(options: SettingsOptions = {}): Settings {
  const projectRoot = findProjectRoot(options.startPath);
  const userUniverseAgentDir = path.join(os.homedir(), '.universe-agent');

  return {
    projectRoot,
    userUniverseAgentDir,
    hasProject: projectRoot !== undefined,

    getAgentDir(agentName: string): string {
      if (!isValidAgentName(agentName)) {
        throw new Error(
          `Invalid agent name: ${JSON.stringify(agentName)}. ` +
            'Agent names can only contain letters, numbers, hyphens, underscores, and spaces.',
        );
      }
      return path.join(userUniverseAgentDir, agentName);
    },

    ensureAgentDir(agentName: string): string {
      const agentDir = this.getAgentDir(agentName);
      fs.mkdirSync(agentDir, { recursive: true });
      return agentDir;
    },

    getUserAgentMdPath(): string {
      return path.join(userUniverseAgentDir, 'AGENTS.md');
    },

    getProjectAgentMdPath(): string | undefined {
      if (!projectRoot) {
        return undefined;
      }
      return path.join(projectRoot, '.universe-agent', 'AGENTS.md');
    },

    getUserSkillsDir(agentName: string): string {
      return path.join(this.getAgentDir(agentName), 'skills');
    },

    ensureUserSkillsDir(agentName: string): string {
      const skillsDir = this.getUserSkillsDir(agentName);
      fs.mkdirSync(skillsDir, { recursive: true });
      return skillsDir;
    },

    getProjectSkillsDir(): string | undefined {
      if (!projectRoot) {
        return undefined;
      }
      return path.join(projectRoot, '.universe-agent', 'skills');
    },

    ensureProjectSkillsDir(): string | undefined {
      const skillsDir = this.getProjectSkillsDir();
      if (!skillsDir) {
        return undefined;
      }
      fs.mkdirSync(skillsDir, { recursive: true });
      return skillsDir;
    },

    ensureProjectUniverseAgentDir(): string | undefined {
      if (!projectRoot) {
        return undefined;
      }
      const universeAgentDir = path.join(projectRoot, '.universe-agent');
      fs.mkdirSync(universeAgentDir, { recursive: true });
      return universeAgentDir;
    },

    getAllMemorySources(): string[] {
      const sources: string[] = [];

      // === User/Global level (lowest precedence, loaded first) ===

      // Claude Code global: ~/.claude/CLAUDE.md
      sources.push(path.join(os.homedir(), '.claude', 'CLAUDE.md'));

      // Universe Agent user-level: ~/.universe-agent/AGENTS.md
      sources.push(this.getUserAgentMdPath());

      // === Project level (highest precedence, loaded last) ===

      if (projectRoot) {
        // GitHub Copilot: .github/copilot-instructions.md
        sources.push(path.join(projectRoot, '.github', 'copilot-instructions.md'));

        // OpenAI Codex: AGENTS.md (project root)
        sources.push(path.join(projectRoot, 'AGENTS.md'));

        // Claude Code: CLAUDE.md (project root)
        sources.push(path.join(projectRoot, 'CLAUDE.md'));

        // Universe Agent project-level: .universe-agent/AGENTS.md
        sources.push(path.join(projectRoot, '.universe-agent', 'AGENTS.md'));
      }

      return sources;
    },
  };
}
