import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
export function testDatabase(){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
 function prepare(query){let args=[];return {bind(...v){args=v;return this;},
  async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};},
  async run(){const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}};},
  execute(){return sql.prepare(query).all(...args);}};}
 const DB={prepare,async batch(statements){sql.exec('BEGIN');try{const results=statements.map(s=>({results:s.execute()}));sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 return {sql,DB,close:()=>sql.close()};
}
export function seed(sql,{id=crypto.randomUUID(),title='Beaver',content='Beaver/บีเวอร์',tags=['beaver'],status='active',revision=1,updated_at='2026-11-12T00:00:00.000Z',kind='knowledge'}={}){
 sql.prepare('INSERT INTO memories(id,kind,title,content,tags,status,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,kind,title,content,JSON.stringify(tags),status,revision,updated_at,updated_at);return id;
}
