const {app,BrowserWindow,ipcMain,shell,dialog,safeStorage,Tray,Menu,nativeImage}=require('electron');
const fs=require('node:fs');const path=require('node:path');const {pathToFileURL}=require('node:url');
const {isUpdateRequest,createUpdateExit}=require('./update-exit.cjs');
app.commandLine.appendSwitch('lang','en-US');
let panel,store,server,bridge,tray,closing=false,activeMedia;
let taskState={phase:'idle'},taskRunning=false,taskCancelled=false;
let taskPromise=Promise.resolve();
const requestUpdateExit=createUpdateExit({cancelTask:()=>{taskCancelled=true;},waitForTask:()=>taskPromise,quit:()=>app.quit(),onError:()=>{}});
const importFile=p=>import(pathToFileURL(path.join(__dirname,p)).href);
if(!app.requestSingleInstanceLock()){app.quit();}else if(isUpdateRequest(process.argv)){app.quit();}else{
 app.on('second-instance',(_event,argv)=>{if(isUpdateRequest(argv)){requestUpdateExit();return;}if(panel){panel.show();panel.focus();}});
 app.whenReady().then(init).catch(e=>{dialog.showErrorBox('OmniMemory',e.message);app.quit();});
}
async function init(){
 const data=path.join(app.getPath('userData'),'memory');fs.mkdirSync(data,{recursive:true});
 process.env.OMNI_DATA_DIR=data;
 // Fresh installations encrypt automatically. Existing plaintext stores remain
 // untouched until the user explicitly migrates them with a verified backup.
 const {getOrCreateDeviceSecret}=require('./key-vault.cjs');
 let deviceVault;
 try{deviceVault=getOrCreateDeviceSecret({dir:data,safeStorage,journalPath:path.join(data,'omnimemory.jsonl')});}
 catch(error){
   // Never regenerate lost keys. Offer explicit, password-authenticated recovery.
   const restored=await requestDeviceRecovery({data,reason:error.message,importFile});
   if(!restored)throw error;
   deviceVault=getOrCreateDeviceSecret({dir:data,safeStorage,journalPath:path.join(data,'omnimemory.jsonl')});
 }
 if(deviceVault.secret){
   if(process.env.OMNI_MEMORY_PASSPHRASE && process.env.OMNI_MEMORY_PASSPHRASE!==deviceVault.secret)
     throw Error('An external encryption passphrase conflicts with the device-protected key.');
   process.env.OMNI_MEMORY_PASSPHRASE=deviceVault.secret;
 }

 const {MemoryStore}=await importFile('../core/lib/store.js');
 const {createApp}=await importFile('../core/server.js');
 const {BridgeClient,validateBridgeOrigin,DEFAULT_BRIDGE_ORIGIN}=await importFile('bridge-client.mjs');
 const {migratePrevious}=await importFile('migrate.mjs');
 const {importFiles}=await importFile('import-files.mjs');
 const {planDeletion,deletionSummary,deleteMemory,cleanupDeletedFiles}=await importFile('delete-memory.mjs');
 const {createMediaProcessor}=await importFile('media.mjs');
 if(process.env.LOCALAPPDATA)migratePrevious({oldDirectory:path.join(process.env.LOCALAPPDATA,'OmniMemory','data'),newDirectory:data,MemoryStore});
 store=new MemoryStore(path.join(data,'omnimemory.jsonl'));
 cleanupDeletedFiles(store,path.join(data,'files'));
 const key=require('node:crypto').randomBytes(32).toString('hex');
 server=createApp({store,key,fileDir:path.join(data,'files')});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const prefsPath=path.join(app.getPath('userData'),'preferences.json');
 const prefs=fs.existsSync(prefsPath)?JSON.parse(fs.readFileSync(prefsPath,'utf8')):{};
 // Credentials are tied to each distinct origin; changing bridges never reuses another bridge's token.
 const makeBridge=origin=>{
  const id=require('node:crypto').createHash('sha256').update(origin).digest('hex').slice(0,20);
  const legacyCredential=path.join(data,'connection.bin');
  const credentialPath=origin===DEFAULT_BRIDGE_ORIGIN&&fs.existsSync(legacyCredential)?legacyCredential:path.join(data,'connection-'+id+'.bin');
  return new BridgeClient({origin,credentialPath,safeStorage,store,openURL:url=>shell.openExternal(url),deviceName:require('node:os').hostname()});
 };
 const configuredOrigin=prefs.bridgeOrigin?validateBridgeOrigin(prefs.bridgeOrigin):DEFAULT_BRIDGE_ORIGIN;
 // The local app must always open even if remote bridge credentials are invalid.
 // Do not delete or reset credentials here: the user may need them later.
 try { bridge=makeBridge(configuredOrigin); bridge.start(); }
 catch (error) { console.warn('Optional AI connection is unavailable:', error.message); bridge=null; }
 if(!prefs.setupComplete){app.setLoginItemSettings({openAtLogin:true});fs.writeFileSync(prefsPath,JSON.stringify({...prefs,setupComplete:true}),{mode:0o600});}
 panel=new BrowserWindow({width:1040,height:760,minWidth:820,minHeight:620,title:'OmniMemory',backgroundColor:'#101b22',webPreferences:{preload:path.join(__dirname,'panel-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'File',submenu:[{label:'Open my data folder',click:()=>shell.openPath(data)},{label:'Exit',click:()=>app.quit()}]},{label:'Edit',submenu:[{label:'Undo',role:'undo'},{label:'Redo',role:'redo'},{type:'separator'},{label:'Cut',role:'cut'},{label:'Copy',role:'copy'},{label:'Paste',role:'paste'},{label:'Select All',role:'selectAll'}]},{label:'View',submenu:[{label:'Actual Size',role:'resetZoom'},{label:'Zoom In',role:'zoomIn'},{label:'Zoom Out',role:'zoomOut'},{label:'Toggle Full Screen',role:'togglefullscreen'}]}]));
 panel.loadFile(path.join(__dirname,'index.html'));
 panel.webContents.setWindowOpenHandler(()=>({action:'deny'}));panel.webContents.on('will-navigate',e=>e.preventDefault());
 const assertPanel=e=>{if(e.sender!==panel.webContents)throw Error('Unauthorized sender.');};
 ipcMain.handle('omni:recovery-export',async(e,password)=>{
  assertPanel(e);if(!deviceVault.secret)throw Error('Legacy plaintext mode has no device recovery key.');
  if(typeof password!=='string'||password.length<16)throw Error('Use a recovery password of at least 16 characters.');
  const chosen=await dialog.showSaveDialog(panel,{title:'Save encrypted recovery kit',defaultPath:'OmniMemory-recovery.omnikey',filters:[{name:'OmniMemory encrypted key',extensions:['omnikey']} ]});
  if(chosen.canceled)return {cancelled:true};
  const {makeRecovery}=require('./recovery-vault.cjs');
  fs.writeFileSync(chosen.filePath,makeRecovery(deviceVault.secret,password),{flag:'wx',mode:0o600});
  return {ok:true};
 });
 ipcMain.handle('omni:status',e=>{assertPanel(e);return {...store.stats(),autoStart:app.getLoginItemSettings().openAtLogin,connection:bridge?.status??'unconfigured',bridgeOrigin:bridge?.origin??'',approvalCode:bridge?.status==='awaiting_approval'?bridge.credentials?.code:null,task:{...taskState,running:taskRunning},encryptionMode:deviceVault.mode,version:app.getVersion()};});
 ipcMain.handle('omni:add-files',async e=>{
  assertPanel(e);if(taskRunning)throw Error('Wait for the current task to finish or click Stop.');
  const choice=await dialog.showOpenDialog(panel,{title:'Add my files',properties:['openFile','multiSelections'],filters:[{name:'Documents, ZIP, WhatsApp and media',extensions:['zip','opus','ogg','mp3','m4a','wav','aac','flac','amr','mp4','mov','mkv','webm','3gp','avi','png','jpg','jpeg','webp','bmp','tif','tiff','pdf','docx','txt','md','markdown','json','jsonl','csv','log','html','htm','xml','yaml','yml','ts','tsx','js','jsx','py','rs','sol','cs','java','sql']}]});
  if(choice.canceled)return {started:false};if(choice.filePaths.length>200)throw Error('Select up to 200 files at a time.');if(taskRunning)throw Error('Another task is already running.');
  taskRunning=true;taskCancelled=false;taskState={phase:'starting',total:choice.filePaths.length};
  const mediaProcessor=activeMedia=createMediaProcessor({runtime:app.isPackaged?path.join(process.resourcesPath,'media-runtime'):path.join(__dirname,'..','media-runtime'),cacheDir:path.join(data,'ocr-cache')});
  taskPromise=importFiles(store,path.join(data,'files','local'),choice.filePaths,{mediaProcessor,onProgress:s=>{taskState=s;},isCancelled:()=>taskCancelled}).catch(e=>{taskState={...taskState,phase:'error',error:e.message};}).finally(async()=>{await mediaProcessor.close();activeMedia=null;taskRunning=false;});return {started:true};
 });
 ipcMain.handle('omni:cancel',e=>{assertPanel(e);taskCancelled=true;return {ok:true};});
 ipcMain.handle('omni:files',e=>{assertPanel(e);return [...store.sources.values()].filter(s=>s.kind==='file').sort((a,b)=>b.updated_at.localeCompare(a.updated_at)||b.id-a.id).map(s=>({uid:s.uid,filename:s.filename,revision:s.revision,index_mode:s.index_mode,size:s.size}));});
 ipcMain.handle('omni:conversations',e=>{assertPanel(e);return [...store.tables.conversations.values()].map(c=>({id:c.id,title:(c.title??c.url??c.id).replace(/^Conversa sem título /,'Untitled conversation '),messages:[...(store.byConversation.get(c.id)??[])].filter(uid=>store.sources.get(uid)?.kind==='chat').length})).filter(c=>c.messages>0);});
 ipcMain.handle('omni:delete',async(e,targets)=>{
  assertPanel(e);if(taskRunning)throw Error('Stop the import and wait for it to finish before deleting.');
  const summary=deletionSummary(planDeletion(store,targets));
  const answer=await dialog.showMessageBox(panel,{type:'warning',title:'Delete from memory',message:'Permanently delete the selected items?',detail:`This removes ${summary.files} files, ${summary.conversations} conversations and ${summary.messages} messages from local memory and search. ${summary.sharedPreserved} shared attachments will be preserved. ZIP containers holding deleted items will also be removed; their other extracted entries remain. Originals outside OmniMemory will not be changed. Recapture of deleted records will be blocked. This cannot be undone.`,buttons:['Cancel','Delete permanently'],defaultId:0,cancelId:0,noLink:true});
  if(answer.response!==1)return {cancelled:true};if(taskRunning)throw Error('Wait for the import to finish.');
  return deleteMemory(store,path.join(data,'files'),targets);
 });
 ipcMain.handle('omni:show-file',(e,uid)=>{assertPanel(e);const s=store.sources.get(uid);if(s?.kind!=='file'||!s.saved_path)throw Error('File unavailable.');const rel=path.relative(path.join(data,'files'),s.saved_path);if(rel.startsWith('..')||path.isAbsolute(rel))throw Error('File is outside local memory.');shell.showItemInFolder(s.saved_path);return {ok:true};});
 ipcMain.handle('omni:bridge-configure',(e,origin)=>{
  assertPanel(e);
  const normalized=validateBridgeOrigin(origin);
  if(bridge?.credentials)throw Error('Disconnect the existing bridge before changing the address.');
  bridge?.stop();bridge=makeBridge(normalized);bridge.start();
  fs.writeFileSync(prefsPath,JSON.stringify({...prefs,bridgeOrigin:normalized}),{mode:0o600});
  return {ok:true,origin:normalized};
 });
 ipcMain.handle('omni:connect',e=>{assertPanel(e);if(!bridge)throw Error('Configure your own HTTPS bridge first.');return bridge.connect();});
 ipcMain.handle('omni:disconnect',e=>{assertPanel(e);if(!bridge)return {ok:true};return bridge.disconnect();});
 ipcMain.handle('omni:startup',(e,enabled)=>{assertPanel(e);app.setLoginItemSettings({openAtLogin:enabled===true});return app.getLoginItemSettings().openAtLogin;});
 ipcMain.handle('omni:folder',e=>{assertPanel(e);return shell.openPath(data);});
 ipcMain.handle('omni:search',(e,q)=>{assertPanel(e);if(typeof q!=='string'||!q.trim()||q.length>2000)throw Error('Enter your search terms (up to 2,000 characters).');return store.search(q,{top_k:5});});
 ipcMain.handle('omni:source',(e,uid,revision)=>{assertPanel(e);if(typeof uid!=='string'||uid.length>128)throw Error('Invalid source.');return store.source(uid,{limit:24000,revision});});
 const icon=nativeImage.createFromPath(path.join(__dirname,'assets','icon.png')).resize({width:16,height:16});
 tray=new Tray(icon);tray.setToolTip('OmniMemory');tray.setContextMenu(Menu.buildFromTemplate([{label:'Open OmniMemory',click:()=>{panel.show();panel.focus();}},{label:'Exit',click:()=>app.quit()}]));tray.on('double-click',()=>panel.show());
 panel.on('close',e=>{if(!closing){e.preventDefault();panel.hide();}});
 panel.on('query-session-end',e=>{if(taskRunning){taskCancelled=true;e.preventDefault();requestUpdateExit();}});
 panel.on('session-end',()=>{requestUpdateExit();});
 app.on('before-quit',()=>{if(closing)return;closing=true;taskCancelled=true;activeMedia?.stop();bridge?.stop();server.close();store.close();tray.destroy();});
}
app.on('window-all-closed',()=>{});

async function requestDeviceRecovery({data,reason,importFile}){
 const journalPath=path.join(data,'omnimemory.jsonl'),keyPath=path.join(data,'memory-device-key.bin');
 if(!fs.existsSync(journalPath))return false;
 let selected=null;const win=new BrowserWindow({width:600,height:400,title:'Recover OmniMemory',webPreferences:{preload:path.join(__dirname,'recovery-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 win.loadFile(path.join(__dirname,'recovery.html'));
 const sender=e=>{if(e.sender!==win.webContents)throw Error('Unauthorized recovery request.');};
 ipcMain.handle('omni:recovery-select',async e=>{sender(e);const choice=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'Recovery kit',extensions:['omnikey']}]});selected=choice.canceled?null:choice.filePaths[0];return {selected:!!selected};});
 let done;
 const result=new Promise(resolve=>{done=resolve;win.on('closed',()=>resolve(false));});
 ipcMain.handle('omni:recovery-import',async(e,password)=>{
  sender(e);if(!selected)throw Error('Select a recovery kit.');
  if(fs.existsSync(keyPath))throw Error('Existing device key must be backed up and removed manually before restoration.');
  const {openRecovery}=require('./recovery-vault.cjs');
  const secret=openRecovery(fs.readFileSync(selected,'utf8'),password);
  const {Journal}=await importFile('../core/lib/journal.js');
  const old=process.env.OMNI_MEMORY_PASSPHRASE;process.env.OMNI_MEMORY_PASSPHRASE=secret;
  try{const journal=new Journal(journalPath,{readOnly:true});try{journal.load(()=>{});}finally{journal.close();}}
  finally{if(old===undefined)delete process.env.OMNI_MEMORY_PASSPHRASE;else process.env.OMNI_MEMORY_PASSPHRASE=old;}
  const blob=safeStorage.encryptString(secret),tmp=keyPath+'.restoring';
  try{fs.writeFileSync(tmp,blob,{flag:'wx',mode:0o600});fs.renameSync(tmp,keyPath);}finally{fs.rmSync(tmp,{force:true});}
  done(true);win.close();return {ok:true};
 });
 try{return await result;}finally{ipcMain.removeHandler('omni:recovery-select');ipcMain.removeHandler('omni:recovery-import');if(!win.isDestroyed())win.close();}
}
