const {BrowserWindow,ipcMain}=require('electron');
const path=require('node:path');
module.exports=function createTunnelWindow({parent,client}){
  let win;
  const assertSender=e=>{if(!win||win.isDestroyed()||e.sender!==win.webContents||e.senderFrame!==win.webContents.mainFrame)throw Error('Unauthorized sender.');};
  ipcMain.handle('omni:tunnel-status',e=>{assertSender(e);return client.status();});
  ipcMain.handle('omni:tunnel-save',async(e,value)=>{assertSender(e);await client.start(value);return client.status();});
  ipcMain.handle('omni:tunnel-disconnect',e=>{assertSender(e);return client.disconnect();});
  const open=()=>{
    if(win&&!win.isDestroyed()){win.show();win.focus();return;}
    win=new BrowserWindow({parent,width:740,height:740,minWidth:620,minHeight:640,title:'OmniMemory — ChatGPT por tunel',backgroundColor:'#101b22',webPreferences:{preload:path.join(__dirname,'tunnel-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
    win.loadFile(path.join(__dirname,'tunnel.html'));win.on('closed',()=>{win=null;});
  };
  return {open};
};
