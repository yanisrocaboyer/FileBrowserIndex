/* ZIP explorer for FBI and public share links. */
window.FBIZipExplorer=async function(container,{list,read,download}){
 container.replaceChildren();
 const root=document.createElement('div');root.className='fbi-zip';
 const bar=document.createElement('div');bar.className='fbi-zip-bar';
 const back=document.createElement('button');back.textContent='← Retour';back.type='button';
 const location=document.createElement('span');location.className='fbi-zip-location';
 const items=document.createElement('div');items.className='fbi-zip-items';
 const pane=document.createElement('section');pane.className='fbi-zip-pane';
 bar.append(back,location);root.append(bar,items,pane);container.append(root);
 let all=[],folder='',current=null;
 const el=(tag,cls,txt)=>{const e=document.createElement(tag);e.className=cls;if(txt!==undefined)e.textContent=txt;return e;};
 const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function clean(html){
  const doc=new DOMParser().parseFromString('<div>'+html+'</div>','text/html');
  const allowed=new Set('p br h1 h2 h3 h4 h5 h6 strong em b i del blockquote pre code ul ol li a img hr table thead tbody tr th td'.split(' '));
  const nodes=[...doc.body.querySelectorAll('*')];
  for(const n of nodes){
   if(!n.isConnected)continue;
   if(!allowed.has(n.localName)){if(n.localName!=='div')n.remove();continue;}
   for(const a of [...n.attributes])n.removeAttribute(a.name);
   n.classList.add('share-md-'+n.localName);
  }
  return doc.body.firstElementChild.innerHTML;
 }
 async function show(path){
  current=path;pane.replaceChildren();const e=all.find(x=>x.path===path);if(!e)return;
  const header=el('div','fbi-zip-file');header.append(el('strong','',path.split('/').pop()),el('span','',((e.size||0)/1024).toFixed(1)+' Ko'));
  const dl=el('button','','↓ Télécharger ce fichier');dl.onclick=()=>download(path);header.append(dl);pane.append(header);
  const ext=(path.split('.').pop()||'').toLowerCase();
  if(e.size>4194304){pane.append(el('p','','Fichier trop volumineux pour un aperçu (4 Mio maximum).'));return;}
  try{
   const blob=await read(path);if(current!==path)return;
   if(['png','jpg','jpeg','gif','webp','bmp'].includes(ext)){
    const url=URL.createObjectURL(blob),img=el('img','fbi-zip-image');img.src=url;img.onload=()=>setTimeout(()=>URL.revokeObjectURL(url),30000);pane.append(img);
   }else if(ext==='pdf'){
    const url=URL.createObjectURL(new Blob([blob],{type:'application/pdf'})),frame=el('iframe','fbi-zip-frame');frame.sandbox='allow-same-origin';frame.src=url;pane.append(frame);setTimeout(()=>URL.revokeObjectURL(url),120000);
   }else if(['html','htm'].includes(ext)){
    const frame=el('iframe','fbi-zip-frame');frame.setAttribute('sandbox','');frame.srcdoc='<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:;">'+await blob.text();pane.append(frame);
   }else if(['md','markdown'].includes(ext)){
    const txt=await blob.text(),article=el('article','fbi-zip-markdown share-markdown');
    article.innerHTML=window.marked?clean(window.marked.parse(txt)):escape(txt);pane.append(article);
   }else if(['txt','json','js','ts','css','xml','py','c','cpp','cs','java','sh','yml','yaml','csv','log'].includes(ext)){
    const pre=el('pre','fbi-zip-code');pre.textContent=await blob.text();pane.append(pre);
   }else pane.append(el('p','','Aucun aperçu disponible pour ce format.'));
  }catch(e){pane.append(el('p','',e.message||'Impossible de prévisualiser ce fichier.'));}
 }
 function render(){
  location.textContent='/'+folder;back.disabled=!folder;items.replaceChildren();pane.replaceChildren();
  const children=new Map();
  for(const e of all){if(!e.path.startsWith(folder))continue;const remain=e.path.slice(folder.length);if(!remain)continue;const slash=remain.indexOf('/');const name=slash>=0?remain.slice(0,slash):remain;if(!name)continue;const dir=slash>=0||e.dir;const key=name+(dir?'/':'');if(!children.has(key))children.set(key,{name,dir,path:dir?folder+name+'/':e.path,size:e.size});}
  for(const c of [...children.values()].sort((a,b)=>Number(b.dir)-Number(a.dir)||a.name.localeCompare(b.name))){
   const b=el('button','fbi-zip-item',(c.dir?'📁 ':'📄 ')+c.name);b.type='button';b.onclick=()=>{if(c.dir){folder=c.path;render();}else show(c.path);};items.append(b);
  }
  if(!children.size)items.append(el('p','','Dossier vide.'));
 }
 back.onclick=()=>{folder=folder.replace(/[^/]+\/$/,'');render();};
 try{const data=await list();all=data.entries||[];render();}catch(e){items.append(el('p','',e.message||'Impossible de lire cette archive.'));}
};
