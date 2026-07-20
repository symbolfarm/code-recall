import * as vscode from "vscode";
import { CodeGraph } from "./model";

export function showGraph(graph: CodeGraph): void {
  const panel = vscode.window.createWebviewPanel(
    "codeRecall.graph",
    "Code Recall Graph",
    vscode.ViewColumn.Beside,
    { enableScripts: true },
  );
  panel.webview.html = graphHtml(graph);
  panel.webview.onDidReceiveMessage(async (message: { type: string; file?: string; line?: number }) => {
    if (message.type === "open" && message.file) {
      const document = await vscode.workspace.openTextDocument(message.file);
      const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
      const line = Math.max(0, (message.line ?? 1) - 1);
      editor.selection = new vscode.Selection(line, 0, line, 0);
      editor.revealRange(new vscode.Range(line, 0, line, 0));
    }
  });
}

function graphHtml(graph: CodeGraph): string {
  const files = graph.nodes.filter((node) => node.kind === "file");
  const fileIds = new Set(files.map((node) => node.id));
  const imports = graph.edges.filter((edge) => edge.kind === "imports" && fileIds.has(edge.from) && fileIds.has(edge.to));
  const payload = JSON.stringify({ files, imports }).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<style>
body{margin:0;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-family:var(--vscode-font-family)}
header{display:flex;gap:12px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--vscode-panel-border);position:sticky;top:0;background:var(--vscode-editor-background);z-index:2}
button{color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:0;padding:6px 10px;cursor:pointer}
#status{opacity:.75}.board{position:relative;min-height:700px;padding:24px}.node{position:absolute;width:170px;min-height:48px;padding:9px;border:1px solid var(--vscode-focusBorder);background:var(--vscode-sideBar-background);cursor:pointer;border-radius:5px;box-sizing:border-box;z-index:1}.node:hover{outline:2px solid var(--vscode-focusBorder)}
.kind{font-size:11px;opacity:.65}.label{overflow-wrap:anywhere;margin-top:4px}.masked .label{filter:blur(6px);user-select:none}.masked.revealed .label{filter:none}.edge{position:absolute;height:1px;background:var(--vscode-descriptionForeground);transform-origin:0 0;opacity:.45}
</style></head><body>
<header><button id="mode">Start recall mode</button><span id="status">${files.length} files · ${imports.length} local imports</span></header>
<main class="board" id="board"></main>
<script>
const vscode=acquireVsCodeApi(); const data=${payload}; const board=document.getElementById('board'); let recall=false;
const positions=new Map(); const columns=Math.max(1,Math.ceil(Math.sqrt(data.files.length)));
data.files.forEach((file,index)=>positions.set(file.id,{x:24+(index%columns)*215,y:24+Math.floor(index/columns)*105}));
for(const edge of data.imports){const a=positions.get(edge.from),b=positions.get(edge.to);if(!a||!b)continue;const x=a.x+85,y=a.y+26,dx=b.x+85-x,dy=b.y+26-y;const line=document.createElement('div');line.className='edge';line.style.left=x+'px';line.style.top=y+'px';line.style.width=Math.hypot(dx,dy)+'px';line.style.transform='rotate('+Math.atan2(dy,dx)+'rad)';board.appendChild(line)}
for(const file of data.files){const p=positions.get(file.id),el=document.createElement('div');el.className='node';el.style.left=p.x+'px';el.style.top=p.y+'px';el.innerHTML='<div class="kind">file</div><div class="label"></div>';el.querySelector('.label').textContent=file.name;el.onclick=()=>{if(recall&&!el.classList.contains('revealed')){el.classList.add('revealed');document.getElementById('status').textContent='Revealed: '+file.name+' — click again to open';return}vscode.postMessage({type:'open',file:file.location.file,line:file.location.line})};board.appendChild(el)}
document.getElementById('mode').onclick=(event)=>{recall=!recall;document.querySelectorAll('.node').forEach(node=>{node.classList.toggle('masked',recall);node.classList.remove('revealed')});event.target.textContent=recall?'Exit recall mode':'Start recall mode';document.getElementById('status').textContent=recall?'Name each file from its graph position and links, then click to reveal.':data.files.length+' files · '+data.imports.length+' local imports'};
</script></body></html>`;
}
