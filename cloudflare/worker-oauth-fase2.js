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
export default {
 async fetch(request,env){
  const url=new URL(request.url);
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
