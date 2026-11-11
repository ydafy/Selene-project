// Counts which agent skills the harness read in recent sessions, for the
// monthly routine (docs/maintenance.md, "E. Agent tools"). Gentle Shell keeps
// one JSONL log per session; a skill read is an assistant tool call whose
// arguments name `skills/<name>/SKILL.md`. Prints Markdown and never prints
// session content.
//
//   bun run skills:usage [--days N] [--logs <dir> ...] [--skills <dir>]
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DAY_MS = 24 * 60 * 60 * 1000;
const SKILL_PATH = /skills[\\/]+([^\\/"]+?)[\\/]+SKILL\.md/gi;
const SKILL_NAME = /^[a-z0-9-]+$/;

export const DEFAULT_LOG_DIRS = [
  join(homedir(), '.gentle-shell', 'agent', 'sessions'),
  join(homedir(), '.gentle-shell', 'agent', 'gentle-agents', 'sessions'),
];
const DEFAULT_SKILLS_DIR = join(
  import.meta.dir,
  '..',
  '..',
  '.agents',
  'skills',
);

export interface SkillCount {
  skill: string;
  sessions: number;
}

export interface SkillUsage {
  sessions: number;
  sessionsWithRead: number;
  counts: SkillCount[];
}

interface ToolCallLine {
  message?: {
    role?: unknown;
    content?: unknown;
  };
}

function parseLine(line: string): ToolCallLine | null {
  try {
    const value: unknown = JSON.parse(line);
    return value && typeof value === 'object' ? (value as ToolCallLine) : null;
  } catch {
    return null;
  }
}

export function skillsReadInSession(jsonl: string): Set<string> {
  const skills = new Set<string>();
  for (const line of jsonl.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const message = parseLine(line)?.message;
    if (message?.role !== 'assistant' || !Array.isArray(message.content))
      continue;
    for (const item of message.content as {
      type?: unknown;
      arguments?: unknown;
    }[]) {
      if (item?.type !== 'toolCall') continue;
      const args = JSON.stringify(item.arguments ?? null);
      for (const match of args.matchAll(SKILL_PATH)) {
        const name = match[1].toLowerCase();
        if (SKILL_NAME.test(name)) skills.add(name);
      }
    }
  }
  return skills;
}

export function installedSkills(skillsDir: string): string[] {
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function sessionFiles(dir: string, since: number): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sessionFiles(path, since));
    else if (entry.name.endsWith('.jsonl') && statSync(path).mtimeMs >= since)
      files.push(path);
  }
  return files;
}

// Returns null when none of the log folders exists.
export function summarizeSkillUsage(options: {
  logDirs: string[];
  days: number;
  now?: number;
}): SkillUsage | null {
  const dirs = options.logDirs.filter((dir) => existsSync(dir));
  if (dirs.length === 0) return null;

  const since = (options.now ?? Date.now()) - options.days * DAY_MS;
  const perSkill = new Map<string, number>();
  let sessions = 0;
  let sessionsWithRead = 0;
  for (const file of dirs.flatMap((dir) => sessionFiles(dir, since))) {
    sessions += 1;
    const skills = skillsReadInSession(readFileSync(file, 'utf8'));
    if (skills.size > 0) sessionsWithRead += 1;
    for (const skill of skills)
      perSkill.set(skill, (perSkill.get(skill) ?? 0) + 1);
  }

  const counts = [...perSkill]
    .map(([skill, count]) => ({ skill, sessions: count }))
    .sort((a, b) => b.sessions - a.sessions || a.skill.localeCompare(b.skill));
  return { sessions, sessionsWithRead, counts };
}

export function formatSkillUsage(
  usage: SkillUsage,
  options: { days: number; installed: string[] },
): string {
  const read = new Set(usage.counts.map((count) => count.skill));
  const unread = options.installed.filter((skill) => !read.has(skill));
  return [
    `# Skill usage, last ${options.days} days`,
    '',
    `- Sessions scanned: ${usage.sessions}`,
    `- Sessions with at least one skill read: ${usage.sessionsWithRead}`,
    '',
    '| Skill | Sessions |',
    '| ----- | -------- |',
    ...usage.counts.map((count) => `| ${count.skill} | ${count.sessions} |`),
    '',
    '## Installed with zero reads',
    '',
    ...(unread.length > 0 ? unread.map((skill) => `- ${skill}`) : ['- None']),
    '',
  ].join('\n');
}

interface CliOptions {
  days: number;
  logDirs: string[];
  skillsDir: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    days: 30,
    logDirs: [],
    skillsDir: DEFAULT_SKILLS_DIR,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--days') {
      const value = argv[++i];
      if (!value || !/^[1-9]\d*$/.test(value))
        throw new Error('--days must be a positive integer');
      options.days = Number(value);
    } else if (arg === '--logs') {
      while (argv[i + 1] && !argv[i + 1].startsWith('--'))
        options.logDirs.push(argv[++i]);
    } else if (arg === '--skills') {
      const value = argv[++i];
      if (!value) throw new Error('--skills needs a folder');
      options.skillsDir = value;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (options.logDirs.length === 0) options.logDirs = DEFAULT_LOG_DIRS;
  return options;
}

if (import.meta.main) {
  let options: CliOptions;
  try {
    options = parseArgs(Bun.argv.slice(2));
  } catch (error) {
    console.error(
      `[skill-usage] ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error(
      'Usage: bun scripts/dev/skill-usage.ts [--days N] [--logs <dir> ...] [--skills <dir>]',
    );
    process.exit(1);
  }
  const usage = summarizeSkillUsage({
    logDirs: options.logDirs,
    days: options.days,
  });
  if (!usage)
    console.log(`No session logs found in: ${options.logDirs.join(', ')}`);
  else
    process.stdout.write(
      formatSkillUsage(usage, {
        days: options.days,
        installed: installedSkills(options.skillsDir),
      }),
    );
}
