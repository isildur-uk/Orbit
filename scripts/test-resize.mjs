/* Sidebar resize test: the drag handle spans the full left column (not just the
 * short identity row), dragging changes the column width, and double-click resets. */
import puppeteer from "puppeteer-core";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const URL = "http://127.0.0.1:4173/index.html?orbittest=1";
const id = (n) => "E:person|" + n.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function seed(){const names=["Alex Morgan","Priya Patel","Tom Baker"];const ents=names.map(n=>{const e=id(n);return{id:e,type:"person",label:n,identity:n,contribs:["ent:"+e],attrs:{entityKind:"individual"},source:"manual",createdBy:"personal-network",ts:1};});return{schema:"orbit.case.v1",name:"D",updated:1,entities:ents,links:[]};}
async function run(){
  const b=await puppeteer.launch({executablePath:CHROME,headless:"new",args:["--no-sandbox"]});
  const p=await b.newPage();
  await p.setRequestInterception(true);
  p.on("request",r=>{if(/supabase-config\.js/.test(r.url()))r.respond({status:200,contentType:"text/javascript",body:"window.ORBIT_SUPABASE_CONFIG={};"});else r.continue();});
  await p.evaluateOnNewDocument((cj)=>{const m=new Map();const s={getItem:k=>m.has(String(k))?m.get(String(k)):null,setItem:(k,v)=>m.set(String(k),String(v)),removeItem:k=>m.delete(String(k)),clear:()=>m.clear(),key:i=>[...m.keys()][i]??null,get length(){return m.size;}};Object.defineProperty(window,"localStorage",{value:s,configurable:true});const iso="2026-08-01T12:00:00.000Z";localStorage.setItem("orbit_local_accounts_v1",JSON.stringify([{id:"acct_demo",name:"Ben",email:"b@e.com",profile:{},salt:"s",hash:"h",createdAt:iso,lastSignIn:iso}]));localStorage.setItem("orbit_local_session_v1",JSON.stringify({accountId:"acct_demo",signedInAt:iso}));localStorage.setItem("orbit_case_v1",cj);},JSON.stringify(seed()));
  await p.setViewport({width:1360,height:840});
  await p.goto(URL,{waitUntil:"networkidle2"});
  await new Promise(r=>setTimeout(r,1800));
  if(!(await p.evaluate(()=>!!document.getElementById("intel-resize")&&!!document.getElementById("network-app")&&!document.getElementById("network-app").hidden))){await b.close();return null;}
  return {b,p};
}
let ctx=null; for(let i=0;i<4&&!ctx;i++){ctx=await run(); if(!ctx) console.log("retry "+(i+1));}
if(!ctx){console.log("FAILED to load");process.exit(1);}
const {b,p}=ctx;
let passed=0,failed=0; const ok=(n,c,d)=>c?(passed++,console.log("  PASS  "+n)):(failed++,console.log("  FAIL  "+n+(d?"  → "+d:"")));
const w=()=>p.evaluate(()=>parseInt(getComputedStyle(document.getElementById("network-app")).getPropertyValue("--intel-w"),10));
const box=await p.$eval("#intel-resize",el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,cx:r.x+r.width/2,cy:r.y+r.height/2};});
const appH=await p.evaluate(()=>document.getElementById("network-app").getBoundingClientRect().height);
console.log("\n[sidebar resize]");
ok("resize handle exists",!!box);
ok("handle spans the full column height (not just identity)", box.h > appH*0.8, "handle "+Math.round(box.h)+" vs app "+Math.round(appH));
const before=await w();
ok("default width applied", before>=290&&before<=520, String(before));
// Drag the handle right by ~70px.
await p.mouse.move(box.cx,box.cy);
await p.mouse.down();
await p.mouse.move(box.cx+70,box.cy,{steps:8});
await p.mouse.up();
await new Promise(r=>setTimeout(r,150));
const after=await w();
ok("dragging widens the sidebar", after > before + 40, before+" → "+after);
// Double-click the handle resets to the default width.
await p.evaluate(() => document.getElementById("intel-resize").dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
await new Promise(r=>setTimeout(r,150));
const reset=await w();
ok("double-click resets to default width", reset===360, String(reset));
console.log("\n  "+passed+" passed, "+failed+" failed\n");
await b.close(); process.exit(failed?1:0);
