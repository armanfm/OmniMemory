async function refresh(){
 const {capture_status={},observation={},outbox={}}=await chrome.storage.local.get(['capture_status','observation','outbox']);
 document.getElementById('status').textContent=`Visíveis na última observação: ${observation.visible_messages??0}\nNa fila de envio: ${Object.keys(outbox).length}\nÚltimo envio: ${capture_status.last_success?new Date(capture_status.last_success).toLocaleString():'Ainda não confirmado'}\n${capture_status.last_error?'Falha: '+capture_status.last_error:''}`;
}
document.getElementById('retry').addEventListener('click',async()=>{await chrome.runtime.sendMessage({type:'OMNI_RETRY'});await refresh();});
void refresh();
