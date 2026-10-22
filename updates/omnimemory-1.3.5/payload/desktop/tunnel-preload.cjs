const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('omniTunnel',{
  status:()=>ipcRenderer.invoke('omni:tunnel-status'),
  save:value=>ipcRenderer.invoke('omni:tunnel-save',value),
  disconnect:()=>ipcRenderer.invoke('omni:tunnel-disconnect')
});
