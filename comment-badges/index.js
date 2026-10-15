/*!7308d587c0a2315f*/

const __6dde252c91=(32471802);
const __d13533f2dd=(__6dde252c91^18267)>>>0;
const __0e0b930eb0=(__d13533f2dd^48934)>>>0;
const __1a3b4f7f48=(__0e0b930eb0^37261)>>>0;
const __09a29b9ddf=(__1a3b4f7f48^43397)>>>0;
if(__09a29b9ddf===-1)globalThis["__1c7b8cc3"]=1;
var A=["svip","svip-year","vip","vip-year","concept","concept-year","changting","qvip","wvip","music","music-year"],J={svip:1.1333333333333333,"svip-year":1.1590909090909092,vip:1.2142857142857142,"vip-year":1.2142857142857142,concept:1,"concept-year":1,changting:1,qvip:1.024390243902439,wvip:1.024390243902439},j={music:.8,"music-year":.8},B=t=>t in j,T=t=>j[t]??J[t]??1,v=["actor","biz","tme-star","auth"],M=["student"];var Q="EAS1",x=(t,e,n)=>new Uint8Array(t,e,n),tt=t=>{let e=atob(t),n=new Uint8Array(e.length);for(let o=0;o<e.length;o+=1)n[o]=e.charCodeAt(o);return n},et=async(t,e)=>{let n=tt(t),o=new Uint8Array(n.length+e.length);o.set(n,0),o.set(e,n.length);let s=await crypto.subtle.digest("SHA-256",o);return crypto.subtle.importKey("raw",s,"AES-GCM",!1,["decrypt"])},R=async(t,e)=>{let n=new DataView(t);if(String.fromCharCode(...new Uint8Array(t,0,4))!==Q)throw new Error("\u8D44\u6E90\u6587\u4EF6\u683C\u5F0F\u4E0D\u6B63\u786E");let s=x(t,4,16),r=x(t,20,12),l=n.getUint32(32,!0),m=36,y=[];for(let g=0;g<l;g+=1){let u=n.getUint16(m,!0);m+=2;let i=n.getUint32(m,!0);m+=4;let C=n.getUint32(m,!0);m+=4;let S=new TextDecoder().decode(x(t,m,u));m+=u,y.push({name:S,offset:i,length:C}/*788b6e22*/)}let h=m,w=t.byteLength-h-16,a=x(t,h,w),c=x(t,h+w,16),p=await et(e,s),d=new Uint8Array(a.length+c.length);d.set(a,0),d.set(c,a.length);let b;try{b=new Uint8Array(await crypto.subtle.decrypt({name:"AES-GCM",iv:r},p,d))}catch{throw new Error("\u8D44\u6E90\u89E3\u5BC6\u5931\u8D25\uFF08\u5BC6\u94A5\u4E0D\u5339\u914D\u6216\u6587\u4EF6\u635F\u574F\uFF09")}let f={};for(let g of y)f[g.name]=b.slice(g.offset,g.offset+g.length);return f},nt={webp:"image/webp",png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",gif:"image/gif",svg:"image/svg+xml",woff:"font/woff",woff2:"font/woff2",ttf:"font/ttf",otf:"font/otf",css:"text/css",json:"application/json",txt:"text/plain"},D=t=>{let e=String(t).split(".").pop()?.toLowerCase()??"";return nt[e]??"application/octet-stream"},U=(t,e)=>{let n="";for(let o of t)n+=String.fromCharCode(o);return`data:${e};base64,${btoa(n)}`};var ot="1XVzPKeODxz7UslL1Z9eSBUeQ1HASWjcIZfQ43Gwugw=",_=null,rt=async t=>{if(_)return _;try{let e=String(await t.electron.plugins.getDirectory()||"").replace(/[\\/]+$/,"");if(!e)return null;let n=await t.fs.readFileBytes(`${e}/${t.id}/assets.bin`,{maxBytes:4*1024*1024});if(!n?.ok||!n.data)throw new Error(n?.error||"\u8BFB\u53D6\u8D44\u6E90\u6587\u4EF6\u5931\u8D25");return _=await R(n.data,ot),_}catch(e){return console.warn("[comment-badges] \u8D44\u6E90\u89E3\u5BC6\u5931\u8D25\uFF1A",e?.message||e),null}},K=async(t,e,n="icons",o=".webp")=>{let s=await rt(t);if(!s)return{};let r={};for(let l of e){let m=s[`${n}/${l}${o}`];m&&(r[l]=U(m,D(o)))}return r},P=async t=>{let e={/*b0cd8396*/};return await Promise.all(Object.entries(t).map(async([n,o])=>{let s=new Image;e[n]=await new Promise(r=>{s.onload=()=>r(s.naturalWidth/s.naturalHeight),s.onerror=()=>r(0),s.src=o})})),e};var E=t=>t.replace(/[^a-zA-Z0-9_-]/g,e=>`\\${e}`),k=t=>t.split(`
`).map(e=>e.trim()).filter(e=>e&&!e.startsWith("/*")).map(e=>e.endsWith(";")?`${e.slice(0,-1)} !important;`:e).join(`
  `),L=(t,e,n)=>`
.comment-badge.comment-badge-${E(t)} {
  ${k(`background-image: none;
  background-color: ${e};
  color: ${n};
  font-size: var(--cb-identity-font);
  font-weight: 800;
  line-height: 1.4;
  padding: var(--cb-identity-pad);
  border-radius: 999px;
  height: auto;
  aspect-ratio: auto;
  max-width: none;`)}
}`,N=t=>{let e=`
/* \u5148\u89E3\u6389\u5BBF\u4E3B\u539F\u6709\u7684\u80F6\u56CA\u5916\u89C2\uFF0C\u53EA\u7559\u56FE\u7247\u672C\u8EAB\u3002
   \u5C55\u5F00\u5199 background-* \u800C\u4E0D\u662F\u7B80\u5199 background: none \u2014\u2014 \u7B80\u5199\u4F1A\u548C\u540E\u9762\u7684
   background-image \u4E89\u540C\u4E00\u5C5E\u6027\uFF1B\u4E5F\u4E0D\u8981\u5728\u8FD9\u91CC\u5199 background-image: none\uFF0C
   \u5B83\u4E0E\u5404\u6863\u7684 background-image \u7279\u5F02\u6027\u76F8\u540C\u3001\u5168\u9760\u987A\u5E8F\u51B3\u80DC\uFF0C\u5BB9\u6613\u51FA\u9519\u3002 */
.comment-badge[class*="comment-badge-"] {
  ${k(`background-color: transparent;
  border: none;
  box-shadow: none;
  padding: 0;
  color: transparent;
  font-size: 0;
  line-height: 0;
  gap: 0;
  min-width: 0;
  border-radius: 0;
  background-repeat: no-repeat;
  background-position: center;
  background-size: contain;`)}
}`,n=A.filter(r=>t[r]).map(r=>{let l=T(r),m=B(r)?"--cb-music-h":"--cb-member-h";return`
.comment-badge.comment-badge-${E(r)} {
  ${k(`background-image: url("${t[r]}");
  height: calc(${l} * var(${/*6fe98d02*/m}));
  aspect-ratio: var(--cb-ratio-${E(r)}, 1);
  max-width: var(--cb-max-w);
  flex: none;`)}
}`}).join(`
`),o=v.map(r=>L(r,"color-mix(in srgb, var(--state-success, #4ade80) 26%, transparent)","color-mix(in srgb, var(--state-success, #16a34a) 78%, var(--color-text-main))")).join(`
`),s=M.map(r=>L(r,"color-mix(in srgb, #38bdf8 26%, transparent)","color-mix(in srgb, #0ea5e9 78%, var(--color-text-main))")).join(`
`);return[e,n,o,s].join(`
`)},O=`
:root {
  --cb-member-h: 15px;
  --cb-music-h: 12px;
  --cb-identity-font: 10px;
  --cb-identity-pad: 2px 9px;
  --cb-max-w: 96px;
}
.comment-floor-reply-header {
  --cb-member-h: 13px;
  --cb-music-h: 10.4px;
  --cb-identity-font: 9px;
  --cb-identity-pad: 1px 7px;
}
/* \u697C\u4E2D\u697C\u540D\u5B57\u540E\u4E0D\u663E\u793A\u300C\u56DE\u590Dxxx\u300D\uFF1A\u4E0B\u65B9\u5F15\u7528\u5757\u5DF2\u6807\u660E\u56DE\u590D\u6765\u6E90 */
.comment-floor-reply-to { display: none !important; }`,Y=t=>{let e=Object.entries(t).filter(([,n])=>n>0).map(([n,o])=>`  --cb-ratio-${E(n)}: ${o.toFixed(4)};`).join(`
`);return e?`:root {
${e}
}`:""};var z=async t=>{let e=await K(t,A),n=Object.keys(e).length;if(n===0)return!1;t.css.inject(O,{id:"size"}),t.css.inject(N(e),{id:"badges"});let o=await P(e),s=Y(o);return s&&t.css.inject(s,{id:"ratios"}/*0074a0b8*/),{count:n,urls:e,ratios:o}};var st=/^\/comment\//,at=t=>!!t&&typeof t=="object"&&!Array.isArray(t)&&("user_name"in t||"userName"in t)&&("content"in t||"time"in t||"addtime"in t),it=t=>!!(typeof t.location=="string"&&t.location.trim()||typeof t.ip_location=="string"&&t.ip_location.trim()||typeof t.ipLocation=="string"&&t.ipLocation.trim()),I=t=>{if(!(!t||typeof t!="object")){if(Array.isArray(t)){for(let e of t)I(e);return}at(t)&&!it(t)&&(t.location="\u672A\u77E5");for(let e of Object.values(t))I(e)}},q=t=>{t.server.intercept(async(e,n)=>{let o=await n();return o?.body&&I(o.body),o},{match:st,priority:100,name:"ip-fallback"})};var ct=(t,e)=>{let n=Number(t)||0,o=Number(e)||0;return o===1||o===3?5:n===1||n===2?3:n===3||n===4?4:-2},mt=t=>t===5?"music-year":"music",pt=t=>ct(t?.m_type??t?.mtype,t?.y_type??t?.ytype),F=t=>String(t??"").trim().replace(/\s+/g," "),lt=t=>F(t?.addtime??t?.add_time??t?.time??""),dt=t=>String(t?.user_name??t?.nickname??t?.userName??"").trim(),G=(t,e)=>`${t}\0${e}`,$=(t,e)=>{if(!t||typeof t!="object")return;if(Array.isArray(t)){for(let s of t)$(s,e);return}let n=dt(t),o=lt(t);if(n&&o){let s=pt(t);s>=0&&e.set(G(n,o),s)}for(let s of Object.values(t))$(s,e)},Z=(t,e)=>{let n=new Map;t.server.intercept(async(a,c)=>{let p=await c();return p?.body&&$(p.body,n),p},{match:/^\/comment\//,priority:90,name:"music-kind-collector"});let o=new Map,s=a=>{let c=o.get(a);if(!c){let p=mt(a),d=e.urls[p];if(!d)return null;c={url:d,ratio:e.ratios[p]||1,assetId:p},o.set(a,c)}return c},r=(a,c,p)=>{if(!a||!c||!p)return!1;if(a.querySelector("[data-cb-music]"))return!0;/*15302680*/let d=c.textContent?.trim()??"",b=p.textContent??"",f=F(b.split("\xB7")[0]);if(!d||!f)return!1;let g=n.get(G(d,f));if(g===void 0)return!1;let u=s(g);if(!u)return!1;let i=document.createElement("span");i.className="comment-badge comment-badge-"+u.assetId,i.dataset.cbMusic=u.assetId,i.setAttribute("aria-label","\u97F3\u4E50\u5305"),i.style.setProperty("background-image",`url("${u.url}")`,"important"),i.style.setProperty("background-color","transparent","important"),i.style.setProperty("background-size","contain","important"),i.style.setProperty("background-repeat","no-repeat","important"),i.style.setProperty("background-position","center","important"),i.style.setProperty("padding","0","important"),i.style.setProperty("border","none","important"),i.style.setProperty("box-shadow","none","important"),i.style.setProperty("color","transparent","important"),i.style.setProperty("font-size","0","important"),i.style.setProperty("line-height","0","important"),i.style.setProperty("height","calc(0.8 * var(--cb-music-h, 12px))","important"),i.style.setProperty("aspect-ratio",String(u.ratio),"important"),i.style.setProperty("flex","none","important");let S=(c.parentElement??a).querySelectorAll('.comment-badge[class*="comment-badge-"]:not([data-cb-music])');return(S.length>0?S[S.length-1]:c).after(i),!0},l=[{selector:".comment-item",name:".comment-name",time:".comment-time"},{selector:".comment-floor-reply-body",name:".comment-floor-reply-name",time:".comment-floor-reply-time"}],m=300,y=20,h=(a,c)=>{let p=0,d=null,b=()=>{!a.isConnected||a.querySelector("[data-cb-music]")||r(a,a.querySelector(c.name),a.querySelector(c.time))||(p+=1,!(p>=y)&&(d=window.setTimeout(b,m)))};return b(),()=>{d!==null&&window.clearTimeout(d),a.querySelector("[data-cb-music]")?.remove()}},w=l.map(a=>t.dom.observe(a.selector,c=>h(c,a)));return()=>w.forEach(a=>a?.())};var W={super:"svip",deluxe:"vip",concept:"concept",music:"music"},H=[".sidebar-member-badge",".profile-member-badge"],V=t=>{let e=H.flatMap(r=>Object.keys(W).map(l=>`${r}.is-${l}`)),n=["background-color: transparent","border: none","box-shadow: none","padding: 0","min-width: 0","color: transparent","font-size: 0","line-height: 0","gap: 0","border-radius: 0","background-repeat: no-repeat","background-position: center","background-size: contain"].map(r=>`  ${r} !important;`).join(`
`),o=`${e.join(`,
`)} {
${n}
}`,s=Object.entries(W).filter(([,r])=>t[r]).map(([r,l])=>`
${H.map(y=>`${y}.is-${r}`).join(`,
`)} {
  background-image: url("${t[l]}") !important;
  height: var(--cb-user-badge-art, 14px) !important;
  aspect-ratio: var(--cb-ratio-${l}, 1) !important;
  max-width: 84px !important;
  flex: none !important;
}`).join(`
`);return[o,s].join(`
`)},X=`
.sidebar-member-badge.is-super,
.sidebar-member-badge.is-deluxe,
.sidebar-member-badge.is-concept,
.sidebar-member-badge.is-music,
.profile-member-badge.is-super,
.profile-member-badge.is-deluxe,
.profile-member-badge.is-concept,
.profile-member-badge.is-music {
  --cb-user-badge-art: 14px;
}`;async function Tt(t){await t.storage.set("lastActivatedAt",Date.now());let e=await z(t);if(!e){t.toast.warning("\u5FBD\u7AE0\u7D20\u6750\u8BFB\u53D6\u5931\u8D25\uFF0C\u63D2\u4EF6\u672A\u751F\u6548");/*43bd4026*/return}t.css.inject(X,{id:"sidebar-size"}),t.css.inject(V(e.urls),{id:"sidebar-badge"}),q(t),Z(t,e)}function vt(){}export{Tt as activate,vt as deactivate};


/*ca815e2723c7248f8f1e*/