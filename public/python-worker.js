/* Python execution is isolated in a browser Web Worker, never on the FBI server.
   Pyodide is downloaded on first use. No access to FBI credentials or DOM. */
let pyodidePromise=null;
const VERSION='0.27.7';
const BASE='https://cdn.jsdelivr.net/pyodide/v'+VERSION+'/full/';
async function runtime(){
  if(!pyodidePromise)pyodidePromise=(async()=>{
    importScripts(BASE+'pyodide.js');
    return await loadPyodide({indexURL:BASE});
  })();
  return pyodidePromise;
}
self.onmessage=async event=>{
  const {id,source}=event.data||{};
  if(typeof source!=='string')return;
  try{
    const py=await runtime();
    py.globals.set('__fbi_source',source);
    const output=await py.runPythonAsync(
      'import io, contextlib, traceback\n'+
      '__fbi_out=io.StringIO()\n'+
      'with contextlib.redirect_stdout(__fbi_out), contextlib.redirect_stderr(__fbi_out):\n'+
      '    try:\n'+
      '        exec(compile(__fbi_source, "<FBI editor>", "exec"), {"__name__":"__main__"})\n'+
      '    except BaseException:\n'+
      '        traceback.print_exc()\n'+
      '__fbi_out.getvalue()'
    );
    self.postMessage({id,output:String(output||''),ok:true});
  }catch(err){self.postMessage({id,output:String(err?.message||err),ok:false});}
};
