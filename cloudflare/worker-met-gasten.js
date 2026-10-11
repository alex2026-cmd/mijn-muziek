// Mijn Muziek - Cloudflare OAuth Worker (fase 1: veilig aanmelden testen).
// LET OP: Deze versie geeft nog geen toegang aan GitHub Pages. Bestaande app blijft ongewijzigd.
const CALLBACK = 'https://mijn-muziek-auth.marakis-alexander.workers.dev/auth/callback';
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata openid';
const encoder = new TextEncoder();
function b64(bytes){return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
function unb64(str){return Uint8Array.from(atob(str.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(str.length/4)*4,'=')),c=>c.charCodeAt(0))}
function random(n=32){return b64(crypto.getRandomValues(new Uint8Array(n)))}
async function digest(value){return b64(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))))}
async function key(env){const raw=Uint8Array.from(atob(env.SESSION_ENCRYPTION_KEY),c=>c.charCodeAt(0));if(raw.length!==32)throw Error('SESSION_ENCRYPTION_KEY moet 32 bytes zijn');return crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt'])}
async function encrypt(value,env){const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(env),encoder.encode(value)));return b64(iv)+'.'+b64(encrypted)}
function page(msg,status=200){return new Response('<!doctype html><html lang="nl"><meta charset="utf-8"><title>Mijn Muziek</title><body style="font:18px system-ui;max-width:650px;margin:80px auto;background:#20132e;color:white;padding:24px"><h2>Mijn Muziek</h2><p>'+msg+'</p></body></html>',{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}})}
function json(o,status=200){return new Response(JSON.stringify(o),{status,headers:{'content-type':'application/json','cache-control':'no-store'}})}
function cookie(name,value,age=600){return name+'='+encodeURIComponent(value)+'; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age='+age}
function getCookie(req,name){return (req.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1)||''}

function mmOrigin(req){return new URL(req.url).origin}
function mmEmail(value){return typeof value==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)&&value.length<255?value.trim().toLowerCase():null}
function mmSid(req,name){try{return decodeURIComponent(getCookie(req,name))}catch{return ''}}
function mmNow(){return Math.floor(Date.now()/1000)}
async function mmOwner(req,env){
 const sid=mmSid(req,'mm_session');if(!sid||!env.OWNER_GOOGLE_SUB)return false;
 const row=await env.DB.prepare('SELECT google_user_id FROM auth_sessions WHERE session_id_hash=? AND revoked_at IS NULL AND expires_at>?').bind(await digest(sid),mmNow()).first();
 return !!row&&row.google_user_id===env.OWNER_GOOGLE_SUB;
}
async function mmGuest(req,env){
 const sid=mmSid(req,'mm_guest');if(!sid)return null;
 return env.DB.prepare("SELECT g.id,g.email FROM music_guest_sessions s JOIN music_guests g ON g.id=s.guest_id WHERE s.token_hash=? AND s.expires_at>? AND s.revoked_at IS NULL AND g.status='active' AND g.revoked_at IS NULL").bind(await digest(sid),mmNow()).first();
}
function mmBad(message,status=400){return json({error:message},status)}
async function mmBody(req){try{const content=await req.text();if(content.length>150000)return null;return JSON.parse(content)}catch{return null}}
function mmMutate(req){return req.headers.get('origin')===mmOrigin(req)}
function mmId(){return crypto.randomUUID()}
function mmPublicSong(s){return {youtubeId:s.youtubeId,title:String(s.title||'').slice(0,180),artist:String(s.artist||'').slice(0,180),folders:Array.isArray(s.folders)?s.folders.filter(x=>typeof x==='string').slice(0,20):[]}}
async function mmGuestApi(request,env,url){
 const path=url.pathname,method=request.method;
 if(path==='/gast'&&method==='GET'){
  const response=await fetch('https://raw.githubusercontent.com/alex2026-cmd/mijn-muziek/main/cloudflare/gast.html',{cf:{cacheTtl:60}});
  if(!response.ok)return page('Gastomgeving tijdelijk niet beschikbaar',503);
  return new Response(response.body,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://i.ytimg.com; script-src 'self' 'unsafe-inline' https://www.youtube.com https://www.youtube-nocookie.com; frame-src https://www.youtube.com https://www.youtube-nocookie.com; img-src 'self' data: https://i.ytimg.com; style-src 'self' 'unsafe-inline'; connect-src 'self'"}}); 
 }
 if(!path.startsWith('/api/guest/')&&!path.startsWith('/api/music-admin/'))return null;
 if(method!=='GET'&&!mmMutate(request))return mmBad('Ongeldige herkomst',403);
 if(path.startsWith('/api/music-admin/')){
  if(!await mmOwner(request,env))return mmBad('Alleen beheerder',403);
  if(path==='/api/music-admin/guests'&&method==='GET'){
   const {results}=await env.DB.prepare('SELECT id,email,status,created_at,revoked_at FROM music_guests ORDER BY created_at DESC').all();return json({guests:results});
  }
  if(path==='/api/music-admin/guests'&&method==='POST'){
   const body=await mmBody(request),email=mmEmail(body?.email);if(!email)return mmBad('Ongeldig e-mailadres');
   const existing=await env.DB.prepare('SELECT id,status FROM music_guests WHERE email=?').bind(email).first();
   const guestId=existing?.id||mmId(),now=mmNow();
   if(existing){if(existing.status==='revoked')return mmBad('Deze gast is geblokkeerd; heractiveren is niet toegestaan',403)}
   else await env.DB.prepare("INSERT INTO music_guests(id,email,status,created_at) VALUES(?,?,'invited',?)").bind(guestId,email,now).run();
   const digits=new Uint32Array(1);crypto.getRandomValues(digits);
   const code=String(digits[0]%100000000).padStart(8,'0');
   const salt=random(16),hash=await digest(salt+':'+code);
   await env.DB.prepare('UPDATE music_guest_codes SET consumed_at=? WHERE guest_id=? AND consumed_at IS NULL').bind(now,guestId).run();
   await env.DB.prepare('INSERT INTO music_guest_codes(id,guest_id,code_hash,expires_at,created_at) VALUES(?,?,?,?,?)').bind(mmId(),guestId,salt+':'+hash,now+86400,now).run();
   return json({ok:true,email,code,expiresHours:24,shareUrl:mmOrigin(request)+'/gast'});
  }
  if(path==='/api/music-admin/revoke'&&method==='POST'){
   const body=await mmBody(request);if(!body||typeof body.id!=='string')return mmBad('Ongeldige gast');
   await env.DB.prepare("UPDATE music_guests SET status='revoked',revoked_at=? WHERE id=?").bind(mmNow(),body.id).run();
   await env.DB.prepare('UPDATE music_guest_sessions SET revoked_at=? WHERE guest_id=?').bind(mmNow(),body.id).run();
   return json({ok:true});
  }
  if(path==='/api/music-admin/collection'&&method==='PUT'){
   const body=await mmBody(request);
   if(!body||!Array.isArray(body.songs)||body.songs.length>5000||!Array.isArray(body.folders))return mmBad('Ongeldige bibliotheek');
   const songs=body.songs.filter(s=>s&&/^[A-Za-z0-9_-]{11}$/.test(s.youtubeId)).map(mmPublicSong);
   const data=JSON.stringify({songs,folders:body.folders.filter(x=>typeof x==='string').slice(0,1000),updatedAt:Date.now()});
   if(data.length>120000)return mmBad('Bibliotheek te groot');
   await env.DB.prepare('INSERT INTO music_shared_collection(id,content,updated_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET content=excluded.content,updated_at=excluded.updated_at').bind(data,mmNow()).run();
   return json({ok:true,count:songs.length});
  }
  return mmBad('Onbekende beheerdersroute',404);
 }
 if(path==='/api/guest/verify'&&method==='POST'){
  const body=await mmBody(request),email=mmEmail(body?.email),code=String(body?.code||'');
  if(!email||!/^[0-9]{8}$/.test(code))return mmBad('Ongeldige code',400);
  const guest=await env.DB.prepare("SELECT id FROM music_guests WHERE email=? AND status!='revoked' AND revoked_at IS NULL").bind(email).first();
  if(!guest)return mmBad('Ongeldige of verlopen code',401);
  const c=await env.DB.prepare('SELECT * FROM music_guest_codes WHERE guest_id=? AND consumed_at IS NULL AND expires_at>? AND attempts<5 ORDER BY created_at DESC LIMIT 1').bind(guest.id,mmNow()).first();
  if(!c)return mmBad('Ongeldige of verlopen code',401);
  const [salt,hash]=c.code_hash.split(':');
  if(await digest(salt+':'+code)!==hash){
   await env.DB.prepare('UPDATE music_guest_codes SET attempts=attempts+1 WHERE id=? AND consumed_at IS NULL AND expires_at>? AND attempts<5').bind(c.id,mmNow()).run();
   return mmBad('Ongeldige of verlopen code',401);
  }
  const now=mmNow();
  const claimed=await env.DB.prepare('UPDATE music_guest_codes SET attempts=attempts+1,consumed_at=? WHERE id=? AND consumed_at IS NULL AND expires_at>? AND attempts<5').bind(now,c.id,now).run();
  if(claimed.meta?.changes!==1)return mmBad('Ongeldige of verlopen code',401);
  const activated=await env.DB.prepare("UPDATE music_guests SET status='active' WHERE id=? AND status!='revoked' AND revoked_at IS NULL").bind(guest.id).run();
  if(activated.meta?.changes!==1)return mmBad('Ongeldige of verlopen code',401);
  const sid=random(),sessionNow=mmNow();
  await env.DB.prepare('INSERT INTO music_guest_sessions(token_hash,guest_id,created_at,expires_at) VALUES(?,?,?,?)').bind(await digest(sid),guest.id,sessionNow,sessionNow+30*86400).run();
  return new Response(JSON.stringify({ok:true}),{headers:{'content-type':'application/json','cache-control':'no-store','set-cookie':cookie('mm_guest',sid,30*86400)}});
 }

 if(path==='/api/guest/logout'&&method==='POST'){
  const sid=mmSid(request,'mm_guest');if(sid)await env.DB.prepare('UPDATE music_guest_sessions SET revoked_at=? WHERE token_hash=?').bind(mmNow(),await digest(sid)).run();
  return new Response(JSON.stringify({ok:true}),{headers:{'content-type':'application/json','cache-control':'no-store','set-cookie':cookie('mm_guest','',0)}});
 }
 const guest=await mmGuest(request,env);if(!guest)return mmBad('Niet aangemeld',401);
 if(path==='/api/guest/data'&&method==='GET'){
  const shared=await env.DB.prepare('SELECT content FROM music_shared_collection WHERE id=1').first();
  const fav=await env.DB.prepare('SELECT youtube_id FROM music_guest_favorites WHERE guest_id=?').bind(guest.id).all();
  const lists=await env.DB.prepare('SELECT id,name FROM music_guest_playlists WHERE guest_id=? ORDER BY updated_at DESC').bind(guest.id).all();
  const tracks=await env.DB.prepare('SELECT t.playlist_id,t.youtube_id,t.position FROM music_guest_playlist_tracks t JOIN music_guest_playlists p ON p.id=t.playlist_id WHERE p.guest_id=? ORDER BY t.position').bind(guest.id).all();
  return json({email:guest.email,collection:shared?JSON.parse(shared.content):{songs:[],folders:[]},favorites:fav.results.map(x=>x.youtube_id),playlists:lists.results.map(p=>({...p,songIds:tracks.results.filter(x=>x.playlist_id===p.id).map(x=>x.youtube_id)}))});
 }
 if(path==='/api/guest/favorite'&&method==='POST'){
  const b=await mmBody(request);if(!b||!/^[A-Za-z0-9_-]{11}$/.test(b.youtubeId)||typeof b.active!=='boolean')return mmBad('Ongeldige favoriet');
  const collection=await env.DB.prepare('SELECT content FROM music_shared_collection WHERE id=1').first();
  if(!collection||!JSON.parse(collection.content).songs.some(s=>s.youtubeId===b.youtubeId))return mmBad('Dit nummer staat niet in de gedeelde collectie',403);
  if(b.active)await env.DB.prepare('INSERT OR IGNORE INTO music_guest_favorites(guest_id,youtube_id,created_at) VALUES(?,?,?)').bind(guest.id,b.youtubeId,mmNow()).run();
  else await env.DB.prepare('DELETE FROM music_guest_favorites WHERE guest_id=? AND youtube_id=?').bind(guest.id,b.youtubeId).run();
  return json({ok:true});
 }
 if(path==='/api/guest/playlists'&&method==='POST'){
  const b=await mmBody(request),name=String(b?.name||'').trim();if(!name||name.length>100)return mmBad('Ongeldige naam');
  const id=mmId(),now=mmNow();await env.DB.prepare('INSERT INTO music_guest_playlists(id,guest_id,name,created_at,updated_at) VALUES(?,?,?,?,?)').bind(id,guest.id,name,now,now).run();
  return json({ok:true,id});
 }
 if(path==='/api/guest/playlist'&&method==='PUT'){
  const b=await mmBody(request);
  if(!b||typeof b.id!=='string'||typeof b.name!=='string'||!b.name.trim()||b.name.length>100||!Array.isArray(b.songIds)||b.songIds.length>2000||b.songIds.some(x=>!(/^[A-Za-z0-9_-]{11}$/.test(x))))return mmBad('Ongeldige afspeellijst');
  const p=await env.DB.prepare('SELECT id FROM music_guest_playlists WHERE id=? AND guest_id=?').bind(b.id,guest.id).first();
  if(!p)return mmBad('Afspeellijst niet gevonden',404);
  const col=await env.DB.prepare('SELECT content FROM music_shared_collection WHERE id=1').first();
  const available=new Set(col?JSON.parse(col.content).songs.map(s=>s.youtubeId):[]);
  const ids=[...new Set(b.songIds)].filter(x=>available.has(x));
  await env.DB.prepare('UPDATE music_guest_playlists SET name=?,updated_at=? WHERE id=? AND guest_id=?').bind(b.name.trim(),mmNow(),b.id,guest.id).run();
  await env.DB.prepare('DELETE FROM music_guest_playlist_tracks WHERE playlist_id=?').bind(b.id).run();
  for(let i=0;i<ids.length;i++)await env.DB.prepare('INSERT INTO music_guest_playlist_tracks(playlist_id,youtube_id,position) VALUES(?,?,?)').bind(b.id,ids[i],i).run();
  return json({ok:true});
 }
 if(path==='/api/guest/playlist'&&method==='DELETE'){
  const b=await mmBody(request);if(typeof b?.id!=='string')return mmBad('Ongeldige afspeellijst');
  const p=await env.DB.prepare('SELECT id FROM music_guest_playlists WHERE id=? AND guest_id=?').bind(b.id,guest.id).first();if(!p)return mmBad('Niet gevonden',404);
  await env.DB.prepare('DELETE FROM music_guest_playlist_tracks WHERE playlist_id=?').bind(b.id).run();
  await env.DB.prepare('DELETE FROM music_guest_playlists WHERE id=? AND guest_id=?').bind(b.id,guest.id).run();
  return json({ok:true});
 }
 return mmBad('Onbekende gastfunctie',404);
}

export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname==='/gast'||url.pathname.startsWith('/api/guest/')||url.pathname.startsWith('/api/music-admin/')){
   try{const reply=await mmGuestApi(request,env,url);if(reply)return reply}catch(e){return json({error:'Serverfout bij gastfunctie'},500)}
  }
  if(url.pathname==='/health'){
   try{
    const table=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_sessions'").first();
    return json({application:'Mijn Muziek',database:table?'OK':'Tabel ontbreekt',googleClient:env.GOOGLE_CLIENT_ID?'OK':'Ontbreekt',googleSecret:env.GOOGLE_CLIENT_SECRET?'OK':'Ontbreekt',encryptionKey:env.SESSION_ENCRYPTION_KEY?'OK':'Ontbreekt',phase:'OAuth-test'});
   }catch{return json({error:'Configuratie niet volledig'},500)}
  }
  if(url.pathname==='/'){
   const upstream=await fetch('https://raw.githubusercontent.com/alex2026-cmd/mijn-muziek/main/cloudflare/index.html',{cf:{cacheTtl:60}});
   if(!upstream.ok)return page('De Cloudflare-versie wordt voorbereid. Probeer straks opnieuw.',503);
   return new Response(upstream.body,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
  }
  if(url.pathname==='/auth/start'){
   const state=random(),verifier=random(48),challenge=await digest(verifier);
   // Een korte, HttpOnly, beveiligde cookie koppelt de OAuth-aanvraag aan deze browser.
   const login=JSON.stringify({state,verifier,at:Date.now()});
   const params=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:CALLBACK,response_type:'code',scope:SCOPE,access_type:'offline',prompt:'consent',state,code_challenge:challenge,code_challenge_method:'S256'});
   return new Response(null,{status:302,headers:{location:'https://accounts.google.com/o/oauth2/v2/auth?'+params,'set-cookie':cookie('mm_login',await encrypt(login,env)),'cache-control':'no-store'}});
  }
  if(url.pathname==='/auth/callback'){
   const clear=cookie('mm_login','',0);
   const packed=decodeURIComponent(getCookie(request,'mm_login'));
   if(!packed)return page('De Google-aanmelding is verlopen. <a href="/auth/start">Opnieuw proberen</a>',400);
   let login;
   try{
    const [iv,cipher]=packed.split('.');
    const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv)},await key(env),unb64(cipher));
    login=JSON.parse(new TextDecoder().decode(plain));
   }catch{return page('Ongeldige of verlopen aanmeldcontrole.',400)}
   if(Date.now()-login.at>600000||url.searchParams.get('state')!==login.state)return page('Ongeldige aanmeldstatus.',400);
   if(url.searchParams.get('error'))return page('Google heeft de aanmelding niet afgerond. Je kunt opnieuw proberen.');
   const code=url.searchParams.get('code');if(!code)return page('Google heeft geen autorisatiecode gestuurd.',400);
   const tokenRes=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,redirect_uri:CALLBACK,grant_type:'authorization_code',code_verifier:login.verifier})});
   if(!tokenRes.ok)return page('Google kon de toestemming niet verwerken. Probeer opnieuw via de startpagina.',400);
   const tokens=await tokenRes.json();
   if(!tokens.refresh_token)return page('Google heeft geen vernieuwbaar toegangstoken verstrekt. Test gestopt zonder gegevens op te slaan.',400);
   const userRes=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{authorization:'Bearer '+tokens.access_token}});
   if(!userRes.ok)return page('Google-account niet geverifieerd. Er is niets opgeslagen.',400);
   const user=await userRes.json();
   if(!user.sub)return page('Google-account bevat geen geldige gebruikersidentificatie.',400);
   const id=random(),idHash=await digest(id),encrypted=await encrypt(tokens.refresh_token,env);
   const now=Math.floor(Date.now()/1000);
   await env.DB.prepare('INSERT INTO auth_sessions (session_id_hash,google_user_id,encrypted_refresh_token,created_at,expires_at,revoked_at) VALUES (?,?,?,?,?,NULL)').bind(idHash,user.sub,encrypted,now,now+90*86400).run();
   const headers=new Headers({'location':'/','cache-control':'no-store'});
   headers.append('set-cookie',clear);
   headers.append('set-cookie',cookie('mm_session',id,90*86400));
   return new Response(null,{status:303,headers});
  }
  if(url.pathname==='/auth/logout'&&request.method==='POST'){
   if(request.headers.get('origin')!==url.origin)return json({error:'Ongeldige herkomst'},403);
   const sid=decodeURIComponent(getCookie(request,'mm_session'));
   if(sid)await env.DB.prepare('UPDATE auth_sessions SET revoked_at=? WHERE session_id_hash=?').bind(Math.floor(Date.now()/1000),await digest(sid)).run();
   return new Response(JSON.stringify({ok:true}),{headers:{'content-type':'application/json','cache-control':'no-store','set-cookie':cookie('mm_session','',0)}});
  }
  if(url.pathname==='/api/session'||url.pathname.startsWith('/api/drive/')){
   const sid=decodeURIComponent(getCookie(request,'mm_session'));
   if(!sid)return json({error:'Niet aangemeld'},401);
   const row=await env.DB.prepare('SELECT * FROM auth_sessions WHERE session_id_hash=? AND revoked_at IS NULL AND expires_at>?').bind(await digest(sid),Math.floor(Date.now()/1000)).first();
   if(!row)return json({error:'Sessie verlopen'},401);
   if(url.pathname==='/api/session')return json({connected:true});
   if(!['GET','POST','PATCH'].includes(request.method))return json({error:'Methode niet toegestaan'},405);
   if(request.method!=='GET'&&request.headers.get('origin')!==url.origin)return json({error:'Ongeldige herkomst'},403);
   let dest;
   if(url.pathname==='/api/drive/files'&&request.method==='GET'){
    dest='https://www.googleapis.com/drive/v3/files?'+url.searchParams;
   }else if(url.pathname.startsWith('/api/drive/file/')&&request.method==='GET'){
    const id=url.pathname.slice('/api/drive/file/'.length);
    if(!/^[a-zA-Z0-9_-]{5,200}$/.test(id))return json({error:'Ongeldig bestand'},400);
    dest='https://www.googleapis.com/drive/v3/files/'+id+'?alt=media';
   }else if(url.pathname.startsWith('/api/drive/upload/')&&request.method==='PATCH'){
    const id=url.pathname.slice('/api/drive/upload/'.length);
    if(!/^[a-zA-Z0-9_-]{5,200}$/.test(id))return json({error:'Ongeldig bestand'},400);
    dest='https://www.googleapis.com/upload/drive/v3/files/'+id+'?uploadType=media';
   }else if(url.pathname==='/api/drive/upload-new'&&request.method==='POST'){
    dest='https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
   }else return json({error:'Route niet toegestaan'},404);
   let encrypted;
   try{const [iv,cipher]=row.encrypted_refresh_token.split('.');encrypted=new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv)},await key(env),unb64(cipher)))}catch{return json({error:'Sessie kan niet ontsleuteld worden'},500)}
   const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,grant_type:'refresh_token',refresh_token:encrypted})});
   if(!tokenResponse.ok)return json({error:'Google-toegang verlopen; opnieuw aanmelden vereist'},401);
   const token=await tokenResponse.json();
   const headers=new Headers({'authorization':'Bearer '+token.access_token});
   if(request.method!=='GET'){
    const ct=request.headers.get('content-type')||'application/json';
    if(!/^(application\/json|multipart\/related)/i.test(ct))return json({error:'Ongeldig inhoudstype'},415);
    headers.set('content-type',ct);
   }
   const response=await fetch(dest,{method:request.method,headers,...(request.method==='GET'?{}:{body:request.body}),redirect:'manual'});
   return new Response(response.body,{status:response.status,headers:{'content-type':response.headers.get('content-type')||'application/json','cache-control':'no-store'}});
  }
  return json({error:'Niet gevonden'},404);
 }
};
