import {createHash} from 'node:crypto';

const fail=code=>{throw Error(code);};

/**
 * Assemble byte ranges returned by an artifact endpoint without accepting gaps,
 * overlaps, short pages, or a mismatched advertised file size.
 */
export function assembleArtifactRanges({totalBytes,ranges}){
 if(!Number.isSafeInteger(totalBytes)||totalBytes<1)fail('ARTIFACT_TOTAL_BYTES_INVALID');
 if(!Array.isArray(ranges)||!ranges.length)fail('ARTIFACT_RANGES_REQUIRED');
 let next=0;const parts=[];
 for(const range of ranges){
  if(!range||!Number.isSafeInteger(range.requestedOffset)||!Number.isSafeInteger(range.requestedLimit)||range.requestedOffset<0||range.requestedLimit<1)fail('ARTIFACT_REQUEST_RANGE_INVALID');
  const bytes=Buffer.isBuffer(range.bytes)?range.bytes:Buffer.from(range.bytes??'');
  const {returnedStart,returnedEnd}=range;
  if(range.requestedOffset!==next)fail('ARTIFACT_RANGE_ORDER_INVALID');
  if(!Number.isSafeInteger(returnedStart)||!Number.isSafeInteger(returnedEnd)||returnedStart!==range.requestedOffset||returnedEnd<returnedStart||returnedEnd>totalBytes)fail('ARTIFACT_RANGE_METADATA_INVALID');
  const expectedEnd=Math.min(range.requestedOffset+range.requestedLimit,totalBytes);
  if(returnedEnd!==expectedEnd||bytes.length!==returnedEnd-returnedStart)fail('ARTIFACT_RANGE_INCOMPLETE');
  parts.push(bytes);next=returnedEnd;
 }
 if(next!==totalBytes)fail('ARTIFACT_INCOMPLETE');
 const bytes=Buffer.concat(parts);
 if(bytes.length!==totalBytes)fail('ARTIFACT_INCOMPLETE');
 return {bytes,byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
}
