import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

const fixture = new URL('./fixtures/brain-pre-card.sql', import.meta.url);
const cardMigration = new URL('../migrations/0002_brain_memory_card.sql', import.meta.url);
const associationsMigration = new URL('../migrations/0003_brain_associations.sql', import.meta.url);

// The deployed Brain DB has baseline memories/history triggers, not the feature schema.
// Exercise an upgrade of that shape, not just a fresh schema.sql installation.
test('legacy Brain DB upgrades to card then associations without rewriting source/history', () => {
 const db = new DatabaseSync(':memory:');
 try {
  db.exec(readFileSync(fixture, 'utf8'));
  const oldTime = '2026-11-01T00:00:00.000Z';
  db.prepare('INSERT INTO memories(id,kind,title,content,tags,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
   .run('memory-a','knowledge','Beaver source','Existing source',JSON.stringify(['Beaver','GO Brain']),'active',oldTime,oldTime);
  const sourceBefore = db.prepare('SELECT id,kind,title,content,status,work_id,evidence_url,outcome,confidence,tags,revision,created_at,updated_at FROM memories WHERE id=?').get('memory-a');
  const historyBefore = db.prepare('SELECT * FROM history ORDER BY rowid').all();

  db.exec(readFileSync(cardMigration, 'utf8'));
  db.exec(readFileSync(associationsMigration, 'utf8'));

  const sourceAfter = db.prepare('SELECT id,kind,title,content,status,work_id,evidence_url,outcome,confidence,tags,revision,created_at,updated_at FROM memories WHERE id=?').get('memory-a');
  assert.deepEqual(sourceAfter, sourceBefore);
  assert.deepEqual(db.prepare('SELECT * FROM history ORDER BY rowid').all(), historyBefore);
  assert.equal(db.prepare('SELECT metadata FROM memories WHERE id=?').get('memory-a').metadata, '{}');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM brain_memory_terms WHERE memory_id='memory-a' AND revision=1 AND provenance='GO_supplied'").get().n, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM brain_association_runs').get().n, 0,
   'old memories must never trigger automatic historical AI requests');

  const updated = '2026-11-12T00:00:00.000Z';
  db.prepare('UPDATE memories SET content=?,revision=2,updated_at=? WHERE id=?')
   .run('Edited source',updated,'memory-a');
  assert.equal(db.prepare("SELECT state FROM brain_association_runs WHERE memory_id='memory-a' AND revision=2").get().state,'pending');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM brain_memory_terms WHERE memory_id='memory-a' AND revision=2 AND provenance='GO_supplied'").get().n,2);
  const newestHistory = JSON.parse(db.prepare("SELECT after_json FROM history WHERE memory_id='memory-a' ORDER BY rowid DESC LIMIT 1").get().after_json);
  assert.deepEqual(newestHistory.metadata, {});

  db.prepare("UPDATE memories SET status='deleted',revision=3 WHERE id='memory-a'").run();
  assert.equal(db.prepare("SELECT state FROM brain_association_runs WHERE memory_id='memory-a' AND revision=2").get().state,'superseded');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM brain_association_runs WHERE memory_id='memory-a' AND revision=3").get().n,0);

  db.prepare("UPDATE memories SET status='active',revision=4 WHERE id='memory-a'").run();
  assert.equal(db.prepare("SELECT state FROM brain_association_runs WHERE memory_id='memory-a' AND revision=4").get().state,'pending');
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 } finally { db.close(); }
});
