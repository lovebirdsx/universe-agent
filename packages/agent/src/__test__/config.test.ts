import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createSettings, findProjectRoot, type Settings } from '../config.js';

describe('Config Module', () => {
  let tempDir: string;
  let originalCwd: () => string;

  beforeEach(() => {
    // Create a temporary directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'universe-agent-test-'));
    originalCwd = process.cwd;
  });

  afterEach(() => {
    // Cleanup temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
    process.cwd = originalCwd;
  });

  describe('findProjectRoot', () => {
    it('should find .git directory', () => {
      // Create a .git directory
      const gitDir = path.join(tempDir, '.git');
      fs.mkdirSync(gitDir);

      const result = findProjectRoot(tempDir);
      expect(result).toBe(tempDir);
    });

    it('should find .git directory in parent', () => {
      // Create a .git directory in root
      const gitDir = path.join(tempDir, '.git');
      fs.mkdirSync(gitDir);

      // Create a nested directory
      const nestedDir = path.join(tempDir, 'nested', 'deep');
      fs.mkdirSync(nestedDir, { recursive: true });

      const result = findProjectRoot(nestedDir);
      expect(result).toBe(tempDir);
    });

    it('should return undefined when no .git found', () => {
      // No .git directory
      const result = findProjectRoot(tempDir);
      expect(result).toBeUndefined();
    });

    it('should use cwd when startPath is not provided', () => {
      // Create .git in cwd
      const gitDir = path.join(tempDir, '.git');
      fs.mkdirSync(gitDir);

      // Mock process.cwd
      process.cwd = () => tempDir;

      const result = findProjectRoot();
      expect(result).toBe(tempDir);
    });
  });

  describe('createSettings', () => {
    it('should return correct paths', () => {
      const settings = createSettings({ startPath: tempDir });

      expect(settings.userUniverseAgentDir).toBe(path.join(os.homedir(), '.universe-agent'));
      expect(settings.projectRoot).toBeUndefined();
      expect(settings.hasProject).toBe(false);
    });

    it('should detect project root when .git exists', () => {
      const gitDir = path.join(tempDir, '.git');
      fs.mkdirSync(gitDir);

      const settings = createSettings({ startPath: tempDir });

      expect(settings.projectRoot).toBe(tempDir);
      expect(settings.hasProject).toBe(true);
    });

    describe('getAgentDir', () => {
      let settings: Settings;

      beforeEach(() => {
        settings = createSettings({ startPath: tempDir });
      });

      it('should return correct path for valid agent name', () => {
        const result = settings.getAgentDir('my-agent');
        expect(result).toBe(path.join(os.homedir(), '.universe-agent', 'my-agent'));
      });

      it('should accept alphanumeric names', () => {
        const result = settings.getAgentDir('Agent123');
        expect(result).toBe(path.join(os.homedir(), '.universe-agent', 'Agent123'));
      });

      it('should accept names with hyphens and underscores', () => {
        const result = settings.getAgentDir('my_agent-name');
        expect(result).toBe(path.join(os.homedir(), '.universe-agent', 'my_agent-name'));
      });

      it('should accept names with spaces', () => {
        const result = settings.getAgentDir('My Agent');
        expect(result).toBe(path.join(os.homedir(), '.universe-agent', 'My Agent'));
      });

      it('should throw for invalid names with special characters', () => {
        expect(() => settings.getAgentDir('agent@name')).toThrow(/Invalid agent name/);
      });

      it('should throw for empty name', () => {
        expect(() => settings.getAgentDir('')).toThrow(/Invalid agent name/);
      });

      it('should throw for whitespace-only name', () => {
        expect(() => settings.getAgentDir('   ')).toThrow(/Invalid agent name/);
      });
    });

    describe('ensureAgentDir', () => {
      it('should create directory if not exists', () => {
        const settings = createSettings({ startPath: tempDir });
        const agentName = 'test-agent';
        const result = settings.ensureAgentDir(agentName);

        // Should end with the agent path
        expect(result).toContain('.universe-agent');
        expect(result).toContain(agentName);
        expect(fs.existsSync(result)).toBe(true);
      });

      it('should return existing directory', () => {
        const settings = createSettings({ startPath: tempDir });
        const agentName = 'test-agent';

        // Create directory first time
        const firstResult = settings.ensureAgentDir(agentName);
        expect(fs.existsSync(firstResult)).toBe(true);

        // Call again - should return the same path
        const secondResult = settings.ensureAgentDir(agentName);
        expect(secondResult).toBe(firstResult);
      });
    });

    describe('getUserAgentMdPath', () => {
      it('should return correct path', () => {
        const settings = createSettings({ startPath: tempDir });
        const result = settings.getUserAgentMdPath();
        expect(result).toBe(path.join(os.homedir(), '.universe-agent', 'AGENTS.md'));
      });
    });

    describe('getProjectAgentMdPath', () => {
      it('should return undefined when not in project', () => {
        const settings = createSettings({ startPath: tempDir });
        expect(settings.getProjectAgentMdPath()).toBeUndefined();
      });

      it('should return correct path when in project', () => {
        const gitDir = path.join(tempDir, '.git');
        fs.mkdirSync(gitDir);

        const settings = createSettings({ startPath: tempDir });
        const result = settings.getProjectAgentMdPath();
        expect(result).toBe(path.join(tempDir, '.universe-agent', 'AGENTS.md'));
      });
    });

    describe('getUserSkillsDir', () => {
      it('should return correct path', () => {
        const settings = createSettings({ startPath: tempDir });
        const result = settings.getUserSkillsDir('my-agent');
        expect(result).toBe(path.join(os.homedir(), '.universe-agent', 'my-agent', 'skills'));
      });
    });

    describe('ensureUserSkillsDir', () => {
      it('should create skills directory', () => {
        const settings = createSettings({ startPath: tempDir });
        const result = settings.ensureUserSkillsDir('my-agent');

        // Should end with skills path
        expect(result).toContain('.universe-agent');
        expect(result).toContain('my-agent');
        expect(result).toContain('skills');
        expect(fs.existsSync(result)).toBe(true);
      });
    });

    describe('getProjectSkillsDir', () => {
      it('should return undefined when not in project', () => {
        const settings = createSettings({ startPath: tempDir });
        expect(settings.getProjectSkillsDir()).toBeUndefined();
      });

      it('should return correct path when in project', () => {
        const gitDir = path.join(tempDir, '.git');
        fs.mkdirSync(gitDir);

        const settings = createSettings({ startPath: tempDir });
        const result = settings.getProjectSkillsDir();
        expect(result).toBe(path.join(tempDir, '.universe-agent', 'skills'));
      });
    });

    describe('ensureProjectSkillsDir', () => {
      it('should return undefined when not in project', () => {
        const settings = createSettings({ startPath: tempDir });
        expect(settings.ensureProjectSkillsDir()).toBeUndefined();
      });

      it('should create directory when in project', () => {
        const gitDir = path.join(tempDir, '.git');
        fs.mkdirSync(gitDir);

        const settings = createSettings({ startPath: tempDir });
        const result = settings.ensureProjectSkillsDir();
        expect(result).toBe(path.join(tempDir, '.universe-agent', 'skills'));
        expect(fs.existsSync(result!)).toBe(true);
      });
    });

    describe('ensureProjectUniverseAgentDir', () => {
      it('should return undefined when not in project', () => {
        const settings = createSettings({ startPath: tempDir });
        expect(settings.ensureProjectUniverseAgentDir()).toBeUndefined();
      });

      it('should create directory when in project', () => {
        const gitDir = path.join(tempDir, '.git');
        fs.mkdirSync(gitDir);

        const settings = createSettings({ startPath: tempDir });
        const result = settings.ensureProjectUniverseAgentDir();
        expect(result).toBe(path.join(tempDir, '.universe-agent'));
        expect(fs.existsSync(result!)).toBe(true);
      });
    });

    describe('getAllMemorySources', () => {
      it('should return only user-level paths when not in a project', () => {
        const settings = createSettings({ startPath: tempDir });
        const sources = settings.getAllMemorySources();

        expect(sources).toHaveLength(2);
        expect(sources[0]).toBe(path.join(os.homedir(), '.claude', 'CLAUDE.md'));
        expect(sources[1]).toBe(path.join(os.homedir(), '.universe-agent', 'AGENTS.md'));
      });

      it('should return all paths when in a project', () => {
        const gitDir = path.join(tempDir, '.git');
        fs.mkdirSync(gitDir);

        const settings = createSettings({ startPath: tempDir });
        const sources = settings.getAllMemorySources();

        expect(sources).toHaveLength(6);
        // User/global level
        expect(sources[0]).toBe(path.join(os.homedir(), '.claude', 'CLAUDE.md'));
        expect(sources[1]).toBe(path.join(os.homedir(), '.universe-agent', 'AGENTS.md'));
        // Project level
        expect(sources[2]).toBe(path.join(tempDir, '.github', 'copilot-instructions.md'));
        expect(sources[3]).toBe(path.join(tempDir, 'AGENTS.md'));
        expect(sources[4]).toBe(path.join(tempDir, 'CLAUDE.md'));
        expect(sources[5]).toBe(path.join(tempDir, '.universe-agent', 'AGENTS.md'));
      });

      it('should have universe-agent project path last (highest precedence)', () => {
        const gitDir = path.join(tempDir, '.git');
        fs.mkdirSync(gitDir);

        const settings = createSettings({ startPath: tempDir });
        const sources = settings.getAllMemorySources();

        const lastSource = sources[sources.length - 1]!;
        expect(lastSource).toContain('.universe-agent');
        expect(lastSource).toContain('AGENTS.md');
        expect(lastSource).toBe(path.join(tempDir, '.universe-agent', 'AGENTS.md'));
      });
    });
  });
});
