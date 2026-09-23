#!/usr/bin/env node
// The owner's standing rule: no em dash anywhere, in any of its four spellings. The patterns are
// assembled from parts so this file, which the check also scans, never spells one itself.
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const EM_DASH_FORMS = [
  { name: 'the character', token: String.fromCharCode(0x2014) },
  { name: 'the named entity', token: '&' + 'mdash;' },
  { name: 'the numeric entity', token: '&#' + '8212;' },
  { name: 'the escape', token: '\\' + 'u2014' },
];

const BINARY = /\.(png|jpe?g|webp|gif|glb|bin|ktx2|blend|exr|ogg|wav|mp3|woff2?|ttf|ico)$/i;

/** One finding per occurrence, with a 1-based line number and the form's name. */
export function findEmDashes(text) {
  const findings = [];
  text.split(/\r?\n/).forEach((line, index) => {
    for (const form of EM_DASH_FORMS) {
      let from = 0;
      for (;;) {
        const at = line.indexOf(form.token, from);
        if (at < 0) break;
        findings.push({ line: index + 1, form: form.name });
        from = at + form.token.length;
      }
    }
  });
  return findings;
}

function candidateFiles() {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    encoding: 'utf8',
  });
  return out.split('\0').filter((file) => file && !BINARY.test(file));
}

function main() {
  const files = candidateFiles();
  let total = 0;
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch (error) {
      // A file git lists can be deleted in the working tree, or be a nested repository directory.
      if (error.code === 'ENOENT' || error.code === 'EISDIR') continue;
      throw error;
    }
    for (const finding of findEmDashes(text)) {
      console.log(`${file}:${finding.line}: em dash (${finding.form})`);
      total += 1;
    }
  }
  console.log(`em dash check: ${total} found in ${files.length} files`);
  if (total > 0) process.exit(1);
}

// Compare real paths: Node resolves symlinks and junctions in import.meta.url but not in argv[1],
// so a plain comparison skipped the scan and exited 0 when the checkout sat behind a link.
const entry = process.argv[1]; // absent under node -e, and realpathSync(undefined) throws
if (entry && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) main();
