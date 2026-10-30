import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const templatesDir = import.meta.dir;
// The wiring ships commented out: the experimental stack refuses content_path
// at `supabase start`. Uncommenting the block is the documented local preview.
const config = readFileSync(
  join(templatesDir, '..', 'config.toml'),
  'utf8',
).replace(/^# ?(?=\[auth\.email\.template\.|subject = |content_path = )/gm, '');

const read = (name: string) =>
  readFileSync(join(templatesDir, `${name}.html`), 'utf8');

// The app asks for the 6-digit code in these three; only email_change is a link.
const codeTemplates = ['confirmation', 'recovery', 'reauthentication'];
const allTemplates = [...codeTemplates, 'email_change'];

const section = (name: string) => {
  const header = `[auth.email.template.${name}]`;
  const start = config.indexOf(header);
  if (start === -1) return '';
  const rest = config.slice(start + header.length);
  const next = rest.search(/^\[/m);
  return next === -1 ? rest : rest.slice(0, next);
};

describe('auth email templates', () => {
  for (const name of allTemplates) {
    test(`${name}: file exists and is wired in config.toml`, () => {
      expect(existsSync(join(templatesDir, `${name}.html`))).toBe(true);
      const block = section(name);
      expect(block).toContain(
        `content_path = "./supabase/templates/${name}.html"`,
      );
      expect(block).toMatch(/^subject = ".+"/m);
    });

    test(`${name}: no external asset URLs`, () => {
      expect(read(name)).not.toMatch(/https?:\/\//i);
    });
  }

  for (const name of codeTemplates) {
    test(`${name}: shows the code, never the link`, () => {
      const html = read(name);
      expect(html).toContain('{{ .Token }}');
      expect(html).not.toContain('{{ .ConfirmationURL }}');
    });
  }

  test('email_change: uses the confirmation link', () => {
    expect(read('email_change')).toContain('{{ .ConfirmationURL }}');
  });
});
