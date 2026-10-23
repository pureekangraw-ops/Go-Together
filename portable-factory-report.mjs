function createFactoryReport(connectors, clock = () => Date.now()) {
  // Current read contracts: GO index blob ff2a4fb83e1a8fb208412bc947892ee1915014b9;
  // PANTHEON worker blob 27ede02c71c364642e9b2777d209c5da96afb958;
  // l1-contract blob 8d9163e25562de94f83a174d0e4eff7568383f43.
  const F = 'mcp__codex_apps__go_brain_pantheon_factory';
  const T = 'mcp__codex_apps__go_brain_pantheon_tasks';
  const L1 = 'task_d6c9e93a42fd4f339bb47d941428dd08';
  const REQUEST = 'de0038fe8be999fe6a1c725156cd9684ac4887127ef783a659148ccdf36d0b24';
  const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  let running = false;
  let retryNotBefore = 0;
  const LIMIT = 524288;
  function bounded(value) {
    const stack = [[value, 0]], seen = new Set();
    let size = 0, nodes = 0;
    while (stack.length) {
      const [v, depth] = stack.pop();
      if (++nodes > 20000 || depth > 32) throw Error('INVALID_RESPONSE');
      if (typeof v === 'string') size += v.length;
      else if (v && typeof v === 'object') {
        if (seen.has(v)) throw Error('INVALID_RESPONSE');
        seen.add(v);
        const keys = Object.keys(v);
        if (keys.length > 20000) throw Error('INVALID_RESPONSE');
        for (const k of keys) { size += k.length; stack.push([v[k], depth + 1]); }
      }
      if (size > LIMIT) throw Error('INVALID_RESPONSE');
    }
    if (JSON.stringify(value)?.length > LIMIT) throw Error('INVALID_RESPONSE');
  }
  function denial(value) {
    if (!object(value)) return null;
    for (const status of [value.status, value.statusCode, value.upstream_status]) {
      if (status === 429 || status === '429' || status === 'RATE_LIMITED') return 'RATE_LIMITED';
      if ([401, 403, '401', '403'].includes(status)) return 'AUTH_REFUSED';
    }
    return null;
  }
  function hold(value) {
    const raw = value?.retry_after ?? value?.retryAfter ?? value?.headers?.['retry-after'] ?? value?.headers?.['Retry-After'];
    if (raw === undefined) return;
    const seconds = Number(raw);
    const until = Number.isFinite(seconds) && seconds >= 0 ? clock() + seconds * 1000 : Date.parse(raw);
    if (Number.isFinite(until)) retryNotBefore = Math.max(retryNotBefore, Math.min(until, 8640000000000000));
  }
  function sha256(s) {
    if (typeof s !== 'string' || s.length > 1048576) throw Error('HASH_INPUT_INVALID');
    const bytes = Array.from(encodeURIComponent(s).replace(/%([0-9A-F]{2})/g, (_,h) => String.fromCharCode(parseInt(h,16))), c=>c.charCodeAt(0));
    const k=[], h=[];
    for(let n=2;k.length<64;n++){let prime=true;for(let j=2;j*j<=n;j++)if(n%j===0){prime=false;break;}if(prime){if(h.length<8)h.push((Math.sqrt(n)*4294967296)|0);k.push((Math.cbrt(n)*4294967296)|0);}}
    const len=bytes.length*8;bytes.push(128);while(bytes.length%64!==56)bytes.push(0);
    for(let i=7;i>=0;i--)bytes.push(i>=4?0:(len>>>(i*8))&255);
    const rr=(a,n)=>(a>>>n)|(a<<(32-n));
    for(let p=0;p<bytes.length;p+=64){const w=[];for(let i=0;i<16;i++)w[i]=(bytes[p+i*4]<<24)|(bytes[p+i*4+1]<<16)|(bytes[p+i*4+2]<<8)|bytes[p+i*4+3];
      for(let i=16;i<64;i++){const a=w[i-15],b=w[i-2];w[i]=((rr(a,7)^rr(a,18)^(a>>>3))+w[i-16]+(rr(b,17)^rr(b,19)^(b>>>10))+w[i-7])|0;}
      let [a,b,c,d,e,f,g,z]=h;for(let i=0;i<64;i++){const t1=(z+(rr(e,6)^rr(e,11)^rr(e,25))+((e&f)^((~e)&g))+k[i]+w[i])|0;
        const t2=((rr(a,2)^rr(a,13)^rr(a,22))+((a&b)^(a&c)^(b&c)))|0;z=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;}
      [a,b,c,d,e,f,g,z].forEach((v,i)=>h[i]=(h[i]+v)|0);}
    return h.map(x=>(x>>>0).toString(16).padStart(8,'0')).join('');
  }
  function freshness(v, now) {
    const ms=typeof v==='string'?Date.parse(v):NaN;
    return !Number.isFinite(ms)?'UNKNOWN':ms>now?'FUTURE':now-ms>900000?'STALE':'CURRENT';
  }
  function parse(raw) {
    if(!object(raw))throw Error('INVALID_RESPONSE');
    const outerDenial = denial(raw);
    if (outerDenial) { hold(raw); throw Error(outerDenial); }
    bounded(raw);
    // Denial status wins over generic isError at every supported wrapper level.
    const wrappers = [raw, raw.structuredContent, raw.structuredContent?.result, raw.result];
    if (Array.isArray(raw.content)) {
      const txt = raw.content.find(x => x?.type === 'text')?.text;
      if (typeof txt === 'string') { try { const body = JSON.parse(txt); wrappers.push(body, body?.result); } catch {} }
    }
    for (const value of wrappers) {
      let current = value;
      for (let depth = 0; depth < 3 && object(current); depth++) {
        const code = denial(current);
        if (code) { hold(raw); hold(current); throw Error(code); }
        if (current.ok !== true || !object(current.result)) break;
        current = current.result;
      }
    }
    if (raw.isError === true) throw Error('REMOTE_REJECTED');
    let b=raw;
    if(object(b.structuredContent))b=b.structuredContent;
    else if(Array.isArray(b.content)){
      if(raw.isError)throw Error('REMOTE_REJECTED');
      const txt=b.content.find(x=>x?.type==='text')?.text;
      if(typeof txt!=='string'||txt.length>524288)throw Error('INVALID_RESPONSE');
      try{b=JSON.parse(txt);}catch{throw Error('INVALID_RESPONSE');}
    }
    bounded(b);
    for(let i=0;i<3;i++){
      if(!object(b))throw Error('INVALID_RESPONSE');
      const code = denial(b);
      if (code) { hold(raw); hold(b); throw Error(code); }
      const status=b.upstream_status??b.status;
      if(status===429||status==='RATE_LIMITED')throw Error('RATE_LIMITED');
      if(status===401||status===403)throw Error('AUTH_REFUSED');
      if(b.ok===false||b.isError===true||b.error||(Number.isInteger(status)&&status>=400))throw Error('REMOTE_REJECTED');
      if(object(b.result)&&b.ok===true){b=b.result;continue;}return b;
    }
    throw Error('INVALID_RESPONSE');
  }
  async function report(options={}) {
    if (running) return { status: 'REPORT_IN_PROGRESS', attempted: false };
    if (clock() < retryNotBefore) return { status: 'RETRY_AFTER_ACTIVE', attempted: false, retryNotBefore: new Date(retryNotBefore).toISOString() };
    running = true;
    try { return await runReport(options); } finally { running = false; }
  }
  async function runReport(options={}) {
    const seen = new Set();
    const now=clock();
    if(!object(options)||Object.keys(options).some(k=>!['taskIds','execute'].includes(k))||
       !Array.isArray(options.taskIds)||options.taskIds.length<1||options.taskIds.length>3||
       options.taskIds.some(id=>typeof id!=='string'||!/^task_[a-f0-9]{32}$/.test(id))||
       new Set(options.taskIds).size!==options.taskIds.length||
       (options.execute!==undefined&&typeof options.execute!=='boolean')||!Number.isSafeInteger(now)||Math.abs(now)>8640000000000000)
      return {status:'INVALID_ARGUMENTS',attempted:false};
    const ids=[...options.taskIds];
    const result={status:'DRY_RUN',observedAt:new Date(now).toISOString(),readOnly:true,
      scope:'EXPLICIT_TASK_IDS_ONLY',wholeQueue:'UNKNOWN_NO_PAGINATION_CONTRACT',maxCalls:1+2*ids.length,
      health:{connection:'UNKNOWN',machines:{CODE:'UNKNOWN',VISUAL:'UNKNOWN',LOGIC:'UNKNOWN'}},
      tasks:[],counts:{queued:0,running:0,completed:0,blocked:0,unknown:0},
      countsMeaning:'REPORTED_JOB_STATE_NOT_PROOF_OF_EXECUTION',verifiedL1Completed:0,
      sourceShaMeaning:'STORED_FIELD_AGREEMENT_NOT_INDEPENDENT_DEPLOYMENT_AUTHENTICITY',evidence:[]};
    if(options.execute!==true)return result;
    let stopped=false;
    async function call(name,args) {
      const event={tool:name,...(args.task_id?{taskId:args.task_id}:{}),observedAt:new Date(clock()).toISOString(),attempted:false};
      try{
        if(stopped)throw Error('STOPPED_AFTER_RATE_LIMIT_OR_AUTH');
        if(!Object.hasOwn(connectors,name)||typeof connectors[name]!=='function')throw Error('CONNECTOR_UNAVAILABLE');
        const key=name+':'+(args.task_id??'health');
        if(seen.has(key))throw Error('DUPLICATE_READ');
        seen.add(key);event.attempted=true;
        const raw=await connectors[name](args);
        const body=parse(raw);event.status='READ_RETURNED';return body;
      }catch(e){
        const codes=['INVALID_RESPONSE','RATE_LIMITED','AUTH_REFUSED','REMOTE_REJECTED','CONNECTOR_UNAVAILABLE','DUPLICATE_READ','STOPPED_AFTER_RATE_LIMIT_OR_AUTH'];
        event.status=denial(e) ?? (codes.includes(e?.message)?e.message:'CONNECTOR_FAILED');
        if (['RATE_LIMITED','AUTH_REFUSED'].includes(event.status)) hold(e);
        if(['RATE_LIMITED','AUTH_REFUSED'].includes(event.status))stopped=true;
        return null;
      }finally{result.evidence.push(event);}
    }
    const health=(await call(F,{}))?.factory;
    const knownConnection=['CONNECTED','NOT_CONFIGURED','INVALID_TARGET','UNREACHABLE'];
    result.health.connection=knownConnection.includes(health?.connection)?health.connection:'UNKNOWN';
    for(const m of ['CODE','VISUAL','LOGIC'])result.health.machines[m]=health?.machinery?.[m]==='READY'?'READY':'UNKNOWN';
    result.health.executionImplied=false;
    for(const id of ids){
      const task=(await call(T,{task_id:id}))?.task;
      const job=(await call(F,{task_id:id}))?.job;
      const row={taskId:id,bucket:'unknown',taskStatus:'UNKNOWN',jobStatus:'UNKNOWN',freshness:'UNKNOWN',
        evidenceStatus:'MISSING',receiptId:null,artifactRef:null,contentSha256:null,sourceSha:null,issues:[]};
      const states=['QUEUED','RUNNING','DISPATCHING','COMPLETED','FAILED','BLOCKED','NEEDS_RECONCILIATION'];
      const rawState = v => typeof v === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(v) ? v : null;
      row.rawTaskStatus = rawState(task?.status);
      row.rawJobStatus = rawState(job?.status);
      row.taskStatus=states.includes(task?.status)?task.status:'UNKNOWN';
      row.jobStatus=states.includes(job?.status)?job.status:'UNKNOWN';
      if (row.taskStatus === 'UNKNOWN') row.issues.push('UNKNOWN_TASK_STATE');
      if (row.jobStatus === 'UNKNOWN') row.issues.push('UNKNOWN_JOB_STATE');
      if(!task||!job)row.issues.push('PARTIAL_ENDPOINT_FAILURE_OR_MISSING_OBJECT');
      if(task?.task_id!==id||job?.task_id!==id)row.issues.push('TASK_LINEAGE_MISSING_OR_CONFLICT');
      if(task&&job&&(task.status!==job.task_status||
        (task.status==='COMPLETED')!==(job.status==='COMPLETED')))row.issues.push('STATUS_CONFLICT');
      row.freshness=freshness(job?.updated_at,now);
      if(row.freshness==='FUTURE')row.issues.push('FUTURE_SOURCE_TIMESTAMP');
      const back=job?.result, artifact=back?.result;
      if(back){
        const lineage=back.workId===id&&back.checkpointId==='cp-'+id&&back.workPassRef==='work-pass://pantheon-'+id&&back.actingActor==='PANTHEON'&&
          typeof job.receipt_id==='string'&&/^receipt-[A-Za-z0-9-]{8,80}$/.test(job.receipt_id)&&back.receiptId===job.receipt_id;
        const source=/^[a-f0-9]{40}$/.test(job.source_sha??'')&&back.sourceSha===job.source_sha;
        let digest=false;try{digest=/^[a-f0-9]{64}$/.test(job.result_sha256??'')&&sha256(JSON.stringify(back))===job.result_sha256;}catch{}
        if(!lineage||!source||!digest)row.issues.push('RECEIPT_SOURCE_OR_DIGEST_CONFLICT');
        if(lineage)row.receiptId=job.receipt_id;
        if(source)row.sourceSha=job.source_sha;
        const flags=back.status==='HANDOFF_VERIFIED'&&back.boundaryVerified===true&&back.domainCompleted===true&&back.domainVerified===true;
        row.evidenceStatus=lineage&&source&&digest&&flags?'STORED_RECEIPT_MATCHED_NOT_FRESH_READBACK':'UNVERIFIED';
        if(id===L1){
          const ref='factory-artifact://factory/l1/'+id+'/'+REQUEST;
          const ts=artifact?.testTimestamp;
          const expected='YGG FACTORY L1 PASS\ntask_id='+id+'\ncheckpoint_id=cp-'+id+'\nrequest_sha256='+REQUEST+'\ntest_timestamp='+ts+'\n';
          const validTime=typeof ts==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(ts)&&Number.isFinite(Date.parse(ts))&&new Date(ts).toISOString()===ts;
          const matched=validTime&&artifact.taskId===id&&artifact.checkpointId==='cp-'+id&&artifact.requestSha256===REQUEST&&
            artifact.contentType==='text/plain; charset=utf-8'&&artifact.content===expected&&artifact.contentSha256===sha256(expected)&&
            back.receiptId==='receipt-l1-'+id.slice(5)&&back.evidenceRef===ref&&artifact.artifactRef===ref&&
            JSON.stringify(artifact.evidenceRefs)===JSON.stringify([ref]);
          if(matched){row.artifactRef=ref;row.contentSha256=artifact.contentSha256;row.artifactFreshness=freshness(ts,now);
            if (row.artifactFreshness === 'FUTURE') { row.issues.push('FUTURE_ARTIFACT_TIMESTAMP'); row.evidenceStatus = 'UNVERIFIED'; }}
          else row.issues.push('L1_ARTIFACT_CONFLICT');
          if(matched&&flags&&lineage&&source&&digest&&job.owner_verified===true&&
             job.verification_source==='FACTORY_AUTHENTICATED_READBACK'&&row.issues.length===0&&row.taskStatus==='COMPLETED'&&row.jobStatus==='COMPLETED')
            row.evidenceStatus='VERIFIED_L1_OWNER_READBACK';
        }
      }
      if(row.issues.length===0){
        const bucket={QUEUED:'queued',RUNNING:'running',DISPATCHING:'running',COMPLETED:'completed',FAILED:'blocked',BLOCKED:'blocked',NEEDS_RECONCILIATION:'blocked'};
        row.bucket=bucket[row.jobStatus]??'unknown';
      }
      result.counts[row.bucket]++;result.tasks.push(row);
      if (row.evidenceStatus === 'VERIFIED_L1_OWNER_READBACK') result.verifiedL1Completed++;
    }
    result.status=result.evidence.some(e=>e.status!=='READ_RETURNED')||result.tasks.some(t=>t.issues.length)?'PARTIAL':'REPORT_READ_COMPLETED';
    return result;
  }
  return {report,sha256};
}

export { createFactoryReport };
