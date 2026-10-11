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
function cookie(name,value,age=600){return name+'='+encodeURIComponent(value)+'; HttpOnly; Secure; SameSite=Lax; Path=/auth; Max-Age='+age}
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
  if(url.pathname==='/')return page('Beveiligde Google-aanmelding wordt getest. <a style="color:#ff9ad5" href="/auth/start">Verbinden met Google</a>');
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
   // Fase 1 geeft bewust GEEN sessietoken aan de browser: dat volgt pas na beveiligde frontend-handoff.
   return new Response('<!doctype html><html lang="nl"><meta charset="utf-8"><title>Mijn Muziek</title><body style="font:18px system-ui;max-width:650px;margin:80px auto;background:#20132e;color:white;padding:24px"><h2>Google-aanmelding geslaagd</h2><p>De beveiligde verbinding is opgeslagen. De koppeling met Mijn Muziek volgt in de volgende stap.</p></body></html>',{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','set-cookie':clear,'x-content-type-options':'nosniff'}});
  }
  return json({error:'Niet gevonden'},404);
 }
};
