#!/usr/bin/env node
// ─── Interactive SQLite shell ─────────────────────────────────────────────────
// Uses the better-sqlite3 driver already in node_modules.
// Run with:  node scripts/db-shell.js
//            node scripts/db-shell.js "SELECT * FROM events"   (one-shot)

'use strict';

const path     = require('path');
const readline = require('readline');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'ticketyboo.db');
const db = new Database(DB_PATH, { readonly: true });

// ── One-shot mode ─────────────────────────────────────────────────────────────
if (process.argv[2]) {
  try {
    const rows = db.prepare(process.argv[2]).all();
    console.table(rows);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
  db.close();
  process.exit(0);
}

// ── Interactive mode ──────────────────────────────────────────────────────────
const rl = readline.createInterface({
  input:  process.stdin,
  output: process.stdout,
  prompt: 'sqlite> '
});

console.log('ticketyboo SQLite shell  (type .help for commands, .quit to exit)\n');

const builtins = {
  '.help': () => {
    console.log('  .tables       — list all tables');
    console.log('  .schema TABLE — show CREATE statement for TABLE');
    console.log('  .count        — row counts for every table');
    console.log('  .quit / .exit — exit the shell');
    console.log('  Any other input is executed as SQL.\n');
  },
  '.tables': () => {
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    console.log(rows.map(r => r.name).join('  ') + '\n');
  },
  '.count': () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    for (const { name } of tables) {
      const { cnt } = db.prepare(`SELECT COUNT(*) AS cnt FROM "${name}"`).get();
      console.log(`  ${name.padEnd(20)} ${cnt}`);
    }
    console.log();
  },
  '.quit': () => { db.close(); process.exit(0); },
  '.exit': () => { db.close(); process.exit(0); }
};

rl.prompt();

let buffer = '';

rl.on('line', (line) => {
  const trimmed = line.trim();

  // Built-in dot commands
  if (builtins[trimmed]) {
    builtins[trimmed]();
    rl.prompt();
    return;
  }

  // .schema TABLE
  if (trimmed.startsWith('.schema')) {
    const table = trimmed.split(/\s+/)[1] || '';
    const row   = db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(table);
    console.log(row ? row.sql + '\n' : `No table named '${table}'\n`);
    rl.prompt();
    return;
  }

  // Accumulate multi-line SQL
  buffer += (buffer ? ' ' : '') + trimmed;

  if (buffer.endsWith(';') || buffer.endsWith(';')) {
    try {
      const stmt = db.prepare(buffer.replace(/;$/, ''));
      if (stmt.reader) {
        const rows = stmt.all();
        if (rows.length === 0) {
          console.log('(no rows)\n');
        } else {
          console.table(rows);
        }
      } else {
        const info = stmt.run();
        console.log(`Changes: ${info.changes}\n`);
      }
    } catch (err) {
      console.error('Error:', err.message, '\n');
    }
    buffer = '';
    rl.setPrompt('sqlite> ');
  } else if (buffer.length > 0) {
    rl.setPrompt('   ...> ');
  }

  rl.prompt();
});

rl.on('close', () => {
  db.close();
  process.exit(0);
});
