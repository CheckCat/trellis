#!/usr/bin/env node
// Gate: no git-tracked source file may contain a NUL byte (0x00) — the
// standard signal that a file is binary or was corrupted/mis-encoded (e.g.
// saved as UTF-16, or truncated) when every tracked source path in this
// repo is expected to be plain text. Scope is every tracked path EXCEPT
// `.mvp/` (the pipeline's generated audit trail — see the comment on
// `listTrackedFiles` below for why).
//
// Wired in as npm's "pretest" lifecycle hook (see package.json) rather than
// referenced from .mvp/ci-mirror.sh or .github/workflows/ci.yml directly:
// both of those already run the byte-identical `npm run test --if-present`
// step, and npm runs a package's "pretest" script automatically right
// before "test" runs — so hooking in here makes the gate fire identically
// in both places without editing either file (same pattern already used by
// services/backend's own "pretest": compile-before-test).
//
// Run directly for a quick local check: `node scripts/check-text-sources.mjs`.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// The gate covers every tracked source file in the project — but not
// `.mvp/`. That directory is the pipeline's own generated audit trail:
// review packages inside it legitimately quote arbitrary bytes (including
// raw NUL) verbatim as evidence of what a gate rejected, which made this
// same check self-reproducingly red the moment a review package cited a
// NUL byte it was reporting on, rather than one it was introducing as a
// source-encoding bug. Excluding `.mvp/` keeps the gate meaningful for its
// actual purpose (catching mis-encoded/binary source) without it tripping
// over its own audit log. Prose elsewhere in the project that needs to
// talk about a NUL byte still quotes it via escape notation (`\x00`, the
// same convention already used in `.mvp/` for this exact byte) rather than
// embedding the raw control byte — that convention is what keeps `.mvp/`
// itself readable text, it's just no longer this gate's job to enforce it.

function listTrackedFiles() {
  // `-z` NUL-delimits the listing so paths with spaces/newlines round-trip
  // safely; `git ls-files` already excludes .git/ and anything untracked
  // (node_modules, build output, .gitignore'd files). `.mvp/` is excluded
  // here too — see the comment above.
  const raw = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
  return raw
    .split('\0')
    .filter((path) => path.length > 0)
    .filter((path) => path !== '.mvp' && !path.startsWith('.mvp/'));
}

function findNulPosition(buffer) {
  const byteOffset = buffer.indexOf(0x00);
  if (byteOffset === -1) return null;
  let line = 1;
  let column = 1;
  for (let i = 0; i < byteOffset; i += 1) {
    if (buffer[i] === 0x0a) {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { byteOffset, line, column };
}

function main() {
  const files = listTrackedFiles();
  const violations = [];

  for (const file of files) {
    let buffer;
    try {
      buffer = readFileSync(file);
    } catch (err) {
      // A file can be listed by `git ls-files` yet momentarily missing on
      // disk (e.g. a dirty working tree mid-rebase); that's not this gate's
      // concern, skip it rather than crash the whole check.
      if (err && err.code === 'ENOENT') continue;
      throw err;
    }
    const position = findNulPosition(buffer);
    if (position !== null) {
      violations.push({ file, ...position });
    }
  }

  if (violations.length > 0) {
    console.error(
      'check-text-sources: найдены не-текстовые байты (NUL, 0x00) в отслеживаемых файлах:',
    );
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}:${v.column} (byte offset ${v.byteOffset})`);
    }
    console.error(
      `Итого: ${violations.length} файл(ов). Уберите NUL-байты из файла или проверьте кодировку/сохранение.`,
    );
    process.exitCode = 1;
    return;
  }

  process.exitCode = 0;
}

main();
