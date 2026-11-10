import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';

globalThis.crypto ??= webcrypto;
globalThis.btoa ??= value => Buffer.from(value, 'binary').toString('base64');
globalThis.atob ??= value => Buffer.from(value, 'base64').toString('binary');
const source = await readFile(new URL('../worker-met-gasten.js', import.meta.url), 'utf8');
const worker = (await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))).default;
const rawKey = Buffer.alloc(32, 7);
const env = {SESSION_ENCRYPTION_KEY: rawKey.toString('base64'), GOOGLE_CLIENT_ID:'test-client', GOOGLE_CLIENT_SECRET:'test-secret', DB:{prepare(){return {bind(){return this},async first(){return {encrypted_refresh_token:await encryptedRefresh}}}}}};
const sid='test-owner-session';
const digest = async value => Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))).toString('base64url');
let encryptedRefresh;
async function encryptRefresh(){const iv=webcrypto.getRandomValues(new Uint8Array(12));const key=await crypto.subtle.importKey('raw',rawKey,'AES-GCM',false,['encrypt']);const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode('refresh-token'));encryptedRefresh=Buffer.from(iv).toString('base64url')+'.'+Buffer.from(cipher).toString('base64url')}
const originalFetch=globalThis.fetch;
function request(path,{method='GET',body,headers={}}={}){return new Request('https://music.test'+path,{method,headers:{cookie:'mm_session='+sid,origin:'https://music.test',...headers},body})}

test('owner can start and finish a private resumable mp3 upload',async()=>{
 await encryptRefresh();let googleChunks=0;
 globalThis.fetch=async(url,options={})=>{
  const target=String(url);
  if(target==='https://oauth2.googleapis.com/token')return Response.json({access_token:'temporary'});
  if(target.startsWith('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable')){
   const metadata=JSON.parse(options.body);assert.deepEqual(metadata.parents,['appDataFolder']);assert.equal(options.headers['x-upload-content-type'],'audio/mpeg');
   return new Response(null,{status:200,headers:{location:'https://www.googleapis.com/upload/drive/v3/files?upload_id=private-token'}})
  }
  if(target.includes('upload_id=private-token')){assert.equal(options.method,'PUT');assert.equal(options.headers['content-range'],'bytes 0-4/5');assert.equal(Buffer.from(await new Response(options.body).arrayBuffer()).toString(),'audio');googleChunks++;return Response.json({id:'driveFile123',name:'song.mp3',mimeType:'audio/mpeg',size:'5'})}
  throw new Error('Unexpected upstream request '+target)
 };
 const started=await worker.fetch(request('/api/drive/upload-session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'mijn-muziek-audio-12345678.mp3',mimeType:'audio/mpeg',size:5})}),env);
 assert.equal(started.status,200);const {ticket}=await started.json();assert.ok(ticket);
 const uploaded=await worker.fetch(request('/api/drive/upload-chunk',{method:'POST',headers:{'content-type':'application/octet-stream','x-upload-session':ticket,'content-range':'bytes 0-4/5'},body:'audio'}),env);
 assert.equal(uploaded.status,200,await uploaded.clone().text());assert.deepEqual(await uploaded.json(),{complete:true,file:{id:'driveFile123',name:'song.mp3',mimeType:'audio/mpeg',size:5}});assert.equal(googleChunks,1)
});

test('mp3 streaming forwards byte ranges and returns partial response headers',async()=>{
 await encryptRefresh();let forwarded='';globalThis.fetch=async(url,options={})=>{if(String(url)==='https://oauth2.googleapis.com/token')return Response.json({access_token:'temporary'});forwarded=options.headers.get('range');return new Response('audio',{status:206,headers:{'content-type':'audio/mpeg','content-range':'bytes 20-24/100','content-length':'5','accept-ranges':'bytes'}})};
 const response=await worker.fetch(request('/api/drive/file/driveFile123?alt=media',{headers:{range:'bytes=20-24'}}),env);
 assert.equal(response.status,206);assert.equal(forwarded,'bytes=20-24');assert.equal(response.headers.get('content-range'),'bytes 20-24/100');assert.equal(response.headers.get('accept-ranges'),'bytes');assert.equal(await response.text(),'audio')
});

test('upload endpoint rejects cross-origin writes and files over 100 MB',async()=>{
 await encryptRefresh();let googleStarts=0;globalThis.fetch=async url=>{if(String(url)==='https://oauth2.googleapis.com/token')return Response.json({access_token:'temporary'});googleStarts++;return new Response(null,{status:200,headers:{location:'https://www.googleapis.com/upload/drive/v3/files?upload_id=unused'}})};
 const cross=await worker.fetch(new Request('https://music.test/api/drive/upload-session',{method:'POST',headers:{cookie:'mm_session='+sid,origin:'https://attacker.test','content-type':'application/json'},body:'{}'}),env);assert.equal(cross.status,403);
 const large=await worker.fetch(request('/api/drive/upload-session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'mijn-muziek-audio-12345678.mp3',mimeType:'audio/mpeg',size:104857601})}),env);assert.equal(large.status,400);assert.equal(googleStarts,0)
});

test.after(()=>{globalThis.fetch=originalFetch});
