import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Execute the shipped page script with a minimal DOM and synthetic transport.
async function page() {
 const nodes=new Map(), calls=[], replies=[];
 const node=()=>({value:'',style:{},dataset:{},classList:{toggle(){}},handlers:{},
  addEventListener(type,fn){this.handlers[type]=fn;},append(){},replaceChildren(){},querySelectorAll(){return [];}});
 const get=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
 get('ttl').value='60';let sequence=0;
 const context=vm.createContext({document:{getElementById:get,createElement:node},window:{addEventListener(){}},
  confirm:()=>true,crypto:{randomUUID:()=>`synthetic-request-${++sequence}`},
  fetch:async(_url,options)=>{const action=options.body?JSON.parse(options.body):{};calls.push(action);
   if(!action.action)return {ok:true,json:async()=>({ok:true,presets:[{preset:'CODE',name:'Code',scopes:[],maxTtlSeconds:3600}],slots:[{slotId:'TEST_SLOT',recipient:'TEST',preset:'CODE',maxTtlSeconds:3600}]})};
   const next=replies.shift();const reply=typeof next==='function'?await next():next;if(reply instanceof Error)throw reply;
   return {ok:true,json:async()=>({ok:true,...reply})};}});
 const html=readFileSync(new URL('../static/factory-key-stamper.html',import.meta.url),'utf8');
 vm.runInContext(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1],context);
 await new Promise(resolve=>setImmediate(resolve));vm.runInContext("selectSlot('TEST_SLOT')",context);
 return {get,calls,replies,click:id=>get(id).handlers.click()};
}
for(const prior of [false,true])test(`lost stamp response recovers revocation identity (prior stamp: ${prior})`,async()=>{
 const p=await page();
 if(prior){p.replies.push({status:'KEY_STAMPED',keyId:'synthetic-A',key:'synthetic-secret-A'});await p.click('stampButton');}
 p.replies.push(new Error('response lost'));await p.click('stampButton');
 const request=p.calls.at(-1).requestId;
 assert.equal(p.get('keyId').value,'');assert.equal(p.get('secretOutput').value,'');
 const before=p.calls.length;await p.click('revokeButton');assert.equal(p.calls.length,before);
 p.replies.push({status:'ACTIVE',keyId:'synthetic-B',slotId:'TEST_SLOT',recipient:'TEST'});await p.click('statusButton');
 assert.deepEqual(p.calls.at(-1),{action:'status',requestId:request});
 assert.equal(p.get('keyId').value,'synthetic-B');assert.equal(p.get('secretOutput').value,'');
 p.replies.push({status:'REVOKED'});await p.click('revokeButton');
 assert.deepEqual(p.calls.at(-1),{action:'revoke',keyId:'synthetic-B',approved:true});
});

test('status lookup locks mutations until identity recovery finishes',async()=>{
 const p=await page();p.replies.push(new Error('lost'));await p.click('stampButton');
 let finish;p.replies.push(()=>new Promise(resolve=>{finish=resolve;}));
 const pending=p.click('statusButton');assert.equal(p.get('keyId').readOnly,true);
 const before=p.calls.length;await p.click('stampButton');await p.click('revokeButton');await p.click('statusButton');assert.equal(p.calls.length,before);
 finish({status:'ACTIVE',keyId:'synthetic-B'});await pending;
 assert.equal(p.get('keyId').value,'synthetic-B');assert.equal(p.get('keyId').readOnly,false);
});
test('failed lookup retains request identity; explicit manual identity cancels fallback',async()=>{
 const p=await page();p.replies.push(new Error('lost'));await p.click('stampButton');
 const request=p.calls.at(-1).requestId;p.replies.push(new Error('offline'));await p.click('statusButton');
 assert.equal(p.get('keyId').value,'');assert.equal(p.get('statusButton').disabled,false);
 p.replies.push({status:'ACTIVE',keyId:'synthetic-B'});await p.click('statusButton');assert.equal(p.calls.at(-1).requestId,request);
 p.get('keyId').value='synthetic-manual';p.get('keyId').handlers.input();
 p.replies.push({status:'ACTIVE'});await p.click('statusButton');assert.deepEqual(p.calls.at(-1),{action:'status',keyId:'synthetic-manual'});
 p.get('keyId').value='';p.get('keyId').handlers.input();const before=p.calls.length;await p.click('statusButton');assert.equal(p.calls.length,before);
});

test('operator can recover a lost-response request after reopening the page',async()=>{
 const p=await page();p.get('requestId').value='123e4567-e89b-42d3-a456-426614174000';
 assert.equal(typeof p.get('requestId').handlers.input,'function');
 p.get('requestId').handlers.input();
 p.replies.push({status:'ACTIVE',keyId:'synthetic-recovered'});await p.click('statusButton');
 assert.deepEqual(p.calls.at(-1),{action:'status',requestId:'123e4567-e89b-42d3-a456-426614174000'});
 assert.equal(p.get('keyId').value,'synthetic-recovered');
 assert.equal(p.get('secretOutput').value,'');
});

test('probe uses issuance recipient and memory-only key, locks repeated clicks and clears on hide',async()=>{
 const p=await page();p.replies.push({status:'KEY_STAMPED',keyId:'synthetic-A',key:'synthetic-secret-A'});await p.click('stampButton');
 p.get('recipient').value='DIFFERENT';let finish;
 p.replies.push(()=>new Promise(resolve=>{finish=resolve;}));const pending=p.click('probeButton');
 assert.deepEqual(p.calls.at(-1),{action:'probe',key:'synthetic-secret-A',recipient:'TEST',scope:'FACTORY:STATUS'});
 const count=p.calls.length;await p.click('probeButton');assert.equal(p.calls.length,count);
 finish({status:'KEY_ACCEPTED'});await pending;
 assert.ok(!p.get('status').textContent.includes('synthetic-secret-A'));
 await p.click('hideButton');await p.click('probeButton');assert.equal(p.calls.length,count);assert.equal(p.get('secretOutput').value,'');
});
