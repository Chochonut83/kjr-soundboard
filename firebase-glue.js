// Connects the soundboard to Firebase so your songs and game sync between devices.
// You don't need to edit this file.
import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth,signInAnonymously,onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {initializeFirestore,persistentLocalCache,persistentMultipleTabManager,memoryLocalCache,doc,getDoc,setDoc,onSnapshot} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const norm=e=>{const x=new Error((e&&e.message)||String(e));x.code=String((e&&e.code)||"unknown").replace(/^firestore\//,"").replace(/^auth\//,"").replace(/-/g,"_");return x};
const cfg=window.FIREBASE_CONFIG;
let api;
if(!cfg||!cfg.apiKey){
  api={noConfig:true};
}else{
  const app=initializeApp(cfg,"soundboard");
  let fs;
  try{fs=initializeFirestore(app,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()}),ignoreUndefinedProperties:true})}
  catch(e){fs=initializeFirestore(app,{localCache:memoryLocalCache(),ignoreUndefinedProperties:true})}
  const auth=getAuth(app);
  const ready=new Promise((res,rej)=>{let asked=false;const un=onAuthStateChanged(auth,u=>{
    if(u){un();res({uid:u.uid})}
    else if(!asked){asked=true;signInAnonymously(auth).catch(e=>{un();rej(norm(e))})}
  })});
  const D=p=>doc(fs,p);
  api={
    ready,
    get:async p=>{try{const s=await getDoc(D(p));return s.exists()?s.data():null}catch(e){throw norm(e)}},
    set:(p,d)=>setDoc(D(p),d).catch(e=>{throw norm(e)}),
    watchDoc:(p,cb,err)=>onSnapshot(D(p),{includeMetadataChanges:true},s=>cb(s.exists()?s.data():null,{fromCache:s.metadata.fromCache,pending:s.metadata.hasPendingWrites}),e=>err&&err(norm(e))),
  };
}
window.__sbDB(api);
