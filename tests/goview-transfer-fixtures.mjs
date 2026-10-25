import {createHash} from 'node:crypto';
export const hash=raw=>createHash('sha256').update(raw).digest('hex');
export const capture='synthetic-capture-0001';
export function envelope(operation,payload,identity,transferId){
 return {schema:'goview.transfer.v1',transferId,operation,payloadType:operation==='STUDIO'?'goview.map.package.v1':'goview.map-update',identity,sha256:hash(payload),payload};
}
export function snapshot(){
 return envelope('SNAPSHOT',JSON.stringify({type:'FeatureCollection',schemaVersion:1,name:'GOVIEW',goview:{format:'goview.map-update',version:3},features:[{type:'Feature',id:'selected-one',geometry:{type:'Point',coordinates:[10,20]},properties:{name:'Synthetic',goviewRecord:{id:'selected-one',label:'Synthetic',point:{longitude:10,latitude:20},gridId:'',evidence:{coordinate:'UNKNOWN',source:'selected-owner-snapshot',observedAt:null,availableUntil:null},zoneId:null,note:null}}}],captureId:capture,capturedAtEpochMs:1,captureReceipt:{id:'synthetic-receipt-0001',operation:'SNAPSHOT',status:'CAPTURED_LOCAL',correlationId:capture,version:3},selection:'explicit-pins-only'}),{captureId:capture,baseVersion:3},capture);
}
export function proposal(s=snapshot()){
 return envelope('PROPOSAL',JSON.stringify({contractVersion:1,operation:'propose-update',sourceCaptureId:capture,baseVersion:3,package:{type:'FeatureCollection',features:[{type:'Feature',id:'proposed-one',geometry:{type:'Point',coordinates:[11,21]},properties:{name:'New synthetic'}}]}}),{captureId:capture,baseVersion:3,snapshotSha256:s.sha256},capture+'-proposal');
}
export function studio(version=1){
 const map={schema:1,mapId:'synthetic-studio',title:'Synthetic',version,origin:{lat:10,lng:20},nodes:[{id:'n1',x:0,y:0},{id:'n2',x:1,y:1}],roads:[{id:'r1',from:'n1',to:'n2',name:'Path'}],areas:[],pois:[{id:'p1',name:'Place',nodeId:'n1'}]};
 return envelope('STUDIO',JSON.stringify({format:'goview.map.package.v1',checksum:'sha256:'+hash(JSON.stringify(map)),map})+'\n',{mapId:map.mapId,version},'synthetic-studio-transfer');
}
export const receipt=(p=proposal())=>({transferId:p.transferId,sha256:p.sha256,operation:'UPDATE',status:'SAVED',revision:4,readbackVerified:true});
