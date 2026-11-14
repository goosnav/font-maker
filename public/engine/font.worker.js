let runtime;
let chain=Promise.resolve();
async function init(){
 if(runtime)return runtime;
 postMessage({progress:'Preparing font engine…'});
 const url='/runtime/pyodide/pyodide.mjs';
 const {loadPyodide}=await import(/* @vite-ignore */url);
 const py=await loadPyodide({indexURL:'/runtime/pyodide/'});
 await py.loadPackage('fonttools');py.FS.mkdirTree('/fonts');
 const response=await fetch('/engine/font_engine.py');if(!response.ok)throw Error('Font engine is missing.');
 await py.runPythonAsync(await response.text());runtime=py;postMessage({progress:'Font engine ready'});return py;
}
self.onmessage=(event)=>{const {id,request,sources}=event.data;chain=chain.catch(()=>{}).then(async()=>{try{const py=await init();for(const source of sources){const path=`/fonts/${source.id}.ttf`;if(!py.FS.analyzePath(path).exists)py.FS.writeFile(path,new Uint8Array(source.data));}py.globals.set('request_json',JSON.stringify(request));const out=await py.runPythonAsync('dispatch(request_json)');let result;if(typeof out==='string')result=JSON.parse(out);else{result=out.toJs();out.destroy();}postMessage({id,result});}catch(error){postMessage({id,error:error instanceof Error?error.message:String(error)});}});};
