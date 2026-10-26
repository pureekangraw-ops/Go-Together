// Read station delivery evidence through Hub only. This capability never
// resolves Work ownership or grants Office/Factory execution rights.
const annotations={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
const attemptId={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$',maxLength:128};
export const GREENHOUSE_TOOLS=[
 {name:'greenhouse_delivery_list',description:'Read a bounded recent window of Greenhouse station delivery evidence. Coverage is incomplete; unresolved Work ownership is not authorization.',inputSchema:{type:'object',properties:{limit:{type:'integer',minimum:1,maximum:30}},additionalProperties:false},annotations},
 ...['greenhouse_delivery_get','greenhouse_result_get'].map(name=>({name,description:'Read one Greenhouse station delivery attempt. UNAVAILABLE/NOT_FOUND do not mean Work completed or failed.',inputSchema:{type:'object',properties:{attemptId},required:['attemptId'],additionalProperties:false},annotations}))
];
export function validateGreenhouseRead(name,args){
 if(!GREENHOUSE_TOOLS.some(t=>t.name===name))throw Error('UNKNOWN_GREENHOUSE_TOOL');
 if(!args||typeof args!=='object'||Array.isArray(args))throw Error('INVALID_GREENHOUSE_ARGUMENTS');
 const list=name==='greenhouse_delivery_list';
 if(Object.keys(args).some(k=>k!==(list?'limit':'attemptId'))||
    (list?args.limit!==undefined&&(!Number.isInteger(args.limit)||args.limit<1||args.limit>30):
      typeof args.attemptId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(args.attemptId)))throw Error('INVALID_GREENHOUSE_ARGUMENTS');
}
