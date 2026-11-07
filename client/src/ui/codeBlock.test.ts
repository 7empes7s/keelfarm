import { describe, expect, it } from 'vitest';
import { codeLanguage, copiedText, languageLabel, shellLines } from './codeBlock';

describe('code blocks (#200)', () => {
  it('labels the fence language', () => {
    expect(languageLabel(codeLanguage('language-bash'))).toBe('Terminal');
    expect(languageLabel(codeLanguage(['language-sh']))).toBe('Terminal');
    expect(languageLabel(codeLanguage(['hljs', 'language-console']))).toBe('Terminal');
    expect(languageLabel(codeLanguage('language-ts'))).toBe('TypeScript');
    expect(languageLabel(codeLanguage('language-TSX'))).toBe('TypeScript');
    expect(languageLabel(codeLanguage('language-rust'))).toBe('RUST');
    expect(languageLabel(codeLanguage(undefined))).toBe('Code');
  });

  it('copies the code alone: no prompt, line breaks kept, no trailing newline', () => {
    const cmd = 'git -C /root/Projects/keelfarm log --oneline';
    expect(copiedText(`${cmd}\n`, 'bash')).toBe(cmd);
    expect(copiedText('npm ci \\\n  --no-audit\nnpm test\n\n', 'sh')).toBe('npm ci \\\n  --no-audit\nnpm test');
    expect(copiedText('const a = 1;\n\nexport { a };\n', 'ts')).toBe('const a = 1;\n\nexport { a };');
    // a console transcript: the commands without their $, not the output
    expect(copiedText('$ npm test\n12 passed\n$ npm run build\n', 'console')).toBe('npm test\nnpm run build');
  });

  it('puts the prompt on commands, not on comments, blanks or continuations', () => {
    expect(shellLines('# set up\nnpm ci \\\n  --no-audit\n\nnpm test').map((l) => l.prompt)).toEqual([false, true, false, false, true]);
  });
});
