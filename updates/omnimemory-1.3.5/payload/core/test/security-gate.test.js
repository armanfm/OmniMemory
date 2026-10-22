import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const server=readFileSync(new URL('../server.js',import.meta.url),'utf8');
test('MCP authentication precedes invocation of the MCP transport',()=>{
 const start=server.indexOf("if(url.pathname==='/mcp')");
 const auth=server.indexOf('if(!readAuthorized(req))',start);
 const invoke=server.indexOf('transport.handleRequest(req,res)',start);
 assert.ok(start>=0&&auth>start&&invoke>auth);
});
test('MCP browser origins have explicit allowlist rather than wildcard CORS',()=>{
 assert.match(server,/originAllowed\(req\)/);
 assert.match(server,/OMNI_MCP_ALLOWED_ORIGINS/);
 assert.doesNotMatch(server,/Access-Control-Allow-Origin'\s*:\s*'\*'/);
});
