/* FBI public shared-file viewer. No credentials or authentication required. */
(()=>{
'use strict';
const root=document.querySelector('[data-share-view]');
if(!root)return;
const source=document.getElementById('share-source');
const editor=document.getElementById('edit-content');
const preview=document.getElementById('share-preview');
const mode=root.dataset.mode;
const token=root.dataset.token;
const base=root.dataset.base||'';
const escapeHTML=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const input=()=>editor?editor.value:(source?.value||'');
function highlight(text,lang){
 const src=String(text),re=lang==='html'?/(<!--[\s\S]*?-->|<\/?[\w:-]+|\s+[\w:-]+(?=\s*=)|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\/?\s*>)/g:lang==='css'?/(\/\*[\s\S]*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|#[a-f\d]{3,8}\b|@[\w-]+|[\w-]+(?=\s*:)|\b\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw)?\b|[{}:;])/gi:/(\/\/[^\n]*|#[^\n]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b(?:true|false|null|const|let|var|function|return|def|class|import|from|if|else|for|while|async|await)\b|\b\d+(?:\.\d+)?\b)/g;
 let out='',last=0,m;
 while((m=re.exec(src))){
  out+=escapeHTML(src.slice(last,m.index));
  const t=m[0];let kind='operator';
  if(t.startsWith('<!--')||t.startsWith('/*')||(lang!=='css'&&lang!=='html'&&(t.startsWith('//')||t.startsWith('#'))))kind='comment';
  else if(t.startsWith('"')||t.startsWith("'"))kind='string';
  else if(/^\d|^#[\da-f]{3,8}$/i.test(t))kind='number';
  else if(/^<\/?|^@/.test(t)||/^(true|false|null|const|let|var|function|return|def|class|import|from|if|else|for|while|async|await)$/.test(t))kind='keyword';
  else if(/^[\w:-]+$/.test(t))kind='property';
  out+='<span class="share-token share-token-'+kind+'">'+escapeHTML(t)+'</span>';last=re.lastIndex;
 }
 return out+escapeHTML(src.slice(last));
}
function language(el){return (el?.dataset.lang||mode||'text').toLowerCase();}
function paintCode(el,text,lang){
 el.innerHTML=highlight(text,lang);
 el.classList.add('share-code','share-code-'+lang);
}
function safeMarkdown(html){
 const doc=new DOMParser().parseFromString('<div>'+html+'</div>','text/html');
 const allowed=new Set('p br h1 h2 h3 h4 h5 h6 strong b em i del s u blockquote pre code ul ol li a img hr table thead tbody tr th td details summary input'.split(' '));
 const walk=doc.createTreeWalker(doc.body,NodeFilter.SHOW_ELEMENT);
 const nodes=[];while(walk.nextNode())nodes.push(walk.currentNode);
 for(const el of nodes){
  if(!el.isConnected)continue;
  const tag=el.localName;
  if(!allowed.has(tag)){el.remove();continue;}
  for(const a of [...el.attributes]){
   if(!['href','src','alt','title','class','type','checked','disabled'].includes(a.name))el.removeAttribute(a.name);
  }
  if(tag==='a'){
   const url=el.getAttribute('href')||'';
   if(!/^(https?:\/\/|mailto:|#|\/)/i.test(url))el.removeAttribute('href');
   el.setAttribute('rel','noopener noreferrer');el.setAttribute('target','_blank');
  }
  if(tag==='img'){
   const url=el.getAttribute('src')||'';
   if(!/^(https:\/\/|data:image\/(?:png|jpeg|gif|webp);base64,)/i.test(url))el.removeAttribute('src');
   el.setAttribute('loading','lazy');
  }
  if(tag==='input'){el.setAttribute('disabled','');if(el.getAttribute('type')!=='checkbox')el.remove();}
  el.classList.add('share-md-'+tag);
  if(tag==='pre')el.classList.add('share-md-codeblock');
  if(tag==='code'){
   const lang=(el.className.match(/language-([\w-]+)/)||[])[1]||'text';
   if(el.parentElement?.localName==='pre')paintCode(el,el.textContent,lang);
  }
 }
 const frag=document.createDocumentFragment();
 for(const child of [...doc.body.firstElementChild.childNodes])frag.appendChild(document.importNode(child,true));
 return frag;
}
function render(){
 const value=input();
 if(mode==='html'){
  const frame=preview.querySelector('iframe');
  if(frame){
   const policy='<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data: blob:; font-src data:;">';
   frame.srcdoc=policy+value;
   frame.classList.add('share-html-frame');
  }
 }else if(mode==='markdown'){
  const article=preview.querySelector('article');
  if(article){
   article.replaceChildren();
   article.classList.add('share-markdown','share-rendered-markdown');
   if(window.marked){
    try{article.append(safeMarkdown(marked.parse(value,{gfm:true,breaks:true})));}catch(e){article.textContent=value;}
   }else article.textContent=value;
  }
 }else if(mode==='code'){
  const code=preview.querySelector('code');if(code)paintCode(code,value,language(code));
 }
 const raw=document.getElementById('share-source-code');
 if(raw)paintCode(raw,value,root.dataset.lang||mode);
}
const toggle=document.getElementById('share-source-toggle');
const sourcePanel=document.getElementById('share-source-panel');
if(toggle&&sourcePanel){toggle.addEventListener('click',()=>{sourcePanel.hidden=!sourcePanel.hidden;toggle.setAttribute('aria-expanded',String(!sourcePanel.hidden));});}
if(editor){
 let debounce;
 editor.addEventListener('input',()=>{clearTimeout(debounce);debounce=setTimeout(render,160);});
 const save=document.getElementById('save'),status=document.getElementById('status');
 if(save)save.addEventListener('click',async()=>{
  save.disabled=true;status.textContent='Enregistrement…';
  try{
   const response=await fetch(base+'/api/public-share/'+token,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:editor.value})});
   const result=await response.json();if(!response.ok)throw Error(result.error||'Erreur');
   status.textContent='Enregistré.';render();
  }catch(e){status.textContent=e.message||'Erreur';}finally{save.disabled=false;}
 });
}
if(mode==='zip'&&window.FBIZipExplorer){
 const endpoint=base+'/s/'+token+'/zip-preview';
 window.FBIZipExplorer(preview,{
  list:async()=>{const r=await fetch(endpoint);if(!r.ok)throw Error('Impossible de lire cette archive.');return r.json();},
  read:async path=>{const r=await fetch(endpoint+'?entry='+encodeURIComponent(path));if(!r.ok)throw Error('Aperçu indisponible.');return r.blob();},
  download:path=>{const a=document.createElement('a');a.href=endpoint+'?entry='+encodeURIComponent(path)+'&download=1';a.download=path.split('/').pop();document.body.append(a);a.click();a.remove();}
 });
}
render();
})();
