/* Advanced Text Editor
   - Doubly Linked List document model (LineNode, LineList)
   - Undo/Redo stacks with operation objects
   - Trie: autocomplete + spell-check underline
   - Line numbers, counts, dark/light, find/replace, autosave, download/print
*/

/* ------------------------------
   Mini dictionary for demo (extend as needed)
--------------------------------*/
const DICTIONARY = [
  "the","this","that","text","editor","autocomplete","undo","redo","javascript","function",
  "line","insert","delete","cursor","stack","trie","node","data","structure","project",
  "code","compile","run","hello","world","example","typing","suggest","suggestion","professor",
  "komal","bank","loan","model","personal","appointment","list","replace","find","print","download",
  "count","words","characters","dark","light","theme","save","local","storage","linked","double",
  "doubly","class","split","join","enter","backspace","arrow","up","down","left","right"
];

/* ------------------------------
   Trie
--------------------------------*/
class TrieNode { constructor(){ this.children=Object.create(null); this.isEnd=false; } }
class Trie {
  constructor(){ this.root=new TrieNode(); }
  insert(word){ let n=this.root; for(const ch of word.toLowerCase()){ if(!n.children[ch]) n.children[ch]=new TrieNode(); n=n.children[ch]; } n.isEnd=true; }
  contains(word){ let n=this.root; for(const ch of word.toLowerCase()){ if(!n.children[ch]) return false; n=n.children[ch]; } return n.isEnd; }
  _collect(node, pref, out){ if(!node) return; if(node.isEnd) out.push(pref); for(const k of Object.keys(node.children)) this._collect(node.children[k], pref+k, out); }
  autocomplete(prefix, limit=8){
    let n=this.root; for(const ch of prefix.toLowerCase()){ if(!n.children[ch]) return []; n=n.children[ch]; }
    const res=[]; this._collect(n, prefix.toLowerCase(), res); return res.slice(0,limit);
  }
}
const trie = new Trie(); DICTIONARY.forEach(w=>trie.insert(w));

/* ------------------------------
   Doubly Linked List for lines
--------------------------------*/
class LineNode { constructor(text=""){ this.text=text; this.prev=null; this.next=null; } }
class LineList {
  constructor(){
    this.head = new LineNode("");
    this.tail = this.head; this.size = 1;
  }
  insertAfter(node, newNode){
    newNode.prev=node; newNode.next=node.next;
    if(node.next) node.next.prev=newNode;
    node.next=newNode;
    if(this.tail===node) this.tail=newNode;
    this.size++;
  }
  deleteNode(node){
    if(!node) return;
    if(node.prev) node.prev.next=node.next;
    if(node.next) node.next.prev=node.prev;
    if(node===this.head) this.head=node.next || new LineNode("");
    if(node===this.tail && node.prev) this.tail=node.prev;
    this.size=Math.max(1, this.size-1);
  }
  toArray(){ const arr=[]; let n=this.head; while(n){ arr.push(n.text); n=n.next; } return arr; }
}

/* ------------------------------
   DOM refs
--------------------------------*/
const bodyEl        = document.body;
const editorEl      = document.getElementById("editor");
const gutterEl      = document.getElementById("gutter");
const suggestionsEl = document.getElementById("suggestions");

const undoBtn   = document.getElementById("undoBtn");
const redoBtn   = document.getElementById("redoBtn");
const saveBtn   = document.getElementById("saveBtn");
const printBtn  = document.getElementById("printBtn");
const clearBtn  = document.getElementById("clearBtn");
const themeBtn  = document.getElementById("themeBtn");

const findToggle    = document.getElementById("findToggle");
const findPanel     = document.getElementById("findPanel");
const findInput     = document.getElementById("findInput");
const replaceInput  = document.getElementById("replaceInput");
const findNextBtn   = document.getElementById("findNextBtn");
const replaceBtn    = document.getElementById("replaceBtn");
const replaceAllBtn = document.getElementById("replaceAllBtn");

const posEl = document.getElementById("pos");
const wcEl  = document.getElementById("wc");
const ccEl  = document.getElementById("cc");
const autosaveEl = document.getElementById("autosave");

/* ------------------------------
   Editor state
--------------------------------*/
let lines = new LineList();
let curNode = lines.head;
let cursorIndex = 0;

let undoStack = [];
let redoStack = [];

const STORAGE_KEY = "te_text_v2";
let findIndexCache = null; // for find-next line/col tracking

/* ------------------------------
   Utilities
--------------------------------*/
const escapeHtml = (s)=> s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const splitTokens = (s)=> s.match(/(\w+|[^\w]+)/g) || [""];

/* ------------------------------
   Undo/Redo push & buttons
--------------------------------*/
function pushUndo(op){ undoStack.push(op); redoStack=[]; updateButtons(); }
function updateButtons(){
  undoBtn.disabled = undoStack.length===0;
  redoBtn.disabled = redoStack.length===0;
}

/* ------------------------------
   Render gutter + content + caret + counters
--------------------------------*/
function render(){
  // Build gutter
  let ghtml = "";
  let n = lines.head, i = 1;
  while(n){ ghtml += `<div class="ln">${i}</div>`; n=n.next; i++; }
  gutterEl.innerHTML = ghtml;

  // Build content (with misspell underlines)
  let chtml = "";
  n = lines.head;
  while(n){
    const tokens = splitTokens(n.text).map(tok => {
      if (/\w+/.test(tok) && !trie.contains(tok)) return `<span class="miss">${escapeHtml(tok)}</span>`;
      return escapeHtml(tok);
    });
    chtml += `<div class="line" data-id="${lineId(n)}">${tokens.join("")}</div>`;
    n = n.next;
  }
  editorEl.innerHTML = chtml;

  // Place caret
  placeCaret();

  // Update counters + status
  updateCounts();
  updateStatus();
  scheduleAutosave();
}

/* stable id by walk */
function lineId(node){ let idx=0, p=lines.head; while(p && p!==node){ p=p.next; idx++; } return "L"+idx; }

/* Insert caret by reconstructing the current line HTML portion */
function placeCaret(){
  const lineDiv = editorEl.querySelector(`[data-id="${lineId(curNode)}"]`);
  if(!lineDiv) return;
  const left = curNode.text.slice(0, cursorIndex);
  const right = curNode.text.slice(cursorIndex);
  lineDiv.innerHTML = escapeHtml(left) + `<span class="caret" id="__caret__"></span>` + escapeHtml(right);
  // selection to after caret
  const range = document.createRange();
  const caret = document.getElementById("__caret__");
  if(!caret) return;
  range.setStartAfter(caret); range.collapse(true);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
}

/* Counters */
function updateCounts(){
  const text = lines.toArray().join("\n");
  const words = (text.match(/\b\w+\b/g) || []).length;
  wcEl.textContent = `Words: ${words}`;
  ccEl.textContent = `Chars: ${text.length}`;
}
function updateStatus(){
  // compute current line/column numbers
  let row = 1, n = lines.head;
  while(n && n!==curNode){ row++; n=n.next; }
  const col = cursorIndex + 1;
  posEl.textContent = `Ln ${row}, Col ${col}`;
}

/* ------------------------------
   Movement
--------------------------------*/
function moveLeft(){
  if (cursorIndex>0){ cursorIndex--; }
  else if (curNode.prev){ curNode=curNode.prev; cursorIndex=curNode.text.length; }
  render();
}
function moveRight(){
  if (cursorIndex<curNode.text.length){ cursorIndex++; }
  else if (curNode.next){ curNode=curNode.next; cursorIndex=0; }
  render();
}
function moveUp(){
  if (!curNode.prev) return;
  const col = cursorIndex;
  curNode=curNode.prev; cursorIndex=Math.min(col, curNode.text.length);
  render();
}
function moveDown(){
  if (!curNode.next) return;
  const col = cursorIndex;
  curNode=curNode.next; cursorIndex=Math.min(col, curNode.text.length);
  render();
}

/* ------------------------------
   Edits
--------------------------------*/
function insertChar(ch){
  const before = curNode.text;
  curNode.text = before.slice(0, cursorIndex) + ch + before.slice(cursorIndex);
  pushUndo({type:"insert", node:curNode, index:cursorIndex, text:ch});
  cursorIndex += ch.length;
  render(); showSuggestions();
}
function backspace(){
  if (cursorIndex>0){
    const before = curNode.text;
    const removed = before[cursorIndex-1];
    curNode.text = before.slice(0, cursorIndex-1) + before.slice(cursorIndex);
    pushUndo({type:"del", node:curNode, index:cursorIndex-1, text:removed});
    cursorIndex--;
    render();
  } else if (curNode.prev){
    // join with previous
    const prev=curNode.prev, oldPrev=prev.text, oldCur=curNode.text, joinAt=prev.text.length;
    pushUndo({type:"join", prev, cur:curNode, oldPrev, oldCur, joinAt});
    prev.text = prev.text + curNode.text;
    lines.deleteNode(curNode);
    curNode = prev; cursorIndex = joinAt;
    render();
  }
}
function newline(){
  const left = curNode.text.slice(0, cursorIndex);
  const right = curNode.text.slice(cursorIndex);
  const newNode = new LineNode(right);
  pushUndo({type:"split", node:curNode, oldText:curNode.text, index:cursorIndex});
  curNode.text = left;
  lines.insertAfter(curNode, newNode);
  curNode = newNode; cursorIndex=0;
  render();
}

/* Undo / Redo */
function undo(){
  if(!undoStack.length) return;
  const op = undoStack.pop(); redoStack.push(op);
  if(op.type==="insert"){
    op.node.text = op.node.text.slice(0, op.index) + op.node.text.slice(op.index + op.text.length);
    curNode=op.node; cursorIndex=op.index;
  } else if(op.type==="del"){
    op.node.text = op.node.text.slice(0, op.index) + op.text + op.node.text.slice(op.index);
    curNode=op.node; cursorIndex=op.index+1;
  } else if(op.type==="split"){
    const node = op.node, next=node.next;
    if(next){ node.text = op.oldText; lines.deleteNode(next); curNode=node; cursorIndex=op.index; }
  } else if(op.type==="join"){
    const {prev, cur, oldPrev, oldCur, joinAt} = op;
    // restore separate lines
    const restored = new LineNode(oldCur);
    restored.next = prev.next; if(prev.next) prev.next.prev = restored;
    prev.next = restored; restored.prev = prev;
    if(lines.tail===prev) lines.tail = restored;
    prev.text = oldPrev;
    curNode = restored; cursorIndex = 0;
  }
  updateButtons(); render();
}
function redo(){
  if(!redoStack.length) return;
  const op = redoStack.pop(); undoStack.push(op);
  if(op.type==="insert"){
    op.node.text = op.node.text.slice(0, op.index) + op.text + op.node.text.slice(op.index);
    curNode=op.node; cursorIndex=op.index+op.text.length;
  } else if(op.type==="del"){
    op.node.text = op.node.text.slice(0, op.index) + op.node.text.slice(op.index + op.text.length);
    curNode=op.node; cursorIndex=op.index;
  } else if(op.type==="split"){
    const node = op.node;
    const right = node.text.slice(op.index);
    const newNode = new LineNode(right);
    node.text = node.text.slice(0, op.index);
    lines.insertAfter(node, newNode);
    curNode=newNode; cursorIndex=0;
  } else if(op.type==="join"){
    const prev = op.prev, cur = prev.next;
    if(cur){ prev.text = prev.text + cur.text; lines.deleteNode(cur); curNode=prev; cursorIndex=op.joinAt; }
  }
  updateButtons(); render();
}

/* ------------------------------
   Suggestions (Trie)
--------------------------------*/
function currentWordBeforeCursor(){
  const left = curNode.text.slice(0, cursorIndex);
  const m = left.match(/(\w+)$/);
  return m ? m[1] : "";
}
let suggestionIndex = -1;
function showSuggestions(){
  const word = currentWordBeforeCursor();
  if(!word){ hideSuggestions(); return; }
  const items = trie.autocomplete(word, 8);
  if(!items.length){ hideSuggestions(); return; }
  suggestionsEl.innerHTML = items.map((w,i)=> `<div class="item${i===0?' active':''}" data-v="${w}">${w}</div>`).join("");
  suggestionIndex = 0;
  // position dropdown just under editorWrap (simple placement)
  const wrapRect = document.querySelector('.editor-wrap').getBoundingClientRect();
  suggestionsEl.style.left = (wrapRect.left + 80) + "px";
  suggestionsEl.style.top  = (wrapRect.bottom - 4) + "px";
  suggestionsEl.classList.remove("hidden");
}
function hideSuggestions(){ suggestionsEl.classList.add("hidden"); suggestionIndex=-1; }
suggestionsEl.addEventListener("click", (e)=>{
  const el = e.target.closest(".item"); if(!el) return;
  applySuggestion(el.dataset.v);
});
function applySuggestion(word){
  const cur = curNode.text;
  const left = cur.slice(0, cursorIndex);
  const right = cur.slice(cursorIndex);
  const m = left.match(/(\w+)$/);
  const start = m ? (cursorIndex - m[1].length) : cursorIndex;
  curNode.text = cur.slice(0, start) + word + right;
  pushUndo({type:"insert", node:curNode, index:start, text:word});
  cursorIndex = start + word.length;
  hideSuggestions(); render();
}

/* Keyboard navigation inside suggestions */
function moveSuggestion(delta){
  if(suggestionsEl.classList.contains("hidden")) return;
  const items = [...suggestionsEl.querySelectorAll(".item")];
  if(!items.length) return;
  suggestionIndex = (suggestionIndex + delta + items.length) % items.length;
  items.forEach((el,i)=> el.classList.toggle("active", i===suggestionIndex));
}
function acceptSuggestion(){
  if(suggestionsEl.classList.contains("hidden")) return;
  const items = [...suggestionsEl.querySelectorAll(".item")];
  if(items[suggestionIndex]) applySuggestion(items[suggestionIndex].dataset.v);
}

/* ------------------------------
   Keyboard handling
--------------------------------*/
editorEl.addEventListener("keydown", (ev)=>{
  // Global combos
  if((ev.ctrlKey||ev.metaKey) && ev.key.toLowerCase()==='z'){ ev.preventDefault(); undo(); return; }
  if((ev.ctrlKey||ev.metaKey) && ev.key.toLowerCase()==='y'){ ev.preventDefault(); redo(); return; }
  if((ev.ctrlKey||ev.metaKey) && ev.key.toLowerCase()==='f'){ ev.preventDefault(); toggleFind(true); return; }

  switch(ev.key){
    case "ArrowLeft":   ev.preventDefault(); moveLeft(); break;
    case "ArrowRight":  ev.preventDefault(); moveRight(); break;
    case "ArrowUp":     if(!suggestionsEl.classList.contains("hidden")){ ev.preventDefault(); moveSuggestion(-1); } else { ev.preventDefault(); moveUp(); } break;
    case "ArrowDown":   if(!suggestionsEl.classList.contains("hidden")){ ev.preventDefault(); moveSuggestion(+1); } else { ev.preventDefault(); moveDown(); } break;
    case "Enter":       if(!suggestionsEl.classList.contains("hidden")){ ev.preventDefault(); acceptSuggestion(); } else { ev.preventDefault(); newline(); } break;
    case "Backspace":   ev.preventDefault(); backspace(); break;
    case "Escape":      hideSuggestions(); break;
    case "Tab":         ev.preventDefault(); insertChar("  "); break;
    default:
      if(ev.key.length===1 && !ev.ctrlKey && !ev.metaKey){
        ev.preventDefault();
        insertChar(ev.key);
      }
  }
});

/* Click to move caret approximately to position */
editorEl.addEventListener("click", (ev)=>{
  const rect = editorEl.getBoundingClientRect();
  const y = ev.clientY - rect.top;
  const lineHeight = 25; // approx for monospace 15px + padding
  const targetRow = Math.max(0, Math.floor(y / lineHeight));
  // map to node
  let n=lines.head, i=0; while(n && i<targetRow){ n=n.next; i++; }
  if(!n) n=lines.tail;
  curNode = n;
  // rough X -> index
  const avgChar = 8.5;
  const x = Math.max(0, ev.clientX - rect.left - 12);
  cursorIndex = Math.max(0, Math.min(curNode.text.length, Math.round(x/avgChar)));
  render();
});

/* ------------------------------
   Find & Replace
--------------------------------*/
function toggleFind(open){
  if(typeof open==="boolean"){
    findPanel.classList.toggle("hidden", !open);
  } else {
    findPanel.classList.toggle("hidden");
  }
  if(!findPanel.classList.contains("hidden")) findInput.focus();
}
findToggle.addEventListener("click", ()=> toggleFind());

findNextBtn.addEventListener("click", ()=>{
  const q = findInput.value;
  if(!q) return;
  // linear scan from current line/index
  let n = curNode, idx = cursorIndex;
  // search current line right
  let pos = n.text.indexOf(q, idx);
  if(pos !== -1){ curNode=n; cursorIndex=pos; render(); return; }
  // else next lines
  n = n.next;
  while(n){ pos = n.text.indexOf(q); if(pos!==-1){ curNode=n; cursorIndex=pos; render(); return; } n=n.next; }
  // wrap to start
  n = lines.head;
  while(n){ pos = n.text.indexOf(q); if(pos!==-1){ curNode=n; cursorIndex=pos; render(); return; } n=n.next; }
});

replaceBtn.addEventListener("click", ()=>{
  const q = findInput.value, r = replaceInput.value ?? "";
  if(!q) return;
  if(curNode.text.slice(cursorIndex, cursorIndex+q.length) === q){
    curNode.text = curNode.text.slice(0,cursorIndex) + r + curNode.text.slice(cursorIndex+q.length);
    pushUndo({type:"insert", node:curNode, index:cursorIndex, text:r}); // simple op record
    cursorIndex += r.length;
    render();
  } else {
    // find next then replace
    findNextBtn.click();
  }
});
replaceAllBtn.addEventListener("click", ()=>{
  const q = findInput.value, r = replaceInput.value ?? "";
  if(!q) return;
  let n = lines.head;
  while(n){
    if(n.text.includes(q)){
      n.text = n.text.split(q).join(r);
    }
    n = n.next;
  }
  render();
});

/* ------------------------------
   Saving / Printing / Clearing / Theme
--------------------------------*/
saveBtn.addEventListener("click", ()=>{
  const txt = lines.toArray().join("\n");
  const blob = new Blob([txt], {type:"text/plain"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "text_editor_output.txt";
  a.click();
});
printBtn.addEventListener("click", ()=> window.print());
clearBtn.addEventListener("click", ()=>{
  lines = new LineList(); curNode = lines.head; cursorIndex=0; undoStack=[]; redoStack=[]; render();
});
themeBtn.addEventListener("click", ()=>{
  const isDark = bodyEl.classList.contains("dark");
  bodyEl.classList.toggle("dark", !isDark);
  bodyEl.classList.toggle("light", isDark);
});

/* ------------------------------
   Autosave (localStorage)
--------------------------------*/
let autosaveTimer=null;
function scheduleAutosave(){
  if(autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(()=>{
    try{
      const txt = lines.toArray().join("\n");
      localStorage.setItem(STORAGE_KEY, JSON.stringify({txt}));
      autosaveEl.textContent = "Autosaved";
      setTimeout(()=> autosaveEl.textContent=" ", 1200);
    }catch(e){}
  }, 350);
}

/* ------------------------------
   Initialization: load from storage if exists
--------------------------------*/
function loadFromStorage(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return;
    const {txt} = JSON.parse(raw);
    if(typeof txt !== "string") return;
    // build lines
    lines = new LineList();
    const parts = txt.split("\n");
    lines.head.text = parts[0] ?? "";
    let cur = lines.head;
    for(let i=1;i<parts.length;i++){
      const n = new LineNode(parts[i]);
      lines.insertAfter(cur, n);
      cur = n;
    }
    curNode = lines.head; cursorIndex = 0;
  }catch(e){}
}

function init(){
  loadFromStorage();
  updateButtons();
  render();
  editorEl.focus();
}
init();
