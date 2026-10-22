const $=id=>document.getElementById(id);
const labels={disconnected:'Desconectado — acesso pelo túnel interrompido.',starting:'Cliente iniciado — aguardando confirmação da OpenAI.',connected:'Conectado — a OpenAI aceitou as consultas do cliente.',unauthorized:'401/403 — a chave ou suas permissões foram recusadas pela OpenAI.',offline:'Sem comunicação confirmada com a OpenAI.',configuration_error:'Não foi possível carregar ou iniciar a configuração. Informe a chave novamente.'};
async function refresh(){try{const s=await window.omniTunnel.status();$('status').textContent=labels[s.state]??s.state;$('status').dataset.state=s.state;if(!$('tunnel').value&&s.tunnelId)$('tunnel').value=s.tunnelId;}catch{$('status').textContent='Não foi possível consultar o estado do Desktop.';}}
$('setup').addEventListener('submit',async e=>{e.preventDefault();$('connect').disabled=true;$('message').textContent='';
  try{await window.omniTunnel.save({tunnelId:$('tunnel').value.trim(),apiKey:$('key').value.trim()});$('message').textContent='Configuração salva. Confira o estado da conexão acima.';}
  catch(error){$('message').textContent=error.message;}
  finally{$('key').value='';$('connect').disabled=false;await refresh();}
});
$('disconnect').addEventListener('click',async()=>{try{await window.omniTunnel.disconnect();$('key').value='';$('consent').checked=false;$('message').textContent='A leitura pelo túnel foi interrompida e a credencial local removida.';}catch(error){$('message').textContent=error.message;}await refresh();});
void refresh();setInterval(refresh,2500);
