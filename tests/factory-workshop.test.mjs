import test from 'node:test';
import assert from 'node:assert/strict';
import {factoryWorkshopContent,factoryDirectSubmit} from '../worker/factory-direct.mjs';
const KEY='fixture-opaque-key!0123456789+abcdefgh/ABCDEFGHIJK',SHA='a'.repeat(40);
function fixture({ready=true,badDigest=false}={}) {
  const paths=[];
  const env={GO_FACTORY_RAIL_SECRET:KEY,FACTORY_DIRECT:{fetch:async request=>{
    const path=new URL(request.url).pathname;paths.push(path);
    if(path==='/health')return Response.json({service:'factory-district',stationId:'FACTORY-STATION',sourceSha:SHA,status:'READY',storage:{status:'READY'},transport:{status:'READY'},machinery:{LOGIC:{status:'READY',genericRunner:{status:ready?'READY':'UNKNOWN'}}}});
    const body=JSON.parse(await request.text());
    if(path==='/station/go-auth-probe'){
      const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(KEY),{name:'HMAC',hash:'SHA-256'},false,['sign']);
      const proof=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(body.purpose+'\n'+body.nonce+'\n'+SHA+'\nFACTORY-STATION'))).toString('hex');
      return Response.json({status:'AUTHENTICATED',service:'factory-district',stationId:'FACTORY-STATION',sourceSha:SHA,nonce:body.nonce,readOnly:true,executed:false,proof});
    }
    assert.equal(path,'/station/go-workshop-content');assert.equal(body.expectedSourceSha,SHA);
    const hash=badDigest?'0'.repeat(64):Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(body.content)))).toString('hex');
    return Response.json({status:'WORKSHOP_CONTENT_STORED',ref:'r2://factory/records/logic/workshop/v1/content/'+hash,sha256:hash,executed:false});
  }}};
  return {env,paths};
}

test('old runtime never receives Workshop input or commands',async()=>{
  const f=fixture({ready:false});
  assert.equal((await factoryWorkshopContent(f.env,{content:{x:1}},true)).status,'FACTORY_WORKSHOP_NOT_READY');
  assert.equal((await factoryDirectSubmit(f.env,{domain:'LOGIC',spec:{workshop:{operation:'REGISTER_SUBJECT'}}},true)).status,'FACTORY_WORKSHOP_NOT_READY');
  assert.ok(f.paths.every(p=>p==='/health'||p==='/station/go-auth-probe'));
});
test('content digest checked independently and no implicit approval',async()=>{
  const f=fixture();
  assert.equal((await factoryWorkshopContent(f.env,{content:{x:1}})).status,'OWNER_APPROVAL_REQUIRED');assert.equal(f.paths.length,0);
  const good=await factoryWorkshopContent(f.env,{content:{x:1}},true);assert.equal(good.ok,true);assert.equal(good.executed,false);
  const bad=await factoryWorkshopContent(fixture({badDigest:true}).env,{content:{x:1}},true);assert.equal(bad.status,'GO_WORKSHOP_CONTENT_UNVERIFIED');
});
