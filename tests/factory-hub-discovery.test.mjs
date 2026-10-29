import test from 'node:test';
import assert from 'node:assert/strict';
import {appMcp} from '../worker/index.js';
import {hubGroup} from '../worker/hub-client.mjs';
test('Factory VISUAL upload and readback stay discoverable through their source API',async()=>{
 const names=['factory_visual_upload','factory_visual_upload_status','factory_visual_zip_chunk'];
 for(const name of names)assert.equal(hubGroup(name),'factory');
 const response=await appMcp(new Request('https://go.internal/hub-mcp/factory',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})}),{});
 const rpc=await response.json();
 for(const name of names)assert.ok(rpc.result.tools.some(t=>t.name===name));
});
