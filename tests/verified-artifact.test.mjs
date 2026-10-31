import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {assembleArtifactRanges} from '../scripts/verified-artifact.mjs';

const chunk=(source,offset,limit)=>({
 requestedOffset:offset,
 requestedLimit:limit,
 returnedStart:offset,
 returnedEnd:Math.min(offset+limit,source.length),
 bytes:source.subarray(offset,Math.min(offset+limit,source.length))
});

test('artifact assembly accepts contiguous exact ranges and returns the full digest',()=>{
 const source=Buffer.alloc(821741);
 for(let i=0;i<source.length;i++)source[i]=i%251;
 const ranges=[chunk(source,0,200000),chunk(source,200000,200000),chunk(source,400000,200000),chunk(source,600000,200000),chunk(source,800000,21741)];
 const assembled=assembleArtifactRanges({totalBytes:source.length,ranges});
 assert.deepEqual(assembled.bytes,source);
 assert.equal(assembled.byteLength,821741);
 assert.equal(assembled.sha256,createHash('sha256').update(source).digest('hex'));
});

test('artifact assembly rejects a short page even when the endpoint reports a larger file',()=>{
 const totalBytes=821741;
 const prefix=Buffer.alloc(200000,0x61);
 const shortPage=Buffer.alloc(114626,0x62);
 const ranges=[
  {requestedOffset:0,requestedLimit:200000,returnedStart:0,returnedEnd:200000,bytes:prefix},
  {requestedOffset:200000,requestedLimit:200000,returnedStart:200000,returnedEnd:314626,bytes:shortPage}
 ];
 assert.throws(()=>assembleArtifactRanges({totalBytes,ranges}),/ARTIFACT_RANGE_INCOMPLETE/);
});

test('artifact assembly rejects an empty later range instead of silently leaving a gap',()=>{
 const ranges=[
  {requestedOffset:0,requestedLimit:200000,returnedStart:0,returnedEnd:200000,bytes:Buffer.alloc(200000)},
  {requestedOffset:400000,requestedLimit:200000,returnedStart:400000,returnedEnd:400000,bytes:Buffer.alloc(0)}
 ];
 assert.throws(()=>assembleArtifactRanges({totalBytes:821741,ranges}),/ARTIFACT_RANGE_ORDER_INVALID/);
});
