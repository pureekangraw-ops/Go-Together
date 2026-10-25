// Independent boundary validation pinned to Observatory transfer contract v1 at
// 2be838f6799cb927f940f21f3af21b830442a8e7. Keep Studio graph normalization
// separate from selected-pin GeoJSON; never translate between their stores.
const transferTools=['goview_transfer_read','goview_transfer_publish','goview_transfer_receipt'];
async function digest(raw){
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw));
 return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
async function unpackStudio(raw){
 const p=JSON.parse(raw);ensure(p && p.format==='goview.map.package.v1');
 const map=normalize(p.map);
 ensure(p.checksum==='sha256:'+await digest(JSON.stringify(map)));
 return map;
}
const MAX_PAYLOAD=1048576;
const MAX_ENVELOPE=2*MAX_PAYLOAD+8192;
const idValid=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{8,80}$/.test(x);
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>object(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const ensure=(x)=>{if(!x)throw Error('INVALID_TRANSFER');};
const integer=x=>Number.isSafeInteger(x)&&x>=0;
const bounded=(x,n)=>typeof x==='string'&&x.length>0&&x.length<=n;
const proposalId=captureId=>captureId+'-proposal';
function points(document,selected=false){
 ensure(object(document)&&document.type==='FeatureCollection'&&Array.isArray(document.features)&&document.features.length>0&&document.features.length<=1000);
 const ids=new Set();
 for(const f of document.features){
  ensure(object(f)&&f.type==='Feature'&&bounded(String(f.id??''),256)&&!ids.has(String(f.id)));ids.add(String(f.id));
  ensure(object(f.geometry)&&f.geometry.type==='Point'&&Array.isArray(f.geometry.coordinates)&&f.geometry.coordinates.length===2);
  const [lng,lat]=f.geometry.coordinates;ensure(Number.isFinite(lng)&&Math.abs(lng)<=180&&Number.isFinite(lat)&&Math.abs(lat)<=90);
  ensure(object(f.properties));
  if(selected){
   ensure(exact(f,['type','id','geometry','properties'])&&exact(f.geometry,['type','coordinates']));
   ensure(exact(f.properties,['name','goviewRecord']));
   const p=f.properties.goviewRecord;
   ensure(exact(p,['id','label','point','gridId','evidence','zoneId','note']));
   ensure(p.id===f.id&&bounded(p.label,256)&&p.label===f.properties.name&&p.gridId===''&&p.zoneId===null&&p.note===null);
   ensure(exact(p.point,['longitude','latitude'])&&p.point.longitude===lng&&p.point.latitude===lat);
   ensure(exact(p.evidence,['coordinate','source','observedAt','availableUntil'])&&p.evidence.coordinate==='UNKNOWN'&&p.evidence.source==='selected-owner-snapshot'&&p.evidence.observedAt===null&&p.evidence.availableUntil===null);
  }
 }
}
async function validateTransfer(e){
 ensure(new TextEncoder().encode(JSON.stringify(e)).length<=MAX_ENVELOPE);
 ensure(exact(e,['schema','transferId','operation','payloadType','identity','sha256','payload']));
 ensure(e.schema==='goview.transfer.v1'&&idValid(e.transferId)&&typeof e.payload==='string'&&new TextEncoder().encode(e.payload).length<=MAX_PAYLOAD);
 ensure(typeof e.sha256==='string'&&/^[a-f0-9]{64}$/.test(e.sha256)&&await digest(e.payload)===e.sha256);
 const p=JSON.parse(e.payload),i=e.identity;
 if(e.payloadType==='goview.map.package.v1'){
  ensure(e.operation==='STUDIO'&&exact(i,['mapId','version']));
  const map=await unpackStudio(e.payload);ensure(map.mapId===i.mapId&&map.version===i.version);
 }else{
  ensure(e.payloadType==='goview.map-update');
  if(e.operation==='SNAPSHOT'){
   ensure(exact(i,['captureId','baseVersion'])&&idValid(i.captureId)&&i.captureId.length<=71&&e.transferId===i.captureId&&integer(i.baseVersion));
   ensure(exact(p,['type','schemaVersion','name','goview','features','captureId','capturedAtEpochMs','captureReceipt','selection']));
   ensure(p.schemaVersion===1&&p.name==='GOVIEW'&&p.selection==='explicit-pins-only'&&p.captureId===i.captureId&&integer(p.capturedAtEpochMs));
   ensure(exact(p.goview,['format','version'])&&p.goview.format==='goview.map-update'&&p.goview.version===i.baseVersion);
   ensure(exact(p.captureReceipt,['id','operation','status','correlationId','version'])&&idValid(p.captureReceipt.id)&&p.captureReceipt.operation==='SNAPSHOT'&&p.captureReceipt.status==='CAPTURED_LOCAL'&&p.captureReceipt.correlationId===i.captureId&&p.captureReceipt.version===i.baseVersion);
   points(p,true);
  }else{
   ensure(e.operation==='PROPOSAL'&&exact(i,['captureId','baseVersion','snapshotSha256'])&&idValid(i.captureId)&&integer(i.baseVersion)&&typeof i.snapshotSha256==='string'&&/^[a-f0-9]{64}$/.test(i.snapshotSha256));
   ensure(e.transferId===proposalId(i.captureId));
   ensure(exact(p,['contractVersion','operation','sourceCaptureId','baseVersion','package'])&&p.contractVersion===1&&p.operation==='propose-update'&&p.sourceCaptureId===i.captureId&&p.baseVersion===i.baseVersion);
   points(p.package);
  }
 }
 return e;
}
  function uniqueIds(xs,label) {
    const ids=new Set();
    for (const x of xs) { ensure(x && typeof x.id==="string" && /^[a-zA-Z0-9_-]{1,60}$/.test(x.id),label+" id"); ensure(!ids.has(x.id),label+" duplicate id"); ids.add(x.id); }
    return ids;
  }
  function coord(value) { return typeof value==="number" && Number.isFinite(value) && Math.abs(value)<=2000000; }
  function string(value,max) {return typeof value==="string" && value.trim().length>0 && value.length<=max;}
  function normalize(data) {
    ensure(data && typeof data==="object" && !Array.isArray(data),"map object required");
    ensure(data.schema===1,"unsupported map schema");
    ensure(string(data.mapId,70) && /^[a-zA-Z0-9_-]+$/.test(data.mapId),"invalid mapId");
    ensure(string(data.title,140),"map title required");
    ensure(Number.isSafeInteger(data.version) && data.version>=1 && data.version<=1000000,"invalid version");
    ensure(data.origin && typeof data.origin==="object" && Number.isFinite(data.origin.lat) &&
      Math.abs(data.origin.lat)<=90 && Number.isFinite(data.origin.lng) && Math.abs(data.origin.lng)<=180,"origin WGS84");
    for(const key of ["nodes","roads","areas","pois"])ensure(Array.isArray(data[key]),"missing "+key);
    ensure(data.nodes.length<=2000 && data.roads.length<=4000 && data.areas.length<=200 && data.pois.length<=1000,"map capacity");
    const nids=uniqueIds(data.nodes,"node"),rids=uniqueIds(data.roads,"road");
    uniqueIds(data.areas,"area");uniqueIds(data.pois,"POI");
    const nodes=data.nodes.map(n=>{
      ensure(coord(n.x)&&coord(n.y),"invalid node position");
      return {id:n.id,x:n.x,y:n.y};
    });
    const roads=data.roads.map(r=>{
      ensure(nids.has(r.from)&&nids.has(r.to)&&r.from!==r.to,"road endpoint missing or self-connected");
      ensure(!r.name || string(r.name,100),"invalid road name");
      return {id:r.id,from:r.from,to:r.to,name:r.name||""};
    });
    const areas=data.areas.map(a=>{
      ensure(string(a.name,100)&&Array.isArray(a.points)&&a.points.length>=3&&a.points.length<=150,"invalid area");
      return {id:a.id,name:a.name,points:a.points.map(p=>{ensure(p&&coord(p.x)&&coord(p.y),"invalid polygon");return {x:p.x,y:p.y};})};
    });
    const pois=data.pois.map(p=>{
      ensure(string(p.name,140)&&nids.has(p.nodeId),"POI must attach to node");
      return {id:p.id,name:p.name,nodeId:p.nodeId};
    });
    ensure(nodes.length>0 || (roads.length===0 && pois.length===0),"empty nodes");
    const result={schema:1,mapId:data.mapId,title:data.title,version:data.version,
      origin:{lat:data.origin.lat,lng:data.origin.lng},nodes,roads,areas,pois};
    ensure(new TextEncoder().encode(JSON.stringify(result)).length<=MAX_PAYLOAD,"map larger than 1 MiB");
    return result;
  }

const sameIdentity=(a,b)=>exact(a,Object.keys(b))&&Object.keys(b).every(k=>a[k]===b[k]);
const sameEnvelope=(a,b)=>['schema','transferId','operation','payloadType','sha256','payload'].every(k=>a[k]===b[k])&&sameIdentity(a.identity,b.identity);
const uncertain=(id,sha)=>({ok:false,status:'TRANSFER_UNCERTAIN_READ_EXACT_BEFORE_RETRY',transferId:id,...(sha?{sha256:sha}:{}),readbackRequired:true});
function transferFailure(result){
 if(result?.ok!==false)return {ok:false,status:'INVALID_GOVIEW_RESPONSE'};
 const statuses=['NOT_OBSERVED','TRANSFER_READ_UNAVAILABLE','TRANSFER_PUT_REJECTED_OR_UNCERTAIN','TRANSFER_UNCERTAIN_READ_EXACT_BEFORE_RETRY','TRANSFER_READBACK_MISMATCH','INVALID_TRANSFER_ARGUMENTS'];
 const status=statuses.includes(result.status)?result.status:'TRANSFER_UPSTREAM_REJECTED';
 return {ok:false,status,...(Number.isInteger(result.httpStatus)&&result.httpStatus>=100&&result.httpStatus<=599?{httpStatus:result.httpStatus}:{}),
   ...(status.includes('UNCERTAIN')?{readbackRequired:true}:{})};
}
async function typedTransfer(env,name,raw){
 let args,expected,id;
 try {
  // Capture immutable arguments before hashing/provider awaits.
  args=structuredClone(raw);
  if(name==='goview_transfer_publish'){
   ensure(exact(args,['envelope']));expected=await validateTransfer(args.envelope);id=expected.transferId;
   if(expected.operation==='SNAPSHOT')return {ok:false,status:'DEVICE_UPLOAD_ROLE_REQUIRED'};
  }else{
   ensure(exact(args,name==='goview_transfer_read'?['transferId','sha256']:['transferId']));
   id=args.transferId;ensure(idValid(id));
   if(name==='goview_transfer_read')ensure(typeof args.sha256==='string'&&/^[a-f0-9]{64}$/.test(args.sha256));
  }
 }catch{return {ok:false,status:'INVALID_TRANSFER_ARGUMENTS'};}
 if(!env?.GOVIEW_GO||typeof env.GOVIEW_GO.invoke!=='function')return {ok:false,status:'GOVIEW_BINDING_NOT_CONFIGURED'};
 let mutationStarted=false;
 try {
  if(expected?.operation==='PROPOSAL'){
   const sourceResult=await env.GOVIEW_GO.invoke('goview_transfer_read',{transferId:expected.identity.captureId,sha256:expected.identity.snapshotSha256});
   if(sourceResult?.ok!==true)return transferFailure(sourceResult);
   const source=await validateTransfer(sourceResult.envelope);
   if(source.operation!=='SNAPSHOT'||source.transferId!==expected.identity.captureId||source.sha256!==expected.identity.snapshotSha256||source.identity.baseVersion!==expected.identity.baseVersion)
     return {ok:false,status:'SNAPSHOT_BASE_MISMATCH'};
  }
  mutationStarted=!!expected;
  const result=await env.GOVIEW_GO.invoke(name,args);
  if(result?.ok!==true){
   if(mutationStarted && result?.ok!==false)return uncertain(id,expected.sha256);
   return {...transferFailure(result),...(mutationStarted?{transferId:id,sha256:expected.sha256}:{} )};
  }
  if(name==='goview_transfer_receipt'){
   const r=result.receipt;
   ensure(exact(r,['transferId','sha256','operation','status','revision','readbackVerified']));
   ensure(r.transferId===id&&typeof r.sha256==='string'&&/^[a-f0-9]{64}$/.test(r.sha256)&&r.operation==='UPDATE'&&integer(r.revision));
   ensure(['SAVED','DUPLICATE','COMMITTED_READBACK_UNAVAILABLE'].includes(r.status)&&r.readbackVerified===(r.status!=='COMMITTED_READBACK_UNAVAILABLE'));
   return {ok:true,status:'DEVICE_REPORTED_RECEIPT',receipt:r,independentlyVerified:false};
  }
  const received=await validateTransfer(result.envelope);
  if(received.transferId!==id||received.sha256!==(expected?.sha256??args.sha256)||(expected&&!sameEnvelope(received,expected)))
    return mutationStarted?uncertain(id,expected.sha256):{ok:false,status:'TRANSFER_READBACK_MISMATCH'};
  return {ok:true,status:'REMOTE_EXACT_READBACK_VERIFIED',envelope:received,androidStatus:'NOT_OBSERVED_OWNER_APPROVAL_REQUIRED'};
 }catch{
  return mutationStarted?uncertain(id,expected.sha256):{ok:false,status:'TRANSFER_READ_UNAVAILABLE'};
 }
}

export const isGoviewTool=name=>[...transferTools,'goview_publish','goview_readback','goview_propose_pin','goview_focus_point','goview_command_status'].includes(name);
export async function goviewDirect(env,name,args={}) {
 if(!isGoviewTool(name))return {ok:false,status:'UNSUPPORTED'};
 if(!args||typeof args!=='object'||Array.isArray(args))return {ok:false,status:'INVALID_ARGUMENTS'};
 if(transferTools.includes(name))return typedTransfer(env,name,args);
 if(['goview_propose_pin','goview_focus_point','goview_command_status'].includes(name)){
   if(typeof args.commandId!=='string'||!/^[-a-f0-9]{36}$/i.test(args.commandId))
     return {ok:false,status:'INVALID_COMMAND_ID'};
   if(name!=='goview_command_status'){
     if(!Number.isFinite(args.latitude)||!Number.isFinite(args.longitude)||
       Math.abs(args.latitude)>90||Math.abs(args.longitude)>180||
       (args.expectedRevision!==undefined&&(!Number.isSafeInteger(args.expectedRevision)||args.expectedRevision<0))||
       (name==='goview_propose_pin'&&(typeof args.label!=='string'||args.label.trim().length<1||args.label.length>140)))
       return {ok:false,status:'INVALID_DIRECT_MAP_COMMAND'};
   }
   if(!env?.GOVIEW_GO||typeof env.GOVIEW_GO.invoke!=='function')
     return {ok:false,status:'GOVIEW_BINDING_NOT_CONFIGURED'};
   try {
     const result=await env.GOVIEW_GO.invoke(name,args);
     return result&&typeof result.ok==='boolean'?result:{ok:false,status:'INVALID_GOVIEW_RESPONSE'};
   } catch {return {ok:false,status:'COMMAND_OUTCOME_UNCERTAIN_QUERY_ID'};}
 }
 if(typeof args.mapId!=='string'||!/^[a-zA-Z0-9_-]{1,70}$/.test(args.mapId)||
    !Number.isInteger(args.version)||args.version<1||args.version>999999||
    typeof args.transferId!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(args.transferId)||
    typeof args.sha256!=='string'||!/^[a-f0-9]{64}$/.test(args.sha256)||
    (name==='goview_publish'&&(typeof args.package!=='string'||new TextEncoder().encode(args.package).length>1048832)))
   return {ok:false,status:'INVALID_ARTIFACT_IDENTITY'};
 if(!env?.GOVIEW_GO||typeof env.GOVIEW_GO.invoke!=='function')return {ok:false,status:'GOVIEW_BINDING_NOT_CONFIGURED'};
 try {
  const result=await env.GOVIEW_GO.invoke(name,args);
  if(!result||typeof result.ok!=='boolean')return {ok:false,status:'INVALID_GOVIEW_RESPONSE'};
  return result;
 }catch{return {ok:false,status:'TRANSFER_UNCERTAIN_READ_EXACT_VERSION_BEFORE_RETRY'};}
}
