/* Advanced Text Editor JS
 - Doubly linked list for lines (LineNode, LinkedList)
 - Undo/Redo with stacks (push operation objects)
 - Trie for suggestions/spell-check
 - Rendering: we re-render entire content from linked list to HTML (highlight misspellings)
 - Keyboard handling: printable chars, Enter, Backspace, Arrow keys
*/

/* -----------------------
   Simple dictionary (for demo)
   In real project, replace with larger list or load external file
------------------------*/
const DICTIONARY = [
  "the","this","that","text","editor","autocomplete","undo","redo","javascript","function",
  "line","insert","delete","cursor","stack","trie","node","data","structure","project",
  "code","compile","run","hello","world","example","typing","suggest","suggestion","professor",
  "nagar","komal","bank","loan","model","personal","appointment"
];

/* -----------------------
   Trie Implementation
------------------------*/
class TrieNode {
  constructor() {
    this.children = Object.create(null);
    this.isEnd = false;
  }
}
class Trie {
  constructor() { this.root = new TrieNode(); }
  insert(word){
    let n = this.root;
    for (const ch of word.toLowerCase()){
      if (!n.children[ch]) n.children[ch] = new TrieNode();
      n = n.children[ch];
    }
    n.isEnd = true;
  }
  _collect(node, prefix, arr){
    if (!node) return;
    if (node.isEnd) arr.push(prefix);
    for (const k of Object.keys(node.children)) this._collect(node.children[k], prefix + k, arr);
  }
  autocomplete(prefix, limit=8){
    let n = this.root;
    for (const ch of prefix.toLowerCase()){
      if (!n.children[ch]) return [];
      n = n.children[ch];
    }
    const results = [];
    this._collect(n, prefix.toLowerCase(), results);
    return results.slice(0, limit);
  }
  contains(word){
    let n = this.root;
    for (const ch of word.toLowerCase()){
      if (!n.children[ch]) return false;
      n = n.children[ch];
    }
    return n.isEnd;
  }
}

/* -----------------------
   Doubly linked list for lines
------------------------*/
class LineNode {
  constructor(text=""){
    this.text = text;
    this.next = null;
    this.prev = null;
  }
}
class LineList {
  constructor(){
    this.head = new LineNode("");
    this.tail = this.head;
    this.size = 1;
  }
  insertAfter(node, newNode){
    newNode.prev = node;
    newNode.next = node.next;
    if (node.next) node.next.prev = newNode;
    node.next = newNode;
    if (this.tail === node) this.tail = newNode;
    this.size++;
  }
  insertAtEnd(node){
    this.tail.next = node;
    node.prev = this.tail;
    this.tail = node;
    this.size++;
  }
  deleteNode(node){
    if (!node) return;
    if (node.prev) node.prev.next = node.next;
    if (node.next) node.next.prev = node.prev;
    if (node === this.head) this.head = node.next || new LineNode("");
    if (node === this.tail && node.prev) this.tail = node.prev;
    this.size = Math.max(1, this.size - 1);
  }
  toArray(){
    const arr = [];
    let n = this.head;
    while (n){
      arr.push(n.text);
      n = n.next;
    }
    return arr;
  }
}

/* -----------------------
   Editor State & Undo/Redo
------------------------*/
const editorEl = document.getElementById("editor");
const suggestionsEl = document.getElementById("suggestions");
const undoBtn = document.getElementById("undoBtn");
const redoBtn = document.getElementById("redoBtn");
const saveBtn = document.getElementById("saveBtn");

const trie = new Trie();
DICTIONARY.forEach(w => trie.insert(w));

let lines = new LineList();               // doubly linked list of lines
let curNode = lines.head;                 // current line node where cursor stands
let cursorIndex = 0;                      // index inside curNode.text (caret position)
let undoStack = [];                       // push operation objects {type, payload}
let redoStack = [];                       // for redo

/* push current snapshot op - used for simple undo (we store small diffs instead of full snapshots) */
function pushUndo(op){
  undoStack.push(op);
  redoStack = []; // clear redo on new edit
  updateButtons();
}
function updateButtons(){
  undoBtn.disabled = undoStack.length === 0;
  redoBtn.disabled = redoStack.length === 0;
}

/* -----------------------
   Render: build HTML from lines
   - highlight misspelled words with .miss
   - insert caret span at position
------------------------*/
function render(){
  // build DOM
  let html = "";
  let n = lines.head;
  while (n){
    // split words to allow miss highlight
    const words = splitWordsPreserve(n.text);
    const parts = [];
    for (const w of words){
      if (/\w+/.test(w) && !trie.contains(w)) {
        parts.push(`<span class="miss">${escapeHtml(w)}</span>`);
      } else {
        parts.push(escapeHtml(w));
      }
    }
    const lineHtml = parts.join("");
    // mark line container; we will insert caret when we find curNode
    html += `<div class="line" data-line-id="${lineId(n)}">${lineHtml}</div>`;
    n = n.next;
  }
  editorEl.innerHTML = html;

  // Now, insert caret span at the correct place in the DOM
  placeCaretDOM();
}

/* helper for stable id for nodes */
function lineId(node){
  // we use object reference index by walking from head
  let i = 0, n = lines.head;
  while (n && n !== node){ i++; n = n.next; }
  return "L"+i;
}

/* split preserving punctuation/spaces so rendered words keep spacing */
function splitWordsPreserve(s){
  // split into tokens: words or non-word sequences
  return s.match(/(\w+|[^\w]+)/g) || [""];
}
function escapeHtml(s){
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

/* place a blinking caret span at the cursorIndex inside the curNode line */
function placeCaretDOM(){
  // find the line div
  const id = lineId(curNode);
  const lineDiv = editorEl.querySelector(`[data-line-id="${id}"]`);
  if (!lineDiv){
    // fallback: append caret at end
    editorEl.focus();
    return;
  }

  // create caret span
  const caret = document.createElement("span");
  caret.className = "caret";
  caret.id = "__caret__";

  // Determine where to insert caret: we need to convert curNode.text and cursorIndex into text position among child nodes
  const fullText = curNode.text;
  const left = fullText.slice(0, cursorIndex);
  const right = fullText.slice(cursorIndex);

  // We will set lineDiv.innerHTML = escape(left) + caret + escape(right) but since lineDiv already contains spans for miss, rebuild
  // Simple approach: clear and set text nodes preserving miss spans lost — easiest is to set lineDiv.innerHTML directly using left+caret+right raw HTML (escaped)
  lineDiv.innerHTML = escapeHtml(left) + caret.outerHTML + escapeHtml(right);

  // Put selection (focus) on caret so caret appears
  setSelectionToCaret();
}

/* Put the real DOM selection around the caret element so user caret appears and keys go to document (we handle keys manually) */
function setSelectionToCaret(){
  const caret = document.getElementById("__caret__");
  if (!caret) return;
  const range = document.createRange();
  range.setStartAfter(caret); // position caret after the span
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  editorEl.focus();
}

/* -----------------------
   Cursor Movement Helpers
------------------------*/
function moveCursorLeft(){
  if (cursorIndex > 0){
    cursorIndex--;
  } else if (curNode.prev){
    curNode = curNode.prev;
    cursorIndex = curNode.text.length;
  }
  render();
}
function moveCursorRight(){
  if (cursorIndex < curNode.text.length){
    cursorIndex++;
  } else if (curNode.next){
    curNode = curNode.next;
    cursorIndex = 0;
  }
  render();
}
function moveCursorUp(){
  // move to previous line, keep similar column if possible
  if (curNode.prev){
    const col = cursorIndex;
    curNode = curNode.prev;
    cursorIndex = Math.min(col, curNode.text.length);
    render();
  }
}
function moveCursorDown(){
  if (curNode.next){
    const col = cursorIndex;
    curNode = curNode.next;
    cursorIndex = Math.min(col, curNode.text.length);
    render();
  }
}

/* -----------------------
   Editing Ops (we perform changes on lines list and record ops)
------------------------*/
function insertChar(ch){
  // insert character ch at cursorIndex in current line
  const before = curNode.text;
  curNode.text = before.slice(0, cursorIndex) + ch + before.slice(cursorIndex);
  const op = { type: "insert", ch: ch, node: curNode, index: cursorIndex };
  pushUndo(op);
  cursorIndex += ch.length;
  render();
}

function deleteBackward(){
  // Backspace behavior
  if (cursorIndex > 0){
    const before = curNode.text;
    const removed = before[cursorIndex-1];
    curNode.text = before.slice(0, cursorIndex-1) + before.slice(cursorIndex);
    const op = { type: "del", ch: removed, node: curNode, index: cursorIndex-1 };
    pushUndo(op);
    cursorIndex--;
    render();
  } else {
    // if at start of line and prev exists => join lines
    if (curNode.prev){
      const prev = curNode.prev;
      const oldPrevText = prev.text;
      const oldCurText = curNode.text;
      const prevLen = prev.text.length;
      // op include nodes and texts so undo can split again
      const op = { type: "join", prevNode: prev, curNode: curNode, prevText: oldPrevText, curText: oldCurText };
      pushUndo(op);
      // join text and delete curNode
      prev.text = prev.text + curNode.text;
      lines.deleteNode(curNode);
      curNode = prev;
      cursorIndex = prevLen;
      render();
    }
  }
}

function insertLineBreak(){
  // Split current line at cursorIndex into two nodes
  const before = curNode.text.slice(0, cursorIndex);
  const after = curNode.text.slice(cursorIndex);
  const newNode = new LineNode(after);
  const op = { type: "split", node: curNode, beforeText: curNode.text, newText: after, index: cursorIndex };
  pushUndo(op);
  curNode.text = before;
  lines.insertAfter(curNode, newNode);
  curNode = newNode;
  cursorIndex = 0;
  render();
}

/* Undo / Redo handling */
function undo(){
  if (undoStack.length === 0) return;
  const op = undoStack.pop();
  redoStack.push(op);
  // apply inverse
  if (op.type === "insert"){
    // remove inserted char
    const node = op.node;
    node.text = node.text.slice(0, op.index) + node.text.slice(op.index + op.ch.length);
    curNode = node;
    cursorIndex = op.index;
  } else if (op.type === "del"){
    // re-insert deleted char
    const node = op.node;
    node.text = node.text.slice(0, op.index) + op.ch + node.text.slice(op.index);
    curNode = node;
    cursorIndex = op.index + 1;
  } else if (op.type === "split"){
    // we had split node into node + newNode: so we must join back and restore text
    const node = op.node;
    const next = node.next;
    if (next){
      node.text = op.beforeText;
      lines.deleteNode(next);
      curNode = node;
      cursorIndex = op.index;
    }
  } else if (op.type === "join"){
    // we had joined prev & cur by removing cur; re-create cur node
    const prev = op.prevNode;
    const curText = op.curText;
    const restored = new LineNode(curText);
    // insert after prev
    if (prev.next) {
      // Insert between prev and prev.next
      restored.next = prev.next;
      prev.next.prev = restored;
    } else {
      lines.tail = restored;
    }
    prev.next = restored;
    restored.prev = prev;
    restored.next = op.prevNext || restored.next; // not necessary
    prev.text = op.prevText;
    curNode = restored;
    cursorIndex = 0;
  }
  updateButtons();
  render();
}

function redo(){
  if (redoStack.length === 0) return;
  const op = redoStack.pop();
  // reapply op (same as performing it originally)
  if (op.type === "insert"){
    op.node.text = op.node.text.slice(0, op.index) + op.ch + op.node.text.slice(op.index);
    curNode = op.node;
    cursorIndex = op.index + op.ch.length;
  } else if (op.type === "del"){
    op.node.text = op.node.text.slice(0, op.index) + op.node.text.slice(op.index + op.ch.length);
    curNode = op.node;
    cursorIndex = op.index;
  } else if (op.type === "split"){
    // split node again
    const node = op.node;
    const after = node.text.slice(op.index);
    const newNode = new LineNode(after);
    node.text = node.text.slice(0, op.index);
    lines.insertAfter(node, newNode);
    curNode = newNode;
    cursorIndex = 0;
  } else if (op.type === "join"){
    // join prev and cur again
    const prev = op.prevNode;
    const cur = prev.next;
    if (cur){
      prev.text = prev.text + cur.text;
      lines.deleteNode(cur);
      curNode = prev;
      cursorIndex = prev.text.length - (op.curText?op.curText.length:0);
    }
  }
  undoStack.push(op);
  updateButtons();
  render();
}
undoBtn.addEventListener("click", undo);
redoBtn.addEventListener("click", redo);

/* -----------------------
   Keyboard Handling
   We'll prevent default text insertion and do operations ourselves so model stays authoritative
------------------------*/
editorEl.addEventListener("keydown", (ev) => {
  // allow Ctrl/Meta combos for undo/redo native too
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
    ev.preventDefault();
    undo();
    return;
  }
  if ((ev.ctrlKey || ev.metaKey) && (ev.key.toLowerCase() === 'y')) {
    ev.preventDefault();
    redo();
    return;
  }

  switch(ev.key){
    case "ArrowLeft":
      ev.preventDefault();
      moveCursorLeft();
      break;
    case "ArrowRight":
      ev.preventDefault();
      moveCursorRight();
      break;
    case "ArrowUp":
      ev.preventDefault();
      moveCursorUp();
      break;
    case "ArrowDown":
      ev.preventDefault();
      moveCursorDown();
      break;
    case "Backspace":
      ev.preventDefault();
      deleteBackward();
      break;
    case "Enter":
      ev.preventDefault();
      insertLineBreak();
      break;
    case "Tab":
      ev.preventDefault();
      insertChar("  "); // two spaces
      break;
    default:
      // printable characters: simple check
      if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey){
        ev.preventDefault();
        insertChar(ev.key);
        showSuggestionsForCurrentWord();
      }
      break;
  }
});

/* click to set caret to clicked position (we compute approximate position by mapping click Y to line and X to char index) */
editorEl.addEventListener("click", (ev) => {
  // find clicked line and approximate index
  const rect = editorEl.getBoundingClientRect();
  const y = ev.clientY - rect.top;
  const lineHeight = 20; // approx; we could compute from font metrics
  const idx = Math.floor(y / lineHeight);
  // find line node at idx
  let n = lines.head; let i=0;
  while (n && i < idx){ n = n.next; i++; }
  if (!n) n = lines.tail;
  curNode = n;
  // approximate char index by measuring text width — fallback estimate: divide by avg char width
  const avgCharWidth = 8.8;
  const x = ev.clientX - rect.left - 8; // small padding
  const approxIndex = Math.max(0, Math.min(n.text.length, Math.round(x / avgCharWidth)));
  cursorIndex = approxIndex;
  render();
});

/* -----------------------
   Suggestions (autocomplete/spell)
------------------------*/
function getCurrentWord(){
  const text = curNode.text;
  // get characters before cursor until non-word
  const left = text.slice(0, cursorIndex);
  const m = left.match(/(\w+)$/);
  return m ? m[1] : "";
}
function showSuggestionsForCurrentWord(){
  const word = getCurrentWord();
  if (!word) { suggestionsEl.classList.add("hidden"); return; }
  const items = trie.autocomplete(word, 8);
  if (items.length === 0) {
    suggestionsEl.classList.add("hidden");
    return;
  }
  suggestionsEl.innerHTML = "";
  items.forEach(it => {
    const el = document.createElement("div");
    el.className = "item";
    el.textContent = it;
    el.onclick = () => applySuggestion(it);
    suggestionsEl.appendChild(el);
  });
  suggestionsEl.classList.remove("hidden");
}
function applySuggestion(word){
  // replace current word before cursor with word
  const cur = curNode.text;
  const left = cur.slice(0, cursorIndex);
  const right = cur.slice(cursorIndex);
  const m = left.match(/(\w+)$/);
  const start = m ? (cursorIndex - m[1].length) : cursorIndex;
  curNode.text = cur.slice(0, start) + word + right;
  cursorIndex = start + word.length;
  suggestionsEl.classList.add("hidden");
  pushUndo({ type:"insert", ch: word, node: curNode, index: start });
  render();
}

/* -----------------------
   Utilities: escape, save
------------------------*/
function escapeHtmlForText(s){
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;");
}

/* download file */
saveBtn.addEventListener("click", () => {
  const arr = lines.toArray();
  const txt = arr.join("\n");
  const blob = new Blob([txt], {type: "text/plain"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "text_editor_output.txt";
  a.click();
});

/* small helper: if user clicks outside suggestions, hide */
document.addEventListener("click", (ev) => {
  if (!suggestionsEl.contains(ev.target) && !editorEl.contains(ev.target)) suggestionsEl.classList.add("hidden");
});

/* -----------------------
   Initialization
------------------------*/
function init(){
  // seed lines with one empty line
  lines = new LineList();
  curNode = lines.head;
  cursorIndex = 0;
  undoStack = [];
  redoStack = [];
  updateButtons();
  render();
  // focus editor for keyboard
  editorEl.focus();
}
init();
