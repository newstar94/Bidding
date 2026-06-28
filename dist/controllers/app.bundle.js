var Lt=Object.defineProperty;var _t=(u,t,a)=>t in u?Lt(u,t,{enumerable:!0,configurable:!0,writable:!0,value:a}):u[t]=a;var vt=(u,t,a)=>(_t(u,typeof t!="symbol"?t+"":t,a),a);const $t="modulepreload",kt=function(u){return"/"+u},bt={},ut=function(t,a,n){if(!a||a.length===0)return t();const i=document.getElementsByTagName("link");return Promise.all(a.map(e=>{if(e=kt(e),e in bt)return;bt[e]=!0;const o=e.endsWith(".css"),l=o?'[rel="stylesheet"]':"";if(!!n)for(let r=i.length-1;r>=0;r--){const c=i[r];if(c.href===e&&(!o||c.rel==="stylesheet"))return}else if(document.querySelector(`link[href="${e}"]${l}`))return;const d=document.createElement("link");if(d.rel=o?"stylesheet":$t,o||(d.as="script",d.crossOrigin=""),d.href=e,document.head.appendChild(d),o)return new Promise((r,c)=>{d.addEventListener("load",r),d.addEventListener("error",()=>c(new Error(`Unable to preload CSS for ${e}`)))})})).then(()=>t()).catch(e=>{const o=new Event("vite:preloadError",{cancelable:!0});if(o.payload=e,window.dispatchEvent(o),!o.defaultPrevented)throw e})};window.generateUUID=function(){return typeof crypto<"u"&&typeof crypto.randomUUID=="function"?crypto.randomUUID():"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,function(u){const t=Math.random()*16|0;return(u==="x"?t:t&3|8).toString(16)})};window.escapeHTML=function(u){return u==null?"":String(u).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")};class mt{constructor(t="BiddingFlowDB"){this.dbName=t,this.db=null,this.stores=["chudautu","nhathau","chuyengia","kehoach","goithau","hopdong","systempackages","organizations","employees","permissionmatrix","custompaperstatuses","assignments","thongtinmothau","kv_store"]}init(){return new Promise((t,a)=>{const n=indexedDB.open(this.dbName,2);n.onupgradeneeded=i=>{const e=i.target.result;this.stores.forEach(o=>{e.objectStoreNames.contains(o)||e.createObjectStore(o,o==="kv_store"?{}:{keyPath:"id"})})},n.onsuccess=i=>{this.db=i.target.result,t(this)},n.onerror=i=>{a(i.target.error)}})}get(t){return new Promise(a=>{if(!this.db)return a(null);try{const e=this.db.transaction("kv_store","readonly").objectStore("kv_store").get(t);e.onsuccess=()=>a(e.result),e.onerror=()=>a(null)}catch{a(null)}})}set(t,a){return new Promise((n,i)=>{if(!this.db)return i("Database not initialized");try{const l=this.db.transaction("kv_store","readwrite").objectStore("kv_store").put(a,t);l.onsuccess=()=>n(),l.onerror=()=>i(l.error)}catch(e){i(e)}})}getTableData(t){return new Promise(a=>{if(!this.db||!this.db.objectStoreNames.contains(t))return a([]);try{const e=this.db.transaction(t,"readonly").objectStore(t).getAll();e.onsuccess=()=>a(e.result||[]),e.onerror=()=>a([])}catch{a([])}})}putTableData(t,a){return new Promise((n,i)=>{if(!this.db||!this.db.objectStoreNames.contains(t))return n();try{const e=this.db.transaction(t,"readwrite"),o=e.objectStore(t),l=o.getAllKeys();l.onsuccess=()=>{const h=new Set(l.result||[]),d=new Set((a||[]).map(r=>r.id));h.forEach(r=>{d.has(r)||o.delete(r)}),(a||[]).forEach(r=>{o.put(r)})},e.oncomplete=()=>n(),e.onerror=h=>i(h.target.error)}catch(e){i(e)}})}putRecord(t,a){return new Promise((n,i)=>{if(!this.db||!this.db.objectStoreNames.contains(t))return n();try{const l=this.db.transaction(t,"readwrite").objectStore(t).put(a);l.onsuccess=()=>n(),l.onerror=()=>i(l.error)}catch(e){i(e)}})}deleteRecord(t,a){return new Promise((n,i)=>{if(!this.db||!this.db.objectStoreNames.contains(t))return n();try{const l=this.db.transaction(t,"readwrite").objectStore(t).delete(a);l.onsuccess=()=>n(),l.onerror=()=>i(l.error)}catch(e){i(e)}})}putRecords(t,a){return new Promise((n,i)=>{if(!this.db||!this.db.objectStoreNames.contains(t))return n();try{const e=this.db.transaction(t,"readwrite"),o=e.objectStore(t);(a||[]).forEach(l=>{o.put(l)}),e.oncomplete=()=>n(),e.onerror=l=>i(l.target.error)}catch(e){i(e)}})}deleteRecords(t,a){return new Promise((n,i)=>{if(!this.db||!this.db.objectStoreNames.contains(t))return n();try{const e=this.db.transaction(t,"readwrite"),o=e.objectStore(t);(a||[]).forEach(l=>{o.delete(l)}),e.oncomplete=()=>n(),e.onerror=l=>i(l.target.error)}catch(e){i(e)}})}}const pt=class pt{constructor(){this.db=new mt,this.STORAGE_KEYS={CHUDAUTU:"bf_chudautu",NHATHAU:"bf_nhathau",CHUYENGIA:"bf_chuyengia",KEHOACH:"bf_kehoach",GOITHAU:"bf_goithau",HOPDONG:"bf_hopdong",THEME:"bf_dark_mode",USERID:"bf_user_id",ACTIVEROLE:"bf_active_role",ACTIVEUSER:"bf_active_user",ORGANIZATIONS:"bf_organizations",EMPLOYEES:"bf_employees",PERMISSIONMATRIX:"bf_permission_matrix",CUSTOMPAPERSTATUSES:"bf_custom_paper_statuses",ASSIGNMENTS:"bf_assignments",SYSTEMPACKAGES:"bf_system_packages",THONGTINMOTHAU:"bf_thong_tin_mo_thau"},this.state={chudautu:[],nhathau:[],chuyengia:[],kehoach:[],goithau:[],hopdong:[],systempackages:[],selectedPlanVersion:{},selectedPackageVersion:{},organizations:[],employees:[],permissionmatrix:[],custompaperstatuses:[],assignments:[]},this.sortState={kehoach:{field:"maKeHoach",order:"asc"},goithau:{field:"maGoiThau",order:"asc"},chudautu:{field:"tenChuDauTu",order:"asc"},nhathau:{field:"tenNhaThau",order:"asc"},chuyengia:{field:"hoTen",order:"asc"},hopdong:{field:"tenHopDong",order:"asc"}};const t=(()=>{try{return JSON.parse(sessionStorage.getItem("bf_current_pages")||"{}")}catch{return{}}})();this.currentPage={kehoach:t.kehoach||1,goithau:t.goithau||1,chudautu:t.chudautu||1,nhathau:t.nhathau||1,chuyengia:t.chuyengia||1,hopdong:t.hopdong||1},this.pageSize=10}savePage(t){try{const a=JSON.parse(sessionStorage.getItem("bf_current_pages")||"{}");a[t]=this.currentPage[t]||1,sessionStorage.setItem("bf_current_pages",JSON.stringify(a))}catch{}}async init(){const t=sessionStorage.getItem("bf_user_id");if(t){const e=String(t).replace(/[^a-zA-Z0-9_-]/g,"");this.db=new mt(`BiddingFlowDB_${e}`)}else this.db=new mt;await this.db.init();let a=!1;try{a=localStorage.getItem("bf_migrated_v5_clean")==="true"}catch{}if(!a){for(const e of Object.keys(this.STORAGE_KEYS))if(e!=="THEME")try{const o=localStorage.getItem(this.STORAGE_KEYS[e]);if(o){const l=JSON.parse(o);await this.db.set(this.STORAGE_KEYS[e],l)}}catch(o){console.error("Failed to migrate key during startup:",e,o)}try{localStorage.setItem("bf_migrated_v5_clean","true")}catch{}}for(const e of Object.keys(this.STORAGE_KEYS)){if(e==="THEME"||e==="ACTIVEROLE"||e==="ACTIVEUSER")continue;const o=e.toLowerCase();try{let l;if(this.db.stores.includes(o)){if(l=await this.db.getTableData(o),!l||l.length===0){const h=await this.db.get(this.STORAGE_KEYS[e]);h&&h.length>0&&(l=h,await this.db.putTableData(o,l))}}else l=await this.db.get(this.STORAGE_KEYS[e]);l?this.state[o]=l:(this.state[o]=[],this.db.stores.includes(o)?await this.db.putTableData(o,[]):await this.db.set(this.STORAGE_KEYS[e],[]))}catch{this.state[o]=[]}}this.state.systempackages||(this.state.systempackages=[]);let n=null,i=null;try{const e=sessionStorage.getItem(this.STORAGE_KEYS.ACTIVEROLE),o=sessionStorage.getItem(this.STORAGE_KEYS.ACTIVEUSER);e&&(n=JSON.parse(e)),o&&(i=JSON.parse(o))}catch(e){console.error("Lỗi đọc active role/user từ localStorage:",e)}if(!n||!i)try{n=n||await this.db.get(this.STORAGE_KEYS.ACTIVEROLE),i=i||await this.db.get(this.STORAGE_KEYS.ACTIVEUSER)}catch{}try{this.state.activerole=n||"super_admin"}catch{this.state.activerole="super_admin"}try{this.state.activeuser=i||{name:"Admin",title:"Hệ thống",id:"sa-1"}}catch{this.state.activeuser={name:"Admin",title:"Hệ thống",id:"sa-1"}}}async trackDeletions(t){try{const a=await this.db.getTableData(t);if(Array.isArray(a)&&Array.isArray(this.state[t])){const n=new Set(this.state[t].map(e=>e.id).filter(Boolean)),i=a.map(e=>e.id).filter(e=>e&&!n.has(e));if(i.length>0){let e=[];try{e=JSON.parse(localStorage.getItem("bf_local_deletions")||"[]")}catch{e=[]}i.forEach(o=>{e.some(l=>l.id===o&&l.table===t)||e.push({table:t,id:o})}),localStorage.setItem("bf_local_deletions",JSON.stringify(e))}}}catch(a){console.error("Error checking deletions in trackDeletions:",a)}}async persistData(t){const a=t.toUpperCase();if(this.STORAGE_KEYS[a])if(this.db.stores.includes(t)){await this.trackDeletions(t);try{await this.db.putTableData(t,this.state[t])}catch(n){console.error("Failed to persist data for type:",t,n)}}else try{await this.db.set(this.STORAGE_KEYS[a],this.state[t])}catch(n){console.error("Failed to persist data for type:",t,n)}}async addRecord(t,a){this.state[t]||(this.state[t]=[]),this.state[t].push(a),this.db.stores.includes(t)?await this.db.putRecord(t,a):this.persistData(t)}async updateRecord(t,a){this.state[t]||(this.state[t]=[]);const n=this.state[t].findIndex(i=>i.id===a.id);n!==-1?this.state[t][n]=a:this.state[t].push(a),this.db.stores.includes(t)?await this.db.putRecord(t,a):this.persistData(t)}async deleteRecord(t,a){this.state[t]&&(this.state[t]=this.state[t].filter(i=>i.id!==a));let n=[];try{n=JSON.parse(localStorage.getItem("bf_local_deletions")||"[]")}catch{n=[]}n.some(i=>i.id===a&&i.table===t)||(n.push({table:t,id:a}),localStorage.setItem("bf_local_deletions",JSON.stringify(n))),this.db.stores.includes(t)?await this.db.deleteRecord(t,a):this.persistData(t)}switchActiveRole(t,a,n){this.state.activerole=t;let i="Chuyên viên";t==="super_admin"?i="Super Admin":t==="manager"&&(i="Quản lý"),this.state.activeuser={...this.state.activeuser||{},name:a,title:i,id:n},sessionStorage.setItem(this.STORAGE_KEYS.ACTIVEROLE,JSON.stringify(this.state.activerole)),sessionStorage.setItem(this.STORAGE_KEYS.ACTIVEUSER,JSON.stringify(this.state.activeuser))}clearSessionData(){Object.keys(this.STORAGE_KEYS).forEach(t=>{t!=="THEME"&&localStorage.removeItem(this.STORAGE_KEYS[t])}),sessionStorage.removeItem("bf_session_token"),sessionStorage.removeItem("bf_username"),Object.keys(this.state).forEach(t=>{Array.isArray(this.state[t])?this.state[t]=[]:typeof this.state[t]=="object"&&this.state[t]!==null&&(this.state[t]={})}),this.state.activerole=null,this.state.activeuser=null}hasEffectiveRole(t,a){const i=(typeof t=="string"?t:t&&t.role?t.role:"").split(",").map(o=>o.trim()).filter(Boolean);return new Set(i.flatMap(o=>pt.ROLE_HIERARCHY[o]||[o])).has(a)}hasActiveEffectiveRole(t){return this.hasEffectiveRole(this.state.activerole,t)}static getEffectiveRoles(t){const a=(t||"").split(",").map(i=>i.trim()).filter(Boolean);return new Set(a.flatMap(i=>pt.ROLE_HIERARCHY[i]||[i]))}hasPermission(t,a,n){if(this.hasActiveEffectiveRole("manager"))return!0;const i=this.state.permissionmatrix.find(o=>o.empId===t);if(!i)return!1;const e=i[a];return e?n==="edit"?e==="edit":e==="view"||e==="edit":!1}isAssigned(t,a,n){if(this.hasActiveEffectiveRole("manager"))return!0;const i=String(t).replace(/^(emp-|user-|sa-|mgr-)+/,""),e=String(a).replace(/^(gt-|hd-)+/,"");return this.state.assignments.some(o=>String(o.empId).replace(/^(emp-|user-|sa-|mgr-)+/,"")===i&&String(o.targetId).replace(/^(gt-|hd-)+/,"")===e&&o.type===n)}getFilteredKeHoach(){const t=this.getLatestPlans();if(this.hasActiveEffectiveRole("manager"))return t;const a=this.state.activeuser.id,n=String(a).replace(/^(emp-|user-|sa-|mgr-)+/,""),i=this.state.assignments.filter(o=>String(o.empId).replace(/^(emp-|user-|sa-|mgr-)+/,"")===n&&o.type==="kehoach").map(o=>String(o.targetId).replace(/^(gt-|hd-)+/,"")),e=this.state.assignments.filter(o=>String(o.empId).replace(/^(emp-|user-|sa-|mgr-)+/,"")===n&&o.type==="goithau").map(o=>String(o.targetId).replace(/^(gt-|hd-)+/,""));return t.filter(o=>i.includes(String(o.id).replace(/^(gt-|hd-)+/,""))?!0:this.state.goithau.filter(d=>d.keHoachId===o.id).some(d=>e.includes(String(d.id).replace(/^(gt-|hd-)+/,""))))}getFilteredGoiThau(){const t=this.getLatestPackages();if(this.hasActiveEffectiveRole("manager"))return t;const a=this.state.activeuser.id;return t.filter(n=>this.isAssigned(a,n.id,"goithau"))}getFilteredHopDong(){const t=this.state.hopdong||[];if(this.hasActiveEffectiveRole("manager"))return t;const a=this.state.activeuser.id;return t.filter(n=>this.isAssigned(a,n.id,"hopdong"))}formatCurrency(t){if(t==null||t===""||isNaN(t))return"--";const i=(t%1!==0?t.toFixed(2):t.toFixed(0)).split("."),e=i[0].replace(/\B(?=(\d{3})+(?!\d))/g,"."),o=i[1]?","+i[1]:"";return e+o+" VND"}formatVND(t){if(t==null)return"";let a=t.toString().trim();if(!a)return"";typeof t=="number"&&(a=t.toString().replace(".",","));const n=a.split(",");let i=n[0],e=n.length>1?n[1]:null;if(i=i.replace(/\D/g,""),!i&&e===null)return"";i||(i="0");const o=parseInt(i,10).toLocaleString("vi-VN");return e!==null?(e=e.replace(/\D/g,""),o+","+e):o}parseVND(t){if(t==null)return null;let a=t.toString().trim();if(!a)return null;a=a.replace(/\./g,""),a=a.replace(/,/g,".");const n=parseFloat(a);return isNaN(n)?null:n}formatDate(t){if(!t)return"--";let a=null,n=null,i=null,e="00",o="00",l=!1;if(t instanceof Date){const h=t;i=String(h.getDate()).padStart(2,"0"),n=String(h.getMonth()+1).padStart(2,"0"),a=h.getFullYear(),e=String(h.getHours()).padStart(2,"0"),o=String(h.getMinutes()).padStart(2,"0"),l=h.getHours()!==0||h.getMinutes()!==0}else{const h=String(t).replace(/\s*-\s*/," ").trim(),d=h.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/),r=h.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[T\s](\d{2}):(\d{2}))?/);if(d)a=d[1],n=d[2],i=d[3],d[4]!==void 0&&(e=d[4],o=d[5],l=!0);else if(r)i=r[1],n=r[2],a=r[3],r[4]!==void 0&&(e=r[4],o=r[5],l=!0);else{const c=new Date(t);if(isNaN(c.getTime()))return t;i=String(c.getDate()).padStart(2,"0"),n=String(c.getMonth()+1).padStart(2,"0"),a=c.getFullYear(),e=String(c.getHours()).padStart(2,"0"),o=String(c.getMinutes()).padStart(2,"0"),l=/[T\s]\d{1,2}:\d{2}/.test(t)}}return l?`${i}/${n}/${a} ${e}:${o}`:`${i}/${n}/${a}`}formatDateWithTime(t){if(!t)return"--";let a=null,n=null,i=null,e="00",o="00";if(t instanceof Date){const l=t;i=String(l.getDate()).padStart(2,"0"),n=String(l.getMonth()+1).padStart(2,"0"),a=l.getFullYear(),e=String(l.getHours()).padStart(2,"0"),o=String(l.getMinutes()).padStart(2,"0")}else{const l=String(t).replace(/\s*-\s*/," ").trim(),h=l.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/),d=l.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[T\s](\d{2}):(\d{2}))?/);if(h)a=h[1],n=h[2],i=h[3],h[4]!==void 0&&(e=h[4],o=h[5]);else if(d)i=d[1],n=d[2],a=d[3],d[4]!==void 0&&(e=d[4],o=d[5]);else{const r=new Date(t);if(isNaN(r.getTime()))return t;i=String(r.getDate()).padStart(2,"0"),n=String(r.getMonth()+1).padStart(2,"0"),a=r.getFullYear(),e=String(r.getHours()).padStart(2,"0"),o=String(r.getMinutes()).padStart(2,"0")}}return`${i}/${n}/${a} ${e}:${o}`}formatForDateInput(t){if(!t)return"";let a=null,n=null,i=null;if(t instanceof Date){const e=t;i=String(e.getDate()).padStart(2,"0"),n=String(e.getMonth()+1).padStart(2,"0"),a=e.getFullYear()}else{const e=String(t).replace(/\s*-\s*/," ").trim(),o=e.match(/^(\d{4})-(\d{2})-(\d{2})/),l=e.match(/^(\d{2})\/(\d{2})\/(\d{4})/);if(o)a=o[1],n=o[2],i=o[3];else if(l)i=l[1],n=l[2],a=l[3];else{const h=new Date(t);if(isNaN(h.getTime()))return"";i=String(h.getDate()).padStart(2,"0"),n=String(h.getMonth()+1).padStart(2,"0"),a=h.getFullYear()}}return`${a}-${n}-${i}`}formatForDatetimeLocal(t){if(!t)return"";let a=null,n=null,i=null,e="00",o="00";if(t instanceof Date){const l=t;i=String(l.getDate()).padStart(2,"0"),n=String(l.getMonth()+1).padStart(2,"0"),a=l.getFullYear(),e=String(l.getHours()).padStart(2,"0"),o=String(l.getMinutes()).padStart(2,"0")}else{const l=String(t).replace(/\s*-\s*/," ").trim(),h=l.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/),d=l.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[T\s](\d{2}):(\d{2}))?/);if(h)a=h[1],n=h[2],i=h[3],h[4]!==void 0&&(e=h[4],o=h[5]);else if(d)i=d[1],n=d[2],a=d[3],d[4]!==void 0&&(e=d[4],o=d[5]);else{const r=new Date(t);if(isNaN(r.getTime()))return"";i=String(r.getDate()).padStart(2,"0"),n=String(r.getMonth()+1).padStart(2,"0"),a=r.getFullYear(),e=String(r.getHours()).padStart(2,"0"),o=String(r.getMinutes()).padStart(2,"0")}}return`${a}-${n}-${i}T${e}:${o}`}convertDMYToYMD(t){if(!t)return"";let a=String(t).replace(/\s*-\s*/," ").trim();if(/^\d{4}-\d{2}-\d{2}$/.test(a))return a;const e=a.split(" ")[0].split("/");if(e.length!==3)return t;const o=e[0].padStart(2,"0"),l=e[1].padStart(2,"0");return`${e[2]}-${l}-${o}`}convertDMYHMSToYMDHMS(t){if(!t)return"";let a=String(t).replace("T"," ").replace(/\s*-\s*/," ").trim();if(/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}(:\d{2})?$/.test(a)){const l=a.split(" ");let h=l[1];return h.split(":").length===2&&(h+=":00"),`${l[0]} ${h}`}const n=a.split(" "),i=n[0];let e=n[1]||"00:00:00";return e.split(":").length===2&&(e+=":00"),`${this.convertDMYToYMD(i)} ${e}`}getFileExtensionFromBase64(t){return t?t.startsWith("data:image/jpeg")||t.startsWith("data:image/jpg")?"jpg":t.startsWith("data:image/webp")?"webp":t.startsWith("data:image/gif")?"gif":t.includes(".")?t.split(".").pop():"png":"png"}getPlanBaseCode(t){return t||""}getVersionLabel(t){const a=parseInt(t)||0;return a===0?"V0 (Gốc)":`V${a} (Điều chỉnh ${a})`}getPackageBaseCode(t){return t||""}getLatestPlans(){const t={};return(this.state.kehoach||[]).forEach(a=>{const n=a.rootId||a.id,i=parseInt(a.phienBan)||0,e=a.isLatest==1||a.is_latest==1;if(!t[n])t[n]=a;else{const o=parseInt(t[n].phienBan)||0,l=t[n].isLatest==1||t[n].is_latest==1;(e&&!l||i>o)&&(t[n]=a)}}),Object.values(t)}getLatestPackages(){const t=(this.state.goithau||[]).filter(n=>{if(!n.keHoachId)return!0;const i=this.getLatestPlan(n.keHoachId);return i&&i.id===n.keHoachId}),a={};return t.forEach(n=>{const i=n.rootId||n.id,e=parseInt(n.phienBan)||0,o=n.isLatest==1||n.is_latest==1;if(!a[i])a[i]=n;else{const l=parseInt(a[i].phienBan)||0,h=a[i].isLatest==1||a[i].is_latest==1;(o&&!h||e>l)&&(a[i]=n)}}),Object.values(a)}getLatestChuDauTu(){const t=Array.isArray(this.state.chudautu)?this.state.chudautu:[],a=t.filter(i=>i.isLatest==1);if(a.length>0)return a;const n={};return t.forEach(i=>{const e=i.rootId||i.id,o=parseInt(i.phienBan)||0;(!n[e]||o>n[e].version)&&(n[e]={item:i,version:o})}),Object.values(n).map(i=>i.item)}getLatestNhaThau(){const t=Array.isArray(this.state.nhathau)?this.state.nhathau:[],a=t.filter(i=>i.isLatest==1);if(a.length>0)return a;const n={};return t.forEach(i=>{const e=i.rootId||i.id,o=parseInt(i.phienBan)||0;(!n[e]||o>n[e].version)&&(n[e]={item:i,version:o})}),Object.values(n).map(i=>i.item)}getLatestChuyenGia(){const t=Array.isArray(this.state.chuyengia)?this.state.chuyengia:[],a=t.filter(i=>i.isLatest==1);if(a.length>0)return a;const n={};return t.forEach(i=>{const e=i.rootId||i.id,o=parseInt(i.phienBan)||0;(!n[e]||o>n[e].version)&&(n[e]={item:i,version:o})}),Object.values(n).map(i=>i.item)}getLatestHopDong(){const t=this.getLatestPackages();t.map(e=>e.id);const n=this.getFilteredHopDong().filter(e=>{let o=[];if(e.goiThauId&&o.push(e.goiThauId),e.goiThauIds){if(Array.isArray(e.goiThauIds))o.push(...e.goiThauIds);else if(typeof e.goiThauIds=="string")try{const l=JSON.parse(e.goiThauIds);Array.isArray(l)?o.push(...l):o.push(e.goiThauIds)}catch{o.push(...e.goiThauIds.split(",").map(h=>h.trim()))}}return o=o.filter(Boolean),o.length===0?!0:o.some(l=>{const h=(this.state.goithau||[]).find(r=>r.id===l);if(!h)return!1;const d=h.rootId||h.id;return t.some(r=>r.rootId===d||r.id===d)})}),i={};return n.forEach(e=>{const o=e.rootId||e.id,l=parseInt(e.phienBan)||0,h=e.isLatest==1||e.is_latest==1;if(!i[o])i[o]=e;else{const d=parseInt(i[o].phienBan)||0,r=i[o].isLatest==1||i[o].is_latest==1;(h&&!r||l>d)&&(i[o]=e)}}),Object.values(i)}getLatestPlan(t){if(!t)return null;const a=(this.state.kehoach||[]).find(e=>e.id===t);if(!a)return null;const n=a.rootId||a.id;return(this.state.kehoach||[]).find(e=>(e.rootId===n||e.id===n)&&(e.isLatest==1||e.is_latest==1))||a}getLatestPackage(t){if(!t)return null;const a=(this.state.goithau||[]).find(e=>e.id===t);if(!a)return null;const n=a.rootId||a.id;return(this.state.goithau||[]).find(e=>(e.rootId===n||e.id===n)&&(e.isLatest==1||e.is_latest==1))||a}getLatestContract(t){if(!t)return null;const a=(this.state.hopdong||[]).find(e=>e.id===t);if(!a)return null;const n=a.rootId||a.id;return(this.state.hopdong||[]).find(e=>(e.rootId===n||e.id===n)&&(e.isLatest==1||e.is_latest==1))||a}};vt(pt,"ROLE_HIERARCHY",{super_admin:["super_admin","manager","employee"],manager:["manager","employee"],employee:["employee"]});let yt=pt;function Dt(){const u=this.model.getFilteredGoiThau();document.getElementById("stat-count-kehoach").textContent=this.model.getFilteredKeHoach().length,document.getElementById("stat-count-goithau").textContent=u.length,document.getElementById("stat-count-chudautu").textContent=this.model.getLatestChuDauTu().length,document.getElementById("stat-count-nhathau").textContent=this.model.getLatestNhaThau().length,document.getElementById("stat-count-chuyengia").textContent=this.model.state.chuyengia.length;const t=document.getElementById("stat-count-hopdong");t&&(t.textContent=this.model.getFilteredHopDong().length);const a=this.model.getFilteredHopDong();let n=0;a.forEach(p=>{n+=p.giaTri||0});let i=0;u.forEach(p=>{p.trangThai==="Đang mời thầu"&&i++}),document.getElementById("stat-active-goithau").textContent=`${i} gói đang mời thầu`,document.getElementById("stat-total-budget").textContent=this.model.formatCurrency(n),document.getElementById("stat-savings-value").textContent=`${a.length} Hợp đồng`,document.getElementById("stat-savings-percent").textContent="Đang thực hiện";const e={"Chuẩn bị":0,"Đang mời thầu":0,"Đã mở thầu":0,"Đang chấm thầu":0,"Đã có kết quả":0,"Hủy thầu":0};u.forEach(p=>{e[p.trangThai]!==void 0&&e[p.trangThai]++});const o=u.length||1;document.getElementById("donut-total-count").textContent=u.length;const l={"Chuẩn bị":"var(--text-light)","Đang mời thầu":"var(--primary)","Đã mở thầu":"#f59e0b","Đang chấm thầu":"#9333ea","Đã có kết quả":"var(--success)","Hủy thầu":"var(--danger)"};let h=0;const d=[];let r="";Object.keys(e).forEach(p=>{const m=e[p],f=m/o*100;m>0&&(d.push(`${l[p]} ${h}% ${h+f}%`),h+=f),r+=`
            <div class="legend-item">
                <div class="legend-info">
                    <span class="legend-dot" style="background-color: ${l[p]}"></span>
                    <span>${p}</span>
                </div>
                <span class="legend-val">${m} (${f.toFixed(0)}%)</span>
            </div>
        `});const c=document.querySelector(".status-donut-chart");c&&(d.length>0?c.style.background=`conic-gradient(${d.join(", ")})`:c.style.background="var(--neutral-soft)"),document.getElementById("status-legend-list").innerHTML=r;const g=document.getElementById("recent-packages-table").querySelector("tbody"),s=[...u].reverse().slice(0,4);s.length===0?g.innerHTML='<tr><td colspan="5" class="text-center text-muted">Chưa có gói thầu nào</td></tr>':(g.innerHTML=s.map(p=>`
            <tr>
                <td><a href="#" onclick="event.preventDefault(); window.showPackageDetails('${p.id}')" class="text-blue fw-bold link-hover" title="Xem chi tiết Gói thầu"><span class="detail-code">${p.maGoiThau}</span></a></td>
                <td><a href="#" class="view-package-link" data-id="${p.id}">${p.tenGoiThau}</a></td>
                <td>${this.model.formatCurrency(p.giaGoiThau)}</td>
                <td>${p.hinhThucLuaChon}</td>
                <td>${this.getStatusBadge(p.trangThai)}</td>
            </tr>
        `).join(""),g.querySelectorAll(".view-package-link").forEach(p=>{p.addEventListener("click",m=>{m.preventDefault(),window.showPackageDetails(p.getAttribute("data-id"))})})),lucide.createIcons()}function Ct(){fetch("/api/auth/users").then(u=>u.ok?u.json():[]).then(u=>{const t=[];u.forEach(d=>{d.organization_name&&d.organization_name.split(",").map(r=>r.trim()).filter(Boolean).forEach(r=>{t.push(r)})});const a=new Set(t).size,n=document.getElementById("sad-stat-orgs");n&&(n.textContent=`${a} Đơn vị`);const i=document.getElementById("sad-stat-users");i&&(i.textContent=`${u.length} Người dùng`);const e=[];u.forEach(d=>{d.package_id&&d.package_id!=="none"&&d.organization_name&&d.organization_name.split(",").map(r=>r.trim()).filter(Boolean).forEach(r=>{e.push(r)})});const o=new Set(e).size,l=document.getElementById("sad-stat-active-orgs");l&&(l.textContent=`Đang hoạt động: ${o}`);const h=document.getElementById("sa-org-list-tbody");if(h){const d={};u.forEach(c=>{(c.organization_name?c.organization_name.split(",").map(s=>s.trim()).filter(Boolean):[]).forEach(s=>{d[s]||(d[s]={name:s,manager:"",email:"",package_id:"none",start:"",end:"",userCount:0}),d[s].userCount++,(c.role==="manager"||!d[s].manager)&&(d[s].manager=c.name,d[s].email=c.email,d[s].package_id=c.package_id||"none",d[s].start=c.package_start_date?this.model.formatDate(c.package_start_date):"",d[s].end=c.package_end_date?this.model.formatDate(c.package_end_date):"")})});const r=Object.values(d);r.length===0?h.innerHTML='<tr><td colspan="7" class="text-center text-muted">Chưa có tổ chức nào đăng ký thầu</td></tr>':h.innerHTML=r.map(c=>{const g=c.package_id==="diamond"?"Gói Kim Cương":c.package_id==="gold"?"Gói Vàng":c.package_id==="silver"?"Gói Bạc":"Chưa đăng ký",s=c.package_id==="diamond"?"badge-primary":c.package_id==="gold"?"badge-warning":c.package_id==="silver"?"badge-success":"badge-neutral";return`
                            <tr>
                                <td style="font-weight:700; color:var(--text-main);">${c.name}</td>
                                <td>${c.manager||'<span class="text-muted">Chưa cấu hình</span>'}</td>
                                <td>${c.email||'<span class="text-muted">Chưa có</span>'}</td>
                                <td><span class="badge ${s}">${g}</span></td>
                                <td style="font-weight:600;">${c.end||'<span class="text-muted">Vô thời hạn</span>'}</td>
                                <td style="font-weight:700; text-align:center;">${c.userCount}</td>
                                <td class="text-right">
                                    <div class="actions-group">
                                        <button class="btn btn-icon btn-neutral" onclick="window.switchTab('superadmin')" title="Quản lý chi tiết"><i data-lucide="edit"></i></button>
                                    </div>
                                </td>
                            </tr>
                        `}).join("")}lucide.createIcons()})}const It=Object.freeze(Object.defineProperty({__proto__:null,renderDashboard:Dt,renderSuperAdminDashboard:Ct},Symbol.toStringTag,{value:"Module"}));function Et(u){const t=sessionStorage.getItem("bf_session_token")||"",a=sessionStorage.getItem("bf_username")||"",n=u.includes("?")?"&":"?";return`${u}${n}token=${encodeURIComponent(t)}&username=${encodeURIComponent(a)}`}function ft(u,t){return fetch(u,{headers:{"X-Session-Token":sessionStorage.getItem("bf_session_token")||"","X-Username":sessionStorage.getItem("bf_username")||""}}).then(async a=>{if(!a.ok){let n="Lỗi tải file";try{const i=a.headers.get("content-type");i&&i.includes("application/json")?n=(await a.json()).error||n:n=await a.text()||`${a.status} ${a.statusText}`}catch{n=`${a.status} ${a.statusText}`}throw new Error(n)}return a.blob()}).then(a=>{const n=document.createElement("a"),i=URL.createObjectURL(a);n.href=i,n.download=t||"download",document.body.appendChild(n),n.click(),n.remove(),URL.revokeObjectURL(i)})}function dt(u){return u==null?"--":new Intl.NumberFormat("vi-VN",{style:"currency",currency:"VND"}).format(u)}function rt(u){if(!u)return"--";let t=null,a=null,n=null,i="00",e="00",o=!1;if(u instanceof Date){const l=u;n=String(l.getDate()).padStart(2,"0"),a=String(l.getMonth()+1).padStart(2,"0"),t=l.getFullYear(),i=String(l.getHours()).padStart(2,"0"),e=String(l.getMinutes()).padStart(2,"0"),o=l.getHours()!==0||l.getMinutes()!==0}else{const l=String(u).replace(/\s*-\s*/," ").trim(),h=l.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/),d=l.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[T\s](\d{2}):(\d{2}))?/);if(h)t=h[1],a=h[2],n=h[3],h[4]!==void 0&&(i=h[4],e=h[5],o=!0);else if(d)n=d[1],a=d[2],t=d[3],d[4]!==void 0&&(i=d[4],e=d[5],o=!0);else{const r=new Date(u);if(isNaN(r.getTime()))return u;n=String(r.getDate()).padStart(2,"0"),a=String(r.getMonth()+1).padStart(2,"0"),t=r.getFullYear(),i=String(r.getHours()).padStart(2,"0"),e=String(r.getMinutes()).padStart(2,"0"),o=/[T\s]\d{1,2}:\d{2}/.test(u)}}return o?`${n}/${a}/${t} ${i}:${e}`:`${n}/${a}/${t}`}function ht(u){const t=document.getElementById(u);if(!t)return;const a=t.classList.contains("version-droplist"),n=t.classList.contains("page-version-select")||t.classList.contains("modal-version-select"),i=!a&&!n;t.style.display="none";let e=t.parentElement.querySelector(`.custom-select-container[data-target="${u}"]`);e||(e=document.createElement("div"),e.className="custom-select-container"+(a?" version-select-container":"")+(n?" compact-version-select-container":""),e.setAttribute("data-target",u),t.parentNode.insertBefore(e,t.nextSibling),a?(e.style.display="inline-block",e.style.verticalAlign="middle",e.style.width="52px",e.style.height="22px",e.style.margin="0"):n?(e.style.display="inline-block",e.style.verticalAlign="middle",e.style.margin="0",e.style.width="70px",e.style.minWidth="70px"):t.style.width&&(e.style.width=t.style.width),window._customSelectClickListenerRegistered||(document.addEventListener("click",g=>{document.querySelectorAll(".custom-select-container.open").forEach(s=>{const p=s.getAttribute("data-target"),m=document.querySelector(`.custom-select-dropdown[data-target="${p}"]`),f=s.contains(g.target),v=m&&m.contains(g.target);!f&&!v&&(s.classList.remove("open"),m&&m.parentElement===document.body&&(s.appendChild(m),m.style.opacity="",m.style.visibility="",m.style.transform="",m.style.top="",m.style.left=""))}),document.querySelectorAll("body > .custom-select-dropdown").forEach(s=>{const p=s.getAttribute("data-target"),m=document.getElementById(p),f=document.querySelector(`.custom-select-container[data-target="${p}"]`);(!m||!f||f.offsetWidth===0&&f.offsetHeight===0)&&s.remove()})}),window._customSelectClickListenerRegistered=!0),window._customSelectScrollListenerRegistered||(window.addEventListener("scroll",()=>{document.querySelectorAll(".custom-select-container").forEach(g=>{g.classList.remove("open");const s=g.getAttribute("data-target"),p=document.querySelector(`.custom-select-dropdown[data-target="${s}"]`);p&&p.parentElement===document.body&&(g.appendChild(p),p.style.opacity="",p.style.visibility="",p.style.transform="")})},{passive:!0}),window._customSelectScrollListenerRegistered=!0)),window._customSelectTableScrollListenerRegistered||(document.addEventListener("scroll",g=>{g.target&&g.target.classList&&g.target.classList.contains("table-container")&&document.querySelectorAll(".custom-select-container.open").forEach(s=>{s.classList.remove("open");const p=s.getAttribute("data-target"),m=document.querySelector(`.custom-select-dropdown[data-target="${p}"]`);m&&m.parentElement===document.body&&(s.appendChild(m),m.style.opacity="",m.style.visibility="",m.style.transform="")})},{capture:!0,passive:!0}),window._customSelectTableScrollListenerRegistered=!0);const o=Array.from(t.options);let h=(t.options[t.selectedIndex]||t.options[0]||{text:"",value:""}).text.trim();if(h.startsWith("Tháng ")){let g=h.substring(6).trim();const s={một:"1",hai:"2",ba:"3",bốn:"4",năm:"5",sáu:"6",bảy:"7",tám:"8",chín:"9",mười:"10","mười một":"11","mười hai":"12"};s[g.toLowerCase()]&&(g=s[g.toLowerCase()]),h="Th"+g}const d=e.querySelector(".custom-select-trigger span"),r=Array.from(e.querySelectorAll(".custom-select-option"));let c=!1;if(!d||d.textContent!==h)c=!0;else if(r.length!==o.length)c=!0;else for(let g=0;g<o.length;g++){const s=r[g],p=o[g];if(s.getAttribute("data-value")!==p.value||s.querySelector("span").textContent!==p.text||s.classList.contains("selected")!==p.selected){c=!0;break}}if(c){const g=document.body.querySelector(`.custom-select-dropdown[data-target="${u}"]`);g&&g.remove(),e.innerHTML=`
            <div class="custom-select-trigger">
                <span>${h}</span>
                ${i?`
                <div class="custom-select-trigger-arrow">
                    <i data-lucide="chevron-down" style="width: 14px; height: 14px;"></i>
                </div>
                `:""}
            </div>
            <div class="custom-select-dropdown${a?" version-select-dropdown":""}${n?" compact-version-select-dropdown":""}" data-target="${u}">
                ${o.map(m=>`
                    <div class="custom-select-option ${m.selected?"selected":""}" data-value="${m.value}">
                        <span>${m.text}</span>
                    </div>
                `).join("")}
            </div>
        `;const s=e.querySelector(".custom-select-trigger"),p=e.querySelector(".custom-select-dropdown");s.addEventListener("click",m=>{if(m.stopPropagation(),document.querySelectorAll(".custom-select-container").forEach(v=>{if(v!==e){v.classList.remove("open");const b=v.getAttribute("data-target"),y=document.querySelector(`.custom-select-dropdown[data-target="${b}"]`);y&&y.parentElement===document.body&&(v.appendChild(y),y.style.opacity="",y.style.visibility="",y.style.transform="")}}),e.classList.toggle("open")){const v=s.getBoundingClientRect();document.body.appendChild(p),p.style.position="fixed",p.style.top=v.bottom+4+"px",p.style.left=v.left+"px",p.style.right="auto",p.style.bottom="auto",p.style.margin="0",p.style.transform="none",a?(p.style.width="52px",p.style.minWidth="52px"):n?(p.style.width="70px",p.style.minWidth="70px"):(p.style.minWidth=v.width+"px",p.style.width="max-content"),p.style.zIndex="999999",p.style.opacity="1",p.style.visibility="visible"}else p.style.opacity="0",p.style.visibility="hidden",e.appendChild(p)}),e.querySelectorAll(".custom-select-option").forEach(m=>{m.addEventListener("click",f=>{f.stopPropagation();const v=m.getAttribute("data-value");t.value=v,t.dispatchEvent(new Event("change",{bubbles:!0})),e.classList.remove("open"),p.parentElement===document.body&&(e.appendChild(p),p.style.opacity="",p.style.visibility="",p.style.transform=""),ht(u)})}),i&&window.lucide&&typeof window.lucide.createIcons=="function"&&window.lucide.createIcons()}}async function Ht(){const u=document.getElementById("kehoach-table").querySelector("tbody"),t=document.getElementById("search-kehoach").value.toLowerCase(),a=m=>{if(!m)return{year:null,month:null};let f=String(m).replace(/\s*-\s*/," ").trim();if(f.match(/^\d{4}-\d{2}-\d{2}/)){const b=f.substring(0,4),y=parseInt(f.substring(5,7),10).toString();return{year:b,month:y}}else if(f.match(/^\d{2}\/\d{2}\/\d{4}/)){const b=f.split(" ")[0].split("/"),y=b[2],w=parseInt(b[1],10).toString();return{year:y,month:w}}const v=new Date(f);return isNaN(v.getTime())?{year:null,month:null}:{year:v.getFullYear().toString(),month:(v.getMonth()+1).toString()}},n=document.getElementById("filter-kehoach-nam"),i=document.getElementById("filter-kehoach-thang"),e=this.model.state.kehoach||[];if(n&&i){const m=n.value,f=i.value,v=new Set,b=new Set;e.forEach(x=>{if(x.ngayPheDuyet){const L=a(x.ngayPheDuyet);L.year&&v.add(L.year),L.month&&b.add(L.month)}});const y=Array.from(v).sort((x,L)=>parseInt(L)-parseInt(x)),w=Array.from(b).sort((x,L)=>parseInt(L)-parseInt(x));n.innerHTML='<option value="">Năm</option>'+y.map(x=>`<option value="${x}">${x}</option>`).join(""),i.innerHTML='<option value="">Tháng</option>'+w.map(x=>`<option value="${x}">Tháng ${x}</option>`).join(""),y.includes(m)&&(n.value=m),w.includes(f)&&(i.value=f),ht("filter-kehoach-nam"),ht("filter-kehoach-thang")}const o=n?n.value:"",l=i?i.value:"";let h=[],d=0;const r=this.model.currentPage.kehoach||1,c=this.model.pageSize||10,g=this.model.sortState.kehoach||{},s=g.field||"",p=g.order||"asc";if(this.model.useServerSidePagination){!u.querySelector(".empty-state")&&u.children.length===0&&(u.innerHTML='<tr><td colspan="10" style="text-align: center; padding: 20px; color: var(--primary); font-weight: bold;">Đang tải dữ liệu từ máy chủ...</td></tr>');try{const m=await fetch(`/api/paginate?table=kehoach&page=${r}&pageSize=${c}&search=${encodeURIComponent(t)}&sortBy=${s}&sortOrder=${p}&nam=${encodeURIComponent(o)}&thang=${encodeURIComponent(l)}`,{headers:{"X-Session-Token":sessionStorage.getItem("bf_session_token")||"","X-Username":sessionStorage.getItem("bf_username")||""}});if(m.ok){const f=await m.json();h=f.items,d=f.totalItems}}catch(m){console.error("Failed to fetch paginated plans",m)}}else{const f=this.model.getFilteredKeHoach().filter(b=>{const y=b.maKeHoach.toLowerCase().includes(t)||b.tenKeHoach.toLowerCase().includes(t)||b.tenDuAnDuToan&&b.tenDuAnDuToan.toLowerCase().includes(t);let w=!0,x=!0;if(b.ngayPheDuyet){const L=a(b.ngayPheDuyet);o&&(w=L.year===o),l&&(x=L.month===l)}else(o||l)&&(w=!1,x=!1);return y&&w&&x});s&&f.sort((b,y)=>{let w=b[s]||"",x=y[s]||"";return typeof w=="string"&&(w=w.toLowerCase()),typeof x=="string"&&(x=x.toLowerCase()),w<x?p==="asc"?-1:1:w>x?p==="asc"?1:-1:0}),d=f.length;const v=(r-1)*c;h=f.slice(v,v+c)}if(d===0){u.innerHTML=`
            <tr>
                <td colspan="10">
                    <div class="empty-state">
                        <i data-lucide="file-warning"></i>
                        <p>Không tìm thấy Kế hoạch lựa chọn nhà thầu nào phù hợp</p>
                    </div>
                </td>
            </tr>
        `;const m=document.getElementById("kehoach-pagination");m&&(m.innerHTML="")}else u.innerHTML=h.map(m=>{const f=m.rootId||m.id,v=m.allVersions||this.model.state.kehoach.filter(D=>(D.rootId||D.id)===f).sort((D,P)=>parseInt(P.phienBan)-parseInt(D.phienBan));this.model.state.selectedPlanVersion||(this.model.state.selectedPlanVersion={});const b=this.model.state.selectedPlanVersion[f]||m.id,y=this.model.state.kehoach.find(D=>D.id===b)||m,w=this.model.state.chudautu.find(D=>D.id===y.chuDauTuId),x=v.map(D=>{const P=D.phienBan||"00",V=D.id===y.id?"selected":"";return`<option value="${D.id}" ${V}>${P}</option>`}).join(""),L=`
                <select class="form-control version-droplist" onchange="window.changePlanRowVersion('${f}', this.value)" style="width: 52px; display: inline-block; padding: 2px; height: 22px; font-size: 0.8rem; border-radius: 4px; border: 1px solid var(--border-color, #ccc); background-color: var(--bg-card); color: var(--text-main); text-align-last: center; cursor: pointer; margin: 0; outline: none; vertical-align: middle;">
                    ${x}
                </select>
            `,N=y.id===m.id?`
                            <button class="action-btn btn-edit" onclick="window.editKeHoach('${y.id}')" title="Sửa">
                                <i data-lucide="edit-2"></i>
                            </button>
            `:"";return`
                <tr>
                    <td>
                        <div style="display: inline-flex; align-items: center; gap: 6px; line-height: 1; vertical-align: middle;">
                            <a href="#" onclick="event.preventDefault(); window.showKeHoachDetails('${y.id}')" class="text-blue fw-bold link-hover" style="display: inline-flex; align-items: center; line-height: 1;"><span class="detail-code" style="margin: 0; line-height: 1;">${this.model.getPlanBaseCode(y.maKeHoach)||'<span class="text-muted">(Chưa nhập)</span>'}</span></a>
                            <span style="color: var(--text-muted); font-size: 0.85rem; line-height: 1; display: inline-flex; align-items: center;">-</span>
                            ${L}
                        </div>
                    </td>
                    <td style="min-width: 240px; max-width: 320px;" class="fw-bold text-wrap">${y.tenKeHoach}</td>
                    <td>${y.loaiHinhMuaSam?`<span class="badge ${y.loaiHinhMuaSam==="Dự án"?"badge-info":"badge-warning"}">${y.loaiHinhMuaSam}</span>`:'<span class="text-muted">--</span>'}</td>
                    <td style="min-width: 200px; max-width: 300px;" class="text-muted text-wrap">${y.tenDuAnDuToan||"--"}</td>
                    <td style="min-width: 180px; max-width: 280px;" class="text-wrap">${w?w.tenChuDauTu:'<span class="text-danger">Không rõ</span>'}</td>
                    <td class="text-blue fw-bold">${dt(y.tongMucDauTu)}</td>
                    <td>${rt(y.ngayPheDuyet)}</td>
                    <td>${y.quyetDinhPheDuyet}</td>
                    <td><small class="fw-bold text-muted">${y.thoiGianDangMa?this.model.formatDateWithTime(y.thoiGianDangMa):"--"}</small></td>
                    <td class="text-right">
                        <div class="action-btn-group">
                            ${N}
                            <button class="action-btn btn-delete" onclick="window.deleteKeHoach('${y.id}')" title="Xóa">
                                <i data-lucide="trash-2"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `}).join(""),window.renderTablePagination&&window.renderTablePagination("kehoach-pagination",d,r,c);lucide.createIcons(),this.enhanceTableHeaders("kehoach-table","kehoach")}function Bt(u){const t=document.getElementById("tab-kehoach-detail");if(!t||!t.classList.contains("active")){window.switchTab("kehoach-detail",u);return}if(!this.model.state.kehoach.find(i=>i.id===u))return;const n=document.getElementById("btn-edit-kehoach-fullpage");n&&(n.onclick=()=>{window.editKeHoach(u)}),this.renderPlanVersionDetails(u)}function Mt(u){const t=this.model.state.kehoach.find(T=>T.id===u);if(!t)return;const a=t.rootId||t.id,n=this.model.state.kehoach.filter(T=>(T.rootId||T.id)===a),i={};n.forEach(T=>{const N=T.phienBan||"00";(!i[N]||T.isLatest==1||T.is_latest==1)&&(i[N]=T)});const e=Object.values(i);e.sort((T,N)=>{const D=parseInt(T.phienBan)||0,P=parseInt(N.phienBan)||0;return D-P});const o=this.model.state.chudautu.find(T=>T.id===t.chuDauTuId),h=this.model.getLatestPackages().filter(T=>T.keHoachId===t.id),d=[],r=new Set,c=new Set,g=new Set;h.forEach(T=>{const N=T.rootId,D=T.maGoiThau?T.maGoiThau.trim().toLowerCase():"",P=T.tenGoiThau?T.tenGoiThau.trim().toLowerCase():"";let V=!1;N&&r.has(N)&&(V=!0),D&&D!=="(chưa nhập)"&&c.has(D)&&(V=!0),P&&g.has(P)&&(V=!0),V||(N&&r.add(N),D&&D!=="(chưa nhập)"&&c.add(D),P&&g.add(P),d.push(T))});const s=t.cvDaThucHienList||[],p=t.cvKhongApDungList||[],m=t.cvChuaDuDieuKienList||[];let f="";s.length>0&&(f=`
            <div class="detail-sub-section" style="margin-top: 16px;">
                <h5 class="detail-sub-title" style="color: var(--primary);">I. Phần công việc đã thực hiện</h5>
                <div class="phanlo-table-wrap" style="overflow-x: auto; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-card); margin-top: 8px;">
                    <table class="phanlo-table" style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="background: var(--neutral-soft); text-align: left; border-bottom: 1px solid var(--border-color);">
                                <th style="padding: 10px 14px; font-size: 0.88rem; font-weight: 800; text-transform: uppercase; color: var(--text-muted); text-align: left !important;">Tên phần công việc</th>
                                <th style="padding: 10px 14px; font-size: 0.88rem; font-weight: 800; text-transform: uppercase; color: var(--text-muted); text-align: right !important; width: 180px;">Giá trị (VND)</th>
                                <th style="padding: 10px 14px; font-size: 0.88rem; font-weight: 800; text-transform: uppercase; color: var(--text-muted); text-align: left !important; width: 220px;">Đơn vị thực hiện</th>
                                <th style="padding: 10px 14px; font-size: 0.88rem; font-weight: 800; text-transform: uppercase; color: var(--text-muted); text-align: left !important; width: 220px;">Văn bản phê duyệt</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${s.map(T=>`
                                <tr style="border-bottom: 1px solid var(--border-color);">
                                    <td style="padding: 10px 14px; font-size: 0.88rem; font-weight: 600; color: var(--text-main); text-align: left !important;">${T.tenCongViec}</td>
                                    <td style="padding: 10px 14px; font-size: 0.88rem; font-weight: 700; color: var(--primary); text-align: right !important;">${dt(T.giaTri)}</td>
                                    <td style="padding: 10px 14px; font-size: 0.88rem; font-weight: 600; color: var(--text-muted); text-align: left !important;">${T.donViThucHien||"--"}</td>
                                    <td style="padding: 10px 14px; font-size: 0.88rem; font-weight: 600; color: var(--text-muted); text-align: left !important;">${T.vanBanPheDuyet||"--"}</td>
                                </tr>
                            `).join("")}
                        </tbody>
                    </table>
                </div>
            </div>
        `);let v="";p.length>0&&(v=`
            <div class="detail-sub-section" style="margin-top: 20px;">
                <h5 class="detail-sub-title" style="color: var(--primary);">II. Phần công việc không áp dụng được hình thức LCNT</h5>
                <div class="phanlo-table-wrap" style="overflow-x: auto; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-card); margin-top: 8px;">
                    <table class="phanlo-table" style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="background: var(--neutral-soft); text-align: left; border-bottom: 1px solid var(--border-color);">
                                <th style="padding: 10px 14px; font-size: 0.88rem; font-weight: 800; text-transform: uppercase; color: var(--text-muted); text-align: left !important;">Tên phần công việc</th>
                                <th style="padding: 10px 14px; font-size: 0.88rem; font-weight: 800; text-transform: uppercase; color: var(--text-muted); text-align: right !important; width: 180px;">Giá trị (VND)</th>
                                <th style="padding: 10px 14px; font-size: 0.88rem; font-weight: 800; text-transform: uppercase; color: var(--text-muted); text-align: left !important; width: 300px;">Đơn vị thực hiện</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${p.map(T=>`
                                <tr style="border-bottom: 1px solid var(--border-color);">
                                    <td style="padding: 10px 14px; font-size: 0.88rem; font-weight: 600; color: var(--text-main); text-align: left !important;">${T.tenCongViec}</td>
                                    <td style="padding: 10px 14px; font-size: 0.88rem; font-weight: 700; color: var(--primary); text-align: right !important;">${dt(T.giaTri)}</td>
                                    <td style="padding: 10px 14px; font-size: 0.88rem; font-weight: 600; color: var(--text-muted); text-align: left !important;">${T.donViThucHien||"--"}</td>
                                </tr>
                            `).join("")}
                        </tbody>
                    </table>
                </div>
            </div>
        `);let b="";m.length>0&&(b=`
            <div class="detail-sub-section" style="margin-top: 20px;">
                <h5 class="detail-sub-title" style="color: var(--primary);">III. Phần công việc chưa đủ điều kiện lập kế hoạch LCNT</h5>
                <div class="phanlo-table-wrap" style="overflow-x: auto; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-card); margin-top: 8px;">
                    <table class="phanlo-table" style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="background: var(--neutral-soft); text-align: left; border-bottom: 1px solid var(--border-color);">
                                <th style="padding: 10px 14px; font-size: 0.88rem; font-weight: 800; text-transform: uppercase; color: var(--text-muted); text-align: left !important;">Tên phần công việc</th>
                                <th style="padding: 10px 14px; font-size: 0.88rem; font-weight: 800; text-transform: uppercase; color: var(--text-muted); text-align: right !important; width: 180px;">Giá trị (VND)</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${m.map(T=>`
                                <tr style="border-bottom: 1px solid var(--border-color);">
                                    <td style="padding: 10px 14px; font-size: 0.88rem; font-weight: 600; color: var(--text-main); text-align: left !important;">${T.tenCongViec}</td>
                                    <td style="padding: 10px 14px; font-size: 0.88rem; font-weight: 700; color: var(--primary); text-align: right !important;">${dt(T.giaTri)}</td>
                                </tr>
                            `).join("")}
                        </tbody>
                    </table>
                </div>
            </div>
        `);let y="";t.pheDuyet==="Kế hoạch"&&(y=`
            <div class="detail-item">
                <div class="detail-label">Ngày trình dự toán</div>
                <div class="detail-value">${rt(t.ngayTrinhDuToan)||"--"}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Ngày phê duyệt dự toán</div>
                <div class="detail-value">${rt(t.ngayPheDuyetDuToan)||"--"}</div>
            </div>
            <div class="detail-item" style="grid-column: span 2;">
                <div class="detail-label">Số QĐ phê duyệt dự toán</div>
                <div class="detail-value">${t.soQdPheDuyetDuToan||"--"}</div>
            </div>
        `);let w="";t.loaiHinhMuaSam==="Dự án"&&(w=`
            <div class="detail-item" style="grid-column: span 2;">
                <div class="detail-label">Mã dự án</div>
                <div class="detail-value">${t.maDuan||"--"}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Số QĐ phê duyệt dự án</div>
                <div class="detail-value">${t.soQdPheDuyetDuAn||"--"}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Ngày QĐ phê duyệt dự án</div>
                <div class="detail-value">${rt(t.ngayQdPheDuyetDuAn)||"--"}</div>
            </div>
            <div class="detail-item" style="grid-column: span 2;">
                <div class="detail-label">Cơ quan phê duyệt dự án</div>
                <div class="detail-value">${t.coQuanPheDuyetDuAn||"--"}</div>
            </div>
        `);const x=`
        <div class="detail-section">
            <div class="detail-header-block" style="padding-bottom: 16px; margin-bottom: 20px; border-bottom: 1px solid var(--border-color);">
                <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 10px;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span class="detail-code" style="margin: 0; display: inline-flex; align-items: center; height: 28px; box-sizing: border-box; font-size: 0.85rem; padding: 4px 10px; background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.15); color: var(--primary); border-radius: 4px; font-weight: 700;">${this.model.getPlanBaseCode(t.maKeHoach)||'<span class="text-muted">(Chưa nhập)</span>'}</span>
                        ${e.length>=2?`
                            <span class="version-separator" style="color: var(--text-muted, #64748b); font-weight: 600;">-</span>
                            <select id="fullpage-kh-version-select" class="page-version-select">
                                ${e.map(T=>`<option value="${T.id}" ${T.id===u?"selected":""}>${T.phienBan||"00"}</option>`).join("")}
                            </select>
                        `:""}
                    </div>
                </div>
                <h4 class="detail-title" style="margin: 0; font-size: 1.25rem; font-weight: 800; color: var(--text-main);">${t.tenKeHoach}</h4>
            </div>
            
            <div class="detail-grid">
                <div class="detail-item" style="grid-column: span 2;">
                    <div class="detail-label">Tên Dự án / Dự toán</div>
                    <div class="detail-value text-blue" style="font-size: 1.1rem;">${t.tenDuAnDuToan||"--"}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Hình thức</div>
                    <div class="detail-value">${t.loaiHinhMuaSam?`<span class="badge ${t.loaiHinhMuaSam==="Dự án"?"badge-info":"badge-warning"}">${t.loaiHinhMuaSam}</span>`:'<span class="text-muted">Chưa xác định</span>'}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Phê duyệt</div>
                    <div class="detail-value">${t.pheDuyet?`<span class="badge ${t.pheDuyet==="Kế hoạch"?"badge-info":"badge-success"}">${t.pheDuyet}</span>`:'<span class="text-muted">--</span>'}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Tổng Giá Trị Kế Hoạch</div>
                    <div class="detail-value text-blue" style="font-size: 1.15rem;">${dt(t.tongMucDauTu)}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Thời gian đăng mã kế hoạch</div>
                    <div class="detail-value">${t.thoiGianDangMa?this.model.formatDateWithTime(t.thoiGianDangMa):"--"}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Số QĐ phê duyệt</div>
                    <div class="detail-value">${t.quyetDinhPheDuyet}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Ngày QĐ phê duyệt</div>
                    <div class="detail-value">${rt(t.ngayPheDuyet)}</div>
                </div>
                ${y}
                ${w}
            </div>

            <div class="detail-sub-section">
                <h5 class="detail-sub-title">Thông tin Chủ đầu tư</h5>
                ${o?`
                    <div class="associated-item">
                        <div>
                            <strong style="font-size: 0.9rem;">${o.tenChuDauTu}</strong><br>
                            <small class="text-muted">Mã số thuế: ${o.maSoThue} | Địa chỉ: ${(o.diaChi||"").replace(/\s*\|\s*/g,", ")}</small>
                        </div>
                        <span class="associated-badge">${o.maChuDauTu}</span>
                    </div>
                `:'<div class="text-muted"><small>Không tìm thấy thông tin chủ đầu tư.</small></div>'}
            </div>

            ${f}
            ${v}
            ${b}

            <div class="detail-sub-section" style="margin-top: 20px;">
                <h5 class="detail-sub-title" style="color: var(--primary);">IV. Phần công việc thuộc kế hoạch lựa chọn nhà thầu (Các gói thầu - ${d.length})</h5>
                <div class="associated-list">
                    ${d.length>0?d.map(T=>`
                        <div class="associated-item">
                            <div class="associated-info">
                                <i data-lucide="briefcase" class="text-blue" style="width:16px;"></i>
                                <span><strong>${T.maGoiThau}</strong> - ${T.tenGoiThau}</span>
                            </div>
                            <span class="badge badge-success">${dt(T.giaGoiThau)}</span>
                        </div>
                    `).join(""):'<div class="text-muted"><small>Phiên bản kế hoạch này hiện chưa có gói thầu trực tiếp liên kết.</small></div>'}
                </div>
            </div>
        </div>
    `;document.getElementById("fullpage-kehoach-content").innerHTML=x;const L=document.getElementById("fullpage-kh-version-select");L&&(L.onchange=T=>{this.renderPlanVersionDetails(T.target.value)},window.initCustomSelect&&window.initCustomSelect("fullpage-kh-version-select")),lucide.createIcons()}function gt(u){if(!u)return!1;const t=String(u.danhGiaKetLuan||"").trim().toLowerCase();if(t)return t==="đạt"||t.startsWith("đạt")||t.includes("trúng thầu");const a=String(u.danhGiaHopLe||"").trim().toLowerCase(),n=String(u.danhGiaNangLuc||"").trim().toLowerCase(),i=String(u.danhGiaKyThuat||"").trim().toLowerCase();return a==="đạt"&&n==="đạt"&&i!=="không đạt"&&i!==""}async function Nt(){const u=document.getElementById("goithau-table").querySelector("tbody"),t=document.getElementById("search-goithau").value.toLowerCase(),a=document.getElementById("filter-goithau-trangthai").value,n=document.getElementById("filter-goithau-hinhthuc").value,i=v=>{if(!v)return{year:null,month:null};let b=String(v).replace(/\s*-\s*/," ").trim();if(b.match(/^\d{4}-\d{2}-\d{2}/)){const w=b.substring(0,4),x=parseInt(b.substring(5,7),10).toString();return{year:w,month:x}}else if(b.match(/^\d{2}\/\d{2}\/\d{4}/)){const w=b.split(" ")[0].split("/"),x=w[2],L=parseInt(w[1],10).toString();return{year:x,month:L}}const y=new Date(b);return isNaN(y.getTime())?{year:null,month:null}:{year:y.getFullYear().toString(),month:(y.getMonth()+1).toString()}},e=document.getElementById("filter-goithau-nam"),o=document.getElementById("filter-goithau-thang"),l=this.model.getLatestPackages();if(e&&o){const v=e.value,b=o.value,y=new Set,w=new Set;l.forEach(T=>{const N=T.ngayQuyetDinh;if(N){const D=i(N);D.year&&y.add(D.year),D.month&&w.add(D.month)}});const x=Array.from(y).sort((T,N)=>parseInt(N)-parseInt(T)),L=Array.from(w).sort((T,N)=>parseInt(N)-parseInt(T));e.innerHTML='<option value="">Năm</option>'+x.map(T=>`<option value="${T}">${T}</option>`).join(""),o.innerHTML='<option value="">Tháng</option>'+L.map(T=>`<option value="${T}">Tháng ${T}</option>`).join(""),x.includes(v)&&(e.value=v),L.includes(b)&&(o.value=b),ht("filter-goithau-trangthai"),ht("filter-goithau-hinhthuc"),ht("filter-goithau-nam"),ht("filter-goithau-thang")}const h=e?e.value:"",d=o?o.value:"";let r=[],c=0;const g=this.model.currentPage.goithau||1,s=this.model.pageSize||10,p=this.model.sortState.goithau||{},m=p.field||"",f=p.order||"asc";if(this.model.useServerSidePagination){!u.querySelector(".empty-state")&&u.children.length===0&&(u.innerHTML='<tr><td colspan="8" style="text-align: center; padding: 20px; color: var(--primary); font-weight: bold;">Đang tải dữ liệu từ máy chủ...</td></tr>');try{const v=await fetch(`/api/paginate?table=goithau&page=${g}&pageSize=${s}&search=${encodeURIComponent(t)}&trangThai=${encodeURIComponent(a)}&hinhThuc=${encodeURIComponent(n)}&sortBy=${m}&sortOrder=${f}&nam=${encodeURIComponent(h)}&thang=${encodeURIComponent(d)}`,{headers:{"X-Session-Token":sessionStorage.getItem("bf_session_token")||"","X-Username":sessionStorage.getItem("bf_username")||""}});if(v.ok){const b=await v.json();r=b.items,c=b.totalItems}}catch(v){console.error("Failed to fetch paginated packages",v)}}else{const b=this.model.getFilteredGoiThau().filter(w=>{const x=w.maGoiThau.toLowerCase().includes(t)||w.tenGoiThau.toLowerCase().includes(t),L=!a||w.trangThai===a,T=!n||w.hinhThucLuaChon===n;let N=!0,D=!0;const P=w.ngayQuyetDinh;if(P){const V=i(P);h&&(N=V.year===h),d&&(D=V.month===d)}else(h||d)&&(N=!1,D=!1);return x&&L&&T&&N&&D});m&&b.sort((w,x)=>{let L=w[m]||"",T=x[m]||"";return typeof L=="string"&&(L=L.toLowerCase()),typeof T=="string"&&(T=T.toLowerCase()),L<T?f==="asc"?-1:1:L>T?f==="asc"?1:-1:0}),c=b.length;const y=(g-1)*s;r=b.slice(y,y+s)}if(c===0){u.innerHTML=`
            <tr>
                <td colspan="8">
                    <div class="empty-state">
                        <i data-lucide="archive"></i>
                        <p>Không tìm thấy Gói thầu nào phù hợp</p>
                    </div>
                </td>
            </tr>
        `;const v=document.getElementById("goithau-pagination");v&&(v.innerHTML="")}else window._jvDataMap=window._jvDataMap||{},u.innerHTML=r.map(v=>{const b=v.rootId||v.id,y=v.allVersions||this.model.state.goithau.filter(B=>{if((B.rootId||B.id)!==b)return!1;if(B.keHoachId){const G=(this.model.state.kehoach||[]).find($=>String($.id)===String(B.keHoachId));if(G&&String(G.isLatest)!=="1"&&String(G.is_latest)!=="1")return!1}return!0}).sort((B,G)=>parseInt(G.phienBan)-parseInt(B.phienBan)),w=new Map;y.forEach(B=>{const G=B.phienBan||"00";w.has(G)||w.set(G,B)});const x=Array.from(w.values());this.model.state.selectedPackageVersion||(this.model.state.selectedPackageVersion={});const L=this.model.state.selectedPackageVersion[b]||v.id,T=this.model.state.goithau.find(B=>B.id===L)||v,N=this.model.getLatestPlan(T.keHoachId),D=T.nhaThauTrungThauId?this.model.state.nhathau.find(B=>B.id===T.nhaThauTrungThauId):null,P=T.nhaThauTrungThauId?this.model.state.thongtinmothau.find(B=>String(B.goiThauId)===String(T.id)&&String(B.nhaThauId)===String(T.nhaThauTrungThauId)):null,V=P?P.tenNhaThau:D?D.tenNhaThau:"--",at=P&&P.loaiNhaThau==="Liên danh";let nt;if(at){const B=P.thanhVienLienDanh||[],G=B.find(A=>A.vaiTro==="Đứng đầu liên danh"),$=(G==null?void 0:G.tenNhaThau)||V,O=(G==null?void 0:G.maSoThue)||(D==null?void 0:D.maSoThue)||(D==null?void 0:D.maNhaThau)||P.maDinhDanh||P.maNhaThau||"",I=B.filter(A=>A.vaiTro!=="Đứng đầu liên danh");window._jvDataMap[T.id]={members:I,leadName:$,leadCode:O},nt=`<a href="#" onclick="event.preventDefault(); var d=window._jvDataMap['${T.id}']; d && window.openMoThauJVViewModal(d.members, d.leadName, d.leadCode)" class="fw-bold text-success link-hover" title="Xem thành viên liên danh">👥 ${V}</a>`}else D?nt=`<a href="#" onclick="event.preventDefault(); window.editNhaThau('${D.id}', true)" class="text-blue fw-bold link-hover">${V}</a>`:nt=`<span class="fw-bold text-success">${V}</span>`;let S="--";if(T.phanLo==="Có"){const G=(typeof T.phanLoList=="string"?JSON.parse(T.phanLoList||"[]"):T.phanLoList||[]).filter(O=>O.nhaThauTrungThauId),$=[...new Set(G.map(O=>String(O.nhaThauTrungThauId)).filter(Boolean))];if($.length>1){window._lotWinnersMap=window._lotWinnersMap||{},window._lotWinnersMap[T.id]=G.map(I=>{const A=this.model.state.thongtinmothau.find(C=>String(C.goiThauId)===String(T.id)&&String(C.nhaThauId)===String(I.nhaThauTrungThauId)),F=this.model.state.nhathau.find(C=>C.id===I.nhaThauTrungThauId),tt=A?A.tenNhaThau:F?F.tenNhaThau:"Nhà thầu #"+I.nhaThauTrungThauId,_=A&&A.loaiNhaThau==="Liên danh";let k=null;if(_){const C=A.thanhVienLienDanh||[],j=C.find(Y=>Y.vaiTro==="Đứng đầu liên danh"),Q=(j==null?void 0:j.tenNhaThau)||tt,W=(j==null?void 0:j.maSoThue)||(F==null?void 0:F.maSoThue)||(F==null?void 0:F.maNhaThau)||A.maDinhDanh||A.maNhaThau||"";k={members:C.filter(Y=>Y.vaiTro!=="Đứng đầu liên danh"),leadName:Q,leadCode:W}}return{maPhanLo:I.maPhanLo,tenPhanLo:I.tenPhanLo,nhaThauTrungThauId:I.nhaThauTrungThauId,tenNhaThau:tt,giaTrungThau:I.giaTrungThau,isJV:_,jvData:k}});const O=G.reduce((I,A)=>I+(parseFloat(A.giaTrungThau)||0),0);S=`<a href="#" onclick="event.preventDefault(); window.showLotWinnersModal('${T.id}')" class="text-blue fw-bold link-hover" style="text-decoration: none;" title="Xem chi tiết các nhà thầu trúng thầu">Có nhiều nhà thầu trúng thầu</a><br><small class="text-muted">Tổng giá: ${this.model.formatCurrency(O)}</small>`}else if($.length===1){const O=$[0],I=this.model.state.nhathau.find(k=>String(k.id)===String(O)),A=this.model.state.thongtinmothau.find(k=>String(k.goiThauId)===String(T.id)&&String(k.nhaThauId)===String(O)),F=A?A.tenNhaThau:I?I.tenNhaThau:"Nhà thầu #"+O,tt=G.reduce((k,C)=>k+(parseFloat(C.giaTrungThau)||0),0);let _;if(A&&A.loaiNhaThau==="Liên danh"){const k=A.thanhVienLienDanh||[],C=k.find(U=>U.vaiTro==="Đứng đầu liên danh"),j=(C==null?void 0:C.tenNhaThau)||F,Q=(C==null?void 0:C.maSoThue)||(I==null?void 0:I.maSoThue)||(I==null?void 0:I.maNhaThau)||A.maDinhDanh||A.maNhaThau||"",W=k.filter(U=>U.vaiTro!=="Đứng đầu liên danh");window._jvDataMap[T.id]={members:W,leadName:j,leadCode:Q},_=`<a href="#" onclick="event.preventDefault(); var d=window._jvDataMap['${T.id}']; d && window.openMoThauJVViewModal(d.members, d.leadName, d.leadCode)" class="fw-bold text-success link-hover" title="Xem thành viên liên danh">👥 ${F}</a>`}else I?_=`<a href="#" onclick="event.preventDefault(); window.editNhaThau('${I.id}', true)" class="text-blue fw-bold link-hover">${F}</a>`:_=`<span class="fw-bold text-success">${F}</span>`;S=`${_}<br><small class="text-muted">Giá: ${this.model.formatCurrency(tt)}</small>`}else S="--"}else S=T.nhaThauTrungThauId?nt+'<br><small class="text-muted">Giá: '+this.model.formatCurrency(T.giaTrungThau)+"</small>":"--";const M=x.map(B=>{const G=B.phienBan||"00",$=B.id===T.id?"selected":"";return`<option value="${B.id}" ${$}>${G}</option>`}).join(""),z=`
                <select class="form-control version-droplist" onchange="window.changePackageRowVersion('${b}', this.value)" style="width: 52px; display: inline-block; padding: 2px; height: 22px; font-size: 0.8rem; border-radius: 4px; border: 1px solid var(--border-color, #ccc); background-color: var(--bg-card); color: var(--text-main); text-align-last: center; cursor: pointer; margin: 0; outline: none; vertical-align: middle;">
                    ${M}
                </select>
            `,K=T.id===v.id,H=T.trangThai==="Đã có kết quả"||T.trangThai==="Hủy thầu";let q="";return K&&(H?q=`
                        <button class="action-btn btn-view" onclick="window.editGoiThau('${T.id}', true)" title="Xem chi tiết Gói thầu">
                            <i data-lucide="eye" style="color: var(--primary);"></i>
                        </button>
                        <button class="action-btn btn-delete" onclick="window.deleteGoiThau('${T.id}')" title="Xóa">
                            <i data-lucide="trash-2"></i>
                        </button>
                    `:q=`
                        <button class="action-btn btn-edit" onclick="window.editGoiThau('${T.id}')" title="Sửa">
                            <i data-lucide="edit-2"></i>
                        </button>
                        <button class="action-btn btn-delete" onclick="window.deleteGoiThau('${T.id}')" title="Xóa">
                            <i data-lucide="trash-2"></i>
                        </button>
                    `),`
                <tr>
                    <td>
                        <div style="display: inline-flex; align-items: center; gap: 6px; line-height: 1; vertical-align: middle;">
                            <a href="#" onclick="event.preventDefault(); window.showPackageDetails('${T.id}')" class="text-blue fw-bold link-hover" title="Xem chi tiết Gói thầu" style="display: inline-flex; align-items: center; line-height: 1;"><span class="detail-code" style="margin: 0; line-height: 1;">${this.model.getPackageBaseCode(T.maGoiThau)||'<span class="text-muted">(Chưa nhập)</span>'}</span></a>
                            <span style="color: var(--text-muted); font-size: 0.85rem; line-height: 1; display: inline-flex; align-items: center;">-</span>
                            ${z}
                        </div>
                    </td>
                    <td style="min-width: 240px; max-width: 320px;" class="text-wrap"><a href="#" onclick="event.preventDefault(); window.showPackageDetails('${T.id}')" class="text-blue fw-bold link-hover">${T.tenGoiThau}</a></td>
                    <td style="min-width: 240px; max-width: 320px;" class="text-wrap">${N?`<a href="#" onclick="event.preventDefault(); window.showKeHoachDetails('`+N.id+`')" class="text-blue fw-bold link-hover">`+N.tenKeHoach+"</a>":'<span class="text-danger">Không liên kết</span>'}</td>
                    <td class="fw-bold">${this.model.formatCurrency(T.giaGoiThau)}</td>
                    <td>${T.hinhThucLuaChon}</td>
                    <td>${this.getStatusBadge(T.trangThai)}</td>
                    <td style="min-width: 200px; max-width: 300px;" class="text-wrap">${S}</td>
                    <td class="text-right">
                        <div class="action-btn-group">
                            ${q}
                        </div>
                    </td>
                </tr>
            `}).join(""),window.renderTablePagination&&window.renderTablePagination("goithau-pagination",c,g,s);lucide.createIcons(),this.enhanceTableHeaders("goithau-table","goithau")}function Gt(u){const t=document.getElementById("form-goithau"),a=document.querySelector("#modal-goithau .modal-card");t&&a&&!a.contains(t)&&a.appendChild(t),window._editingInPlace=!1;const n=document.getElementById("detail-workflow-tabs-header");n&&(n.style.display="flex");const i=document.getElementById("tab-goithau-detail");if(!i||!i.classList.contains("active")){window.switchTab("goithau-detail",u);return}this._currentWorkflowPackageId!==u&&(this._inPlaceEditMode=!1,this._biddingInfoEditMode=!1);const e=this.model.state.goithau.find(L=>L.id===u);if(!e)return;const o=e.phuongThucLuaChon==="Một giai đoạn hai túi hồ sơ";let l=!1,h=!1,d=!1;if(e.danhGiaHsdtMetadata)try{const L=JSON.parse(e.danhGiaHsdtMetadata);o?L.is1G2T&&(l=!!(L.technical&&L.technical.saved),h=!!(L.financial&&L.financial.saved)):d=!!L.saved}catch(L){console.error("Error parsing evaluation metadata:",L)}const g=this.model.state.thongtinmothau.filter(L=>String(L.goiThauId)===String(e.id)).filter(gt).some(L=>L.giaDuThau&&L.giaDuThau>0),s=[{id:"preparation",label:"Thông tin gói thầu"}];if(e.trangThai==="Chuẩn bị")s.push({id:"preparation_action",label:"Chuẩn bị"});else if(o){s.push({id:"opening_tech",label:e.trangThai==="Đang mời thầu"?"Thông tin mời thầu":"Biên bản mở HSĐXKT"}),e.trangThai!=="Đang mời thầu"&&e.trangThai!=="Đã mở thầu"&&s.push({id:"eval_tech",label:"Báo cáo đánh giá E-HSĐXKT"});let L=!1;if(e.danhGiaHsdtMetadata)try{const T=JSON.parse(e.danhGiaHsdtMetadata);T.is1G2T&&T.technical&&(L=!!T.technical.qualifiedSaved)}catch{}l&&s.push({id:"qualified",label:"Danh sách nhà thầu đạt kỹ thuật"}),l&&L&&s.push({id:"opening_fin",label:"Biên bản mở E-HSĐXTC"}),l&&L&&g&&s.push({id:"eval_fin",label:"Báo cáo đánh giá E-HSĐXTC"}),l&&L&&g&&(h||e.trangThai==="Đã có kết quả")&&s.push({id:"result",label:"Kết quả lựa chọn nhà thầu"})}else s.push({id:"opening",label:e.trangThai==="Đang mời thầu"?"Thông tin mời thầu":"Biên bản mở thầu"}),e.trangThai!=="Đang mời thầu"&&e.trangThai!=="Đã mở thầu"&&s.push({id:"eval_tech",label:"Báo cáo đánh giá E-HSDT"}),(d||e.trangThai==="Đã có kết quả")&&s.push({id:"result",label:"Kết quả lựa chọn nhà thầu"});(!s.some(L=>L.id===this._currentWorkflowTab)||this._currentWorkflowPackageId!==u)&&(this._currentWorkflowTab=s[0]?s[0].id:"preparation",this._currentWorkflowPackageId=u);const p=document.getElementById("btn-edit-goithau-fullpage"),m=document.getElementById("btn-edit-award-result");p&&(this._currentWorkflowTab==="preparation"&&e.trangThai!=="Đang chấm thầu"&&e.trangThai!=="Đã có kết quả"&&e.trangThai!=="Hủy thầu"&&!this._inPlaceEditMode?(p.style.display="flex",p.onclick=()=>{this._inPlaceEditMode=!0,this.showPackageDetails(u)}):p.style.display="none"),m&&(this._currentWorkflowTab==="result"&&(e.trangThai==="Đã có kết quả"||e.trangThai==="Hủy thầu")?(m.style.display="flex",m.onclick=async()=>{e.trangThai="Đang chấm thầu";const L=["Không đạt yêu cầu về tính hợp lệ","Không đạt yêu cầu về năng lực, kinh nghiệm","Không đạt yêu cầu kỹ thuật","Nhà thầu xếp hạng 1 trúng thầu","Đánh giá theo quy trình 2. Nhà thầu giá thấp hơn trúng thầu",""];this.model.state.thongtinmothau.filter(N=>String(N.goiThauId)===String(u)).forEach(N=>{N.lyDoTruot&&L.includes(N.lyDoTruot.trim())&&(N.lyDoTruot="")}),this.model.persistData("thongtinmothau"),this.model.persistData("goithau"),window.appController.autoSync(),this.showPackageDetails(u)}):m.style.display="none"),this.model.getLatestPlan(e.keHoachId);const f=document.getElementById("detail-workflow-code"),v=document.getElementById("detail-workflow-status-badge"),b=document.getElementById("detail-workflow-title");f&&(f.innerText=e.maGoiThau||"Gói thầu"),v&&(v.innerHTML=this.getStatusBadge(e.trangThai)),b&&(b.innerText=e.tenGoiThau||"Chưa nhập tên");const y=document.getElementById("detail-workflow-version-select");if(y){const L=e.rootId||e.id,T=this.model.state.goithau.filter(V=>(V.rootId||V.id)===L),N={};T.forEach(V=>{const at=V.phienBan||"00";if(!N[at])N[at]=V;else{const nt=this.model.getLatestPlan(V.keHoachId),S=this.model.getLatestPlan(N[at].keHoachId),M=nt&&parseInt(nt.phienBan)||0,z=S&&parseInt(S.phienBan)||0;M>z&&(N[at]=V)}});const D=Object.values(N);D.sort((V,at)=>parseInt(V.phienBan||0)-parseInt(at.phienBan||0));const P=document.getElementById("detail-workflow-version-separator");D.length>=2?(P&&(P.style.display="inline-block"),y.style.display="inline-block",y.innerHTML=D.map(V=>{const at=V.phienBan||"00",nt=(V.phienBan||"00")===(e.phienBan||"00");return`<option value="${V.id}" ${nt?"selected":""}>${at}</option>`}).join(""),y.onchange=V=>{this.showPackageDetails(V.target.value)},window.initCustomSelect&&window.initCustomSelect("detail-workflow-version-select")):(P&&(P.style.display="none"),y.style.display="none")}const w=document.getElementById("detail-workflow-tabs-header");w&&(w.style.display="flex",w.innerHTML=s.map(L=>{const T=this._currentWorkflowTab===L.id?"active":"",N=this._currentWorkflowTab===L.id?"background: var(--bg-card); color: var(--primary); border: 1px solid var(--border-color); border-bottom: 2px solid var(--primary); font-weight: 700;":"background: transparent; color: var(--text-muted); border: 1px solid transparent; cursor: pointer;";return`<button type="button" class="btn ${T}" data-workflow-tab="${L.id}" style="padding: 10px 18px; border-radius: var(--radius-md) var(--radius-md) 0 0; font-size: 0.82rem; transition: all 0.2s; ${N}">${L.label}</button>`}).join(""),w.querySelectorAll("[data-workflow-tab]").forEach(L=>{L.addEventListener("click",()=>{this._inPlaceEditMode=!1,this._biddingInfoEditMode=!1,this._currentWorkflowTab=L.getAttribute("data-workflow-tab"),this.showPackageDetails(u)})}));const x=document.getElementById("detail-workflow-content-wrapper");if(x){switch(x.innerHTML="",this._currentWorkflowTab){case"preparation":{const S=this.model.getLatestPlan(e.keHoachId),M=S?this.model.state.chudautu.find(H=>H.id===S.chuDauTuId):null,z=M?M.tenChuDauTu:"Không rõ",K=S?S.tenKeHoach:"Không rõ";if(e.trangThai==="Chuẩn bị"?`${e.id}`:`${e.trangThai}`,x.innerHTML=`
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px; margin-bottom: 24px;">
                        <!-- Cột 1: Thông tin chung -->
                        <div class="card" style="padding: 20px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-card); display: flex; flex-direction: column; justify-content: space-between;">
                            <div>
                                <h4 style="font-weight: 700; color: var(--primary); border-bottom: 2px solid rgba(59, 130, 246, 0.1); padding-bottom: 8px; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; font-size: 0.95rem;">
                                    <i data-lucide="info" style="width: 18px; height: 18px;"></i> Thông tin chung
                                </h4>
                                <div style="display: flex; flex-direction: column; gap: 10px;">
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Mã TBMT</span>
                                        <span style="color: var(--text-main); font-weight: 700;">${e.maGoiThau||"--"}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Tên gói thầu</span>
                                        <span style="color: var(--text-main); font-weight: 700; max-width: 60%; text-align: right; word-break: break-word;">${e.tenGoiThau||"--"}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Chủ đầu tư</span>
                                        <span style="color: var(--text-main); font-weight: 700; max-width: 60%; text-align: right;">${z}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Kế hoạch liên kết</span>
                                        <span style="color: var(--text-main); font-weight: 700; max-width: 60%; text-align: right;">${K}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Lĩnh vực</span>
                                        <span style="color: var(--text-main); font-weight: 700;">${e.linhVuc||"--"}${e.linhVuc==="Hàng hóa"?e.isThuoc==1?" (Thuốc)":" (Không phải thuốc)":""}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Giá gói thầu</span>
                                        <span style="color: var(--primary); font-weight: 800;">${this.model.formatCurrency(e.giaGoiThau)||"--"}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Nguồn vốn</span>
                                        <span style="color: var(--text-main); font-weight: 700; max-width: 60%; text-align: right;">${e.nguonVon||"--"}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Cột 2: Hình thức & Phương thức -->
                        <div class="card" style="padding: 20px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-card); display: flex; flex-direction: column; justify-content: space-between;">
                            <div>
                                <h4 style="font-weight: 700; color: var(--primary); border-bottom: 2px solid rgba(59, 130, 246, 0.1); padding-bottom: 8px; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; font-size: 0.95rem;">
                                    <i data-lucide="layers" style="width: 18px; height: 18px;"></i> Hình thức & Phương thức
                                </h4>
                                <div style="display: flex; flex-direction: column; gap: 10px;">
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Hình thức LCNT</span>
                                        <span style="color: var(--text-main); font-weight: 700;">${e.hinhThucLuaChon||"--"}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Phương thức LCNT</span>
                                        <span style="color: var(--text-main); font-weight: 700;">${e.phuongThucLuaChon||"--"}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Phương pháp đánh giá</span>
                                        <span style="color: var(--text-main); font-weight: 700;">${e.phuongPhapDanhGia||"--"}</span>
                                    </div>
                                    ${e.trongSoKyThuat?`
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Trọng số kỹ thuật (%)</span>
                                        <span style="color: var(--text-main); font-weight: 700;">${e.trongSoKyThuat}%</span>
                                    </div>`:""}
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Đấu thầu qua mạng</span>
                                        <span style="color: var(--text-main); font-weight: 700;">${e.quaMang||"Qua mạng"}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Phân lô</span>
                                        <span style="color: var(--text-main); font-weight: 700;">${e.phanLo||"Không"}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Tùy chọn mua thêm</span>
                                        <span style="color: var(--text-main); font-weight: 700;">${e.tuyChonMuaThem||"Không"}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Cột 3: Thời gian & Tiến độ -->
                        <div class="card" style="padding: 20px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-card); display: flex; flex-direction: column; justify-content: space-between;">
                            <div>
                                <h4 style="font-weight: 700; color: var(--primary); border-bottom: 2px solid rgba(59, 130, 246, 0.1); padding-bottom: 8px; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; font-size: 0.95rem;">
                                    <i data-lucide="calendar" style="width: 18px; height: 18px;"></i> Thời gian & Tiến độ
                                </h4>
                                <div style="display: flex; flex-direction: column; gap: 10px;">
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Thời gian thực hiện</span>
                                        <span style="color: var(--text-main); font-weight: 700;">${e.thoiGianThucHien||"--"}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Thời gian tổ chức LCNT</span>
                                        <span style="color: var(--text-main); font-weight: 700;">${e.thoiGianToChuc||"--"}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Bắt đầu tổ chức</span>
                                        <span style="color: var(--text-main); font-weight: 700;">${e.thoiGianBatDauToChuc||"--"}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Thời gian đăng tải</span>
                                        ${this._inPlaceEditMode?`
                                            <input type="datetime-local" id="ip-dangtai" class="form-control" style="width: 160px; height: 28px; padding: 2px 8px; font-size: 0.83rem; text-align: right;" value="${e.thoiGianDangTai?this.model.formatForDatetimeLocal(e.thoiGianDangTai):""}">
                                        `:`
                                            <span style="color: var(--text-main); font-weight: 700;">${e.thoiGianDangTai?this.model.formatDateWithTime(e.thoiGianDangTai):"--"}</span>
                                        `}
                                    </div>
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Thời gian đóng thầu</span>
                                        ${this._inPlaceEditMode?`
                                            <input type="datetime-local" id="ip-dongthau" class="form-control" style="width: 160px; height: 28px; padding: 2px 8px; font-size: 0.83rem; text-align: right;" value="${e.thoiGianDongThau?this.model.formatForDatetimeLocal(e.thoiGianDongThau):""}">
                                        `:`
                                            <span style="color: var(--text-main); font-weight: 700;">${e.thoiGianDongThau?this.model.formatDateWithTime(e.thoiGianDongThau):"--"}</span>
                                        `}
                                    </div>
                                    <div style="display: flex; justify-content: space-between; padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Thời gian mở thầu</span>
                                        ${this._inPlaceEditMode?`
                                            <input type="datetime-local" id="ip-mothau" class="form-control" style="width: 160px; height: 28px; padding: 2px 8px; font-size: 0.83rem; text-align: right;" value="${e.thoiGianMoThau?this.model.formatForDatetimeLocal(e.thoiGianMoThau):""}">
                                        `:`
                                            <span style="color: var(--text-main); font-weight: 700;">${e.thoiGianMoThau?this.model.formatDateWithTime(e.thoiGianMoThau):"--"}</span>
                                        `}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Cột 4: Quyết định & Thẩm định HSMT (Trải ngang full chiều rộng) -->
                    <div class="card" style="padding: 20px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-card); margin-bottom: 24px;">
                            <h4 style="font-weight: 700; color: var(--primary); border-bottom: 2px solid rgba(59, 130, 246, 0.1); padding-bottom: 8px; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; font-size: 0.95rem;">
                                <i data-lucide="file-text" style="width: 18px; height: 18px;"></i> Quyết định & Thẩm định HSMT
                            </h4>
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px;">
                                <div style="display: flex; flex-direction: column; gap: 10px;">
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Số quyết định phê duyệt HSMT</span>
                                        ${this._inPlaceEditMode?`
                                            <input type="text" id="ip-soquyetdinh" class="form-control" style="width: 180px; height: 28px; padding: 2px 8px; font-size: 0.83rem; text-align: right;" value="${e.soQuyetDinh||""}" placeholder="Nhập số quyết định">
                                        `:`
                                            <span style="color: var(--text-main); font-weight: 700;">${e.soQuyetDinh||"--"}</span>
                                        `}
                                    </div>
                                    <div style="display: flex; justify-content: space-between; padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Ngày quyết định phê duyệt HSMT</span>
                                        ${this._inPlaceEditMode?`
                                            <input type="date" id="ip-ngayquyetdinh" class="form-control" style="width: 180px; height: 28px; padding: 2px 8px; font-size: 0.83rem; text-align: right;" value="${e.ngayQuyetDinh?this.model.formatForDateInput(e.ngayQuyetDinh):""}">
                                        `:`
                                            <span style="color: var(--text-main); font-weight: 700;">${e.ngayQuyetDinh?this.model.formatDate(e.ngayQuyetDinh):"--"}</span>
                                        `}
                                    </div>
                                </div>
                                <div style="display: flex; flex-direction: column; gap: 10px;">
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Yêu cầu thẩm định HSMT</span>
                                        ${this._inPlaceEditMode?`
                                            <select id="ip-yeucauthamdinh" class="form-control" style="width: 180px; height: 28px; padding: 2px 8px; font-size: 0.83rem; text-align-last: right;">
                                                <option value="Có" ${e.yeuCauThamDinhHsmt==="Có"?"selected":""}>Có</option>
                                                <option value="Không" ${e.yeuCauThamDinhHsmt==="Không"||!e.yeuCauThamDinhHsmt?"selected":""}>Không</option>
                                            </select>
                                        `:`
                                            <span style="color: var(--text-main); font-weight: 700;">${e.yeuCauThamDinhHsmt||"Không"}</span>
                                        `}
                                    </div>
                                    <div id="wrapper-sobaocaothamdinh" style="display: ${this._inPlaceEditMode||e.yeuCauThamDinhHsmt==="Có"?"flex":"none"}; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Số báo cáo thẩm định HSMT</span>
                                        ${this._inPlaceEditMode?`
                                            <input type="text" id="ip-sobaocaothamdinh" class="form-control" style="width: 180px; height: 28px; padding: 2px 8px; font-size: 0.83rem; text-align: right;" value="${e.soBaoCaoThamDinhHsmt||""}" placeholder="Nhập số báo cáo">
                                        `:`
                                            <span style="color: var(--text-main); font-weight: 700;">${e.soBaoCaoThamDinhHsmt||"--"}</span>
                                        `}
                                    </div>
                                    <div id="wrapper-ngaybaocaothamdinh" style="display: ${this._inPlaceEditMode||e.yeuCauThamDinhHsmt==="Có"?"flex":"none"}; justify-content: space-between; padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Ngày báo cáo thẩm định HSMT</span>
                                        ${this._inPlaceEditMode?`
                                            <input type="date" id="ip-ngaybaocaothamdinh" class="form-control" style="width: 180px; height: 28px; padding: 2px 8px; font-size: 0.83rem; text-align: right;" value="${e.ngayBaoCaoThamDinhHsmt?this.model.formatForDateInput(e.ngayBaoCaoThamDinhHsmt):""}">
                                        `:`
                                            <span style="color: var(--text-main); font-weight: 700;">${e.ngayBaoCaoThamDinhHsmt?this.model.formatDate(e.ngayBaoCaoThamDinhHsmt):"--"}</span>
                                        `}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ${this._inPlaceEditMode?`
                        <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 20px;">
                            <button id="btn-cancel-inplace" class="btn btn-outline" style="padding: 8px 20px; font-weight: 700; border-radius: var(--radius-md);">Hủy</button>
                            <button id="btn-save-inplace" class="btn btn-primary" style="padding: 8px 20px; font-weight: 700; border-radius: var(--radius-md);">Lưu</button>
                        </div>
                    `:""}
                `,lucide.createIcons(),this._inPlaceEditMode){const H=document.getElementById("ip-yeucauthamdinh");if(H){const G=()=>{const $=H.value==="Có";document.getElementById("wrapper-sobaocaothamdinh").style.display=$?"flex":"none",document.getElementById("wrapper-ngaybaocaothamdinh").style.display=$?"flex":"none"};H.onchange=G,G()}const q=document.getElementById("btn-save-inplace");q&&(q.onclick=async()=>{const G=document.getElementById("ip-dangtai").value,$=document.getElementById("ip-dongthau").value,O=document.getElementById("ip-mothau").value,I=document.getElementById("ip-soquyetdinh").value,A=document.getElementById("ip-ngayquyetdinh").value,F=document.getElementById("ip-yeucauthamdinh").value,tt=document.getElementById("ip-sobaocaothamdinh").value,_=document.getElementById("ip-ngaybaocaothamdinh").value,k={thoiGianDangTai:G?this.model.convertDMYHMSToYMDHMS(G):"",thoiGianDongThau:$?this.model.convertDMYHMSToYMDHMS($):"",thoiGianMoThau:O?this.model.convertDMYHMSToYMDHMS(O):"",soQuyetDinh:I,ngayQuyetDinh:A?this.model.convertDMYToYMD(A):"",yeuCauThamDinhHsmt:F,soBaoCaoThamDinhHsmt:F==="Không"?"":tt,ngayBaoCaoThamDinhHsmt:F==="Không"||!_?"":this.model.convertDMYToYMD(_)},C=e.thoiGianDangTai?String(e.thoiGianDangTai).trim():"",j=String(k.thoiGianDangTai||"").trim(),Q=e.thoiGianDongThau?String(e.thoiGianDongThau).trim():"",W=String(k.thoiGianDongThau||"").trim(),U=e.thoiGianMoThau?String(e.thoiGianMoThau).trim():"",Y=String(k.thoiGianMoThau||"").trim();let et=!1;if(C!==""){const E=(ot,J)=>{if(!ot&&!J)return!1;if(!ot||!J)return!0;const lt=new Date(ot),st=new Date(J);return isNaN(lt.getTime())||isNaN(st.getTime())?ot!==J:lt.getTime()!==st.getTime()},Z=E(C,j),X=E(Q,W),it=E(U,Y);(Z||X||it)&&(et=!0)}let R=u;if(et){const E=e.rootId||e.id,Z=this.model.state.goithau.filter(J=>(J.rootId||J.id)===E),X=Math.max(...Z.map(J=>parseInt(J.phienBan)||0)),it=String(X+1).padStart(2,"0");Z.forEach(J=>{J.isLatest=0,J.is_latest=0});const ot=window.generateUUID();if(R=ot,this.model.state.selectedPackageVersion||(this.model.state.selectedPackageVersion={}),this.model.state.selectedPackageVersion[E]=ot,this.model.state.goithau.push({...e,...k,id:ot,phienBan:it,isLatest:1,is_latest:1,rootId:E,createdAt:e.createdAt||Math.floor(Date.now()/1e3),created_at:e.created_at||Math.floor(Date.now()/1e3),updatedAt:Math.floor(Date.now()/1e3),updated_at:Math.floor(Date.now()/1e3)}),Array.isArray(this.model.state.hopdong)&&(this.model.state.hopdong=this.model.state.hopdong.map(J=>{if(J.goiThauIds&&J.goiThauIds.includes(u)){const lt=[...J.goiThauIds];return lt.includes(ot)||lt.push(ot),{...J,goiThauIds:lt}}return J}),this.model.persistData("hopdong")),Array.isArray(this.model.state.thongtinmothau)){const lt=this.model.state.thongtinmothau.filter(st=>String(st.goiThauId)===String(u)).map(st=>({...st,id:window.generateUUID(),goiThauId:ot}));this.model.state.thongtinmothau=[...this.model.state.thongtinmothau,...lt],this.model.persistData("thongtinmothau")}}else Object.assign(e,k),e.updatedAt=Math.floor(Date.now()/1e3),e.updated_at=e.updatedAt;if(await this.model.persistData("goithau"),window.appController&&typeof window.appController.autoSync=="function")try{await window.appController.autoSync()}catch(E){console.error("Sync failed:",E)}this._inPlaceEditMode=!1,this.showPackageDetails(R),await this.customAlert("Thành công","Cập nhật thông tin gói thầu thành công!","check-circle")});const B=document.getElementById("btn-cancel-inplace");B&&(B.onclick=()=>{this._inPlaceEditMode=!1,this.showPackageDetails(u)})}}break;case"preparation_action":{let S="";e.trangThai==="Chuẩn bị"?S=`
                        <div style="width: 64px; height: 64px; border-radius: 50%; background: rgba(245, 158, 11, 0.08); display: flex; align-items: center; justify-content: center; margin: 0 auto 20px;">
                            <i data-lucide="settings" style="width: 32px; height: 32px; color: #f59e0b;"></i>
                        </div>
                        <h4 style="font-weight: 700; color: var(--text-main); margin-bottom: 8px; font-size: 1.1rem;">Gói thầu đang trong giai đoạn Chuẩn bị</h4>
                        <p style="font-size: 0.85rem; margin-bottom: 24px; max-width: 460px; margin-left: auto; margin-right: auto; line-height: 1.5; color: var(--text-muted);">
                            Gói thầu này hiện đang trong giai đoạn Chuẩn bị và chưa phát hành hồ sơ mời thầu. Vui lòng phát hành HSMT để bắt đầu quá trình mời thầu và nhận hồ sơ thầu.
                        </p>
                        <button class="btn btn-primary" onclick="window.phatHanhHsmtGoiThau('${e.id}')" style="padding: 10px 24px; font-weight: 700; display: inline-flex; align-items: center; gap: 8px; border-radius: var(--radius-md); margin: 0 auto;">
                            <i data-lucide="send"></i> Phát hành HSMT & Mời thầu
                        </button>
                    `:S=`
                        <div style="width: 64px; height: 64px; border-radius: 50%; background: rgba(16, 185, 129, 0.08); display: flex; align-items: center; justify-content: center; margin: 0 auto 20px;">
                            <i data-lucide="check-circle" style="width: 32px; height: 32px; color: #10b981;"></i>
                        </div>
                        <h4 style="font-weight: 700; color: var(--text-main); margin-bottom: 8px; font-size: 1.1rem;">Gói thầu đã phát hành HSMT</h4>
                        <p style="font-size: 0.85rem; max-width: 460px; margin-left: auto; margin-right: auto; line-height: 1.5; color: var(--text-muted);">
                            Gói thầu này đã hoàn thành bước chuẩn bị và đã phát hành hồ sơ mời thầu (Trạng thái hiện tại: <strong style="color: var(--primary);">${e.trangThai}</strong>). Bạn có thể chuyển sang các tab tiếp theo để xem/nhập thông tin mở thầu và chấm thầu.
                        </p>
                    `,x.innerHTML=`
                    <div style="text-align: center; padding: 48px; color: var(--text-muted); background: var(--bg-card); border-radius: var(--radius-lg); border: 1px dashed var(--border-color); margin: 20px 0; display: flex; flex-direction: column; align-items: center; justify-content: center;">
                        ${S}
                    </div>
                `,lucide.createIcons()}break;case"opening":case"opening_tech":if(e.trangThai==="Chuẩn bị"){const S=this.model.getLatestPlan(e.keHoachId),M=S?this.model.state.chudautu.find(K=>K.id===S.chuDauTuId):null,z=M?M.tenChuDauTu:"Không rõ";x.innerHTML=`
                    <div style="background: var(--neutral-soft); padding: 16px 20px; border-radius: var(--radius-md); border: 1px solid var(--border-color); margin-bottom: 20px;">
                        <div style="font-weight: 700; color: var(--primary); border-bottom: 1px solid rgba(59, 130, 246, 0.2); padding-bottom: 4px; margin-bottom: 12px;">Thông số Gói thầu</div>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 8px; font-size: 0.82rem;">
                            <div>• <strong>Chủ đầu tư:</strong> <span class="text-dark fw-bold">${z}</span></div>
                            <div>• <strong>Lĩnh vực:</strong> ${e.linhVuc||"Hàng hóa"}${e.linhVuc==="Hàng hóa"?e.isThuoc===1||e.isThuoc==="1"?" (Thuốc)":" (Không phải thuốc)":""}</div>
                            <div>• <strong>Phương thức LCNT:</strong> ${e.phuongThucLuaChon||"Một giai đoạn một túi hồ sơ"}</div>
                            <div>• <strong>Phân lô:</strong> ${e.phanLo==="Có"?"Có chia phần lô":"Không chia phần lô"}</div>
                            <div>• <strong>Giá gói thầu:</strong> <span class="text-blue fw-bold">${this.model.formatCurrency(e.giaGoiThau)}</span></div>
                            <div>• <strong>Hình thức LCNT:</strong> ${e.hinhThucLuaChon||"--"}</div>
                            <div>• <strong>Loại hợp đồng:</strong> ${e.loaiHopDong||"--"}</div>
                            <div>• <strong>Thời gian thực hiện:</strong> ${e.thoiGianThucHien||"--"}</div>
                            <div>• <strong>Nguồn vốn:</strong> ${e.nguonVon||"--"}</div>
                            <div>• <strong>Thời gian đóng thầu:</strong> ${e.thoiGianDongThau?this.model.formatDateWithTime(e.thoiGianDongThau):"--"}</div>
                            <div>• <strong>Thời gian mở thầu:</strong> ${e.thoiGianMoThau?this.model.formatDateWithTime(e.thoiGianMoThau):"--"}</div>
                        </div>
                    </div>

                    <div style="text-align: center; padding: 48px; color: var(--text-muted); background: var(--bg-card); border-radius: var(--radius-lg); border: 1px dashed var(--border-color); margin: 20px 0;">
                        <div style="width: 64px; height: 64px; border-radius: 50%; background: rgba(245, 158, 11, 0.08); display: flex; align-items: center; justify-content: center; margin: 0 auto 20px;">
                            <i data-lucide="settings" style="width: 32px; height: 32px; color: #f59e0b;"></i>
                        </div>
                        <h4 style="font-weight: 700; color: var(--text-main); margin-bottom: 8px; font-size: 1.1rem;">Gói thầu đang trong giai đoạn Chuẩn bị</h4>
                        <p style="font-size: 0.85rem; margin-bottom: 24px; max-width: 460px; margin-left: auto; margin-right: auto; line-height: 1.5; color: var(--text-muted);">
                            Gói thầu này hiện đang trong giai đoạn Chuẩn bị và chưa phát hành hồ sơ mời thầu. Vui lòng phát hành HSMT để bắt đầu quá trình mời thầu và nhận hồ sơ thầu.
                        </p>
                        <button class="btn btn-primary" onclick="window.phatHanhHsmtGoiThau('${e.id}')" style="padding: 10px 24px; font-weight: 700; display: inline-flex; align-items: center; gap: 8px; border-radius: var(--radius-md);">
                            <i data-lucide="send"></i> Phát hành HSMT & Mời thầu
                        </button>
                    </div>
                `,lucide.createIcons()}else if(e.trangThai==="Đang mời thầu"){const S=this.model.getLatestPlan(e.keHoachId),M=S?this.model.state.chudautu.find(G=>G.id===S.chuDauTuId):null,z=M?M.tenChuDauTu:"Không rõ";x.innerHTML=`
                    <div style="background: var(--neutral-soft); padding: 16px 20px; border-radius: var(--radius-md); border: 1px solid var(--border-color); margin-bottom: 20px;">
                        <div style="font-weight: 700; color: var(--primary); border-bottom: 1px solid rgba(59, 130, 246, 0.2); padding-bottom: 4px; margin-bottom: 12px;">Thông số Gói thầu</div>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 8px; font-size: 0.82rem;">
                            <div>• <strong>Chủ đầu tư:</strong> <span class="text-dark fw-bold">${z}</span></div>
                            <div>• <strong>Lĩnh vực:</strong> ${e.linhVuc||"Hàng hóa"}${e.linhVuc==="Hàng hóa"?e.isThuoc===1||e.isThuoc==="1"?" (Thuốc)":" (Không phải thuốc)":""}</div>
                            <div>• <strong>Phương thức LCNT:</strong> ${e.phuongThucLuaChon||"Một giai đoạn một túi hồ sơ"}</div>
                            <div>• <strong>Phân lô:</strong> ${e.phanLo==="Có"?"Có chia phần lô":"Không chia phần lô"}</div>
                            <div>• <strong>Giá gói thầu:</strong> <span class="text-blue fw-bold">${this.model.formatCurrency(e.giaGoiThau)}</span></div>
                            <div>• <strong>Hình thức LCNT:</strong> ${e.hinhThucLuaChon||"--"}</div>
                            <div>• <strong>Loại hợp đồng:</strong> ${e.loaiHopDong||"--"}</div>
                            <div>• <strong>Thời gian thực hiện:</strong> ${e.thoiGianThucHien||"--"}</div>
                            <div>• <strong>Nguồn vốn:</strong> ${e.nguonVon||"--"}</div>
                            <div>• <strong>Thời gian đóng thầu:</strong> <span id="display-thoigiandongthau" style="font-weight:700;">${e.thoiGianDongThau?this.model.formatDateWithTime(e.thoiGianDongThau):"--"}</span></div>
                            <div>• <strong>Thời gian mở thầu:</strong> <span id="display-thoigianmothau" style="font-weight:700;">${e.thoiGianMoThau?this.model.formatDateWithTime(e.thoiGianMoThau):"--"}</span></div>
                        </div>
                    </div>

                    <!-- Gia hạn thời điểm đóng thầu -->
                    <div class="card" style="padding: 20px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-card); margin-bottom: 20px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                            <h4 style="font-weight: 700; color: var(--primary); margin: 0; font-size: 0.95rem;">Gia hạn thời điểm đóng thầu</h4>
                            <button type="button" id="btn-them-giahan" class="btn btn-outline btn-sm" style="padding: 6px 12px; font-size: 0.82rem; font-weight: 600; display: ${this._biddingInfoEditMode?"flex":"none"}; align-items: center; gap: 4px;">
                                <i data-lucide="plus" style="width: 14px; height: 14px;"></i> Thêm gia hạn
                            </button>
                        </div>
                        <div class="table-container" style="border: 1px solid var(--border-color); border-radius: var(--radius-md); overflow-x: auto;">
                            <table class="data-table" id="giahan-table" style="min-width: 100%;">
                                <thead>
                                    <tr>
                                        <th style="width: 120px; text-align: center;">Lần gia hạn</th>
                                        <th>Thời gian đóng thầu <span style="color:var(--danger)">*</span></th>
                                        <th>Lý do gia hạn <span style="color:var(--danger)">*</span></th>
                                        <th style="width: 50px; display: ${this._biddingInfoEditMode?"":"none"};"></th>
                                    </tr>
                                </thead>
                                <tbody id="gt-giahan-tbody"></tbody>
                            </table>
                        </div>
                    </div>

                    <!-- Yêu cầu làm rõ HSMT -->
                    <div class="card" style="padding: 20px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-card); margin-bottom: 20px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                            <h4 style="font-weight: 700; color: var(--primary); margin: 0; font-size: 0.95rem;">Yêu cầu làm rõ HSMT</h4>
                            <button type="button" id="btn-them-yeucaulamro" class="btn btn-outline btn-sm" style="padding: 6px 12px; font-size: 0.82rem; font-weight: 600; display: ${this._biddingInfoEditMode?"flex":"none"}; align-items: center; gap: 4px;">
                                <i data-lucide="plus" style="width: 14px; height: 14px;"></i> Thêm yêu cầu
                            </button>
                        </div>
                        <div class="table-container" style="border: 1px solid var(--border-color); border-radius: var(--radius-md); overflow-x: auto;">
                            <table class="data-table" id="yeucaulamro-table" style="min-width: 100%;">
                                <thead>
                                    <tr>
                                        <th style="width: 80px; text-align: center;">STT</th>
                                        <th style="width: 250px;">Thời gian yêu cầu làm rõ <span style="color:var(--danger)">*</span></th>
                                        <th>Nội dung yêu cầu <span style="color:var(--danger)">*</span></th>
                                        <th style="width: 50px; display: ${this._biddingInfoEditMode?"":"none"};"></th>
                                    </tr>
                                </thead>
                                <tbody id="gt-yeucaulamro-tbody"></tbody>
                            </table>
                        </div>
                    </div>

                    <!-- Trả lời làm rõ -->
                    <div class="card" style="padding: 20px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-card); margin-bottom: 20px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                            <h4 style="font-weight: 700; color: var(--primary); margin: 0; font-size: 0.95rem;">Trả lời làm rõ</h4>
                            <button type="button" id="btn-them-traloilamro" class="btn btn-outline btn-sm" style="padding: 6px 12px; font-size: 0.82rem; font-weight: 600; display: ${this._biddingInfoEditMode?"flex":"none"}; align-items: center; gap: 4px;">
                                <i data-lucide="plus" style="width: 14px; height: 14px;"></i> Thêm trả lời
                            </button>
                        </div>
                        <div class="table-container" style="border: 1px solid var(--border-color); border-radius: var(--radius-md); overflow-x: auto;">
                            <table class="data-table" id="traloilamro-table" style="min-width: 100%;">
                                <thead>
                                    <tr>
                                        <th style="width: 80px; text-align: center;">STT</th>
                                        <th style="width: 250px;">Thời gian trả lời làm rõ <span style="color:var(--danger)">*</span></th>
                                        <th>Nội dung trả lời <span style="color:var(--danger)">*</span></th>
                                        <th style="width: 50px; display: ${this._biddingInfoEditMode?"":"none"};"></th>
                                    </tr>
                                </thead>
                                <tbody id="gt-traloilamro-tbody"></tbody>
                            </table>
                        </div>
                    </div>

                    <!-- Action Buttons -->
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border-color);">
                        <button class="btn btn-primary" onclick="window.moThauGoiThau('${e.id}')" style="padding: 10px 24px; font-weight: 700; display: inline-flex; align-items: center; gap: 8px;">
                            <i data-lucide="unlock"></i> Tiến hành Mở thầu
                        </button>
                        <button class="btn btn-primary" id="btn-luu-thongtinmoithau" style="padding: 10px 24px; font-weight: 700; display: inline-flex; align-items: center; gap: 8px; background: ${this._biddingInfoEditMode?"#10b981":"var(--primary)"}; border-color: ${this._biddingInfoEditMode?"#10b981":"var(--primary)"};">
                            <i data-lucide="${this._biddingInfoEditMode?"save":"edit-3"}"></i> ${this._biddingInfoEditMode?"Lưu thông tin mời thầu":"Chỉnh sửa"}
                        </button>
                    </div>
                `,window.appController&&(window.appController._loadGiaHanRows(e.giaHanList||[]),window.appController._loadYeuCauLamRoRows(e.yeuCauLamRoList||[]),window.appController._loadTraLoiLamRoRows(e.traLoiLamRoList||[])),this._biddingInfoEditMode||(document.querySelectorAll("#gt-giahan-tbody input, #gt-yeucaulamro-tbody input, #gt-traloilamro-tbody input").forEach(G=>{G.disabled=!0,G.style.background="var(--neutral-soft)",G.style.cursor="not-allowed"}),document.querySelectorAll("#gt-giahan-tbody td:last-child, #gt-yeucaulamro-tbody td:last-child, #gt-traloilamro-tbody td:last-child").forEach(G=>{G.style.display="none"}));const K=document.getElementById("btn-them-giahan");K&&(K.onclick=()=>window.appController.addGiaHanRow());const H=document.getElementById("btn-them-yeucaulamro");H&&(H.onclick=()=>window.appController.addYeuCauLamRoRow());const q=document.getElementById("btn-them-traloilamro");q&&(q.onclick=()=>window.appController.addTraLoiLamRoRow());const B=document.getElementById("btn-luu-thongtinmoithau");B&&(B.onclick=async()=>{if(!this._biddingInfoEditMode){this._biddingInfoEditMode=!0,this.showPackageDetails(u);return}const G=window.appController._collectGiaHanRows(),$=window.appController._collectYeuCauLamRoRows(),O=window.appController._collectTraLoiLamRoRows();if(e.giaHanList=G,e.yeuCauLamRoList=$,e.traLoiLamRoList=O,G.length>0){const I=G[G.length-1];if(I.thoiGianDongThau){const A=this.model.convertDMYHMSToYMDHMS(I.thoiGianDongThau);e.thoiGianDongThau=A,e.thoiGianMoThau=A}}if(await this.model.persistData("goithau"),window.appController&&typeof window.appController.autoSync=="function")try{await window.appController.autoSync()}catch(I){console.error("Sync failed:",I)}this._biddingInfoEditMode=!1,this.showPackageDetails(u),await this.customAlert("Thành công","Lưu thông tin mời thầu thành công!","check-circle")}),lucide.createIcons()}else x.innerHTML=`
                    <select id="mothau-goithau-select" style="display:none;"><option value="${e.id}" selected>${e.tenGoiThau}</option></select>
                    <div id="mothau-goithau-summary" style="display:none;"></div>
                    <div id="mothau-bid-container" style="display:none;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                            <h4 id="mothau-table-title" style="font-weight:700; font-size:0.95rem; color:var(--text-main);">Danh sách Nhà thầu tham dự & Nộp hồ sơ</h4>
                            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                                <button class="btn-excel-action btn-download-excel-template-direct" data-type="mothau" id="btn-mothau-download-excel"><i data-lucide="download"></i> Tải Excel Mẫu</button>
                                <button class="btn-excel-action btn-import-excel-direct" data-type="mothau" id="btn-mothau-import-excel"><i data-lucide="upload"></i> Nhập từ Excel</button>
                                <button class="btn btn-outline btn-sm" id="btn-mothau-add-bid" style="padding: 6px 12px; font-size: 0.82rem; font-weight: 600;"><i data-lucide="plus"></i> Thêm Nhà thầu nộp hồ sơ</button>
                            </div>
                        </div>
                        <div class="table-container" style="border:1px solid var(--border-color); border-radius:var(--radius-md); overflow-x:auto; margin-bottom:24px;">
                            <table class="data-table" id="mothau-table" style="min-width:100%;">
                                <thead id="mothau-table-thead"></thead>
                                <tbody id="mothau-table-tbody"></tbody>
                            </table>
                        </div>
                        <div style="display:flex; justify-content:flex-end; gap:12px;">
                            <button class="btn btn-primary" id="btn-mothau-save" style="padding:10px 24px; font-weight:700;"><i data-lucide="save"></i> Lưu thông tin mở thầu</button>
                        </div>
                    </div>
                    <div id="mothau-empty-state" style="display:none;"></div>
                `,window.appController.renderMoThauPanel();break;case"eval_tech":x.innerHTML=`
                <select id="danhgiahsdt-goithau-select" style="display:none;"><option value="${e.id}" selected>${e.tenGoiThau}</option></select>
                <div id="danhgiahsdt-goithau-summary" style="display:none;"></div>
                <div id="danhgiahsdt-container" style="display:none;">
                    <div id="danhgiahsdt-tabs-header" style="display:none;">
                        <button type="button" id="tab-btn-hsdxt-kt" class="active">KT</button>
                        <button type="button" id="tab-btn-hsdxt-tc">TC</button>
                    </div>
                    <div class="form-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-bottom:20px; border-bottom:1px solid var(--border-color); padding-bottom:20px;">
                        <div class="form-group">
                            <label style="font-weight:700; font-size:0.85rem; color:var(--text-main); display:block; margin-bottom:6px;">Số báo cáo đánh giá <span class="required">*</span></label>
                            <input type="text" id="danhgiahsdt-so-baocao" class="form-control" required placeholder="Ví dụ: 12/BC-TCD">
                            <span class="error-text">Vui lòng nhập số báo cáo đánh giá</span>
                        </div>
                        <div class="form-group">
                            <label style="font-weight:700; font-size:0.85rem; color:var(--text-main); display:block; margin-bottom:6px;">Ngày báo cáo đánh giá <span class="required">*</span></label>
                            <input type="date" id="danhgiahsdt-ngay-baocao" class="form-control" required>
                            <span class="error-text">Vui lòng chọn ngày báo cáo đánh giá</span>
                        </div>
                    </div>
                    <div id="danhgiahsdt-quytrinh-container" style="display:none; margin-bottom: 20px; padding: 12px 16px; background: rgba(59, 130, 246, 0.05); border: 1px solid rgba(59, 130, 246, 0.15); border-radius: var(--radius-md); align-items: center; gap: 24px;">
                        <span style="font-weight: 700; font-size: 0.85rem; color: var(--text-main);">Quy trình đánh giá:</span>
                        <label style="display: inline-flex; align-items: center; gap: 8px; font-size: 0.85rem; font-weight: 600; cursor: pointer; color: var(--text-main);">
                            <input type="radio" name="danhgiahsdt-quytrinh" value="quytrinh1" checked style="accent-color: var(--primary); cursor: pointer;">
                            Quy trình 1
                        </label>
                        <label style="display: inline-flex; align-items: center; gap: 8px; font-size: 0.85rem; font-weight: 600; cursor: pointer; color: var(--text-main);">
                            <input type="radio" name="danhgiahsdt-quytrinh" value="quytrinh2" style="accent-color: var(--primary); cursor: pointer;">
                            Quy trình 2
                        </label>
                    </div>

                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                        <h4 id="danhgiahsdt-table-title" style="font-weight:700; font-size:0.95rem;">Đánh giá chi tiết các HSDT nộp</h4>
                        <div style="display:flex; gap:8px;">
                            <button class="btn-excel-action btn-download-excel-template-direct" data-type="danhgiahsdt" id="btn-danhgiahsdt-download-excel"><i data-lucide="download"></i> Tải Excel Mẫu</button>
                            <button class="btn-excel-action btn-import-excel-direct" data-type="danhgiahsdt" id="btn-danhgiahsdt-import-excel"><i data-lucide="upload"></i> Nhập từ Excel</button>
                        </div>
                    </div>
                    <div class="table-container" style="border:1px solid var(--border-color); border-radius:var(--radius-md); overflow-x:auto; margin-bottom:24px;">
                        <table class="data-table" id="danhgiahsdt-table">
                            <thead id="danhgiahsdt-table-thead"></thead>
                            <tbody id="danhgiahsdt-table-tbody"></tbody>
                        </table>
                    </div>
                    <div style="display:flex; justify-content:flex-end; gap:12px;">
                        <button class="btn btn-primary" id="btn-danhgiahsdt-save" style="padding:10px 24px; font-weight:700;"><i data-lucide="save"></i> Lưu thông tin đánh giá</button>
                    </div>
                </div>
                <div id="danhgiahsdt-empty-state" style="display:none;"></div>
            `,window.appController.currentDanhGiaTab="technical",window.appController.renderDanhGiaHsdtPanel();break;case"eval_fin":x.innerHTML=`
                <select id="danhgiahsdt-goithau-select" style="display:none;"><option value="${e.id}" selected>${e.tenGoiThau}</option></select>
                <div id="danhgiahsdt-goithau-summary" style="display:none;"></div>
                <div id="danhgiahsdt-container" style="display:none;">
                    <div id="danhgiahsdt-tabs-header" style="display:none;">
                        <button type="button" id="tab-btn-hsdxt-kt">KT</button>
                        <button type="button" id="tab-btn-hsdxt-tc" class="active">TC</button>
                    </div>
                    <div class="form-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-bottom:20px; border-bottom:1px solid var(--border-color); padding-bottom:20px;">
                        <div class="form-group">
                            <label style="font-weight:700; font-size:0.85rem; color:var(--text-main); display:block; margin-bottom:6px;">Số báo cáo đánh giá <span class="required">*</span></label>
                            <input type="text" id="danhgiahsdt-so-baocao" class="form-control" required placeholder="Ví dụ: 12/BC-TCD">
                            <span class="error-text">Vui lòng nhập số báo cáo đánh giá</span>
                        </div>
                        <div class="form-group">
                            <label style="font-weight:700; font-size:0.85rem; color:var(--text-main); display:block; margin-bottom:6px;">Ngày báo cáo đánh giá <span class="required">*</span></label>
                            <input type="date" id="danhgiahsdt-ngay-baocao" class="form-control" required>
                            <span class="error-text">Vui lòng chọn ngày báo cáo đánh giá</span>
                        </div>
                    </div>

                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                        <h4 id="danhgiahsdt-table-title" style="font-weight:700; font-size:0.95rem;">Đánh giá chi tiết các HSDT nộp</h4>
                        <div style="display:flex; gap:8px;">
                            <button class="btn-excel-action btn-download-excel-template-direct" data-type="danhgiahsdt" id="btn-danhgiahsdt-download-excel"><i data-lucide="download"></i> Tải Excel Mẫu</button>
                            <button class="btn-excel-action btn-import-excel-direct" data-type="danhgiahsdt" id="btn-danhgiahsdt-import-excel"><i data-lucide="upload"></i> Nhập từ Excel</button>
                        </div>
                    </div>
                    <div class="table-container" style="border:1px solid var(--border-color); border-radius:var(--radius-md); overflow-x:auto; margin-bottom:24px;">
                        <table class="data-table" id="danhgiahsdt-table">
                            <thead id="danhgiahsdt-table-thead"></thead>
                            <tbody id="danhgiahsdt-table-tbody"></tbody>
                        </table>
                    </div>
                    <div style="display:flex; justify-content:flex-end; gap:12px;">
                        <button class="btn btn-primary" id="btn-danhgiahsdt-save" style="padding:10px 24px; font-weight:700;"><i data-lucide="save"></i> Lưu thông tin đánh giá</button>
                    </div>
                </div>
                <div id="danhgiahsdt-empty-state" style="display:none;"></div>
            `,window.appController.currentDanhGiaTab="financial",window.appController.renderDanhGiaHsdtPanel();break;case"qualified":const T=this.model.state.thongtinmothau.filter(S=>String(S.goiThauId)===String(e.id)).filter(gt);if(T.length===0)x.innerHTML=`
                    <div style="text-align: center; padding: 48px; color: var(--text-muted);">
                        <i data-lucide="shield-alert" style="width: 48px; height: 48px; margin: 0 auto 16px; color: var(--warning);"></i>
                        <h4 style="font-weight: 700; color: var(--text-main);">Chưa có Nhà thầu đạt kỹ thuật</h4>
                        <p style="font-size: 0.85rem;">Vui lòng hoàn thành và Lưu Báo cáo đánh giá E-HSĐXKT trước.</p>
                    </div>
                `;else{let S={is1G2T:!0,technical:{saved:!1},financial:{saved:!1}};if(e.danhGiaHsdtMetadata)try{const B=JSON.parse(e.danhGiaHsdtMetadata);B.is1G2T?S=B:S={is1G2T:!0,technical:B.soBaoCao?B:{saved:!1},financial:{saved:!1}}}catch(B){console.error("Failed to parse metadata",B)}S.technical||(S.technical={saved:!0});const M=S.technical.soQdPheDuyetKt||"",z=S.technical.ngayQdPheDuyetKt||"",K=!!S.technical.qualifiedSaved,H=this._editingState&&this._editingState[this._currentWorkflowTab],q=K&&!H||e.trangThai==="Đã có kết quả";if(x.innerHTML=`
                    <div style="background: var(--neutral-soft); padding: 16px 20px; border-radius: var(--radius-md); border: 1px solid var(--border-color); margin-bottom: 24px;">
                        <div style="font-weight: 700; color: var(--primary); border-bottom: 1px solid rgba(59, 130, 246, 0.2); padding-bottom: 4px; margin-bottom: 12px;">QĐ phê duyệt danh sách nhà thầu đạt kỹ thuật</div>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px;">
                            <div class="form-group" style="margin-bottom: 0;">
                                <label style="font-weight: 600; font-size: 0.85rem; margin-bottom: 4px; display: block;">Số QĐ phê duyệt danh sách nhà thầu đạt kỹ thuật <span class="text-danger">*</span></label>
                                <input type="text" id="qualified-so-qd" class="form-control" value="${M}" placeholder="Ví dụ: 120/QĐ-CDT" style="width: 100%;" ${q?"readonly":""}>
                                <span class="error-text" style="color: var(--danger); font-size: 0.75rem; display: none; margin-top: 4px;">Vui lòng nhập Số QĐ phê duyệt!</span>
                            </div>
                            <div class="form-group" style="margin-bottom: 0;">
                                <label style="font-weight: 600; font-size: 0.85rem; margin-bottom: 4px; display: block;">Ngày QĐ phê duyệt <span class="text-danger">*</span></label>
                                <input type="date" id="qualified-ngay-qd" class="form-control" value="${z?this.model.formatForDateInput(z):""}" style="width: 100%;" ${q?"readonly":""}>
                                <span class="error-text" style="color: var(--danger); font-size: 0.75rem; display: none; margin-top: 4px;">Vui lòng chọn Ngày QĐ phê duyệt!</span>
                            </div>
                        </div>
                    </div>
 
                     <div class="table-container" style="border:1px solid var(--border-color); border-radius:var(--radius-md); overflow-x:auto; margin-bottom:24px; background:var(--bg-card);">
                         <table class="data-table" style="min-width: 100%;">
                             <thead>
                                 <tr>
                                     ${e.phanLo==="Có"?`
                                         <th style="width: 15%;">Mã phần lô</th>
                                         <th style="width: 25%;">Tên phần lô</th>
                                     `:""}
                                     <th style="width: 15%;">Mã nhà thầu</th>
                                     <th style="width: 30%;">Tên nhà thầu</th>
                                     <th style="width: 15%; text-align: center;">Kết quả</th>
                                 </tr>
                             </thead>
                             <tbody>
                                 ${T.map(B=>`
                                     <tr>
                                         ${e.phanLo==="Có"?`
                                             <td>${B.maPhanLo||"--"}</td>
                                             <td>${B.tenPhanLo||"--"}</td>
                                         `:""}
                                         <td>${B.maNhaThau||B.maDinhDanh||"--"}</td>
                                         <td class="fw-bold">${B.tenNhaThau||"--"}</td>
                                         <td style="text-align: center;">
                                             <span class="badge badge-success" style="font-size: 0.75rem; font-weight: 700; padding: 4px 8px; border-radius: 4px;">Đạt kỹ thuật</span>
                                         </td>
                                     </tr>
                                 `).join("")}
                             </tbody>
                         </table>
                     </div>
                     <div style="display: flex; justify-content: flex-end; margin-top: 16px;">
                         ${q?"":`
                             <button class="btn btn-primary" id="btn-save-qualified-decision" style="padding: 10px 24px; font-weight: 700; display: inline-flex; align-items: center; gap: 8px;"><i data-lucide="save"></i> Lưu QĐ phê duyệt</button>
                         `}
                     </div>
                 `,!q){const B=x.querySelector("#btn-save-qualified-decision");B&&(B.onclick=async()=>{const G=x.querySelector("#qualified-so-qd"),$=x.querySelector("#qualified-ngay-qd"),O=G.value.trim(),I=$.value.trim();let A=!1;O?(G.closest(".form-group").querySelector(".error-text").style.display="none",G.closest(".form-group").classList.remove("invalid")):(A=!0,G.closest(".form-group").querySelector(".error-text").style.display="block",G.closest(".form-group").classList.add("invalid")),I?($.closest(".form-group").querySelector(".error-text").style.display="none",$.closest(".form-group").classList.remove("invalid")):(A=!0,$.closest(".form-group").querySelector(".error-text").style.display="block",$.closest(".form-group").classList.add("invalid")),!A&&(S.technical.soQdPheDuyetKt=O,S.technical.ngayQdPheDuyetKt=this.model.convertDMYToYMD(I),S.technical.qualifiedSaved=!0,e.danhGiaHsdtMetadata=JSON.stringify(S),this.model.persistData("goithau"),window.appController.autoSync(),this._editingState&&(this._editingState[this._currentWorkflowTab]=!1),await this.customAlert("Thành công","Đã lưu QĐ phê duyệt danh sách nhà thầu đạt kỹ thuật thành công!","check-circle"),this._currentWorkflowTab="opening_fin",this.showPackageDetails(e.id))})}}break;case"opening_fin":const D=this.model.state.thongtinmothau.filter(S=>String(S.goiThauId)===String(e.id)).filter(gt);if(D.length===0)x.innerHTML=`
                    <div style="text-align: center; padding: 48px; color: var(--text-muted);">
                        <i data-lucide="lock" style="width: 48px; height: 48px; margin: 0 auto 16px; color: var(--text-muted);"></i>
                        <h4 style="font-weight: 700; color: var(--text-main);">Chưa mở túi hồ sơ Đề xuất Tài chính</h4>
                        <p style="font-size: 0.85rem;">Vui lòng hoàn thành Đánh giá kỹ thuật để xác định danh sách nhà thầu đủ điều kiện mở túi HSĐXTC.</p>
                    </div>
                `;else{const M=D.some(H=>H.giaDuThau&&H.giaDuThau>0),z=this._editingState&&this._editingState[this._currentWorkflowTab],K=M&&!z||e.trangThai==="Đã có kết quả";if(x.innerHTML=`
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                        <h4 style="font-weight: 700; font-size: 1.05rem; color: var(--text-main); margin: 0;">
                            Biên bản mở hồ sơ đề xuất tài chính (E-HSĐXTC)
                        </h4>
                        ${K?"":`
                            <div style="display:flex; gap:8px;">
                                <button class="btn-excel-action btn-download-excel-template-direct" data-type="opening_fin" id="btn-opening-fin-export-excel"><i data-lucide="download"></i> Tải Excel Mẫu</button>
                                <button class="btn-excel-action btn-import-excel-direct" data-type="opening_fin" id="btn-opening-fin-import-excel"><i data-lucide="upload"></i> Nhập từ Excel</button>
                            </div>
                        `}
                    </div>
                    <p class="text-muted" style="font-size: 0.82rem; margin-bottom: 20px;">
                        Nhập giá dự thầu, tỷ lệ giảm giá của các nhà thầu vượt qua bước đánh giá kỹ thuật.
                    </p>
                    <div class="table-container" style="border: 1px solid var(--border-color); border-radius: var(--radius-md); overflow-x: auto; margin-bottom: 24px;">
                        <table class="data-table" id="opening-fin-table" style="min-width: 100%;">
                            <thead>
                                <tr>
                                    <th>Mã nhà thầu</th>
                                    <th>Tên nhà thầu</th>
                                    <th style="width:160px;">Giá dự thầu (VNĐ)</th>
                                    <th style="width:80px;">Tỷ lệ %</th>
                                    <th style="width:160px;">Giá sau giảm</th>
                                    <th style="width:120px;">Hiệu lực HSDT</th>
                                    <th style="width:120px;">Thời gian TH</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${D.map(H=>{const q=this.model.formatVND(H.giaDuThau)||"",B=(H.tyLeGiamGia||0).toString().replace(".",","),G=this.model.formatVND(H.giaSauGiamGia)||"",$=H.hieuLucHsdt||"",O=H.thoiGianThucHien||e.thoiGianThucHien||"";return K?`
                                            <tr>
                                                <td><strong>${H.maNhaThau||H.maDinhDanh||"--"}</strong></td>
                                                <td><strong>${H.tenNhaThau}</strong></td>
                                                <td>${q||"--"}</td>
                                                <td style="text-align:right;">${B}</td>
                                                <td>${G||"--"}</td>
                                                <td>${$?$+" ngày":"--"}</td>
                                                <td>${O||"--"}</td>
                                            </tr>
                                        `:`
                                            <tr data-opening-bid-id="${H.id}">
                                                <td><strong>${H.maNhaThau||H.maDinhDanh||"--"}</strong></td>
                                                <td><strong>${H.tenNhaThau}</strong></td>
                                                <td><input type="text" class="form-control op-gia-du-thau" value="${q}" placeholder="Nhập giá..." style="padding:4px 8px; font-size:0.8rem;"></td>
                                                <td><input type="text" class="form-control op-ty-le-giam" value="${B}" placeholder="0" style="text-align:right; padding:4px 8px; font-size:0.8rem;"></td>
                                                <td><input type="text" class="form-control op-gia-sau-giam" value="${G}" readonly style="background:#f1f5f9; padding:4px 8px; font-size:0.8rem;"></td>
                                                <td><input type="text" class="form-control op-hieu-luc-hsdt" value="${$?$+" ngày":""}" placeholder="Ví dụ: 90 ngày" style="padding:4px 8px; font-size:0.8rem;"></td>
                                                <td><input type="text" class="form-control op-thoi-gian-th" value="${O}" placeholder="Ví dụ: 60 ngày" style="padding:4px 8px; font-size:0.8rem;"></td>
                                            </tr>
                                        `}).join("")}
                            </tbody>
                        </table>
                    </div>
                    <div style="display:flex; justify-content:flex-end;">
                        ${K?"":`
                            <button class="btn btn-primary" id="btn-save-opening-fin" style="padding:10px 24px; font-weight:700;"><i data-lucide="save"></i> Lưu Biên bản mở HSĐXTC</button>
                        `}
                    </div>
                `,!K){const H=x.querySelectorAll("#opening-fin-table tbody tr");H.forEach($=>{const O=$.querySelector(".op-gia-du-thau"),I=$.querySelector(".op-ty-le-giam"),A=$.querySelector(".op-gia-sau-giam"),F=()=>{const _=this.model.parseVND(O.value),k=I.value||"0",C=parseFloat(k.replace(/,/g,"."))||0,j=_*(1-C/100);A.value=this.model.formatVND(j)||""};(_=>{_&&_.addEventListener("input",k=>{const C=k.target.selectionStart,j=k.target.value.length,Q=this.model.formatVND(k.target.value);k.target.value=Q;const W=Q.length,U=C+(W-j);k.target.setSelectionRange(U,U)})})(O),O&&O.addEventListener("input",F),I&&I.addEventListener("input",F)});const q=document.getElementById("btn-opening-fin-export-excel");q&&(q.onclick=()=>{const $=(e.maGoiThau||"GoiThau").replace(/[^a-zA-Z0-9_-]/g,"").trim().substring(0,30);ft(`/api/export-opening-fin-template?package_id=${e.id}&package_name=${encodeURIComponent($)}`,`Mau_Mo_Tai_Chinh_${$}.xlsx`)});const B=document.getElementById("btn-opening-fin-import-excel");B&&(B.onclick=()=>{window.appController.openExcelImportModal("opening_fin")});const G=document.getElementById("btn-save-opening-fin");G&&(G.onclick=async()=>{H.forEach($=>{var A,F,tt,_,k;const O=$.getAttribute("data-opening-bid-id"),I=this.model.state.thongtinmothau.find(C=>C.id===O);if(I){I.giaDuThau=this.model.parseVND(((A=$.querySelector(".op-gia-du-thau"))==null?void 0:A.value)||"");const C=((F=$.querySelector(".op-ty-le-giam"))==null?void 0:F.value)||"0";I.tyLeGiamGia=parseFloat(C.replace(/,/g,"."))||0,I.giaSauGiamGia=this.model.parseVND(((tt=$.querySelector(".op-gia-sau-giam"))==null?void 0:tt.value)||""),I.hieuLucHsdt=parseInt(((_=$.querySelector(".op-hieu-luc-hsdt"))==null?void 0:_.value)||"0",10);const j=((k=$.querySelector(".op-thoi-gian-th"))==null?void 0:k.value.trim())||"";I.thoiGianThucHien=j||I.thoiGianThucHien||e.thoiGianThucHien||""}}),this.model.persistData("thongtinmothau"),this.model.persistData("goithau"),window.appController.autoSync(),this._editingState&&(this._editingState[this._currentWorkflowTab]=!1),await this.customAlert("Thành công","Đã lưu Biên bản mở thầu E-HSĐXTC thành công!","check-circle"),this._currentWorkflowTab="eval_fin",this.showPackageDetails(u)})}}break;case"result":const P=this.model.state.thongtinmothau.filter(S=>String(S.goiThauId)===String(e.id)&&gt(S));if(e.trangThai==="Đã có kết quả"){!e.nhaThauTrungThauId&&P.length===1&&(e.nhaThauTrungThauId=P[0].nhaThauId||P[0].id);const S=P.find(_=>String(_.nhaThauId)===String(e.nhaThauTrungThauId))||P[0],M=e.giaGoiThau-(e.giaTrungThau||0),z=e.giaGoiThau>0?(M/e.giaGoiThau*100).toFixed(2):"0,00";let K="",H=!1,q=[],B=[];if(e.phanLo==="Có"&&(q=(typeof e.phanLoList=="string"?JSON.parse(e.phanLoList||"[]"):e.phanLoList||[]).filter(k=>k.nhaThauTrungThauId),B=[...new Set(q.map(k=>String(k.nhaThauTrungThauId)).filter(Boolean))],B.length>1&&(H=!0)),H)window._lotWinnersMap=window._lotWinnersMap||{},window._lotWinnersMap[e.id]=q.map(_=>{const k=this.model.state.thongtinmothau.find(U=>String(U.goiThauId)===String(e.id)&&String(U.nhaThauId)===String(_.nhaThauTrungThauId)),C=this.model.state.nhathau.find(U=>U.id===_.nhaThauTrungThauId),j=k?k.tenNhaThau:C?C.tenNhaThau:"Nhà thầu #"+_.nhaThauTrungThauId,Q=k&&k.loaiNhaThau==="Liên danh";let W=null;if(Q){const U=k.thanhVienLienDanh||[],Y=U.find(Z=>Z.vaiTro==="Đứng đầu liên danh"),et=(Y==null?void 0:Y.tenNhaThau)||j,R=(Y==null?void 0:Y.maSoThue)||(C==null?void 0:C.maSoThue)||(C==null?void 0:C.maNhaThau)||k.maDinhDanh||k.maNhaThau||"";W={members:U.filter(Z=>Z.vaiTro!=="Đứng đầu liên danh"),leadName:et,leadCode:R}}return{maPhanLo:_.maPhanLo,tenPhanLo:_.tenPhanLo,nhaThauTrungThauId:_.nhaThauTrungThauId,tenNhaThau:j,giaTrungThau:_.giaTrungThau,isJV:Q,jvData:W}}),K=`
                        <h5 style="margin:4px 0 0; font-size:1.1rem; font-weight:800; color:var(--primary);">
                            <a href="#" onclick="event.preventDefault(); window.showLotWinnersModal('${e.id}')" class="link-hover" style="color:var(--primary); text-decoration: none;" title="Xem chi tiết các nhà thầu trúng thầu">Có nhiều nhà thầu trúng thầu</a>
                        </h5>
                    `;else{const _=B.length===1?B[0]:e.nhaThauTrungThauId||(S?S.nhaThauId||S.id:null),k=P.find(C=>String(C.nhaThauId)===String(_))||S;if(k)if(k.loaiNhaThau==="Liên danh"){const C=k.thanhVienLienDanh||[],j=C.find(U=>U.vaiTro==="Đứng đầu liên danh"),Q=C.filter(U=>U.vaiTro!=="Đứng đầu liên danh"),W=this.model.state.nhathau.find(U=>String(U.id)===String(k.nhaThauId));window._jvDataMap=window._jvDataMap||{},window._jvDataMap[e.id]={members:Q,leadName:(j==null?void 0:j.tenNhaThau)||k.tenNhaThau,leadCode:(j==null?void 0:j.maSoThue)||(W==null?void 0:W.maSoThue)||(W==null?void 0:W.maNhaThau)||k.maDinhDanh||k.maNhaThau||""},K=`
                                <div style="display: flex; flex-direction: column; gap: 4px;">
                                    <h5 style="margin:4px 0 0; font-size:1.1rem; font-weight:800; color:var(--primary);">
                                        <a href="#" onclick="event.preventDefault(); var d=window._jvDataMap['${e.id}']; d && window.openMoThauJVViewModal(d.members, d.leadName, d.leadCode)" class="link-hover" title="Xem chi tiết liên danh" style="color:var(--primary);">👥 ${k.tenNhaThau}</a>
                                    </h5>
                                </div>
                            `}else{const C=this.model.state.nhathau.find(Q=>String(Q.id)===String(k.nhaThauId)),j=C?C.maSoThue||C.maNhaThau:k.maDinhDanh||k.maNhaThau;K=`
                                <h5 style="margin:4px 0 0; font-size:1.1rem; font-weight:800; color:var(--primary);">
                                    <a href="#" onclick="event.preventDefault(); window.editNhaThau('${k.nhaThauId}', true)" class="link-hover" style="color:var(--primary);">${k.tenNhaThau}</a>
                                </h5>
                                <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 4px;">
                                    MST: <strong>${j||"Chưa có"}</strong>
                                </div>
                            `}else K='<h5 style="margin:4px 0 0; font-size:1.1rem; font-weight:800; color:var(--primary);">Chưa xác định</h5>'}const G=this.model.state.thongtinmothau.filter(_=>String(_.goiThauId)===String(e.id));G.sort((_,k)=>{const C=String(_.maPhanLo||"").toLowerCase(),j=String(k.maPhanLo||"").toLowerCase();return C.localeCompare(j,"vi",{numeric:!0})});const $=new Set;if(e.nhaThauTrungThauId&&$.add(String(e.nhaThauTrungThauId)),e.phanLo==="Có"&&e.phanLoList)try{(typeof e.phanLoList=="string"?JSON.parse(e.phanLoList):e.phanLoList).forEach(k=>{k.nhaThauTrungThauId&&$.add(String(k.nhaThauTrungThauId))})}catch(_){console.error(_)}const O={};G.forEach(_=>{const k=String(_.nhaThauId||_.id||"");k&&(O[k]||(O[k]=[]),O[k].push(_))});const I=e.phanLo==="Có",A=G.map((_,k)=>{String(_.nhaThauId||_.id);let C=!1,j="—",Q="—";if(I){const E=(typeof e.phanLoList=="string"?JSON.parse(e.phanLoList||"[]"):e.phanLoList||[]).find(Z=>String(Z.maPhanLo)===String(_.maPhanLo)&&String(Z.nhaThauTrungThauId)===String(_.nhaThauId));E?(C=!0,j=this.model.formatCurrency(E.giaTrungThau||0),Q=E.thoiGianGoiThau||"—"):Q=_.thoiGianThucHien||_.thoiGianGoiThau||"—"}else e.nhaThauTrungThauId&&String(e.nhaThauTrungThauId)===String(_.nhaThauId)?(C=!0,j=this.model.formatCurrency(e.giaTrungThau||0),Q=e.thoiGianGoiThau||"—"):Q=_.thoiGianThucHien||_.thoiGianGoiThau||"—";const W=C?'<span class="badge badge-success" style="font-size:0.75rem; padding: 4px 10px; background-color: rgba(16, 185, 129, 0.08); color: #059669; border: 1px solid rgba(16, 185, 129, 0.25);">Trúng thầu</span>':'<span class="badge badge-danger" style="font-size:0.75rem; padding: 4px 10px; background-color: rgba(239,68,68,0.08); color: #dc2626; border: 1px solid rgba(239,68,68,0.25);">Trượt thầu</span>';let U="";if(C)U="—";else if(U=_.lyDoTruot||"",!U)if(e.quyTrinhDanhGia==="quytrinh2"&&_.danhGiaKetLuan==="Không đánh giá")U="Đánh giá theo quy trình 2. Nhà thầu giá thấp hơn trúng thầu";else{const R=_.danhGiaKetLuan;if(R==="Không đạt"||R&&R.startsWith("Không đạt")){const E=[];_.danhGiaHopLe==="Không đạt"&&E.push("Đánh giá hợp lệ"),_.danhGiaNangLuc==="Không đạt"&&E.push("Đánh giá năng lực"),(_.danhGiaKyThuat==="Không đạt"||_.danhGiaKyThuat&&String(_.danhGiaKyThuat).toLowerCase().includes("không đạt"))&&E.push("Đánh giá kỹ thuật"),(_.danhGiaTaiChinh==="Không đạt"||_.danhGiaTaiChinh&&String(_.danhGiaTaiChinh).toLowerCase().includes("không đạt"))&&E.push("Đánh giá tài chính"),E.length>0?U=`Không đạt ở bước: ${E.join(", ")}`:U="Không đạt đánh giá chi tiết"}else U="Nhà thầu xếp hạng 1 trúng thầu"}const Y=_.loaiNhaThau==="Liên danh";let et="";if(Y){const R=_.thanhVienLienDanh||[],E=R.find(J=>J.vaiTro==="Đứng đầu liên danh"),Z=(E==null?void 0:E.tenNhaThau)||_.tenNhaThau,X=(E==null?void 0:E.maSoThue)||_.maDinhDanh||_.maNhaThau||"",it=R.filter(J=>J.vaiTro!=="Đứng đầu liên danh"),ot=`${e.id}_result_bidder_${k}`;window._jvDataMap=window._jvDataMap||{},window._jvDataMap[ot]={members:it,leadName:Z,leadCode:X},et=`<a href="#" onclick="event.preventDefault(); var d=window._jvDataMap['${ot}']; d && window.openMoThauJVViewModal(d.members, d.leadName, d.leadCode)" class="fw-bold text-success link-hover" title="Xem thành viên liên danh">👥 ${_.tenNhaThau||"--"}</a>`}else et=`<span class="fw-bold">${_.tenNhaThau||"--"}</span>`;return I?`
                            <tr>
                                <td>${_.maPhanLo||"—"}</td>
                                <td>${_.tenPhanLo||"—"}</td>
                                <td>${_.maNhaThau||_.maDinhDanh||"--"}</td>
                                <td>${et}</td>
                                <td class="fw-bold text-success">${j}</td>
                                <td>${Q}</td>
                                <td style="text-align: center;">${W}</td>
                                <td class="text-muted">${U}</td>
                            </tr>
                        `:`
                            <tr>
                                <td>${_.maNhaThau||_.maDinhDanh||"--"}</td>
                                <td>${et}</td>
                                <td class="fw-bold text-success">${j}</td>
                                <td>${Q}</td>
                                <td style="text-align: center;">${W}</td>
                                <td class="text-muted">${U}</td>
                            </tr>
                        `}).join("");let F="";I?F=`
                        <tr>
                            <th style="width: 10%;">Mã phần lô</th>
                            <th style="width: 12%;">Tên phần lô</th>
                            <th style="width: 10%;">Mã nhà thầu</th>
                            <th style="width: 20%;">Tên nhà thầu</th>
                            <th style="width: 13%;">Giá trị trúng thầu</th>
                            <th style="width: 15%;">Thời gian thực hiện</th>
                            <th style="width: 10%; text-align: center;">Trạng thái</th>
                            <th style="width: 10%;">Lý do trượt thầu</th>
                        </tr>
                    `:F=`
                        <tr>
                            <th style="width: 15%;">Mã nhà thầu</th>
                            <th style="width: 35%;">Tên nhà thầu</th>
                            <th style="width: 15%;">Giá trị trúng thầu</th>
                            <th style="width: 15%;">Thời gian thực hiện</th>
                            <th style="width: 10%; text-align: center;">Trạng thái</th>
                            <th style="width: 10%;">Lý do trượt thầu</th>
                        </tr>
                    `,x.innerHTML=`
                    <div class="card" style="padding: 24px; border: 1px solid rgba(16, 185, 129, 0.25); background: rgba(16, 185, 129, 0.02); border-radius: var(--radius-lg); margin-bottom: 24px; display: flex; flex-direction: column; gap: 16px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
                            <div style="display:flex; gap:12px; align-items:center;">
                                <i data-lucide="check-circle" class="text-success" style="width:36px; height:36px;"></i>
                                <div>
                                    <h4 style="margin:0; font-size:1.15rem; font-weight:800; color:var(--text-main);">Gói thầu đã hoàn thành LCNT</h4>
                                    <p class="text-muted" style="margin:0; font-size:0.8rem;">Đã phê duyệt kết quả lựa chọn nhà thầu chính thức.</p>                                </div>
                            </div>
                            <div style="display:flex; gap:8px;">
                                <button class="btn-excel-action btn-download-excel-template-direct" data-type="ketquaqd" id="btn-result-download-excel"><i data-lucide="download"></i> Tải Excel Mẫu</button>
                                <button class="btn-excel-action btn-import-excel-direct" data-type="ketquaqd" id="btn-result-import-excel"><i data-lucide="upload"></i> Nhập từ Excel</button>
                                <button class="btn btn-primary" id="btn-export-docx-report" style="font-weight:700;"><i data-lucide="file-text"></i> Xuất Báo cáo Kết quả (Word)</button>
                            </div>
                        </div>

                        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap:20px;">
                            <div>
                                <span class="text-muted" style="font-size:0.75rem; font-weight:700; text-transform:uppercase;">Nhà thầu trúng thầu</span>
                                ${K}
                            </div>
                            <div>
                                <span class="text-muted" style="font-size:0.75rem; font-weight:700; text-transform:uppercase;">Giá trúng thầu</span>
                                <h5 style="margin:4px 0 0; font-size:1.1rem; font-weight:800; color:var(--text-main);">${this.model.formatCurrency(e.giaTrungThau)}</h5>
                            </div>
                            <div>
                                <span class="text-muted" style="font-size:0.75rem; font-weight:700; text-transform:uppercase;">Thời gian thực hiện</span>
                                <h5 style="margin:4px 0 0; font-size:1.1rem; font-weight:800; color:var(--text-main);">${e.thoiGianGoiThau||"--"}</h5>
                            </div>
                            <div>
                                <span class="text-muted" style="font-size:0.75rem; font-weight:700; text-transform:uppercase;">Hiệu quả tiết kiệm</span>
                                <h5 style="margin:4px 0 0; font-size:1.1rem; font-weight:800; color:var(--success);">${this.model.formatCurrency(M)} (${z}%)</h5>
                            </div>
                            <div>
                                <span class="text-muted" style="font-size:0.75rem; font-weight:700; text-transform:uppercase;">QĐ phê duyệt số</span>
                                <h5 style="margin:4px 0 0; font-size:1.1rem; font-weight:800; color:var(--text-main);">${e.soQuyetDinhKetQua||"--"}</h5>
                            </div>
                            <div>
                                <span class="text-muted" style="font-size:0.75rem; font-weight:700; text-transform:uppercase;">Ngày ký QĐ</span>
                                <h5 style="margin:4px 0 0; font-size:1.1rem; font-weight:800; color:var(--text-main);">${e.ngayQuyetDinhKetQua?this.model.formatDate(e.ngayQuyetDinhKetQua):"--"}</h5>
                            </div>
                        </div>
                    </div>

                    <h5 style="margin-top:24px; margin-bottom:12px; font-weight:700; font-size:0.95rem; color:var(--text-main); display:flex; align-items:center; gap:6px;">
                        <i data-lucide="list"></i> Danh sách Nhà thầu tham dự và kết quả đánh giá
                    </h5>
                    <div class="table-container" style="border:1px solid var(--border-color); border-radius:var(--radius-md); overflow-x:auto; margin-bottom:24px; background:var(--bg-card);">
                        <table class="data-table" style="min-width: 100%;">
                            <thead>
                                ${F}
                            </thead>
                            <tbody>
                                ${A}
                            </tbody>
                        </table>
                    </div>
                `;const tt=document.getElementById("btn-export-docx-report");tt&&(tt.onclick=()=>{tt.disabled=!0;const _=tt.innerHTML;tt.innerHTML='<i data-lucide="loader-2" class="animate-spin" style="width:16px;"></i> Đang xuất...',lucide.createIcons();const k=u,C={"X-Session-Token":sessionStorage.getItem("bf_session_token")||"","X-Username":sessionStorage.getItem("bf_username")||""};fetch(`/api/export-report/${k}`,{headers:C}).then(j=>{if(!j.ok)throw new Error("Không thể xuất báo cáo");return j.blob()}).then(j=>{const Q=window.URL.createObjectURL(j),W=document.createElement("a");W.href=Q,W.download=`Bao_cao_ket_qua_danh_gia_ho_so_du_thau_${e.maGoiThau}.docx`,document.body.appendChild(W),W.click(),W.remove(),window.URL.revokeObjectURL(Q)}).catch(j=>{this.customAlert("Lỗi","Lỗi xuất báo cáo: "+j.message,"x-circle")}).finally(()=>{tt.disabled=!1,tt.innerHTML=_,lucide.createIcons()})})}else{const S=this.model.state.thongtinmothau.filter($=>String($.goiThauId)===String(e.id));S.sort(($,O)=>{const I=String($.maPhanLo||"").trim(),A=String(O.maPhanLo||"").trim();return I.localeCompare(A,"vi",{numeric:!0})}),this.model.state.thongtinmothau.filter($=>String($.goiThauId)===String(e.id)&&gt($));const{rankings:M,scores:z}=window.appController.calculateRankings(e,S),K=e.phuongPhapDanhGia==="Kết hợp giữa kỹ thuật và giá",H=$=>gt($),q=S.map(($,O)=>{const I=H($);let A="";if(e.quyTrinhDanhGia==="quytrinh2"&&$.danhGiaKetLuan==="Không đánh giá")A="Đánh giá theo quy trình 2. Nhà thầu giá thấp hơn trúng thầu";else if(I)A="Nhà thầu xếp hạng 1 trúng thầu";else{const et=String($.danhGiaHopLe||"").trim().toLowerCase(),R=String($.danhGiaNangLuc||"").trim().toLowerCase();et!=="đạt"?A="Không đạt yêu cầu về tính hợp lệ":R!=="đạt"?A="Không đạt yêu cầu về năng lực, kinh nghiệm":A="Không đạt yêu cầu kỹ thuật"}const F=["Không đạt yêu cầu về tính hợp lệ","Không đạt yêu cầu về năng lực, kinh nghiệm","Không đạt yêu cầu kỹ thuật","Nhà thầu xếp hạng 1 trúng thầu","Đánh giá theo quy trình 2. Nhà thầu giá thấp hơn trúng thầu",""],_=!$.lyDoTruot||F.includes($.lyDoTruot.trim())?A:$.lyDoTruot,k=this.model.formatVND($.giaSauGiamGia||$.giaDuThau||"")||"",C=$.thoiGianThucHien||e.thoiGianThucHien||"",j=C?C+" + Thời gian thực hiện các nghĩa vụ theo hợp đồng":"",Q=M[$.id],W=z[$.id],U=Q?`Xếp hạng ${Q}`:I?"--":"Không xếp hạng";let Y=!1;if(I)if(e.phanLo==="Có"){const et=typeof e.phanLoList=="string"?JSON.parse(e.phanLoList||"[]"):e.phanLoList||[],R=$.maPhanLo,E=et.find(Z=>Z.maPhanLo===R);E&&E.nhaThauTrungThauId?Y=String(E.nhaThauTrungThauId)===String($.nhaThauId||$.id):Y=Q===1}else e.nhaThauTrungThauId?Y=String(e.nhaThauTrungThauId)===String($.nhaThauId||$.id):Y=Q===1;return`
                        <tr data-approve-bid-id="${$.id}" data-is-qualified="${I}" data-nt-id="${$.nhaThauId||$.id}"
                            data-default-price="${k}" data-default-duration-pkg="${C}" data-default-duration-ctr="${j}"
                            data-default-reason="${A}">
                            ${e.phanLo==="Có"?`
                                <td>${$.maPhanLo||"--"}</td>
                                <td>${$.tenPhanLo||"--"}</td>
                            `:""}
                            <td>${$.maNhaThau||$.maDinhDanh||"--"}</td>
                            <td class="fw-bold">${$.tenNhaThau||"--"}</td>
                            ${K?`
                                <td style="text-align: center; font-weight: 700; color: var(--primary);">${W!=null&&!isNaN(W)&&W>0?W.toFixed(2):"--"}</td>
                            `:""}
                            <td style="text-align: center; font-weight: bold; color: var(--primary);">${U}</td>
                            <td>
                                <select class="form-control row-status-select" style="padding:4px 8px; font-size:0.8rem; font-weight:600;" ${I?"":"disabled"}>
                                    <option value="truot" ${Y?"":"selected"}>Trượt thầu</option>
                                    ${I?`<option value="trung" ${Y?"selected":""}>Trúng thầu</option>`:""}
                                </select>
                            </td>
                            <td>
                                <input type="text" class="form-control row-ly-do-truot" value="${Y?"":_}" placeholder="Lý do trượt..." style="padding:4px 8px; font-size:0.8rem; width:100%;" ${Y?'disabled style="background:#f1f5f9;"':""}>
                            </td>
                            <td>
                                <input type="text" class="form-control row-gia-trung" value="${Y?k:""}" placeholder="Giá trúng..." style="padding:4px 8px; font-size:0.8rem; width:100%;" ${Y?"":'disabled style="background:#f1f5f9;"'}>
                            </td>
                            <td>
                                <input type="text" class="form-control row-tg-goithau" value="${Y?C:""}" placeholder="Thời gian gói..." style="padding:4px 8px; font-size:0.8rem; width:100%;" ${Y?"":'disabled style="background:#f1f5f9;"'}>
                            </td>
                            <td>
                                <input type="text" class="form-control row-tg-hopdong" value="${Y?j:""}" placeholder="Thời gian HĐ..." style="padding:4px 8px; font-size:0.8rem; width:100%;" ${Y?"":'disabled style="background:#f1f5f9;"'}>
                            </td>
                        </tr>
                    `}).join("");x.innerHTML=`
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 8px;">
                        <div>
                            <h4 style="font-weight: 700; font-size: 1.05rem; color: var(--text-main); margin: 0;">
                                Phê duyệt kết quả Lựa chọn Nhà thầu (LCNT)
                            </h4>
                            <p class="text-muted" style="font-size:0.82rem; margin: 4px 0 0 0;">
                                Vui lòng nhập QĐ phê duyệt và chọn kết quả trúng thầu/trượt thầu cho từng nhà thầu bên dưới.
                            </p>
                        </div>
                        <div style="display: flex; gap: 8px;">
                            <button class="btn-excel-action" id="btn-result-export-excel-template">
                                <i data-lucide="download"></i> Tải Excel Mẫu
                            </button>
                            <button class="btn-excel-action" id="btn-result-import-excel">
                                <i data-lucide="upload"></i> Nhập từ Excel
                            </button>
                        </div>
                    </div>

                    <div class="card" style="padding: 20px; border: 1px solid var(--border-color); border-radius: var(--radius-lg); background: var(--bg-card); display: flex; flex-direction: column; gap: 16px; margin-bottom: 24px;">
                        <div class="form-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
                            <div class="form-group" style="display:flex; flex-direction:column; gap:6px; margin-bottom:0;">
                                <label style="font-weight:700; font-size:0.85rem;">QĐ phê duyệt số <span class="required">*</span></label>
                                <input type="text" id="award-decision-no" class="form-control" required value="${e.soQuyetDinhKetQua||""}" placeholder="Số QĐ...">
                                <span class="error-text">Vui lòng nhập số QĐ</span>
                            </div>
                            <div class="form-group" style="display:flex; flex-direction:column; gap:6px; margin-bottom:0;">
                                <label style="font-weight:700; font-size:0.85rem;">Ngày ký QĐ <span class="required">*</span></label>
                                <input type="date" id="award-decision-date" class="form-control" required value="${e.ngayQuyetDinhKetQua?this.model.formatForDateInput(e.ngayQuyetDinhKetQua):""}">
                                <span class="error-text">Vui lòng chọn ngày ký QĐ</span>
                            </div>
                        </div>
                    </div>

                    <h5 style="margin-top:24px; margin-bottom:12px; font-weight:700; font-size:0.95rem; color:var(--text-main); display:flex; align-items:center; gap:6px;">
                        <i data-lucide="list"></i> Danh sách nhà thầu tham dự & Kết quả LCNT
                    </h5>
                    <div class="table-container" style="border:1px solid var(--border-color); border-radius:var(--radius-md); overflow-x:auto; margin-bottom:24px; background:var(--bg-card);">
                        <table class="data-table" style="min-width: 100%;">
                            <thead>
                                <tr>
                                    ${e.phanLo==="Có"?`
                                        <th style="width: 10%;">Mã phần lô</th>
                                        <th style="width: 10%;">Tên phần lô</th>
                                    `:""}
                                    <th style="width: 10%;">Mã nhà thầu</th>
                                    <th style="width: 16%;">Tên nhà thầu</th>
                                    ${K?`
                                        <th style="width: 10%; text-align: center;">Điểm tổng hợp</th>
                                    `:""}
                                    <th style="width: 10%; text-align: center;">Xếp hạng nhà thầu</th>
                                    <th style="width: 10%;">Trúng thầu/trượt thầu</th>
                                    <th style="width: 14%;">Lý do trượt</th>
                                    <th style="width: 10%;">Giá trúng thầu</th>
                                    <th style="width: 8%;">Thời gian thực hiện gói thầu</th>
                                    <th style="width: 8%;">Thời gian thực hiện hợp đồng</th>
                                </tr>
                            </thead>
                            <tbody id="approve-bidders-tbody">
                                ${q}
                            </tbody>
                        </table>
                    </div>

                    <div style="display:flex; justify-content:flex-end; gap:12px;">
                        <button class="btn btn-primary" id="btn-approve-award" style="padding:12px 24px; font-weight:700; display:flex; align-items:center; gap:8px;">
                            <i data-lucide="check-circle2"></i> Phê duyệt & Hoàn thành LCNT
                        </button>
                    </div>
                `;const B=document.getElementById("approve-bidders-tbody");B&&(B.querySelectorAll(".row-gia-trung").forEach($=>{$.addEventListener("input",O=>{const I=this.model.formatVND(O.target.value);O.target.value=I})}),B.querySelectorAll(".row-tg-goithau").forEach($=>{$.addEventListener("input",O=>{const A=O.target.closest("tr").querySelector(".row-tg-hopdong");if(A){const F=O.target.value.trim();A.value=F?F+" + Thời gian thực hiện các nghĩa vụ theo hợp đồng":""}})}),B.querySelectorAll(".row-status-select").forEach($=>{$.addEventListener("change",O=>{var F;const I=O.target.closest("tr");if(O.target.value==="trung"){const tt=(F=I.cells[0])==null?void 0:F.textContent.trim();B.querySelectorAll("tr").forEach(Q=>{var W;if(Q!==I){if(e.phanLo==="Có"&&((W=Q.cells[0])==null?void 0:W.textContent.trim())!==tt)return;const U=Q.querySelector(".row-status-select");U&&!U.disabled&&(U.value="truot");const Y=Q.querySelector(".row-ly-do-truot");Y&&(Y.disabled=!1,Y.style.background="",Y.value||(Y.value=Q.getAttribute("data-default-reason")||"Nhà thầu xếp hạng 1 trúng thầu"));const et=Q.querySelector(".row-gia-trung");et&&(et.disabled=!0,et.style.background="#f1f5f9",et.value="");const R=Q.querySelector(".row-tg-goithau");R&&(R.disabled=!0,R.style.background="#f1f5f9",R.value="");const E=Q.querySelector(".row-tg-hopdong");E&&(E.disabled=!0,E.style.background="#f1f5f9",E.value="")}});const _=I.querySelector(".row-gia-trung");_&&(_.disabled=!1,_.style.background="",_.value=I.getAttribute("data-default-price")||"");const k=I.querySelector(".row-tg-goithau");k&&(k.disabled=!1,k.style.background="",k.value=I.getAttribute("data-default-duration-pkg")||"");const C=I.querySelector(".row-tg-hopdong");C&&(C.disabled=!1,C.style.background="",C.value=I.getAttribute("data-default-duration-ctr")||"");const j=I.querySelector(".row-ly-do-truot");j&&(j.disabled=!0,j.style.background="#f1f5f9",j.value="")}else{const tt=I.querySelector(".row-gia-trung");tt&&(tt.disabled=!0,tt.style.background="#f1f5f9",tt.value="");const _=I.querySelector(".row-tg-goithau");_&&(_.disabled=!0,_.style.background="#f1f5f9",_.value="");const k=I.querySelector(".row-tg-hopdong");k&&(k.disabled=!0,k.style.background="#f1f5f9",k.value="");const C=I.querySelector(".row-ly-do-truot");C&&(C.disabled=!1,C.style.background="",C.value=I.getAttribute("data-default-reason")||"Nhà thầu xếp hạng 1 trúng thầu")}})}));const G=document.getElementById("btn-approve-award");G&&(G.onclick=async()=>{var W,U,Y,et,R;const $=((W=document.getElementById("award-decision-no"))==null?void 0:W.value.trim())||"",O=((U=document.getElementById("award-decision-date"))==null?void 0:U.value)||"",I=this.model.convertDMYToYMD(O);let A=!1;const F=[];[{el:document.getElementById("award-decision-no"),val:$},{el:document.getElementById("award-decision-date"),val:O}].forEach(E=>{var Z;if(!E.val&&(A=!0,E.el)){F.push(E.el),(Z=E.el.closest(".form-group"))==null||Z.classList.add("invalid");const X=()=>{var it;(it=E.el.closest(".form-group"))==null||it.classList.remove("invalid")};E.el.addEventListener("input",X),E.el.addEventListener("change",X)}});const _=[];if(B.querySelectorAll("tr").forEach(E=>{var X;((X=E.querySelector(".row-status-select"))==null?void 0:X.value)==="trung"&&_.push(E)}),_.forEach(E=>{var J,lt,st;const Z=((J=E.querySelector(".row-gia-trung"))==null?void 0:J.value)||"",X=((lt=E.querySelector(".row-tg-goithau"))==null?void 0:lt.value.trim())||"",it=((st=E.querySelector(".row-tg-hopdong"))==null?void 0:st.value.trim())||"";[{el:E.querySelector(".row-gia-trung"),val:Z},{el:E.querySelector(".row-tg-goithau"),val:X},{el:E.querySelector(".row-tg-hopdong"),val:it}].forEach(ct=>{if(!ct.val&&(A=!0,ct.el)){F.push(ct.el),ct.el.style.border="1px solid var(--danger)";const St=()=>{ct.el.style.border=""};ct.el.addEventListener("input",St)}})}),A){if(F.length>0){const E=F[0];E.scrollIntoView({behavior:"smooth",block:"center",inline:"center"}),setTimeout(()=>E.focus({preventScroll:!0}),300)}return}B.querySelectorAll("tr").forEach(E=>{var it,ot;const Z=E.getAttribute("data-approve-bid-id"),X=this.model.state.thongtinmothau.find(J=>J.id===Z);X&&(((it=E.querySelector(".row-status-select"))==null?void 0:it.value)==="trung"?X.lyDoTruot="":X.lyDoTruot=((ot=E.querySelector(".row-ly-do-truot"))==null?void 0:ot.value.trim())||"")});let k=_.length>0,C="none";if(e.phanLo==="Có"){const E=typeof e.phanLoList=="string"?JSON.parse(e.phanLoList||"[]"):e.phanLoList||[];E.forEach(X=>{var ot,J,lt;const it=_.find(st=>{var ct;return((ct=st.cells[0])==null?void 0:ct.textContent.trim())===X.maPhanLo});if(it){const st=it.getAttribute("data-nt-id");X.nhaThauTrungThauId=st?isNaN(st)?st:parseInt(st):"",X.giaTrungThau=this.model.parseVND(((ot=it.querySelector(".row-gia-trung"))==null?void 0:ot.value)||"0"),X.thoiGianGoiThau=((J=it.querySelector(".row-tg-goithau"))==null?void 0:J.value.trim())||"",X.thoiGianHopDong=((lt=it.querySelector(".row-tg-hopdong"))==null?void 0:lt.value.trim())||""}else X.nhaThauTrungThauId="",X.giaTrungThau=0,X.thoiGianGoiThau="",X.thoiGianHopDong=""}),e.phanLoList=E;const Z=_[0];if(Z){const X=Z.getAttribute("data-nt-id");e.nhaThauTrungThauId=X?isNaN(X)?X:parseInt(X):"",e.giaTrungThau=_.reduce((it,ot)=>{var J;return it+this.model.parseVND(((J=ot.querySelector(".row-gia-trung"))==null?void 0:J.value)||"0")},0),C=X||"none"}else e.nhaThauTrungThauId="",e.giaTrungThau=0;e.thoiGianGoiThau="",e.thoiGianHopDong=""}else{const E=_[0];let Z=0,X="",it="";E&&(C=E.getAttribute("data-nt-id"),Z=this.model.parseVND(((Y=E.querySelector(".row-gia-trung"))==null?void 0:Y.value)||"0"),X=((et=E.querySelector(".row-tg-goithau"))==null?void 0:et.value.trim())||"",it=((R=E.querySelector(".row-tg-hopdong"))==null?void 0:R.value.trim())||""),e.nhaThauTrungThauId=C==="none"?"":isNaN(C)?C:parseInt(C),e.giaTrungThau=Z,e.thoiGianGoiThau=C==="none"?"":X,e.thoiGianHopDong=C==="none"?"":it}e.soQuyetDinhKetQua=$,e.ngayQuyetDinhKetQua=I,e.trangThai=k?"Đã có kết quả":"Hủy thầu",this.model.persistData("goithau"),this.model.persistData("thongtinmothau"),this.renderGoiThauTable(),window.appController.autoSync();const j=C==="none"?"Hủy thầu thành công":"Chúc mừng",Q=C==="none"?`Đã cập nhật trạng thái hủy thầu cho gói thầu "${e.tenGoiThau}" thành công!`:`Đã phê duyệt trúng thầu cho gói thầu "${e.tenGoiThau}" thành công!`;await this.customAlert(j,Q,"check-circle"),this.showPackageDetails(u)})}const at=document.getElementById("btn-result-export-excel-template");at&&(at.onclick=()=>{const S=(e.tenGoiThau||"GoiThau").replace(/[^a-zA-Z0-9]/g,"_");ft(`/api/export-ketquaqd-template?package_id=${e.id}&package_name=${encodeURIComponent(S)}`,`KetQua_QD_${S}.xlsx`)});const nt=document.getElementById("btn-result-import-excel");nt&&(nt.onclick=()=>{window.appController._currentResultPackageId=e.id,window.appController.openExcelImportModal("ketquaqd")});break}lucide.createIcons(),window.appController&&window.appController.setupExcelImportEvents&&window.appController.setupExcelImportEvents()}}function Pt(u,t){const a=document.getElementById("excel-preview-container"),n=document.getElementById("excel-preview-header"),i=document.getElementById("excel-preview-tbody");if(!a||!i||!n)return;if(u.length===0){i.innerHTML='<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">Không tìm thấy dữ liệu hợp lệ trong file Excel</td></tr>',a.style.display="block";return}const e={maKeHoach:"Mã kế hoạch",tenKeHoach:"Tên kế hoạch",loaiHinhMuaSam:"Loại hình",tenDuAnDuToan:"Dự án / Dự toán",tongMucDauTu:"Tổng mức đầu tư",ngayPheDuyet:"Ngày phê duyệt",quyetDinhPheDuyet:"QĐ phê duyệt",thoiGianDangMa:"Thời gian đăng mã",maGoiThau:"Mã gói thầu",tenGoiThau:"Tên gói thầu",keHoachId:"Mã Kế hoạch liên kết",giaGoiThau:"Giá gói thầu",hinhThucLuaChon:"Hình thức LCNT",phuongThucLuaChon:"Phương thức LCNT",thoiGianThucHien:"TG thực hiện (ngày)",trangThai:"Trạng thái",loaiHopDong:"Loại hợp đồng",nguonVon:"Nguồn vốn",maChuDauTu:"Mã CĐT",tenChuDauTu:"Tên chủ đầu tư",maSoThue:"Mã số thuế",diaChi:"Địa chỉ",soDienThoai:"Điện thoại",email:"Email",chucVuNguoiDungDau:"Chức vụ người đứng đầu",nguoiKyQuyetDinh:"Người ký QĐ",chucVuNguoiKy:"Chức vụ người ký",danhXung:"Danh xưng",soTaiKhoan:"Số tài khoản",noiMoTaiKhoan:"Nơi mở tài khoản",maQHNS:"Mã QHNS",maNhaThau:"Mã nhà thầu",tenNhaThau:"Tên nhà thầu",loaiNhaThau:"Loại nhà thầu",nguoiDaiDien:"Người đại diện",soTaiKhoan:"Số tài khoản",noiMoTaiKhoan:"Nơi mở tài khoản",hoTen:"Họ và tên",soCCCD:"Số CCCD",ngayCapCCCD:"Ngày cấp CCCD",noiCapCCCD:"Nơi cấp CCCD",soChungChi:"Số chứng chỉ",ngayCapChungChi:"Ngày cấp CC",donViCapChungChi:"Đơn vị cấp CC",soHopDong:"Số hợp đồng",tenHopDong:"Tên hợp đồng",ngayKy:"Ngày ký",giaTri:"Giá trị hợp đồng",soNgayThucHien:"Số ngày thực hiện",maDinhDanh:"Mã nhà thầu",maNhaThau:"Mã nhà thầu",nhaThauId:"Nhà thầu",maPhanLo:"Mã phần lô",tenPhanLo:"Tên phần lô",damBaoDuThau:"Đảm bảo dự thầu",hieuLucDamBao:"Hiệu lực ĐB (ngày)",hieuLucHsdxt:"Hiệu lực E-HSĐXKT",giaDuThau:"Giá dự thầu",tyLeGiamGia:"Tỷ lệ giảm (%)",giaSauGiamGia:"Giá sau giảm giá",hieuLucHsdt:"Hiệu lực E-HSDT",giaTriDamBao:"Giá trị đảm bảo",hieuLucBaoDamNgay:"Hiệu lực ĐB (ngày)",thoiGianThucHien:"Thời gian thực hiện",danhGiaHopLe:"Đánh giá hợp lệ",danhGiaNangLuc:"Đánh giá năng lực",danhGiaKyThuat:"Đánh giá kỹ thuật",danhGiaKetLuan:"Kết luận",giaTrungThau:"Giá trúng thầu",thoiGianGoiThau:"Thời gian thực hiện gói thầu",thoiGianHopDong:"Thời gian thực hiện hợp đồng",lyDoTruot:"Lý do trượt thầu"},o=u[0],l=Object.keys(o).filter(d=>d!=="_valid"&&d!=="_comment");let h="<tr>";l.forEach(d=>{const r=e[d]||d;let c="left";["tongMucDauTu","giaGoiThau","giaTri","giaTriPhanLo","giaTrungThau","damBaoDuThau","giaDuThau","giaSauGiamGia","giaTriDamBao"].includes(d)&&(c="right"),h+=`<th style="text-align: ${c} !important;">${r}</th>`}),h+='<th style="text-align: center !important;">Thông tin kiểm tra</th></tr>',n.innerHTML=h,i.innerHTML=u.map(d=>{const r=d._valid?"":'style="background-color: rgba(239, 68, 68, 0.08);"',c=d._valid?'<span class="badge badge-success"><i data-lucide="check"></i> Hợp lệ</span>':`<span class="badge badge-danger" title="${d._comment}"><i data-lucide="alert-circle"></i> Lỗi dữ liệu</span>`;let g=`<tr ${r}>`;return l.forEach(s=>{let p=d[s],m="left",f="";if(["tongMucDauTu","giaGoiThau","giaTri","giaTriPhanLo","giaTrungThau","damBaoDuThau","giaDuThau","giaSauGiamGia","giaTriDamBao"].includes(s))m="right",f="font-weight:700; color:var(--primary);",p=this.model.formatVND?this.model.formatVND(p||0):this.model.formatCurrency?this.model.formatCurrency(p||0):p;else if(s==="maKeHoach"||s==="maGoiThau"||s==="maChuDauTu"||s==="maNhaThau"||s==="soHopDong"||s==="soChungChi"||s==="maDinhDanh")f="font-weight:700;";else if(s==="nhaThauId"){const v=this.model.state.nhathau.find(b=>b.id===p);v&&(p=v.tenNhaThau)}g+=`<td style="text-align: ${m} !important; ${f}">${p!=null&&p!==""?p:"--"}</td>`}),g+=`<td style="text-align: center; vertical-align: middle;">${c}</td></tr>`,g}).join(""),a.style.display="block",lucide.createIcons()}const qt=Object.freeze(Object.defineProperty({__proto__:null,authFetchDownload:ft,checkBidQualified:gt,formatCurrency:dt,formatDate:rt,getAuthDownloadUrl:Et,initCustomSelect:ht,renderExcelPreview:Pt,renderGoiThauTable:Nt,renderKeHoachTable:Ht,renderPlanVersionDetails:Mt,showKeHoachDetails:Bt,showPackageDetails:Gt},Symbol.toStringTag,{value:"Module"}));async function Vt(){const u=document.getElementById("chudautu-table").querySelector("tbody"),t=document.getElementById("search-chudautu").value.toLowerCase();let a=[],n=0;const i=this.model.currentPage.chudautu||1,e=this.model.pageSize||10,o=this.model.sortState.chudautu||{},l=o.field||"",h=o.order||"asc";if(this.model.useServerSidePagination){!u.querySelector(".empty-state")&&u.children.length===0&&(u.innerHTML='<tr><td colspan="8" style="text-align: center; padding: 20px; color: var(--primary); font-weight: bold;">Đang tải dữ liệu từ máy chủ...</td></tr>');try{const d=await fetch(`/api/paginate?table=chudautu&page=${i}&pageSize=${e}&search=${encodeURIComponent(t)}&sortBy=${l}&sortOrder=${h}`,{headers:{"X-Session-Token":sessionStorage.getItem("bf_session_token")||"","X-Username":sessionStorage.getItem("bf_username")||""}});if(d.ok){const r=await d.json();a=r.items,n=r.totalItems}}catch(d){console.error("Failed to fetch paginated investors",d)}}else{const r=this.model.getLatestChuDauTu().filter(g=>(g.maChuDauTu||"").toLowerCase().includes(t)||(g.tenChuDauTu||"").toLowerCase().includes(t)||g.maSoThue&&g.maSoThue.includes(t));l&&r.sort((g,s)=>{let p=g[l]||"",m=s[l]||"";return typeof p=="string"&&(p=p.toLowerCase()),typeof m=="string"&&(m=m.toLowerCase()),p<m?h==="asc"?-1:1:p>m?h==="asc"?1:-1:0}),n=r.length;const c=(i-1)*e;a=r.slice(c,c+e)}if(n===0){u.innerHTML=`
            <tr>
                <td colspan="8">
                    <div class="empty-state">
                        <i data-lucide="building"></i>
                        <p>Không tìm thấy Chủ đầu tư nào phù hợp</p>
                    </div>
                </td>
            </tr>
        `;const d=document.getElementById("chudautu-pagination");d&&(d.innerHTML="")}else u.innerHTML=a.map(d=>{const r=d.rootId||d.id,c=d.allVersions||this.model.state.chudautu.filter(f=>(f.rootId||f.id)===r).sort((f,v)=>parseInt(v.phienBan||v.phien_ban||0)-parseInt(f.phienBan||f.phien_ban||0));this.model.state.selectedChuDauTuVersion||(this.model.state.selectedChuDauTuVersion={});const g=this.model.state.selectedChuDauTuVersion[r]||d.id,s=this.model.state.chudautu.find(f=>f.id===g)||d,p=c.map(f=>{const v=`V${parseInt(f.phienBan||f.phien_ban||0)}`,b=f.id===s.id?"selected":"";return`<option value="${f.id}" ${b}>${v}</option>`}).join(""),m=`
                <select class="form-control version-droplist" onchange="window.changeChuDauTuRowVersion('${r}', this.value)" style="width: 52px; display: inline-block; padding: 2px; height: 22px; font-size: 0.8rem; border-radius: 4px; border: 1px solid var(--border-color, #ccc); background-color: var(--bg-card); color: var(--text-main); text-align-last: center; cursor: pointer; margin: 0; outline: none; vertical-align: middle;">
                    ${p}
                </select>
            `;return`
            <tr>
                <td>
                    <div style="display: inline-flex; align-items: center; gap: 6px; line-height: 1; vertical-align: middle;">
                        <a href="#" onclick="event.preventDefault(); window.editChuDauTu('${s.id}')" class="text-blue fw-bold link-hover" title="Xem chi tiết / Sửa Chủ đầu tư" style="display: inline-flex; align-items: center; line-height: 1;"><span class="detail-code" style="margin: 0; line-height: 1;">${s.maChuDauTu||""}</span></a>
                        <span style="color: var(--text-muted); font-size: 0.85rem; line-height: 1; display: inline-flex; align-items: center;">-</span>
                        ${m}
                    </div>
                </td>
                <td style="min-width: 220px; max-width: 320px;" class="fw-bold text-wrap">
                    ${s.tenChuDauTu||""}
                    ${s.coQuanChuQuan?`<div style="font-size:0.75rem; font-weight:normal; color:var(--text-muted); margin-top:2px;">CQ chủ quản: ${s.coQuanChuQuan}</div>`:""}
                </td>
                <td>${s.maSoThue||"--"}</td>
                <td><span class="fw-bold">${s.danhXung||"Ông"} ${s.nguoiKyQuyetDinh||"--"}</span></td>
                <td style="min-width: 240px; max-width: 360px;" class="text-wrap">
                    <div style="font-size:0.85rem;" class="fw-bold">${(s.diaChi||"").replace(/\s*\|\s*/g,", ")}</div>
                    <div style="font-size:0.75rem; color:var(--text-light);">${s.soDienThoai||""}${s.email?" | "+s.email:""}</div>
                </td>
                <td>
                    <div style="font-size:0.85rem;" class="fw-bold">${s.soTaiKhoan||"--"}</div>
                    <div style="font-size:0.75rem; color:var(--text-light);">${s.noiMoTaiKhoan||"--"}${s.maQHNS?" | QHNS: "+s.maQHNS:""}</div>
                </td>
                <td class="text-right">
                    <div class="action-btn-group">
                        <button class="action-btn btn-edit" onclick="window.editChuDauTu('${s.id}')" title="Sửa">
                            <i data-lucide="edit-2"></i>
                        </button>
                        <button class="action-btn btn-delete" onclick="window.deleteChuDauTu('${s.id}')" title="Xóa">
                            <i data-lucide="trash-2"></i>
                        </button>
                    </div>
                </td>
            </tr>
            `}).join(""),window.renderTablePagination&&window.renderTablePagination("chudautu-pagination",n,i,e);lucide.createIcons({root:u}),this.enhanceTableHeaders("chudautu-table","chudautu")}async function At(){const u=document.getElementById("nhathau-table").querySelector("tbody"),t=document.getElementById("search-nhathau").value.toLowerCase();let a=[],n=0;const i=this.model.currentPage.nhathau||1,e=this.model.pageSize||10,o=this.model.sortState.nhathau||{},l=o.field||"",h=o.order||"asc";if(this.model.useServerSidePagination){!u.querySelector(".empty-state")&&u.children.length===0&&(u.innerHTML='<tr><td colspan="8" style="text-align: center; padding: 20px; color: var(--primary); font-weight: bold;">Đang tải dữ liệu từ máy chủ...</td></tr>');try{const d=await fetch(`/api/paginate?table=nhathau&page=${i}&pageSize=${e}&search=${encodeURIComponent(t)}&sortBy=${l}&sortOrder=${h}`,{headers:{"X-Session-Token":sessionStorage.getItem("bf_session_token")||"","X-Username":sessionStorage.getItem("bf_username")||""}});if(d.ok){const r=await d.json();a=r.items,n=r.totalItems}}catch(d){console.error("Failed to fetch paginated contractors",d)}}else{const r=this.model.getLatestNhaThau().filter(g=>(g.maNhaThau||"").toLowerCase().includes(t)||(g.tenNhaThau||"").toLowerCase().includes(t)||g.maSoThue&&g.maSoThue.includes(t)||g.loaiNhaThau==="Liên danh"&&g.thanhVienLienDanh&&g.thanhVienLienDanh.some(s=>(s.tenNhaThau||"").toLowerCase().includes(t)||(s.maSoThue||"").includes(t)));l&&r.sort((g,s)=>{let p=g[l]||"",m=s[l]||"";return typeof p=="string"&&(p=p.toLowerCase()),typeof m=="string"&&(m=m.toLowerCase()),p<m?h==="asc"?-1:1:p>m?h==="asc"?1:-1:0}),n=r.length;const c=(i-1)*e;a=r.slice(c,c+e)}if(n===0){u.innerHTML=`
            <tr>
                <td colspan="8">
                    <div class="empty-state">
                        <i data-lucide="shield-alert"></i>
                        <p>Không tìm thấy Nhà thầu nào phù hợp</p>
                    </div>
                </td>
            </tr>
        `;const d=document.getElementById("nhathau-pagination");d&&(d.innerHTML="")}else u.innerHTML=a.map(d=>{const r=d.rootId||d.id,c=d.allVersions||this.model.state.nhathau.filter(v=>(v.rootId||v.id)===r).sort((v,b)=>parseInt(b.phienBan||b.phien_ban||0)-parseInt(v.phienBan||v.phien_ban||0));this.model.state.selectedNhaThauVersion||(this.model.state.selectedNhaThauVersion={});const g=this.model.state.selectedNhaThauVersion[r]||d.id,s=this.model.state.nhathau.find(v=>v.id===g)||d,p=c.map(v=>{const b=`V${parseInt(v.phienBan||v.phien_ban||0)}`,y=v.id===s.id?"selected":"";return`<option value="${v.id}" ${y}>${b}</option>`}).join(""),m=`
                <select class="form-control version-droplist" onchange="window.changeNhaThauRowVersion('${r}', this.value)" style="width: 52px; display: inline-block; padding: 2px; height: 22px; font-size: 0.8rem; border-radius: 4px; border: 1px solid var(--border-color, #ccc); background-color: var(--bg-card); color: var(--text-main); text-align-last: center; cursor: pointer; margin: 0; outline: none; vertical-align: middle;">
                    ${p}
                </select>
            `;if(s.loaiNhaThau==="Liên danh"){const v=s.thanhVienLienDanh||[],b=v.map(T=>T.tenNhaThau||"").join("<br>+ "),y=v.map(T=>T.maSoThue||"").join(", "),w=v.length>0?`${v[0].danhXung||"Ông"} ${v[0].nguoiDaiDien||"--"} (Trưởng LD)`:"--",x=v.length>0?`<small>SĐT: ${v[0].soDienThoai||"--"}</small><br><small>Email: ${v[0].email||"--"}</small>`:"--",L=v.length>0?`<div style="font-size:0.85rem;" class="fw-bold">${v[0].soTaiKhoan||"--"}</div><div style="font-size:0.75rem; color:var(--text-light);">${v[0].noiMoTaiKhoan||"--"} (+${v.length-1} TV)</div>`:"--";return`
                    <tr>
                        <td>
                            <div style="display: inline-flex; align-items: center; gap: 6px; line-height: 1; vertical-align: middle;">
                                <a href="#" onclick="event.preventDefault(); window.editNhaThau('${s.id}')" class="text-blue fw-bold link-hover" title="Xem chi tiết / Sửa Nhà thầu" style="display: inline-flex; align-items: center; line-height: 1;"><span class="detail-code" style="margin: 0; line-height: 1;">${s.maNhaThau||""}</span></a>
                                <span style="color: var(--text-muted); font-size: 0.85rem; line-height: 1; display: inline-flex; align-items: center;">-</span>
                                ${m}
                            </div>
                        </td>
                        <td style="min-width: 240px; max-width: 360px;" class="fw-bold text-wrap">
                            ${s.tenNhaThau||""}
                            <div style="margin-top: 4px;"><span class="badge badge-info">Liên danh (${v.length} TV)</span></div>
                            <div style="font-size: 0.75rem; font-weight: normal; color: var(--text-muted); margin-top: 4px; padding-left: 8px; border-left: 2px solid var(--primary-soft); white-space: normal !important;">
                                + ${b}
                            </div>
                        </td>
                        <td><small>${y}</small></td>
                        <td>${w}</td>
                        <td>${x}</td>
                        <td>${L}</td>
                        <td class="text-right">
                            <div class="action-btn-group">
                                <button class="action-btn btn-edit" onclick="window.editNhaThau('${s.id}')" title="Sửa">
                                    <i data-lucide="edit-2"></i>
                                </button>
                                <button class="action-btn btn-delete" onclick="window.deleteNhaThau('${s.id}')" title="Xóa">
                                    <i data-lucide="trash-2"></i>
                                </button>
                            </div>
                        </td>
                    </tr>
                `}else{const v=`${s.danhXung||"Ông"} ${s.nguoiDaiDien||"--"}`,b=`<small>SĐT: ${s.soDienThoai||"--"}</small><br><small>Email: ${s.email||"--"}</small>`,y=`<div style="font-size:0.85rem;" class="fw-bold">${s.soTaiKhoan||"--"}</div><div style="font-size:0.75rem; color:var(--text-light);">${s.noiMoTaiKhoan||"--"}${s.maNganHang?" ("+s.maNganHang+")":""}</div>`;return`
                    <tr>
                        <td>
                            <div style="display: inline-flex; align-items: center; gap: 6px; line-height: 1; vertical-align: middle;">
                                <a href="#" onclick="event.preventDefault(); window.editNhaThau('${s.id}')" class="text-blue fw-bold link-hover" title="Xem chi tiết / Sửa Nhà thầu" style="display: inline-flex; align-items: center; line-height: 1;"><span class="detail-code" style="margin: 0; line-height: 1;">${s.maNhaThau||""}</span></a>
                                <span style="color: var(--text-muted); font-size: 0.85rem; line-height: 1; display: inline-flex; align-items: center;">-</span>
                                ${m}
                            </div>
                        </td>
                        <td style="min-width: 240px; max-width: 360px;" class="fw-bold text-wrap">
                            ${s.tenNhaThau||""}
                        </td>
                        <td>${s.maSoThue||"--"}</td>
                        <td>${v}</td>
                        <td>${b}</td>
                        <td>${y}</td>
                        <td class="text-right">
                            <div class="action-btn-group">
                                <button class="action-btn btn-edit" onclick="window.editNhaThau('${s.id}')" title="Sửa">
                                    <i data-lucide="edit-2"></i>
                                </button>
                                <button class="action-btn btn-delete" onclick="window.deleteNhaThau('${s.id}')" title="Xóa">
                                    <i data-lucide="trash-2"></i>
                                </button>
                            </div>
                        </td>
                    </tr>
                `}}).join(""),window.renderTablePagination&&window.renderTablePagination("nhathau-pagination",n,i,e);lucide.createIcons({root:u}),this.enhanceTableHeaders("nhathau-table","nhathau")}async function zt(){const u=document.getElementById("chuyengia-table").querySelector("tbody"),t=document.getElementById("search-chuyengia").value.toLowerCase(),a=this.model.state.activerole==="employee",n=document.getElementById("btn-add-chuyengia");n&&(n.style.display=a?"none":"flex");let i=[],e=0;const o=this.model.currentPage.chuyengia||1,l=this.model.pageSize||10,h=this.model.sortState.chuyengia||{},d=h.field||"",r=h.order||"asc";if(this.model.useServerSidePagination){!u.querySelector(".empty-state")&&u.children.length===0&&(u.innerHTML='<tr><td colspan="7" style="text-align: center; padding: 20px; color: var(--primary); font-weight: bold;">Đang tải dữ liệu từ máy chủ...</td></tr>');try{const c=await fetch(`/api/paginate?table=chuyengia&page=${o}&pageSize=${l}&search=${encodeURIComponent(t)}&sortBy=${d}&sortOrder=${r}`,{headers:{"X-Session-Token":sessionStorage.getItem("bf_session_token")||"","X-Username":sessionStorage.getItem("bf_username")||""}});if(c.ok){const g=await c.json();i=g.items,e=g.totalItems}}catch(c){console.error("Failed to fetch paginated experts",c)}}else{const g=this.model.getLatestChuyenGia().filter(p=>(p.hoTen||"").toLowerCase().includes(t)||(p.soCCCD||"").includes(t)||(p.soChungChi||"").toLowerCase().includes(t));d&&g.sort((p,m)=>{let f=p[d]||"",v=m[d]||"";return typeof f=="string"&&(f=f.toLowerCase()),typeof v=="string"&&(v=v.toLowerCase()),f<v?r==="asc"?-1:1:f>v?r==="asc"?1:-1:0}),e=g.length;const s=(o-1)*l;i=g.slice(s,s+l)}if(e===0){u.innerHTML=`
            <tr>
                <td colspan="7">
                    <div class="empty-state">
                        <i data-lucide="user-x"></i>
                        <p>Không tìm thấy Chuyên gia nào phù hợp</p>
                    </div>
                </td>
            </tr>
        `;const c=document.getElementById("chuyengia-pagination");c&&(c.innerHTML="")}else u.innerHTML=i.map(c=>{const g=c.rootId||c.id,s=c.allVersions||this.model.state.chuyengia.filter(b=>(b.rootId||b.id)===g).sort((b,y)=>parseInt(y.phienBan||y.phien_ban||0)-parseInt(b.phienBan||b.phien_ban||0));this.model.state.selectedChuyenGiaVersion||(this.model.state.selectedChuyenGiaVersion={});const p=this.model.state.selectedChuyenGiaVersion[g]||c.id,m=this.model.state.chuyengia.find(b=>b.id===p)||c,f=s.map(b=>{const y=`V${parseInt(b.phienBan||b.phien_ban||0)}`,w=b.id===m.id?"selected":"";return`<option value="${b.id}" ${w}>${y}</option>`}).join(""),v=`
                <select class="form-control version-droplist" onchange="window.changeChuyenGiaRowVersion('${g}', this.value)" style="width: 52px; display: inline-block; padding: 2px; height: 22px; font-size: 0.8rem; border-radius: 4px; border: 1px solid var(--border-color, #ccc); background-color: var(--bg-card); color: var(--text-main); text-align-last: center; cursor: pointer; margin: 0; outline: none; vertical-align: middle;">
                    ${f}
                </select>
            `;return`
            <tr>
                <td class="fw-bold">
                    <div style="display: inline-flex; align-items: center; gap: 6px; line-height: 1; vertical-align: middle;">
                        <a href="#" onclick="event.preventDefault(); window.showChuyenGiaDetails('${m.id}')" class="text-blue fw-bold link-hover" title="Xem chi tiết lý lịch" style="display: inline-flex; align-items: center; line-height: 1;"><span style="margin: 0; line-height: 1;">${m.hoTen||""}</span></a>
                        <span style="color: var(--text-muted); font-size: 0.85rem; line-height: 1; display: inline-flex; align-items: center;">-</span>
                        ${v}
                    </div>
                </td>
                <td>${m.soCCCD||""}</td>
                <td><span class="badge badge-info">${m.soChungChi||""}</span></td>
                <td style="min-width: 200px; max-width: 300px;" class="text-muted text-wrap">${m.donViCapChungChi||"--"}</td>
                <td>${m.ngayCapChungChi?rt(m.ngayCapChungChi):"--"}</td>
                <td class="text-right">
                    ${a?"":`
                    <div class="action-btn-group">
                        <button class="action-btn btn-edit" onclick="window.editChuyenGia('${m.id}')" title="Sửa">
                            <i data-lucide="edit-2"></i>
                        </button>
                        <button class="action-btn btn-delete" onclick="window.deleteChuyenGia('${m.id}')" title="Xóa">
                            <i data-lucide="trash-2"></i>
                        </button>
                    </div>
                    `}
                </td>
            </tr>
            `}).join(""),window.renderTablePagination&&window.renderTablePagination("chuyengia-pagination",e,o,l);lucide.createIcons({root:u}),this.enhanceTableHeaders("chuyengia-table","chuyengia")}async function jt(){const u=document.getElementById("hopdong-table").querySelector("tbody"),t=document.getElementById("search-hopdong").value.toLowerCase(),a=m=>{if(!m)return{year:null,month:null};let f=String(m).replace(/\s*-\s*/," ").trim();if(f.match(/^\d{4}-\d{2}-\d{2}/)){const b=f.substring(0,4),y=parseInt(f.substring(5,7),10).toString();return{year:b,month:y}}else if(f.match(/^\d{2}\/\d{2}\/\d{4}/)){const b=f.split(" ")[0].split("/"),y=b[2],w=parseInt(b[1],10).toString();return{year:y,month:w}}const v=new Date(f);return isNaN(v.getTime())?{year:null,month:null}:{year:v.getFullYear().toString(),month:(v.getMonth()+1).toString()}},n=document.getElementById("filter-hopdong-nam"),i=document.getElementById("filter-hopdong-thang"),e=this.model.state.hopdong||[];if(n&&i){const m=n.value,f=i.value,v=new Set,b=new Set;e.forEach(x=>{if(x.ngayKy){const L=a(x.ngayKy);L.year&&v.add(L.year),L.month&&b.add(L.month)}});const y=Array.from(v).sort((x,L)=>parseInt(L)-parseInt(x)),w=Array.from(b).sort((x,L)=>parseInt(L)-parseInt(x));n.innerHTML='<option value="">Năm</option>'+y.map(x=>`<option value="${x}">${x}</option>`).join(""),i.innerHTML='<option value="">Tháng</option>'+w.map(x=>`<option value="${x}">Tháng ${x}</option>`).join(""),y.includes(m)&&(n.value=m),w.includes(f)&&(i.value=f),ht("filter-hopdong-nam"),ht("filter-hopdong-thang")}const o=n?n.value:"",l=i?i.value:"";let h=[],d=0;const r=this.model.currentPage.hopdong||1,c=this.model.pageSize||10,g=this.model.sortState.hopdong||{},s=g.field||"",p=g.order||"asc";if(this.model.useServerSidePagination){!u.querySelector(".empty-state")&&u.children.length===0&&(u.innerHTML='<tr><td colspan="13" style="text-align: center; padding: 20px; color: var(--primary); font-weight: bold;">Đang tải dữ liệu từ máy chủ...</td></tr>');try{const m=await fetch(`/api/paginate?table=hopdong&page=${r}&pageSize=${c}&search=${encodeURIComponent(t)}&sortBy=${s}&sortOrder=${p}&nam=${encodeURIComponent(o)}&thang=${encodeURIComponent(l)}`,{headers:{"X-Session-Token":sessionStorage.getItem("bf_session_token")||"","X-Username":sessionStorage.getItem("bf_username")||""}});if(m.ok){const f=await m.json();h=f.items,d=f.totalItems}}catch(m){console.error("Failed to fetch paginated contracts",m)}}else{const f=this.model.getLatestHopDong().filter(b=>{const y=(b.soHopDong||"").toLowerCase().includes(t)||(b.tenHopDong||"").toLowerCase().includes(t);let w=!0,x=!0;if(b.ngayKy){const L=a(b.ngayKy);o&&(w=L.year===o),l&&(x=L.month===l)}else(o||l)&&(w=!1,x=!1);return y&&w&&x});s&&f.sort((b,y)=>{let w=b[s]||"",x=y[s]||"";return typeof w=="string"&&(w=w.toLowerCase()),typeof x=="string"&&(x=x.toLowerCase()),w<x?p==="asc"?-1:1:w>x?p==="asc"?1:-1:0}),d=f.length;const v=(r-1)*c;h=f.slice(v,v+c)}if(d===0){u.innerHTML=`
            <tr>
                <td colspan="13">
                    <div class="empty-state">
                        <i data-lucide="file-check-2"></i>
                        <p>Không tìm thấy Hợp đồng nào phù hợp</p>
                    </div>
                </td>
            </tr>
        `;const m=document.getElementById("hopdong-pagination");m&&(m.innerHTML="")}else u.innerHTML=h.map(m=>{const f=m.rootId||m.id,v=m.allVersions||this.model.state.hopdong.filter(H=>(H.rootId||H.id)===f).sort((H,q)=>parseInt(q.phienBan||q.phien_ban||0)-parseInt(H.phienBan||H.phien_ban||0));this.model.state.selectedHopDongVersion||(this.model.state.selectedHopDongVersion={});const b=this.model.state.selectedHopDongVersion[f]||m.id,y=this.model.state.hopdong.find(H=>H.id===b)||m,w=v.map(H=>{const q=`V${parseInt(H.phienBan||H.phien_ban||0)}`,B=H.id===y.id?"selected":"";return`<option value="${H.id}" ${B}>${q}</option>`}).join(""),x=`
                <select class="form-control version-droplist" onchange="window.changeHopDongRowVersion('${f}', this.value)" style="width: 52px; display: inline-block; padding: 2px; height: 22px; font-size: 0.8rem; border-radius: 4px; border: 1px solid var(--border-color, #ccc); background-color: var(--bg-card); color: var(--text-main); text-align-last: center; cursor: pointer; margin: 0; outline: none; vertical-align: middle;">
                    ${w}
                </select>
            `,T=(Array.isArray(this.model.state.chudautu)?this.model.state.chudautu:[]).find(H=>H.id===y.chuDauTuId),N=T?T.tenChuDauTu:"--",P=(Array.isArray(this.model.state.nhathau)?this.model.state.nhathau:[]).find(H=>H.id===y.nhaThauId),V=P?P.tenNhaThau:"--",at=typeof this.model.getLatestPackages=="function"?this.model.getLatestPackages():Array.isArray(this.model.state.goithau)?this.model.state.goithau:[],nt=(y.goiThauIds||[]).map(H=>{const q=at.find(B=>B.id===H);return q?`<a href="#" onclick="event.preventDefault(); window.showPackageDetails('${q.id}')" style="margin:2px; display:inline-block;" title="${q.tenGoiThau||""}"><span class="detail-code link-hover">${q.maGoiThau||"Gói"}</span></a>`:""}).filter(Boolean).join(" "),M=(Array.isArray(this.model.state.custompaperstatuses)?this.model.state.custompaperstatuses:[]).find(H=>H.name===y.trangThaiHoSo),z=M?M.color:"#6b7280",K=y.trangThaiHoSo?`<span class="status-pill" style="background-color: ${z}; color: white; padding: 4px 10px; border-radius: 20px; font-weight: 700; font-size: 0.78rem;">${y.trangThaiHoSo}</span>`:'<span class="text-muted" style="font-size:0.8rem;">Chưa cập nhật</span>';return`
                <tr>
                    <td>
                        <div style="display: inline-flex; align-items: center; gap: 6px; line-height: 1; vertical-align: middle;">
                            <a href="#" onclick="event.preventDefault(); window.showHopDongDetails('${y.id}')" class="text-blue fw-bold link-hover" title="Xem chi tiết Hợp đồng" style="display: inline-flex; align-items: center; line-height: 1;"><span class="detail-code link-hover" style="margin: 0; line-height: 1;">${y.soHopDong}</span></a>
                            <span style="color: var(--text-muted); font-size: 0.85rem; line-height: 1; display: inline-flex; align-items: center;">-</span>
                            ${x}
                        </div>
                    </td>
                    <td style="min-width: 200px; max-width: 300px;" class="fw-bold text-wrap">${y.tenHopDong}</td>
                    <td>${y.ngayKy?rt(y.ngayKy):"--"}</td>
                    <td style="min-width: 180px; max-width: 280px;" class="text-wrap">${N}</td>
                    <td style="min-width: 180px; max-width: 280px;" class="text-wrap">${V}</td>
                    <td class="fw-bold text-blue">${dt(y.giaTri)}</td>
                    <td><span class="badge badge-info">${y.loaiHopDong||"Trọn gói"}</span></td>
                    <td><span class="badge badge-secondary" style="background-color: var(--primary-light); color: var(--primary); font-weight: 600;">${y.phanLoai||"Tư vấn"}</span></td>
                    <td>${y.soNgayThucHien?isNaN(y.soNgayThucHien)?y.soNgayThucHien:y.soNgayThucHien+" ngày":"--"}</td>
                    <td>${nt||'<span class="text-danger" style="font-weight: 500;">Chưa liên kết</span>'}</td>
                    <td>${K}</td>
                    <td class="text-right">
                        <div class="action-btn-group">
                            ${y.goiThauIds&&y.goiThauIds.length>0?`
                            <button class="action-btn btn-export" onclick="window.exportContractFromHopDong('${y.goiThauIds[0]}', '${y.soHopDong}')" title="Xuất hợp đồng" style="color: var(--emerald);">
                                <i data-lucide="file-text"></i>
                            </button>
                            `:""}
                            <button class="action-btn btn-edit" onclick="window.editHopDong('${y.id}')" title="Sửa">
                                <i data-lucide="edit-2"></i>
                            </button>
                            <button class="action-btn btn-delete" onclick="window.deleteHopDong('${y.id}')" title="Xóa">
                                <i data-lucide="trash-2"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `}).join(""),window.renderTablePagination&&window.renderTablePagination("hopdong-pagination",d,r,c);lucide.createIcons({root:u}),this.enhanceTableHeaders("hopdong-table","hopdong")}function Kt(u){const t=this.model.state.chuyengia.find(o=>o.id===u);if(!t)return;const a=t.hoTen.split(" ").map(o=>o[0]).pop().toUpperCase(),n=t.tenAnhChungChi||(t.soCCCD?`CC_${t.soCCCD}.png`:"--"),i=t.tenAnhChuKy||(t.soCCCD?`CK_${t.soCCCD}.png`:"--"),e=`
        <div class="expert-profile-grid">
            <div class="profile-passport-card">
                <div class="profile-passport-avatar">${a}</div>
                <div class="profile-passport-name">${t.hoTen}</div>

                <div class="passport-details-list">
                    <div class="passport-detail-row">
                        <div class="passport-detail-label">Số CCCD</div>
                        <div class="passport-detail-val fw-bold">${t.soCCCD||"--"}</div>
                    </div>
                    <div class="passport-detail-row">
                        <div class="passport-detail-label">Ngày cấp CCCD</div>
                        <div class="passport-detail-val">${t.ngayCapCCCD?rt(t.ngayCapCCCD):"--"}</div>
                    </div>
                    <div class="passport-detail-row">
                        <div class="passport-detail-label">Nơi cấp CCCD</div>
                        <div class="passport-detail-val">${t.noiCapCCCD||"--"}</div>
                    </div>
                </div>

                <div style="margin-top: 18px;">
                    <div class="passport-detail-label" style="margin-bottom: 6px;">Ảnh chữ ký chuyên gia</div>
                    <div class="signature-display-frame" onclick="window.zoomSignatureImage('${t.id}')" title="Bấm để phóng to">
                        ${t.anhChuKy?`<img src="${t.anhChuKy}" alt="Chữ ký" style="max-height:80px; max-width:100%; object-fit:contain;">`:'<span class="text-muted" style="font-size:0.78rem;">Chưa có ảnh chữ ký</span>'}
                    </div>
                    <div style="margin-top:4px; font-size:0.72rem; color:var(--text-light);">📁 ${i}</div>
                </div>
            </div>

            <div class="expert-profile-details">
                <div class="expert-cert-viewer">
                    <div class="expert-cert-title-bar">
                        <h5>Chứng chỉ Hành nghề Đấu thầu</h5>
                        <span class="badge badge-info">Số CC: ${t.soChungChi}</span>
                    </div>

                    <div class="passport-details-list" style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 0; margin-bottom: 12px;">
                        <div class="passport-detail-row">
                            <div class="passport-detail-label">Số chứng chỉ</div>
                            <div class="passport-detail-val fw-bold text-blue">${t.soChungChi||"--"}</div>
                        </div>
                        <div class="passport-detail-row">
                            <div class="passport-detail-label">Ngày cấp</div>
                            <div class="passport-detail-val">${t.ngayCapChungChi?rt(t.ngayCapChungChi):"--"}</div>
                        </div>
                        <div class="passport-detail-row" style="grid-column: span 2;">
                            <div class="passport-detail-label">Đơn vị cấp chứng chỉ</div>
                            <div class="passport-detail-val fw-bold">${t.donViCapChungChi||"--"}</div>
                        </div>
                    </div>

                    <div class="passport-detail-label" style="margin-bottom: 6px;">Ảnh chụp chứng chỉ thực tế</div>
                    <div class="cert-image-frame" onclick="window.zoomCertificateImage('${t.id}')">
                        ${t.anhChungChi?`<img src="${t.anhChungChi}" alt="Ảnh chứng chỉ">`:'<div style="display:flex;align-items:center;justify-content:center;height:120px;color:var(--text-light);">Chưa có ảnh chứng chỉ</div>'}
                        ${t.anhChungChi?'<div class="cert-zoom-overlay"><i data-lucide="zoom-in"></i> Phóng to</div>':""}
                    </div>
                    <div style="margin-top:4px; font-size:0.72rem; color:var(--text-light);">📁 ${n}</div>
                </div>
            </div>
        </div>
    `;document.getElementById("detail-chuyengia-content").innerHTML=e,this.openModal("modal-detail-chuyengia"),lucide.createIcons({root:document.getElementById("detail-chuyengia-content")})}function Ot(u=[]){const t=document.getElementById("word-templates-tbody");if(t){if(u.length===0){t.innerHTML='<tr><td colspan="3" class="text-center text-muted">Đang tải biểu mẫu...</td></tr>';return}t.innerHTML=u.map(a=>{const n=a.is_active?'<span class="badge badge-success"><i data-lucide="check-circle"></i> Đang hoạt động</span>':`<span class="badge badge-neutral btn-activate-template" data-filename="${a.filename}" style="cursor: pointer; display: inline-flex; align-items: center; gap: 4px;" title="Nhấn để sử dụng làm mẫu chính"><i data-lucide="play" style="width: 12px; height: 12px;"></i> Sẵn sàng</span>`,i=a.is_active?'<span class="text-success fw-bold" style="font-size:0.8rem;">Đang dùng</span>':`<button class="btn btn-outline btn-sm btn-activate-template" data-filename="${a.filename}">Sử dụng</button>`;return`
            <tr>
                <td class="fw-bold">${a.name}</td>
                <td>${n}</td>
                <td class="text-right">${i}</td>
            </tr>
        `}).join(""),lucide.createIcons({root:t})}}function xt(u){const t=document.getElementById("dictionary-table-body");if(!t)return;const a={global:[],experts:[{code:"{#Danh_Sach_Chuyen_Gia}",desc:"Bắt đầu vòng lặp tổ chuyên gia"},{code:"{STT}",desc:"Số thứ tự chuyên gia"},{code:"{/Danh_Sach_Chuyen_Gia}",desc:"Kết thúc vòng lặp tổ chuyên gia"},{code:"{#Danh_Sach_Tham_Dinh}",desc:"Bắt đầu vòng lặp tổ thẩm định"},{code:"{STT}",desc:"Số thứ tự thẩm định viên"},{code:"{/Danh_Sach_Tham_Dinh}",desc:"Kết thúc vòng lặp tổ thẩm định"}],contractors:[{code:"{#Danh_Sach_Nha_Thau}",desc:"Bắt đầu vòng lặp danh sách nhà thầu tham dự"},{code:"{STT}",desc:"Số thứ tự nhà thầu tham dự"},{code:"{#Thanh_Vien_Lien_Danh}",desc:"(Liên danh) Bắt đầu vòng lặp thành viên liên danh của nhà thầu trúng"},{code:"{Ten_TV}",desc:"(Liên danh) Tên thành viên liên danh"},{code:"{MST_TV}",desc:"(Liên danh) Mã số thuế thành viên liên danh"},{code:"{Vai_Tro_TV}",desc:"(Liên danh) Vai trò thành viên (Liên danh chính / liên danh phụ)"},{code:"{Nguoi_Dai_Dien_TV}",desc:"(Liên danh) Người đại diện thành viên liên danh"},{code:"{Dia_Chi_TV}",desc:"(Liên danh) Địa chỉ thành viên liên danh"},{code:"{So_Tai_Khoan_TV}",desc:"(Liên danh) Số tài khoản thành viên liên danh"},{code:"{Noi_Mo_Tai_Khoan_TV}",desc:"(Liên danh) Nơi mở tài khoản thành viên liên danh"},{code:"{/Thanh_Vien_Lien_Danh}",desc:"(Liên danh) Kết thúc vòng lặp thành viên liên danh"},{code:"{/Danh_Sach_Nha_Thau}",desc:"Kết thúc vòng lặp nhà thầu"},{code:"{#Danh_Sach_Nha_Thau_Truot}",desc:"Bắt đầu vòng lặp danh sách nhà thầu trượt thầu"},{code:"{Ten_Nha_Thau}",desc:"Tên nhà thầu trượt thầu"},{code:"{Ma_Nha_Thau}",desc:"Mã định danh/MST nhà thầu trượt"},{code:"{Ly_Do_Truot}",desc:"Lý do trượt thầu (phân tích tự động hoặc người dùng tự gõ)"},{code:"{/Danh_Sach_Nha_Thau_Truot}",desc:"Kết thúc vòng lặp danh sách nhà thầu trượt"}],phanlo:[{code:"{#Danh_Sach_Phan_Lo}",desc:"Bắt đầu vòng lặp danh sách phân lô gói thầu"},{code:"{STT}",desc:"Số thứ tự phân lô"},{code:"{Ten_Phan_Lo}",desc:"Tên phân lô"},{code:"{Gia_Tri_Phan_Lo}",desc:"Giá trúng thầu phân lô"},{code:"{Nha_Thau_Trung}",desc:"Tên nhà thầu trúng thầu phân lô tương ứng"},{code:"{Thoi_Gian_Thuc_Hien}",desc:"Thời gian thực hiện hợp đồng phân lô"},{code:"{/Danh_Sach_Phan_Lo}",desc:"Kết thúc vòng lặp phân lô"}],tuychonmuathem:[{code:"{#Danh_Sach_Tuy_Chon_Mua_Them}",desc:"Bắt đầu vòng lặp tùy chọn mua thêm"},{code:"{STT}",desc:"Số thứ tự tùy chọn mua thêm"},{code:"{Hang_Muc}",desc:"Tên hạng mục tùy chọn mua thêm"},{code:"{Don_Vi}",desc:"Đơn vị tính"},{code:"{So_Luong}",desc:"Số lượng mua thêm"},{code:"{Ty_Le}",desc:"Tỷ lệ % mua thêm"},{code:"{Gia_Tri_Uoc_Tinh}",desc:"Giá trị ước tính mua thêm"},{code:"{/Danh_Sach_Tuy_Chon_Mua_Them}",desc:"Kết thúc vòng lặp mua thêm"}]},n=o=>({chu_dau_tu:"Chủ đầu tư",ke_hoach_lcnt:"Kế hoạch LCNT",goi_thau:"Gói thầu",nha_thau:"Nhà thầu",hop_dong:"Hợp đồng",chuyen_gia:"Chuyên gia",thong_tin_mo_thau:"Thông tin mở thầu",tai_khoan:"Tài khoản cá nhân",to_chuc:"Tổ chức / Doanh nghiệp",goi_dich_vu:"Gói dịch vụ"})[o]||o,i=(o,l)=>{const h={chu_dau_tu:{ten_chu_dau_tu:"Tên chủ đầu tư",ma_chu_dau_tu:"Mã chủ đầu tư",ma_so_thue:"Mã số thuế",chuc_vu_nguoi_dung_dau:"Chức vụ người đứng đầu",nguoi_ky_quyet_dinh:"Người ký QĐ",chuc_vu_nguoi_ky:"Chức vụ người ký",danh_xung:"Danh xưng",dia_chi:"Địa chỉ",so_dien_thoai:"Số điện thoại",email:"Email",so_tai_khoan:"Số tài khoản",noi_mo_tai_khoan:"Nơi mở tài khoản",ma_qhns:"Mã QHNS",co_quan_chu_quan:"Cơ quan chủ quản",phien_ban:"Phiên bản"},ke_hoach_lcnt:{ten_ke_hoach:"Tên kế hoạch LCNT",ma_ke_hoach:"Mã kế hoạch LCNT",ma_du_an:"Mã dự án",ten_du_an_du_toan:"Tên dự án / Dự toán",loai_hinh_mua_sam:"Loại hình mua sắm",tong_muc_dau_tu:"Tổng mức đầu tư",quyet_dinh_phe_duyet:"QĐ phê duyệt",ngay_phe_duyet:"Ngày phê duyệt",thoi_gian_dang_tai:"Thời gian đăng tải",nguon_von:"Nguồn vốn",thoi_gian_du_an:"Thời gian dự án",dia_diem_quy_mo:"Địa điểm quy mô",thong_tin_khac:"Thông tin khác",so_qd_phe_duyet_du_an:"Số QĐ phê duyệt dự án",ngay_qd_phe_duyet_du_an:"Ngày QĐ phê duyệt dự án",co_quan_phe_duyet_du_an:"Cơ quan phê duyệt dự án",phien_ban:"Phiên bản"},goi_thau:{ten_goi_thau:"Tên gói thầu",ma_goi_thau:"Mã gói thầu",gia_goi_thau:"Giá gói thầu",hinh_thuc_lua_chon:"Hình thức LCNT",phuong_thuc_lua_chon:"Phương thức LCNT",loai_hop_dong:"Loại hợp đồng",thoi_gian_thuc_hien:"Thời gian thực hiện",nguon_von:"Nguồn vốn",gia_trung_thau:"Giá trúng thầu",linh_vuc:"Lĩnh vực",tuy_chon_mua_them:"Tùy chọn mua thêm",thoi_gian_to_chuc:"Thời gian tổ chức",thoi_gian_bat_dau_to_chuc:"Thời gian bắt đầu tổ chức",phan_lo:"Phân lô",thoi_gian_dang_tai:"Thời gian đăng tải",thoi_gian_dong_thau:"Thời gian đóng thầu",thoi_gian_mo_thau:"Thời gian mở thầu",so_quyet_dinh:"Số QĐ phê duyệt",ngay_quyet_dinh:"Ngày QĐ phê duyệt",so_quyet_dinh_ket_qua:"Số QĐ kết quả",ngay_quyet_dinh_ket_qua:"Ngày QĐ kết quả",thoi_gian_goi_thau:"Thời gian gói thầu",thoi_gian_hop_dong:"Thời gian hợp đồng",gia_tri_dam_bao_du_thau:"Giá trị bảo đảm dự thầu",hieu_luc_hsdt:"Hiệu lực HSDT",hieu_luc_dam_bao_du_thau:"Hiệu lực bảo đảm dự thầu",gia_han_list:"Gia hạn thời gian mở thầu / đóng thầu",yeu_cau_lam_ro_list:"Làm rõ hồ sơ mời thầu (Yêu cầu)",tra_loi_lam_ro_list:"Trả lời làm rõ hồ sơ mời thầu",trang_thai:"Trạng thái",phien_ban:"Phiên bản"},nha_thau:{ten_nha_thau:"Tên nhà thầu",ma_nha_thau:"Mã nhà thầu",loai_nha_thau:"Loại nhà thầu",ma_so_thue:"Mã số thuế",nguoi_dai_dien:"Người đại diện",danh_xung:"Danh xưng",so_dien_thoai:"Số điện thoại",email:"Email",dia_chi:"Địa chỉ",so_tai_khoan:"Số tài khoản",noi_mo_tai_khoan:"Nơi mở tài khoản",ma_ngan_hang:"Mã ngân hàng",phien_ban:"Phiên bản"},hop_dong:{ten_hop_dong:"Tên hợp đồng",so_hop_dong:"Số hợp đồng",ngay_ky:"Ngày ký",gia_tri:"Giá trị hợp đồng",loai_hop_dong:"Loại hợp đồng",thoi_gian_thuc_hien:"Thời gian thực hiện",trang_thai_ho_so:"Trạng thái hồ sơ"},chuyen_gia:{ho_ten:"Họ tên chuyên gia",so_cccd:"Số CCCD",ngay_cap_cccd:"Ngày cấp CCCD",noi_cap_cccd:"Nơi cấp CCCD",so_chung_chi:"Số chứng chỉ",ngay_cap_chung_chi:"Ngày cấp chứng chỉ",don_vi_cap_chung_chi:"Đơn vị cấp chứng chỉ",chuc_vu:"Chức vụ trong tổ",cong_viec:"Nhiệm vụ phân công"},thong_tin_mo_thau:{gia_du_thau:"Giá dự thầu",dam_bao_du_thau:"Bảo đảm dự thầu",hieu_luc_dam_bao:"Hiệu lực bảo đảm",hieu_luc_hsdxt:"Hiệu lực HSDXT",ty_le_giam_gia:"Tỷ lệ giảm giá",gia_sau_giam_gia:"Giá sau giảm giá",hieu_luc_hsdt:"Hiệu lực HSDT",gia_tri_dam_bao:"Giá trị bảo đảm",hieu_luc_bao_dam_ngay:"Hiệu lực bảo đảm (ngày)",thoi_gian_thuc_hien:"Thời gian thực hiện",ten_nha_thau:"Tên nhà thầu",loai_nha_thau:"Loại nhà thầu",danh_gia_hop_le:"Đánh giá hợp lệ",danh_gia_nang_luc:"Đánh giá năng lực",danh_gia_ky_thuat:"Đánh giá kỹ thuật",danh_gia_tai_chinh:"Đánh giá tài chính",danh_gia_ket_luan:"Đánh giá kết luận",ly_do_truot:"Lý do trượt",lam_ro_hop_le:"Làm rõ hợp lệ",lam_ro_nang_luc:"Làm rõ năng lực",lam_ro_ky_thuat:"Làm rõ kỹ thuật",lam_ro_tai_chinh:"Làm rõ tài chính"},tai_khoan:{ten_dang_nhap:"Tên đăng nhập",ho_ten:"Họ và tên",email:"Email",so_dien_thoai:"Số điện thoại",chuc_vu:"Chức vụ"},to_chuc:{ten_to_chuc:"Tên tổ chức",ma_so_thue:"Mã số thuế",dia_chi:"Địa chỉ",nguoi_dai_dien:"Người đại diện"},goi_dich_vu:{ten_goi:"Tên gói dịch vụ",gia_goi:"Giá gói dịch vụ",thoi_han_thang:"Thời hạn (tháng)"}};return h[o]&&h[o][l]||l};let e=a[u]||[];if(u==="global"&&this.model.state&&this.model.state.wordMappings){const o=this.model.state.wordMappings.map(l=>({code:`{${l.tenBien}}`,desc:`Biến tự định nghĩa (Ánh xạ: Bảng ${n(l.sourceTable)} -> ${i(l.sourceTable,l.sourceColumn)})`,isCustom:!0,id:l.id,sourceTable:l.sourceTable,sourceColumn:l.sourceColumn,tenBien:l.tenBien}));e=[...e,...o]}if(e.length===0){t.innerHTML='<tr><td colspan="3" class="text-center text-muted" style="padding: 24px;">Chưa có biến nào trong nhóm này.</td></tr>';return}t.innerHTML=e.map(o=>{let l="";o.isCustom?l=`
                <div class="action-btn-group" style="justify-content: flex-end; gap: 8px;">
                    <button class="btn btn-outline btn-sm btn-copy-var" data-copy="${o.code}" title="Sao chép" style="padding: 4px 8px; font-size: 0.75rem;">
                        <i data-lucide="copy" style="width:12px; height:12px;"></i>
                    </button>
                    <button class="action-btn btn-edit" onclick="window.editWordMapping('${o.id}')" title="Sửa ánh xạ" style="padding: 4px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: none; cursor: pointer; display: inline-flex; align-items: center;">
                        <i data-lucide="edit-2" style="width:12px; height:12px; color: var(--text-muted);"></i>
                    </button>
                    <button class="action-btn btn-delete" onclick="window.deleteWordMapping('${o.id}')" title="Xóa ánh xạ" style="padding: 4px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: none; cursor: pointer; display: inline-flex; align-items: center;">
                        <i data-lucide="trash-2" style="width:12px; height:12px; color: var(--danger);"></i>
                    </button>
                </div>
            `:l=`
                <button class="btn btn-outline btn-sm btn-copy-var" data-copy="${o.code}" style="padding: 4px 8px; font-size: 0.75rem;">
                    <i data-lucide="copy" style="width:12px; height:12px;"></i> Sao chép
                </button>
            `;let h="";return o.isCustom?h=`
                <span class="badge badge-info" style="font-size:0.7rem; padding: 2px 6px;">${n(o.sourceTable)}</span>
                <span style="color:var(--text-muted); margin:0 4px;">&rarr;</span>
                <span class="fw-bold" style="font-size: 0.8rem;">${i(o.sourceTable,o.sourceColumn)}</span>
            `:h=`<span style="font-size: 0.8rem; color: var(--text-muted);">${o.desc}</span>`,`
            <tr>
                <td><code style="font-size:0.82rem; color:var(--primary); font-weight:700; background:var(--primary-soft); padding:4px 8px; border-radius:4px;">${o.code}</code></td>
                <td>${h}</td>
                <td class="text-right">${l}</td>
            </tr>
        `}).join(""),lucide.createIcons({root:t})}function Rt(u=[]){const t=document.getElementById("dictionary-group-select"),a=t?t.value:"global";xt.call(this,a)}function Ut(u=[]){this.renderBieumauTab(u)}function Qt(u,t=null){return`
        <button type="button" class="btn-remove-member" onclick="window.removeJointVentureMemberCard('${u}')" style="position: absolute; top: 12px; right: 12px; background: none; border: none; font-size: 1.25rem; color: var(--danger); cursor: pointer;">&times;</button>
        <h5 style="margin: 0 0 12px 0; font-size: 0.85rem; font-weight: 700; color: var(--text-muted);">Thành viên liên danh</h5>
        <div class="form-grid">
            <div class="form-group col-span-2" style="margin-bottom: 12px;">
                <label class="nt-member-ten-label">Tên nhà thầu thành viên <span class="required">*</span></label>
                <input type="text" class="nt-member-ten" required placeholder="Ví dụ: Công ty A" value="${t?t.tenNhaThau:""}">
                <span class="error-text">Vui lòng nhập tên nhà thầu</span>
            </div>
            <div class="form-group" style="margin-bottom: 12px;">
                <label>Mã số thuế <span class="required">*</span></label>
                <input type="text" class="nt-member-mst" required placeholder="Mã số thuế" value="${t?t.maSoThue:""}">
                <span class="error-text">Vui lòng nhập mã số thuế</span>
            </div>
            <div class="form-group" style="margin-bottom: 12px;">
                <label>Người đại diện <span class="required">*</span></label>
                <input type="text" class="nt-member-nguoidaidien" required placeholder="Họ tên người đại diện" value="${t?t.nguoiDaiDien:""}">
                <span class="error-text">Vui lòng nhập người đại diện</span>
            </div>
            <div class="form-group" style="margin-bottom: 12px;">
                <label>Danh xưng <span class="required">*</span></label>
                <select class="nt-member-danhxung" required>
                    <option value="Ông" ${t&&t.danhXung==="Ông"?"selected":""}>Ông</option>
                    <option value="Bà" ${t&&t.danhXung==="Bà"?"selected":""}>Bà</option>
                </select>
            </div>
            <div class="form-group" style="margin-bottom: 12px;">
                <label>Điện thoại</label>
                <input type="tel" class="nt-member-sdt" placeholder="Số điện thoại" value="${t?t.soDienThoai:""}">
                <span class="error-text">Vui lòng nhập số điện thoại</span>
            </div>
            <div class="form-group col-span-2" style="margin-bottom: 12px;">
                <label>Email</label>
                <input type="email" class="nt-member-email" placeholder="contact@nhathau.com" value="${t?t.email:""}">
                <span class="error-text">Vui lòng nhập email hợp lệ</span>
            </div>
            <div class="form-group col-span-2" style="margin-bottom: 12px;">
                <label>Địa chỉ <span class="required">*</span></label>
                <input type="text" class="nt-member-diachi" required placeholder="Địa chỉ chi tiết" value="${t?t.diaChi:""}">
                <span class="error-text">Vui lòng nhập địa chỉ</span>
            </div>
            <div class="form-group" style="margin-bottom: 12px;">
                <label>Số tài khoản <span class="required">*</span></label>
                <input type="text" class="nt-member-sotaikhoan" required placeholder="Số tài khoản" value="${t?t.soTaiKhoan:""}">
                <span class="error-text">Vui lòng nhập số tài khoản</span>
            </div>
            <div class="form-group" style="margin-bottom: 12px;">
                <label>Nơi mở tài khoản <span class="required">*</span></label>
                <input type="text" class="nt-member-noimotaikhoan" required placeholder="Tên ngân hàng" value="${t?t.noiMoTaiKhoan:""}">
                <span class="error-text">Vui lòng nhập nơi mở</span>
            </div>
            <div class="form-group col-span-2" style="margin-bottom: 0;">
                <label>Mã ngân hàng</label>
                <input type="text" class="nt-member-manganhang" placeholder="Mã ngân hàng" value="${t&&t.maNganHang||""}">
            </div>
        </div>
    `}function Ft(u){const t=document.getElementById("tab-hopdong-detail");if(!t||!t.classList.contains("active")){window.switchTab("hopdong-detail",u);return}if(!this.model.state.hopdong.find(i=>i.id===u))return;const n=document.getElementById("btn-edit-hopdong-fullpage");n&&(n.onclick=()=>{window.editHopDong(u)}),this.renderContractVersionDetails(u)}function Wt(u){const t=this.model.state.hopdong.find(y=>y.id===u);if(!t)return;const a=this.model.state.chudautu.find(y=>y.id===t.chuDauTuId),n=this.model.state.nhathau.find(y=>y.id===t.nhaThauId),i=this.model.getLatestPlan(t.keHoachId),e=typeof this.model.getLatestPackages=="function"?this.model.getLatestPackages():this.model.state.goithau||[],o=(t.goiThauIds||[]).map(y=>e.find(w=>w.id===y)).filter(Boolean),h=(this.model.state.custompaperstatuses||[]).find(y=>y.name===t.trangThaiHoSo),d=h?h.color:"#6b7280",r=t.trangThaiHoSo?`<span class="status-pill" style="background-color: ${d}; color: white; padding: 4px 12px; border-radius: 20px; font-weight: 700; font-size: 0.85rem;">${t.trangThaiHoSo}</span>`:'<span class="text-muted">Chưa cập nhật</span>',c=t.rootId||t.id,g=this.model.state.hopdong.filter(y=>(y.rootId||y.id)===c),s={};g.forEach(y=>{const w=y.phienBan||y.phien_ban||"00";(!s[w]||y.isLatest==1||y.is_latest==1)&&(s[w]=y)});const p=Object.values(s);p.sort((y,w)=>{const x=parseInt(y.phienBan||y.phien_ban||0);return parseInt(w.phienBan||w.phien_ban||0)-x});const f=`
        <select id="fullpage-hd-version-select" class="page-version-select" style="min-width: 100px; max-width: 320px; width: auto;">
            ${p.map(y=>{const w=y.phienBan||y.phien_ban||"00",x=`V${parseInt(w)}`;return`<option value="${y.id}" ${y.id===u?"selected":""}>${x}</option>`}).join("")}
        </select>
    `,v=`
        <div class="detail-section">
            <div class="detail-header-block" style="padding-bottom: 16px; margin-bottom: 20px; border-bottom: 1px solid var(--border-color);">
                <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 10px;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span class="detail-code" style="margin: 0; display: inline-flex; align-items: center; height: 28px; box-sizing: border-box;">${t.soHopDong||"--"}</span>
                        <span class="version-separator" style="color: var(--text-muted, #64748b); font-weight: 600;">-</span>
                        ${f}
                    </div>
                </div>
                <h4 class="detail-title" style="margin: 0; font-size: 1.25rem; font-weight: 800; color: var(--text-main);">${t.tenHopDong||"Hợp đồng không có tên"}</h4>
                <div style="margin-top: 10px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                    ${r}
                </div>
            </div>
            
            <div class="detail-grid">
                <div class="detail-item">
                    <div class="detail-label">Số hợp đồng</div>
                    <div class="detail-value fw-bold text-blue">${t.soHopDong||"--"}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Ngày ký hợp đồng</div>
                    <div class="detail-value">${t.ngayKy?rt(t.ngayKy):"--"}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Giá trị hợp đồng</div>
                    <div class="detail-value text-blue fw-bold" style="font-size: 1.15rem;">${dt(t.giaTri)}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Loại hợp đồng</div>
                    <div class="detail-value"><span class="badge badge-info">${t.loaiHopDong||"Trọn gói"}</span></div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Phân loại</div>
                    <div class="detail-value"><span class="badge badge-secondary" style="background-color: var(--primary-light); color: var(--primary); font-weight: 600;">${t.phanLoai||"Tư vấn"}</span></div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Thời gian thực hiện</div>
                    <div class="detail-value">${t.soNgayThucHien?isNaN(t.soNgayThucHien)?t.soNgayThucHien:t.soNgayThucHien+" ngày":"--"}</div>
                </div>
            </div>

            <div class="detail-grid" style="margin-top: 20px; border-top: 1px solid var(--border-color); padding-top: 20px;">
                <div class="detail-item">
                    <div class="detail-label">Quyết định chỉ định thầu</div>
                    <div class="detail-value">${t.coQdChiDinh===1?'<span class="badge badge-success">Có quyết định</span>':'<span class="badge badge-secondary">Không</span>'}</div>
                </div>
                ${t.coQdChiDinh===1?`
                    <div class="detail-item">
                        <div class="detail-label">Số quyết định chỉ định</div>
                        <div class="detail-value fw-bold">${t.soQdChiDinh||"--"}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">Ngày quyết định chỉ định</div>
                        <div class="detail-value">${t.ngayKy?rt(t.ngayQdChiDinh):"--"}</div>
                    </div>
                `:""}
            </div>

            <div class="detail-sub-section" style="margin-top: 24px;">
                <h5 class="detail-sub-title">Thông tin Chủ đầu tư</h5>
                ${a?`
                    <div class="associated-item">
                        <div>
                            <strong style="font-size: 0.9rem;">${a.tenChuDauTu}</strong><br>
                            <small class="text-muted">Mã số thuế: ${a.maSoThue} | Địa chỉ: ${(a.diaChi||"").replace(/\s*\|\s*/g,", ")}</small>
                        </div>
                        <span class="associated-badge">${a.maChuDauTu}</span>
                    </div>
                `:'<div class="text-muted"><small>Không tìm thấy thông tin chủ đầu tư.</small></div>'}
            </div>

            <div class="detail-sub-section" style="margin-top: 24px;">
                <h5 class="detail-sub-title">Thông tin Nhà thầu trúng thầu</h5>
                ${n?`
                    <div class="associated-item">
                        <div>
                            <strong style="font-size: 0.9rem;">${n.tenNhaThau}</strong><br>
                            <small class="text-muted">Mã số thuế: ${n.maSoThue} | Đại diện: ${n.nguoiDaiDien||"--"}</small>
                        </div>
                        <span class="associated-badge">${n.maNhaThau||"NHA_THAU"}</span>
                    </div>
                `:'<div class="text-muted"><small>Không tìm thấy thông tin nhà thầu.</small></div>'}
            </div>

            ${i?`
                <div class="detail-sub-section" style="margin-top: 24px;">
                    <h5 class="detail-sub-title">Kế hoạch lựa chọn nhà thầu liên kết</h5>
                    <div class="associated-item" style="cursor: pointer;" onclick="window.showKeHoachDetails('${i.id}')">
                        <div>
                            <strong style="font-size: 0.9rem; color: var(--primary);">${i.tenKeHoach}</strong><br>
                            <small class="text-muted">Mã KH: ${i.maKeHoach} | Tổng mức: ${dt(i.tongMucDauTu)}</small>
                        </div>
                    </div>
                </div>
            `:""}

            <div class="detail-sub-section" style="margin-top: 24px;">
                <h5 class="detail-sub-title" style="color: var(--primary);">Các gói thầu thuộc hợp đồng (${o.length})</h5>
                <div class="associated-list">
                    ${o.length>0?o.map(y=>`
                        <div class="associated-item" style="cursor: pointer;" onclick="window.showPackageDetails('${y.id}')">
                            <div class="associated-info">
                                <i data-lucide="briefcase" class="text-blue" style="width:16px;"></i>
                                <span><strong>${y.maGoiThau}</strong> - ${y.tenGoiThau}</span>
                            </div>
                            <span class="badge badge-success">${dt(y.giaGoiThau)}</span>
                        </div>
                    `).join(""):'<div class="text-muted"><small>Hợp đồng này chưa có gói thầu trực tiếp liên kết.</small></div>'}
                </div>
            </div>
        </div>
    `,b=document.getElementById("fullpage-hopdong-content");if(b){b.innerHTML=v;const y=document.getElementById("fullpage-hd-version-select");y&&(y.onchange=w=>{this.renderContractVersionDetails(w.target.value)},window.initCustomSelect&&window.initCustomSelect("fullpage-hd-version-select")),lucide.createIcons()}}const Yt=Object.freeze(Object.defineProperty({__proto__:null,getJointVentureMemberHTML:Qt,renderBieumauTab:Ot,renderChuDauTuTable:Vt,renderChuyenGiaTable:zt,renderContractVersionDetails:Wt,renderDictionary:xt,renderHopDongTable:jt,renderNhaThauTable:At,renderWordMappingsTable:Rt,renderWordTemplates:Ut,showChuyenGiaDetails:Kt,showHopDongDetails:Ft},Symbol.toStringTag,{value:"Module"}));function Xt(){const u=document.getElementById("header-profile-avatar"),t=document.getElementById("header-profile-name"),a=document.getElementById("header-profile-role");if(u&&t&&a){const o=this.model.state.activeuser;t.textContent=o.name;const l=o.organization_name?o.organization_name.split(",").map(g=>g.trim()).filter(Boolean):[];let h=localStorage.getItem("bf_active_org");(!h||!l.includes(h))&&(h=l[0]||"",h?localStorage.setItem("bf_active_org",h):localStorage.removeItem("bf_active_org")),a.textContent=`Chế độ: ${o.title}`;const d=document.getElementById("header-active-org-pill"),r=document.getElementById("header-active-org-name");d&&r&&(h?(r.textContent=h,d.style.display="flex",d.style.cursor="default"):d.style.display="none"),window.appController&&typeof window.appController.renderWorkspaceSwitcher=="function"&&window.appController.renderWorkspaceSwitcher(),o.avatar?(u.innerHTML=`<img src="${o.avatar}" alt="Avatar">`,u.style.background="none"):(u.textContent=o.name.split(" ").map(g=>g[0]).join("").slice(0,2).toUpperCase(),this.model.state.activerole==="super_admin"?u.style.background="linear-gradient(135deg, #a855f7 0%, #4f46e5 100%)":this.model.state.activerole==="manager"?u.style.background="linear-gradient(135deg, #3b82f6 0%, #10b981 100%)":u.style.background="linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)");const c=document.getElementById("sa-role-switch-section");if(c){if(o.dbRole==="super_admin"||o.dbRole==="manager"){c.style.display="block";const g=document.querySelector('.dropdown-role-btn[data-switch-role="super_admin"]'),s=document.querySelector('.dropdown-role-btn[data-switch-role="manager"]'),p=document.querySelector('.dropdown-role-btn[data-switch-role="employee"]');o.dbRole==="super_admin"?(g&&(g.style.display="flex"),s&&(s.style.display="flex"),p&&(p.style.display="flex")):o.dbRole==="manager"&&(g&&(g.style.display="none"),s&&(s.style.display="flex"),p&&(p.style.display="flex"))}else c.style.display="none";document.querySelectorAll(".dropdown-role-btn").forEach(g=>{g.getAttribute("data-switch-role")===this.model.state.activerole?(g.style.background="rgba(147, 51, 234, 0.08)",g.style.color="#a855f7"):(g.style.background="transparent",g.style.color="var(--text-main)")})}}const n=document.querySelectorAll(".role-menu-superadmin"),i=document.querySelectorAll(".role-menu-manager"),e=document.querySelectorAll(".role-menu-client");n.forEach(o=>{o.style.display=this.model.state.activerole==="super_admin"?"block":"none"}),i.forEach(o=>{o.style.display=this.model.state.activerole==="manager"?"block":"none"}),e.forEach(o=>{o.style.display=this.model.state.activerole==="super_admin"?"none":"block"}),this.applySecurityLockOverlay(),this.populateNhanVienPhuTrachDropdowns()}function Jt(){document.querySelectorAll(".security-lock-overlay").forEach(u=>u.remove())}function Zt(){const u=document.getElementById("gt-nhanvienphutrach"),t=document.getElementById("hd-nhanvienphutrach");let a=Array.isArray(this.model.state.employees)?this.model.state.employees:[];if(this.model.state.activerole!=="super_admin"){const e=localStorage.getItem("bf_active_org");e&&(a=a.filter(o=>(o.organization_name?o.organization_name.split(",").map(h=>h.trim()).filter(Boolean):[]).includes(e)))}const n={super_admin:"Super Admin / Quản lý / Chuyên viên",manager:"Quản lý / Chuyên viên",employee:"Chuyên viên"},i=a.map(e=>{const o=n[e.role]||e.role;return`<option value="${escapeHTML(e.id)}">${escapeHTML(e.name)} — ${escapeHTML(o)}${e.email?" ("+escapeHTML(e.email)+")":""}</option>`}).join("");u&&(u.innerHTML='<option value="">-- Chọn Chuyên viên phụ trách --</option>'+i),t&&(t.innerHTML='<option value="">-- Chọn Chuyên viên phụ trách --</option>'+i)}function te(){const u=document.getElementById("sa-pricing-grid");u&&this.model.state.systempackages&&(u.innerHTML=this.model.state.systempackages.map(t=>{const a=t.id==="silver"?"Silver":t.id==="gold"?"Bán chạy":"Diamond",n=t.id==="gold"?"badge-popular":"",i=t.id==="silver"?"silver-card":t.id==="gold"?"gold-card popular":"diamond-card",e=this.model.formatCurrency(t.price),o=t.quota>=999?"Không giới hạn":`Tối đa ${t.quota} Nhân sự`,l=t.isLocked||!1,h=l?"Đã khóa":"Hoạt động",d=l?"btn-danger":"btn-emerald";return`
                <div class="pricing-card ${i}">
                    <div class="pricing-badge ${n}">${a}</div>
                    <h4 class="package-name">${t.name}</h4>
                    <div class="package-price">${e}<span>/năm</span></div>
                    <p class="package-desc">${t.description||""}</p>
                    <ul class="package-features">
                        <li><i data-lucide="check"></i> Hạn mức nhân sự: <strong>${o}</strong></li>
                        <li><i data-lucide="check"></i> Lập ma trận phân quyền</li>
                        <li><i data-lucide="check"></i> Đồng bộ dữ liệu SQLite động</li>
                        <li><i data-lucide="check"></i> Nhập dữ liệu thầu từ Excel</li>
                    </ul>
                    <div class="package-action-btn-group">
                        <button class="btn btn-outline btn-full-width mb-2"
                            onclick="window.editSystemPackage('${t.id}')">Chỉnh sửa Gói</button>
                        <button class="btn ${d} btn-full-width" id="btn-lock-${t.id}"
                            onclick="window.togglePackageLock('${t.id}')">${h}</button>
                    </div>
                </div>
            `}).join("")),fetch("/api/auth/users").then(t=>t.ok?t.json():[]).then(t=>{const a={};t.forEach(r=>{(r.organization_name?r.organization_name.split(",").map(g=>g.trim()).filter(Boolean):[]).forEach(g=>{a[g]||(a[g]={id:r.id,name:g,contact:"",phone:"",packageId:"none",regDate:r.package_start_date||"",expDate:r.package_end_date||"",status:"Hoạt động"}),(r.role==="manager"||!a[g].contact)&&(a[g].contact=r.name,a[g].packageId=r.package_id||"none",a[g].regDate=r.package_start_date||"",a[g].expDate=r.package_end_date||"")})}),this.model.state.organizations=Object.values(a),this.model.state.employees=t.map(r=>({id:r.id,name:r.name,email:r.email||"",phone:"",role:r.role,username:r.username,package_id:r.package_id,package_start_date:r.package_start_date,package_end_date:r.package_end_date,organization_name:r.organization_name}));const n=this.model.state.organizations.filter(r=>r.status==="Hoạt động");this.model.state.organizations.filter(r=>r.status==="Đã khóa");let i=0;this.model.state.organizations.forEach(r=>{if(r.status==="Hoạt động"){const c=this.model.state.systempackages.find(g=>g.id===r.packageId);c&&(i+=c.price)}});const e=document.getElementById("sa-stat-revenue");e&&(e.textContent=this.model.formatCurrency(i));const o=document.getElementById("sa-stat-orgs");o&&(o.textContent=`${this.model.state.organizations.length} Đơn vị`);const l=document.querySelector("#sa-stat-orgs + .stat-trend");l&&(l.textContent=`Đang hoạt động: ${n.length}`);const h=document.getElementById("sa-stat-employees");h&&(h.textContent=`${this.model.state.employees.length} Nhân sự`);const d=document.getElementById("sa-organizations-tbody");d&&(d.innerHTML=this.model.state.organizations.map(r=>{const c=this.model.state.systempackages.find(m=>m.id===r.packageId),g=c?`<span class="badge ${r.packageId==="diamond"?"badge-warning":r.packageId==="gold"?"badge-info":"badge-neutral"}">${c.name}</span>`:"--",s=r.status==="Hoạt động"?'<span class="badge badge-success"><i data-lucide="check-circle"></i> Hoạt động</span>':'<span class="badge badge-danger"><i data-lucide="lock"></i> Đã khóa</span>',p=r.status==="Hoạt động"?`<button class="action-btn btn-delete" onclick="window.toggleOrgLock('${r.id}')" title="Khóa Đơn vị"><i data-lucide="lock"></i></button>`:`<button class="action-btn btn-edit" style="color:var(--success); background:rgba(16,185,129,0.1);" onclick="window.toggleOrgLock('${r.id}')" title="Mở khóa Đơn vị"><i data-lucide="unlock"></i></button>`;return`
                        <tr>
                            <td class="fw-bold">${escapeHTML(r.name)}</td>
                            <td><span class="fw-bold">${escapeHTML(r.contact)}</span></td>
                            <td>${escapeHTML(r.phone)||"--"}</td>
                            <td>${g}</td>
                            <td>${this.model.formatDate(r.regDate)}</td>
                            <td><small class="fw-bold">${this.model.formatDate(r.expDate)}</small></td>
                            <td>${s}</td>
                            <td class="text-right">
                                <div class="action-btn-group" style="justify-content: flex-end;">
                                    <button class="action-btn btn-view" onclick="window.renewOrgSubscription('${r.id}')" title="Gia hạn 1 năm"><i data-lucide="calendar-plus"></i></button>
                                    ${p}
                                </div>
                            </td>
                        </tr>
                    `}).join("")),lucide.createIcons()})}function ee(){const u=sessionStorage.getItem("bf_username"),t=this.model.state.employees.find(s=>s.username===u),a=t&&t.package_id?t.package_id.split(",").filter(s=>s&&s!=="none"):["silver"];let n="silver";a.includes("diamond")?n="diamond":a.includes("gold")&&(n="gold");const i=this.model.state.systempackages.find(s=>s.id===n),e=i?i.quota:5,o=localStorage.getItem("bf_active_org"),l=this.model.state.employees.filter(s=>s.role!=="employee"?!1:o?(s.organization_name?s.organization_name.split(",").map(m=>m.trim()).filter(Boolean):[]).includes(o):!0),h=document.getElementById("manager-quota-label");h&&(h.textContent=`${l.length} / ${e===999?"Không giới hạn":e} Nhân sự`);const d=document.getElementById("manager-quota-progress-fill");if(d){const s=e===999?20:l.length/e*100;d.style.width=`${Math.min(s,100)}%`,s>=90?d.style.background="var(--danger)":s>=70?d.style.background="var(--warning)":d.style.background="linear-gradient(90deg, var(--primary) 0%, #1d4ed8 100%)"}const r=document.getElementById("manager-package-name");r&&(r.textContent=i?i.name:"--");const c=document.getElementById("manager-employees-tbody");c&&(c.innerHTML=l.map(s=>{const m=this.model.state.assignments.filter(f=>f.empId===s.id).map(f=>{if(f.type==="goithau"){const v=this.model.state.goithau.find(b=>b.id===f.targetId);return v?`<span class="badge badge-neutral" style="margin:2px;">GT: ${v.maGoiThau}</span>`:""}else if(f.type==="hopdong"){const v=this.model.state.hopdong.find(b=>b.id===f.targetId);return v?`<span class="badge badge-info" style="margin:2px;">HD: ${v.soHopDong}</span>`:""}return""}).filter(Boolean).join(" ");return`
                <tr>
                    <td class="fw-bold" style="text-align: center; vertical-align: middle;">${escapeHTML(s.name)}</td>
                    <td style="text-align: center; vertical-align: middle;">${escapeHTML(s.email)}</td>
                    <td style="text-align: center; vertical-align: middle;">${escapeHTML(s.phone)}</td>
                    <td style="max-width: 250px; text-align: center; vertical-align: middle;">${m||'<span class="text-muted">Chưa giao thầu</span>'}</td>
                    <td style="text-align: center; vertical-align: middle;">
                        <div class="action-btn-group" style="justify-content: center; display: inline-flex;">
                            <button class="action-btn btn-edit" onclick="window.editEmployee('${s.id}')" title="Sửa"><i data-lucide="edit-2"></i></button>
                            <button class="action-btn btn-delete" onclick="window.deleteEmployee('${s.id}')" title="Xóa"><i data-lucide="trash-2"></i></button>
                        </div>
                    </td>
                </tr>
            `}).join(""));const g=document.getElementById("manager-matrix-tbody");g&&(g.innerHTML=l.map(s=>{const p=this.model.state.permissionmatrix.find(f=>f.empId===s.id)||{kehoach:"view",goithau:"view",hopdong:"view",chudautu:"view",nhathau:"view",chuyengia:"view"},m=f=>{const v=p[f]||"view";return`
                    <td class="matrix-checkbox-cell">
                        <select class="form-control matrix-select" data-emp-id="${s.id}" data-module="${f}" style="width: 100px; display: inline-block; padding: 2px 4px; height: auto; font-size: 0.82rem; border-radius: 4px; border: 1px solid var(--border-color, #ccc); background-color: var(--bg-card); color: var(--text-main);">
                            <option value="view" ${v==="view"?"selected":""}>Xem</option>
                            <option value="edit" ${v==="edit"?"selected":""}>Sửa đổi</option>
                        </select>
                    </td>
                `};return`
                <tr>
                    <td class="fw-bold">${s.name}</td>
                    ${m("kehoach")}
                    ${m("goithau")}
                    ${m("hopdong")}
                    ${m("chudautu")}
                    ${m("nhathau")}
                    ${m("chuyengia")}
                </tr>
            `}).join("")),lucide.createIcons()}function ae(){const u="1",t=this.model.state.custompaperstatuses.filter(n=>n.orgId===u),a=document.getElementById("manager-hosogiay-tbody");a&&(t.length===0?a.innerHTML='<tr><td colspan="3" class="text-center text-muted">Chưa cấu hình trạng thái hồ sơ giấy nào.</td></tr>':a.innerHTML=t.map(n=>`
                <tr>
                    <td class="fw-bold">${n.name}</td>
                    <td><span class="status-pill" style="background-color: ${n.color};">${n.name}</span></td>
                    <td class="text-right">
                        <div class="action-btn-group">
                            <button class="action-btn btn-edit" onclick="window.editHoSoGiayStatus('${n.id}')" title="Sửa"><i data-lucide="edit-2"></i></button>
                            <button class="action-btn btn-delete" onclick="window.deleteHoSoGiayStatus('${n.id}')" title="Xóa"><i data-lucide="trash-2"></i></button>
                        </div>
                    </td>
                </tr>
            `).join("")),lucide.createIcons()}function ne(u){if(!u)return;const t=document.getElementById("profile-username"),a=document.getElementById("profile-fullname"),n=document.getElementById("profile-email");t&&(t.value=u.username||sessionStorage.getItem("bf_username")||""),a&&(a.value=u.name||""),n&&(n.value=u.email||"");const i=document.getElementById("profile-organization"),e=document.getElementById("profile-org-container");e&&i&&(u.organization_name||u.package_id&&u.package_id!=="none"?(e.style.display="block",i.value=u.organization_name||""):(e.style.display="none",i.value=""));const o=document.getElementById("profile-avatar-preview"),l=document.getElementById("profile-avatar-fallback");u.avatar?(o&&(o.src=u.avatar,o.style.display="block"),l&&(l.style.display="none")):(o&&(o.src="",o.style.display="none"),l&&(l.textContent=(u.name||"AD").split(" ").map(h=>h[0]).join("").slice(0,2).toUpperCase(),l.style.display="flex"))}function ie(u,t){const a=document.getElementById("sa-users-tbody");if(!a)return;if(!u||u.length===0){a.innerHTML='<tr><td colspan="7" class="text-center text-muted">Không có người dùng nào.</td></tr>';return}const n=o=>{if(!o)return'<span class="text-muted" style="font-size:0.8rem;">Chưa kích hoạt</span>';const l=new Date(o),h=new Date;l.setHours(0,0,0,0),h.setHours(0,0,0,0);const d=l-h,r=Math.ceil(d/(1e3*60*60*24));return r<0?`<span class="badge badge-danger" style="background-color: rgba(239,68,68,0.1); color: var(--danger); font-size: 0.8rem; font-weight: 600;"><i data-lucide="alert-circle" style="width:12px;height:12px;display:inline-block;vertical-align:middle;margin-right:2px;"></i> Hết hạn (${Math.abs(r)} ngày trước)</span>`:r===0?'<span class="badge badge-warning" style="background-color: rgba(245,158,11,0.1); color: #f59e0b; font-size: 0.8rem; font-weight: 600;"><i data-lucide="alert-triangle" style="width:12px;height:12px;display:inline-block;vertical-align:middle;margin-right:2px;"></i> Hôm nay hết hạn</span>':r<=30?`<span class="badge badge-warning" style="background-color: rgba(245,158,11,0.1); color: #f59e0b; font-size: 0.8rem; font-weight: 600;">Còn ${r} ngày</span>`:`<span class="badge badge-success" style="background-color: rgba(16,185,129,0.1); color: var(--success); font-size: 0.8rem; font-weight: 600;">Còn ${r} ngày</span>`},i=o=>({super_admin:'<span class="badge badge-purple" style="font-size:0.8rem; font-weight:600;"><i data-lucide="shield-alert" style="width:12px;height:12px;display:inline-block;vertical-align:middle;margin-right:2px;"></i> Super Admin</span>',manager:'<span class="badge badge-info" style="font-size:0.8rem; font-weight:600;"><i data-lucide="shield" style="width:12px;height:12px;display:inline-block;vertical-align:middle;margin-right:2px;"></i> Quản lý</span>',employee:'<span class="badge badge-neutral" style="font-size:0.8rem; font-weight:600;"><i data-lucide="user" style="width:12px;height:12px;display:inline-block;vertical-align:middle;margin-right:2px;"></i> Chuyên viên</span>'})[o]||`<span class="badge badge-neutral">${o}</span>`,e=o=>({silver:'<span class="badge badge-neutral" style="font-size:0.8rem; font-weight:600; background:rgba(148,163,184,0.1); color:#475569; border:1px solid rgba(148,163,184,0.2);">Gói Bạc (Silver)</span>',gold:'<span class="badge badge-warning" style="font-size:0.8rem; font-weight:600; background:rgba(245,158,11,0.1); color:#b45309; border:1px solid rgba(245,158,11,0.2);">Gói Vàng (Gold)</span>',diamond:'<span class="badge badge-info" style="font-size:0.8rem; font-weight:600; background:rgba(14,165,233,0.1); color:#0284c7; border:1px solid rgba(14,165,233,0.2);">Gói Kim Cương (Diamond)</span>',none:'<span class="text-muted" style="font-size:0.8rem;">Chưa chọn gói</span>'})[o]||'<span class="text-muted" style="font-size:0.8rem;">Chưa chọn gói</span>';a.innerHTML=u.map(o=>{const h=o.username===t?'<span class="text-muted" style="font-size:0.8rem; font-style:italic;">(Tài khoản hiện tại)</span>':`<button class="action-btn btn-delete" onclick="window.deleteSystemUser('${o.id}', '${o.username}')" title="Xóa tài khoản"><i data-lucide="trash-2"></i></button>`,d=`<button class="action-btn btn-edit" onclick="window.showSystemUserDetail('${o.id}')" title="Xem chi tiết & Cấu hình"><i data-lucide="user-cog"></i></button>`;return`
            <tr style="cursor: pointer;" onclick="window.showSystemUserDetail('${o.id}')">
                <td class="fw-bold" style="color: var(--text-main);">${escapeHTML(o.username)}</td>
                <td style="font-weight: 600;">${escapeHTML(o.name)}</td>
                <td>${escapeHTML(o.email)||"--"}</td>
                <td>${i(o.role)}</td>
                <td>${e(o.package_id)}</td>
                <td>${n(o.package_end_date)}</td>
                <td class="text-right" onclick="event.stopPropagation()">
                    <div class="action-btn-group" style="justify-content: flex-end;">
                        ${d}
                        ${h}
                    </div>
                </td>
            </tr>
        `}).join(""),lucide.createIcons()}const oe=Object.freeze(Object.defineProperty({__proto__:null,applySecurityLockOverlay:Jt,populateNhanVienPhuTrachDropdowns:Zt,renderManagerHoSoGiayPanel:ae,renderManagerNhanVienPanel:ee,renderProfileTab:ne,renderSuperAdminPanel:te,renderSystemUsersTable:ie,updateActiveUserProfileDisplay:Xt},Symbol.toStringTag,{value:"Module"}));class wt{constructor(t){this.model=t,this.elements={}}initDOM(){this.elements={themeToggle:document.getElementById("theme-toggle"),sunIcon:document.getElementById("sun-icon"),moonIcon:document.getElementById("moon-icon"),sidebarToggle:document.getElementById("sidebar-toggle"),sidebar:document.getElementById("sidebar"),currentDateSpan:document.getElementById("current-date").querySelector("span"),pageTitle:document.getElementById("page-title"),navButtons:document.querySelectorAll(".nav-btn"),tabPanes:document.querySelectorAll(".tab-pane")},this._tableObserver||(this._tableObserver=new MutationObserver(()=>{this.enhanceAllTables()}),this._tableObserver.observe(document.body,{childList:!0,subtree:!0})),setTimeout(()=>this.enhanceAllTables(),100)}enhanceAllTables(){this._tableObserver&&this._tableObserver.disconnect(),document.querySelectorAll("table").forEach(a=>{this.enhanceTableHeaders(a)}),this.upgradeAllSelects(),this._tableObserver&&this._tableObserver.observe(document.body,{childList:!0,subtree:!0})}upgradeAllSelects(){document.querySelectorAll("body > .custom-select-dropdown").forEach(t=>{const a=t.getAttribute("data-target"),n=document.getElementById(a),i=document.querySelector(`.custom-select-container[data-target="${a}"]`);(!n||!i||i.offsetWidth===0&&i.offsetHeight===0)&&t.remove()}),document.querySelectorAll("select").forEach(t=>{const a=t.getAttribute("data-no-custom")==="true",n=t.id&&t.parentNode.querySelector(`.custom-select-wrapper[data-select-id="${t.id}"]`);if(t.classList.contains("version-select")||t.classList.contains("phienban-select")||t.classList.contains("modal-version-select")||a||n){if(t.id){const i=t.parentNode.querySelector(`.custom-select-container[data-target="${t.id}"]`);i&&(i.remove(),n||(t.style.display=""))}return}t.id||(t.id="select-"+Math.random().toString(36).substring(2,9)),ht(t.id)})}enhanceTableHeaders(t,a){let n=typeof t=="string"?document.getElementById(t):t;if(!n)return;const i='<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevrons-up-down" style="display: block;"><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg>',e='<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-up" style="display: block;"><path d="m18 15-6-6-6 6"/></svg>',o='<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-down" style="display: block;"><path d="m6 9 6 6 6-6"/></svg>';!a&&n.id&&(a={"kehoach-table":"kehoach","goithau-table":"goithau","chudautu-table":"chudautu","nhathau-table":"nhathau","chuyengia-table":"chuyengia","hopdong-table":"hopdong"}[n.id]);const l=c=>c?c.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]/g,"").trim():"",h={kehoach:{makehoach:"maKeHoach",phienban:"phienBan",tenkehoachluachonnhathau:"tenKeHoach",phanloai:"loaiHinhMuaSam",duandutoan:"tenDuAnDuToan",chudautu:"chuDauTuId",tonggiatri:"tongMucDauTu",ngaypheduyet:"ngayPheDuyet",soqd:"quyetDinhPheDuyet",thoigiandangma:"thoiGianDangMa"},goithau:{magoi:"maGoiThau",magoithau:"maGoiThau",phienban:"phienBan",tengoithau:"tenGoiThau",kehoachlienket:"keHoachId",giagoithau:"giaGoiThau",hinhthuc:"hinhThucLuaChon",hinhthuclcnt:"hinhThucLuaChon",trangthai:"trangThai",nhathautrungthau:"nhaThauTrungThauId"},chudautu:{macdt:"maChuDauTu",machudautu:"maChuDauTu",phienban:"phienBan",tenchudautu:"tenChuDauTu",masothue:"maSoThue",daidien:"nguoiKyQuyetDinh",diachisdt:"diaChi",sotaikhoan:"soTaiKhoan"},nhathau:{manhathau:"maNhaThau",phienban:"phienBan",tennhathau:"tenNhaThau",masothue:"maSoThue",nguoidaidien:"nguoiDaiDien",lienhe:"soDienThoai",taikhoannganhang:"soTaiKhoan"},chuyengia:{hovatenchuyengia:"hoTen",hotenchuyengia:"hoTen",phienban:"phienBan",socancuoccongdan:"soCCCD",sochungchidauthau:"soChungChi",donvicapchungchi:"donViCapChungChi",ngaycapchungchi:"ngayCapChungChi",ngaycapcccd:"ngayCapCCCD"},hopdong:{sohopdong:"soHopDong",phienban:"phienBan",tenhopdong:"tenHopDong",ngayky:"ngayKy",chudautu:"chuDauTuId",nhathau:"nhaThauId",giatrihopdong:"giaTri",loaihopdong:"loaiHopDong",thoigianthuchien:"soNgayThucHien",goithaulienket:"goiThauId",trangthaihoso:"trangThaiHoSo"}},d=n.querySelectorAll("thead th"),r=a?h[a]:null;d.forEach((c,g)=>{const s=c.textContent.replace(/[↕▲▼]/g,"").trim(),p=l(s);if(!p||["thaotac","hanhdong","chucnang","chon","tuychon"].includes(p))return;const m=r?r[p]:null;if(!c.querySelector(".sort-header-container")){c.style.cursor="pointer",c.style.userSelect="none";const v=c.innerHTML;c.innerHTML=`
                    <div class="sort-header-container">
                        <span class="th-label" style="flex-grow: 1; text-align: inherit;">${v}</span>
                        <span class="sort-icon-btn">
                            ${i}
                        </span>
                    </div>
                `,c.addEventListener("click",b=>{if(!(b.target.closest("select")||b.target.closest("input")||b.target.closest("button")||b.target.closest("a")))if(a&&m)window.toggleSortTable(a,m);else{const y=c.getAttribute("data-sort-order")==="asc"?"desc":"asc";d.forEach(L=>{if(L!==c){L.removeAttribute("data-sort-order");const T=L.querySelector(".sort-icon-btn");T&&(T.innerHTML=i,T.classList.remove("active"),T.style.opacity="",T.style.color="",T.style.fontWeight="")}}),c.setAttribute("data-sort-order",y);const w=c.querySelector(".sort-icon-btn");w&&(w.innerHTML=y==="asc"?e:o,w.classList.add("active"),w.style.opacity="",w.style.color="",w.style.fontWeight="");const x=n.querySelector("tbody");if(x){const L=Array.from(x.querySelectorAll("tr")),T=D=>{const P=D.children[g];if(!P)return"";const V=P.querySelector("input, select");return V?V.value.trim():P.textContent.trim()},N=D=>{const P=D.replace(/\./g,"").replace(/,/g,".").replace(/[^0-9.-]/g,"");if(P&&!isNaN(P))return parseFloat(P);const V=D.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);return V?new Date(V[3],V[2]-1,V[1]).getTime():D.toLowerCase()};L.sort((D,P)=>{const V=N(T(D)),at=N(T(P));return typeof V=="number"&&typeof at=="number"?y==="asc"?V-at:at-V:y==="asc"?String(V).localeCompare(String(at),"vi"):String(at).localeCompare(String(V),"vi")}),L.forEach(D=>x.appendChild(D))}}})}if(a&&m){const v=this.model.sortState[a]||{},b=c.querySelector(".sort-icon-btn");b&&(v.field===m?(b.innerHTML=v.order==="asc"?e:o,b.classList.add("active"),b.style.opacity="",b.style.color="",b.style.fontWeight=""):(b.innerHTML=i,b.classList.remove("active"),b.style.opacity="",b.style.color="",b.style.fontWeight=""))}})}openModal(t){const a=document.getElementById(t);a&&a.classList.add("active")}closeModal(t){const a=document.getElementById(t);a&&a.classList.remove("active")}customConfirm(t,a,n="help-circle"){return new Promise(i=>{const e=document.getElementById("modal-custom-dialog"),o=document.getElementById("dialog-title"),l=document.getElementById("dialog-message"),h=document.getElementById("dialog-icon-container"),d=document.getElementById("dialog-icon"),r=document.getElementById("btn-dialog-ok"),c=document.getElementById("btn-dialog-cancel"),g=document.getElementById("btn-dialog-close");o.textContent=t,l.textContent=a,c.style.display="block",g&&(g.style.display="block"),d.setAttribute("data-lucide",n),n==="trash-2"||n==="user-x"||n==="log-out"?(h.style.background="var(--danger-soft)",h.style.color="var(--danger)",r.className="btn btn-primary bg-danger",r.style.background="var(--danger)",r.style.borderColor="var(--danger)"):n==="alert-triangle"||n==="alert-circle"||n==="info"||n==="help-circle"||n==="save"?(h.style.background="var(--warning-soft)",h.style.color="var(--warning)",r.className="btn btn-primary bg-warning",r.style.background="var(--warning)",r.style.borderColor="var(--warning)"):(h.style.background="rgba(59, 130, 246, 0.1)",h.style.color="var(--primary)",r.className="btn btn-primary",r.style.background="",r.style.borderColor=""),lucide.createIcons();const s=()=>{f(),i(!0)},p=()=>{f(),i(!1)},m=()=>{f(),i(null)},f=()=>{r.removeEventListener("click",s),c.removeEventListener("click",p),g&&g.removeEventListener("click",m),e.classList.remove("active")};r.addEventListener("click",s),c.addEventListener("click",p),g&&g.addEventListener("click",m),e.classList.add("active")})}customVersionDeleteChoice(t,a,n="Xóa phiên bản gần nhất",i="Xóa toàn bộ các phiên bản"){return new Promise(e=>{const o=document.getElementById("modal-custom-dialog"),l=document.getElementById("dialog-title"),h=document.getElementById("dialog-message"),d=document.getElementById("dialog-icon-container"),r=document.getElementById("dialog-icon"),c=document.getElementById("dialog-buttons"),g=document.getElementById("btn-dialog-close");l.textContent=t,h.textContent=a,g&&(g.style.display="block"),r.setAttribute("data-lucide","trash-2"),d.style.background="var(--danger-soft)",d.style.color="var(--danger)";const s=c.innerHTML,p=c.style.flexDirection,m=c.style.gap,f=o.querySelector(".modal-card"),v=f.style.width,b=f.style.maxWidth;f.style.setProperty("width","480px","important"),f.style.setProperty("max-width","480px","important"),c.style.flexDirection="row",c.style.gap="10px",c.innerHTML=`
                <button type="button" class="btn btn-outline" id="btn-dialog-cancel" style="flex: 1; padding: 8px 10px; font-size: 0.8rem; font-weight: 600; white-space: nowrap; height: 38px;">Hủy</button>
                <button type="button" class="btn btn-primary" id="btn-dialog-opt1" style="flex: 1.6; background: var(--warning); border-color: var(--warning); padding: 8px 10px; font-size: 0.8rem; color: #fff; font-weight: 600; white-space: nowrap; height: 38px;">${n}</button>
                <button type="button" class="btn btn-primary" id="btn-dialog-opt2" style="flex: 1.6; background: var(--danger); border-color: var(--danger); padding: 8px 10px; font-size: 0.8rem; color: #fff; font-weight: 600; white-space: nowrap; height: 38px;">${i}</button>
            `,lucide.createIcons();const y=document.getElementById("btn-dialog-opt1"),w=document.getElementById("btn-dialog-opt2"),x=document.getElementById("btn-dialog-cancel"),L=()=>{P(),e(1)},T=()=>{P(),e(2)},N=()=>{P(),e(null)},D=()=>{P(),e(null)},P=()=>{y.removeEventListener("click",L),w.removeEventListener("click",T),x.removeEventListener("click",N),g&&g.removeEventListener("click",D),o.classList.remove("active"),setTimeout(()=>{f.style.width=v,f.style.maxWidth=b,c.style.flexDirection=p,c.style.gap=m,c.innerHTML=s},300)};y.addEventListener("click",L),w.addEventListener("click",T),x.addEventListener("click",N),g&&g.addEventListener("click",D),o.classList.add("active")})}customAlert(t,a,n="info",i=null){return new Promise(e=>{const o=document.getElementById("modal-custom-dialog"),l=document.getElementById("dialog-title"),h=document.getElementById("dialog-message"),d=document.getElementById("dialog-icon-container"),r=document.getElementById("dialog-icon"),c=document.getElementById("btn-dialog-ok"),g=document.getElementById("btn-dialog-cancel"),s=document.getElementById("btn-dialog-close");l.textContent=t,a&&a.includes(`
`)?(h.style.whiteSpace="pre-wrap",h.style.textAlign="left",h.style.fontSize="0.85rem",h.style.maxHeight="340px",h.style.overflowY="auto",h.textContent=a):(h.style.whiteSpace="",h.style.textAlign="",h.style.fontSize="",h.style.maxHeight="",h.style.overflowY="",h.textContent=a),g.style.display="none",s&&(s.style.display="block");let p=[];if(i){const x=document.querySelector(".tab-pane.active")||document;typeof i=="string"?p=Array.from(x.querySelectorAll(i)):i instanceof HTMLElement?p=[i]:i.length!==void 0&&Array.from(i).forEach(L=>{typeof L=="string"?p.push(...x.querySelectorAll(L)):L instanceof HTMLElement&&p.push(L)})}const m=[];p.forEach(w=>{m.push(w);const x=w.closest(".form-group")||w.parentElement;x&&x.classList.add("invalid");const L=()=>{const T=w.closest(".form-group")||w.parentElement;T&&T.classList.remove("invalid"),w.removeEventListener("input",L),w.removeEventListener("change",L)};w.addEventListener("input",L),w.addEventListener("change",L)}),r.setAttribute("data-lucide",n),n==="check-circle"?(d.style.background="rgba(16, 185, 129, 0.1)",d.style.color="var(--success)",c.className="btn btn-primary",c.style.background="",c.style.borderColor=""):n==="alert-triangle"||n==="alert-circle"||n==="info"||n==="save"?(d.style.background="var(--warning-soft)",d.style.color="var(--warning)",c.className="btn btn-primary bg-warning",c.style.background="var(--warning)",c.style.borderColor="var(--warning)"):n==="x-circle"||n==="trash-2"||n==="user-x"||n==="log-out"?(d.style.background="var(--danger-soft)",d.style.color="var(--danger)",c.className="btn btn-primary bg-danger",c.style.background="var(--danger)",c.style.borderColor="var(--danger)"):(d.style.background="rgba(59, 130, 246, 0.1)",d.style.color="var(--primary)",c.className="btn btn-primary",c.style.background="",c.style.borderColor=""),lucide.createIcons();const f=()=>{if(m.length>0){const w=m[0];w.scrollIntoView({behavior:"smooth",block:"center",inline:"center"}),setTimeout(()=>{w.focus({preventScroll:!0})},300)}},v=()=>{y(),e(!0),f()},b=()=>{y(),e(null),f()},y=()=>{c.removeEventListener("click",v),s&&s.removeEventListener("click",b),o.classList.remove("active")};c.addEventListener("click",v),s&&s.addEventListener("click",b),o.classList.add("active")})}customPrompt(t,a,n="",i="",e=!1){return new Promise(o=>{const l=document.getElementById("modal-custom-dialog"),h=document.getElementById("dialog-title"),d=document.getElementById("dialog-message"),r=document.getElementById("dialog-icon-container"),c=document.getElementById("dialog-icon"),g=document.getElementById("btn-dialog-ok"),s=document.getElementById("btn-dialog-cancel"),p=document.getElementById("btn-dialog-close");h.textContent=t,d.textContent=a,s.style.display="block",p&&(p.style.display="block");const m=document.createElement("div");m.id="dialog-prompt-container",m.style.marginTop="16px",m.style.textAlign="left";const f=document.createElement("input");f.type="text",f.id="dialog-prompt-input",f.value=n,f.placeholder=i,f.style.width="100%",f.style.padding="10px 14px",f.style.border="1px solid var(--border-color)",f.style.borderRadius="var(--radius-md)",f.style.background="var(--bg-card)",f.style.color="var(--text-main)",f.style.fontFamily="inherit",f.style.fontSize="0.95rem",f.style.outline="none",f.style.boxSizing="border-box",m.appendChild(f),d.parentNode.insertBefore(m,d.nextSibling),e?(f.type="datetime-local",n&&(f.value=this.model.formatForDatetimeLocal(n)),setTimeout(()=>f.focus(),100)):setTimeout(()=>f.focus(),100),c.setAttribute("data-lucide","calendar"),r.style.background="rgba(59, 130, 246, 0.1)",r.style.color="var(--primary)",g.className="btn btn-primary",g.style.background="",g.style.borderColor="",lucide.createIcons();const v=()=>{let x=f.value;e&&x&&(x=this.model.formatDate(x)),w(),o(x)},b=()=>{w(),o(null)},y=()=>{w(),o(null)},w=()=>{g.removeEventListener("click",v),s.removeEventListener("click",b),p&&p.removeEventListener("click",y),l.classList.remove("active"),setTimeout(()=>{const x=document.getElementById("dialog-prompt-container");x&&x.remove()},300)};e||f.addEventListener("keyup",x=>{x.key==="Enter"&&v()}),g.addEventListener("click",v),s.addEventListener("click",b),p&&p.addEventListener("click",y),l.classList.add("active")})}validateForm(t){let a=!0;const n=t.querySelectorAll("[required]"),i=[];if(n.forEach(e=>{const o=e.closest(".form-group");if(o&&o.offsetWidth===0&&o.offsetHeight===0||!o&&e.offsetWidth===0&&e.offsetHeight===0&&e.type!=="hidden")return;let l=!0;if(e.value.trim()==="")l=!1;else if(e.type==="number"){const h=parseFloat(e.value),d=e.getAttribute("min")?parseFloat(e.getAttribute("min")):-1/0;(isNaN(h)||h<d)&&(l=!1)}else e.type==="email"&&(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.value.trim())||(l=!1));if(o){l?o.classList.remove("invalid"):(o.classList.add("invalid"),i.push(e),a=!1);const h=()=>{e.value.trim()!==""&&(o.classList.remove("invalid"),e.removeEventListener("input",h),e.removeEventListener("change",h))};e.addEventListener("input",h),e.addEventListener("change",h)}}),!a&&i.length>0){const e=i[0];e.scrollIntoView({behavior:"smooth",block:"center",inline:"center"}),setTimeout(()=>{if(e.tagName==="SELECT"&&e.style.display==="none"){const o=e.parentNode.querySelector(`.custom-select-wrapper[data-select-id="${e.id}"]`),l=o?o.querySelector(".custom-select-search"):null;if(l){l.focus({preventScroll:!0});return}}e.focus({preventScroll:!0})},300)}return a}getActiveElement(t){const a=document.querySelector(".tab-pane.active");if(a){const n=a.querySelector("#"+t);if(n)return n}return document.getElementById(t)}debounce(t,a){let n;return function(...i){const e=this;clearTimeout(n),n=setTimeout(()=>t.apply(e,i),a)}}formatCurrencyInput(t){let a=t.value.replace(/[^0-9]/g,"");if(a===""){t.value="";return}t.value=new Intl.NumberFormat("vi-VN").format(parseInt(a,10))}customConflictDialog(t,a){return new Promise(n=>{const i=document.getElementById("modal-custom-dialog"),e=document.getElementById("dialog-title"),o=document.getElementById("dialog-message"),l=document.getElementById("dialog-icon-container"),h=document.getElementById("dialog-icon"),d=document.getElementById("dialog-buttons"),r=document.getElementById("btn-dialog-close");if(!i||!e||!o||!d)return console.error("Conflict modal element not found!"),n("local");e.textContent=t,o.textContent=a,r&&(r.style.display="none"),l&&h&&(l.style.background="var(--warning-soft)",l.style.color="var(--warning)",h.setAttribute("data-lucide","alert-circle"),window.lucide&&window.lucide.createIcons({root:l})),d.innerHTML=`
                <button type="button" class="btn btn-outline" id="btn-conflict-server" style="flex: 1; font-size: 0.8rem; padding: 6px 8px;">Dùng bản Server</button>
                <button type="button" class="btn btn-outline" id="btn-conflict-local" style="flex: 1; font-size: 0.8rem; padding: 6px 8px;">Dùng bản Local</button>
                <button type="button" class="btn btn-primary" id="btn-conflict-new" style="flex: 1; font-size: 0.8rem; padding: 6px 8px;">Tạo bản mới</button>
            `;const c=m=>{i.classList.remove("active"),d.innerHTML=`
                    <button type="button" class="btn btn-outline" id="btn-dialog-cancel" style="flex: 1;">Hủy</button>
                    <button type="button" class="btn btn-primary" id="btn-dialog-ok" style="flex: 1;">Xác nhận</button>
                `,r&&(r.style.display="block"),n(m)},g=document.getElementById("btn-conflict-server"),s=document.getElementById("btn-conflict-local"),p=document.getElementById("btn-conflict-new");g&&(g.onclick=()=>c("server")),s&&(s.onclick=()=>c("local")),p&&(p.onclick=()=>c("new")),i.classList.add("active")})}getStatusBadge(t){return{"Chuẩn bị":'<span class="badge badge-neutral"><i data-lucide="circle-dot"></i> Chuẩn bị</span>',"Đang mời thầu":'<span class="badge badge-info"><i data-lucide="megaphone"></i> Đang mời thầu</span>',"Đã mở thầu":'<span class="badge" style="background-color: #f59e0b; color: white;"><i data-lucide="folder-open"></i> Đã mở thầu</span>',"Đang chấm thầu":'<span class="badge badge-warning"><i data-lucide="award"></i> Đang chấm thầu</span>',"Đã có kết quả":'<span class="badge badge-success"><i data-lucide="check-circle"></i> Đã có kết quả</span>',"Hủy thầu":'<span class="badge badge-danger"><i data-lucide="x-circle"></i> Hủy thầu</span>'}[t]||`<span class="badge">${t}</span>`}}Object.assign(wt.prototype,{...It,...qt,...Yt,...oe});async function re(u){const t=this.model.state.goithau.find(s=>s.id===u);if(!t)return;const a=await this.view.customPrompt("Chọn thời gian mở thầu",`Chọn Thời gian mở thầu cho gói thầu "${t.tenGoiThau}":`,"","Chọn ngày và giờ...",!0);if(a===null)return;const n=a.trim();if(!n){await this.view.customAlert("Lỗi","Vui lòng chọn thời gian mở thầu!","x-circle");return}const i=n.split(" "),e=i[0].split("/"),o=(i[1]||"").split(":"),l=parseInt(e[0]),h=parseInt(e[1]),d=parseInt(e[2]),r=parseInt(o[0]||0),c=parseInt(o[1]||0);if(isNaN(l)||isNaN(h)||isNaN(d)||isNaN(r)||isNaN(c)){await this.view.customAlert("Lỗi","Thời gian mở thầu không hợp lệ. Vui lòng chọn lại!","x-circle");return}if(await this.view.customConfirm("Mở thầu gói thầu",`Bạn có chắc chắn muốn tiến hành mở thầu cho gói thầu "${t.tenGoiThau}" lúc ${n}? Trạng thái sẽ được chuyển sang "Đã mở thầu".`,"unlock")){const s=`${d}-${String(h).padStart(2,"0")}-${String(l).padStart(2,"0")}T${String(r).padStart(2,"0")}:${String(c).padStart(2,"0")}:00`;t.thoiGianMoThau=s,t.trangThai="Đã mở thầu",this.model.persistData("goithau"),this.view.renderGoiThauTable(),this.autoSync(),await this.view.customAlert("Thành công",`Đã tiến hành mở thầu thành công cho gói thầu "${t.tenGoiThau}". Trạng thái hiện tại: Đã mở thầu. Hãy tiến hành điền thông tin mở thầu và lưu lại!`,"check-circle"),this.switchTab("goithau-detail",u)}}async function de(u){const t=this.model.state.goithau.find(d=>d.id===u);if(!t)return;const a=document.getElementById("form-phathanh-hsmt");a&&a.querySelectorAll(".form-group").forEach(d=>d.classList.remove("invalid")),document.getElementById("phathanh-gt-id").value=t.id,document.getElementById("phathanh-magoithau").value=t.maGoiThau||"",document.getElementById("phathanh-soquyetdinh").value=t.soQuyetDinh||"",document.getElementById("phathanh-hieuluchsdt").value=t.hieuLucHsdt||"",document.getElementById("phathanh-giatribaomothau").value=t.giaTriDamBaoDuThau?this.model.formatVND(t.giaTriDamBaoDuThau):"",this.view.fpPhathanhNgayQuyetDinh?this.view.fpPhathanhNgayQuyetDinh.setDate(t.ngayQuyetDinh?new Date(t.ngayQuyetDinh):""):document.getElementById("phathanh-ngayquyetdinh").value=t.ngayQuyetDinh?this.model.formatDate(t.ngayQuyetDinh):"",this.view.fpPhathanhThoiGianDangTai?this.view.fpPhathanhThoiGianDangTai.setDate(t.thoiGianDangTai?new Date(t.thoiGianDangTai):""):document.getElementById("phathanh-thoigiandangtai").value=t.thoiGianDangTai?this.model.formatDateWithTime(t.thoiGianDangTai):"",this.view.fpPhathanhThoiGianDongThau?this.view.fpPhathanhThoiGianDongThau.setDate(t.thoiGianDongThau?new Date(t.thoiGianDongThau):""):document.getElementById("phathanh-thoigiandongthau").value=t.thoiGianDongThau?this.model.formatDateWithTime(t.thoiGianDongThau):"";const n=t.linhVuc==="Tư vấn",i=t.phanLo==="Có",e=document.getElementById("phathanh-baodam-container"),o=document.getElementById("phathanh-giatribaomothau"),l=document.getElementById("phathanh-phanlo-baodam-container"),h=document.getElementById("phathanh-phanlo-baodam-tbody");e&&o&&l&&h&&(n?(e.style.display="none",o.removeAttribute("required"),l.style.display="none",h.innerHTML=""):i?(e.style.display="none",o.removeAttribute("required"),l.style.display="block",h.innerHTML="",(t.phanLoList||[]).forEach(r=>{const c=document.createElement("tr");c.setAttribute("data-id",r.id);const g=r.baoDamDuThau||"",s=r.giaTriPhanLo||0;c.innerHTML=`
                        <td style="padding: 6px 8px;">
                            <input type="text" class="phathanh-pl-code-input" value="${r.maPhanLo||""}" placeholder="Mã..." style="width: 100%; border: 1px solid var(--border-color); padding: 4px 8px; border-radius: var(--radius-sm); font-size: 0.8rem; height: 32px; background: var(--bg-card); color: var(--text-main);">
                        </td>
                        <td style="padding: 6px 8px;">
                            <input type="text" class="phathanh-pl-name-input" value="${r.tenPhanLo||""}" placeholder="Tên..." style="width: 100%; border: 1px solid var(--border-color); padding: 4px 8px; border-radius: var(--radius-sm); font-size: 0.8rem; height: 32px; background: var(--bg-card); color: var(--text-main);">
                        </td>
                        <td style="padding: 6px 8px;">
                            <input type="text" class="phathanh-pl-price-input mt-format-vnd" value="${s?this.model.formatVND(s):""}" placeholder="Giá trị..." style="width: 100%; border: 1px solid var(--border-color); padding: 4px 8px; border-radius: var(--radius-sm); font-size: 0.8rem; height: 32px; background: var(--bg-card); color: var(--text-main);">
                        </td>
                        <td style="padding: 6px 8px;">
                            <input type="text" class="phathanh-pl-baodam-input mt-format-vnd" required value="${g?this.model.formatVND(g):""}" placeholder="Bảo đảm..." style="width: 100%; border: 1px solid var(--border-color); padding: 4px 8px; border-radius: var(--radius-sm); font-size: 0.8rem; height: 32px; background: var(--bg-card); color: var(--text-main);">
                        </td>
                        <td style="padding: 6px 8px;">
                            <input type="text" class="phathanh-pl-duration-input" value="${r.thoiGianThucHien||""}" placeholder="Thời gian..." style="width: 100%; border: 1px solid var(--border-color); padding: 4px 8px; border-radius: var(--radius-sm); font-size: 0.8rem; height: 32px; background: var(--bg-card); color: var(--text-main);">
                        </td>
                    `,h.appendChild(c);const p=m=>{m&&m.addEventListener("input",f=>{const v=f.target.selectionStart,b=f.target.value.length,y=this.model.parseVND(f.target.value);f.target.value=this.model.formatVND(y);const w=f.target.value.length;f.target.setSelectionRange(v+(w-b),v+(w-b))})};p(c.querySelector(".phathanh-pl-price-input")),p(c.querySelector(".phathanh-pl-baodam-input"))})):(e.style.display="block",o.setAttribute("required",""),o.setAttribute("required","true"),o.value=t.giaTriDamBaoDuThau?this.model.formatVND(t.giaTriDamBaoDuThau):"",l.style.display="none",h.innerHTML="")),this.view.openModal("modal-phathanh-hsmt")}async function he(u){u.preventDefault();const t=document.getElementById("form-phathanh-hsmt");if(!this.view.validateForm(t))return;const a=document.getElementById("phathanh-gt-id").value,n=this.model.state.goithau.find(r=>r.id===a);if(!n)return;const i=n.linhVuc==="Tư vấn",e=n.phanLo==="Có",o=document.getElementById("phathanh-magoithau").value.trim();if(!o){await this.view.customAlert("Thiếu thông tin","Mã gói thầu là bắt buộc khi chuyển sang trạng thái Đang mời thầu!","alert-triangle",document.getElementById("phathanh-magoithau"));return}const l=parseInt(document.getElementById("phathanh-hieuluchsdt").value)||0;if(l<=0){await this.view.customAlert("Thiếu thông tin","Thời gian hiệu lực hồ sơ dự thầu phải lớn hơn 0!","alert-triangle",document.getElementById("phathanh-hieuluchsdt"));return}let h=0;if(!i&&!e&&(h=this.model.parseVND(document.getElementById("phathanh-giatribaomothau").value),h<=0)){await this.view.customAlert("Thiếu thông tin","Giá trị bảo đảm dự thầu phải lớn hơn 0 (trừ gói tư vấn)!","alert-triangle",document.getElementById("phathanh-giatribaomothau"));return}if(e&&!i){let r=null,c=null,g="";if(document.querySelectorAll("#phathanh-phanlo-baodam-tbody tr").forEach(s=>{s.getAttribute("data-id");const p=s.querySelector(".phathanh-pl-baodam-input"),m=p?this.model.parseVND(p.value):0,f=s.querySelector(".phathanh-pl-price-input"),v=f?this.model.parseVND(f.value):0;m<=0&&!r&&(r=p),v>0&&m>v&&!c&&(c=p,g=`Giá trị bảo đảm dự thầu (${this.model.formatVND(m)}) không được lớn hơn giá trị phần lô (${this.model.formatVND(v)})!`)}),r||!n.phanLoList||n.phanLoList.length===0){await this.view.customAlert("Thiếu thông tin","Gói thầu bắt buộc phải có Giá trị bảo đảm dự thầu lớn hơn 0 cho tất cả các phần lô (trừ gói tư vấn)!","alert-triangle",r);return}if(c){await this.view.customAlert("Dữ liệu không hợp lệ",g,"alert-triangle",c);return}}if(await this.view.customConfirm("Xác nhận phát hành",`Bạn có chắc chắn muốn phát hành HSMT và chuyển gói thầu "${n.tenGoiThau}" sang trạng thái "Đang mời thầu" không?`,"send")){const r=document.getElementById("phathanh-thoigiandangtai").value,c=document.getElementById("phathanh-thoigiandongthau").value,g=document.getElementById("phathanh-ngayquyetdinh").value;n.maGoiThau=o,n.soQuyetDinh=document.getElementById("phathanh-soquyetdinh").value.trim(),n.ngayQuyetDinh=g?this.model.convertDMYToYMD(g):"",n.thoiGianDangTai=r?this.model.convertDMYHMSToYMDHMS(r):"",n.thoiGianDongThau=c?this.model.convertDMYHMSToYMDHMS(c):"",n.thoiGianMoThau=n.thoiGianDongThau,n.hieuLucHsdt=l,n.hieuLucDamBaoDuThau=l+30,e&&!i&&n.phanLoList?(document.querySelectorAll("#phathanh-phanlo-baodam-tbody tr").forEach(s=>{const p=s.getAttribute("data-id"),m=n.phanLoList.find(f=>f.id===p);if(m){const f=s.querySelector(".phathanh-pl-code-input"),v=s.querySelector(".phathanh-pl-name-input"),b=s.querySelector(".phathanh-pl-price-input"),y=s.querySelector(".phathanh-pl-baodam-input"),w=s.querySelector(".phathanh-pl-duration-input");m.maPhanLo=f?f.value.trim():"",m.tenPhanLo=v?v.value.trim():"",m.giaTriPhanLo=b?this.model.parseVND(b.value):0,m.baoDamDuThau=y?this.model.parseVND(y.value):0,m.thoiGianThucHien=w?w.value.trim():""}}),n.giaTriDamBaoDuThau=n.phanLoList.reduce((s,p)=>s+(p.baoDamDuThau||0),0)):!i&&!e?n.giaTriDamBaoDuThau=h:n.giaTriDamBaoDuThau=0,n.trangThai="Đang mời thầu",this.model.persistData("goithau"),this.view.closeModal("modal-phathanh-hsmt"),this.view.showPackageDetails(a),this.autoSync(),await this.view.customAlert("Thành công","Đã phát hành HSMT và chuyển gói thầu sang trạng thái Đang mời thầu!","check-circle")}}function ce(){const u=document.getElementById("mothau-goithau-select");if(!u)return;const t=new Date,a=this.model.state.goithau.filter(c=>!(c.trangThai!=="Đang mời thầu"&&c.trangThai!=="Đã mở thầu"&&c.trangThai!=="Đang chấm thầu"&&c.trangThai!=="Đã có kết quả"||c.trangThai==="Đang mời thầu"&&(!c.thoiGianDongThau||new Date(c.thoiGianDongThau)>=t))),n=u.value;u.innerHTML='<option value="">-- Chọn Gói thầu (Đang mời thầu / Đã mở thầu / Đang chấm thầu / Đã có kết quả) --</option>'+a.map(c=>`<option value="${c.id}" data-search="${c.maGoiThau||""} ${c.tenGoiThau||""}">${c.tenGoiThau} (${c.maGoiThau||"Chưa có mã"})</option>`).join(""),n&&a.some(c=>c.id===n)?u.value=n:u.value="",this.makeSearchableSelect(u,"Tìm kiếm Gói thầu...");const i=document.getElementById("mothau-goithau-summary"),e=document.getElementById("mothau-bid-container"),o=document.getElementById("mothau-empty-state"),l=document.getElementById("mothau-table-thead"),h=document.getElementById("mothau-table-tbody"),d=()=>{const c=u.value;if(!c){i.style.display="none",e.style.display="none",o.style.display="block";return}const g=this.model.state.goithau.find(q=>q.id===c);if(!g)return;const s=this.model.getLatestPlan(g.keHoachId),p=s?this.model.state.chudautu.find(q=>q.id===s.chuDauTuId):null,m=p?p.tenChuDauTu:"Không rõ",f=g.linhVuc==="Tư vấn",v=g.phuongThucLuaChon==="Một giai đoạn hai túi hồ sơ",b=g.phuongThucLuaChon==="Một giai đoạn một túi hồ sơ",y=g.phanLo==="Có",w=v?"opening_tech":"opening";let x=!1;if(g.danhGiaHsdtMetadata)try{const q=JSON.parse(g.danhGiaHsdtMetadata);v?x=!!(q.is1G2T&&q.technical&&q.technical.saved):x=!!q.saved}catch{}const L=g.trangThai!=="Đang mời thầu"&&g.trangThai!=="Đã mở thầu"&&x,T=this.view._editingState&&this.view._editingState[w],N=L&&!T,D=!N,V=["Đã có kết quả","Hủy thầu"].includes(g.trangThai);i.style.display="block",i.innerHTML=`
            <div style="font-weight: 700; color: var(--primary); border-bottom: 1px solid rgba(59, 130, 246, 0.2); padding-bottom: 4px; margin-bottom: 12px;">Thông số Gói thầu</div>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 8px; font-size: 0.82rem; margin-bottom: 12px;">
                <div>• <strong>Chủ đầu tư:</strong> <span class="text-dark fw-bold">${m}</span></div>
                <div>• <strong>Lĩnh vực:</strong> ${g.linhVuc||"Hàng hóa"}</div>
                <div>• <strong>Phương thức LCNT:</strong> ${g.phuongThucLuaChon||"Một giai đoạn một túi hồ sơ"}</div>
                <div>• <strong>Phân lô:</strong> ${g.phanLo==="Có"?"Có chia phần lô":"Không chia phần lô"}</div>
                <div>• <strong>Giá gói thầu:</strong> <span class="text-blue fw-bold">${this.model.formatCurrency(g.giaGoiThau)}</span></div>
                <div>• <strong>Hình thức LCNT:</strong> ${g.hinhThucLuaChon||"--"}</div>
                ${g.phuongPhapDanhGia?`<div>• <strong>Phương pháp đánh giá:</strong> ${g.phuongPhapDanhGia}${g.phuongPhapDanhGia==="Kết hợp giữa kỹ thuật và giá"&&g.trongSoKyThuat?` (${g.trongSoKyThuat}%)`:""}</div>`:""}
                <div>• <strong>Loại hợp đồng:</strong> ${g.loaiHopDong||"--"}</div>
                <div>• <strong>Thời gian thực hiện:</strong> ${g.thoiGianThucHien||"--"}</div>
                <div>• <strong>Nguồn vốn:</strong> ${g.nguonVon||"--"}</div>
                <div>• <strong>Thời gian đóng thầu:</strong> ${g.thoiGianDongThau?this.model.formatDateWithTime(g.thoiGianDongThau):"--"}</div>
                <div>• <strong>Thời gian mở thầu:</strong> ${g.thoiGianMoThau?this.model.formatDateWithTime(g.thoiGianMoThau):"--"}</div>
            </div>
            ${V||N?`<div style="margin-top:8px; padding:8px 12px; background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.25); border-radius:6px; color:#dc2626; font-weight:600; font-size:0.82rem; display:flex; align-items:center; gap:6px;">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                Biên bản mở thầu đã bị khóa — Gói thầu có trạng thái <strong style="margin-left:4px;">${g.trangThai}</strong>
            </div>`:""}
        `,o.style.display="none",e.style.display="block";const at=document.getElementById("btn-mothau-add-bid"),nt=document.getElementById("btn-mothau-save"),S=document.getElementById("btn-mothau-import-excel"),M=document.getElementById("btn-mothau-download-excel");at&&(at.style.display=D?"":"none"),S&&(S.style.display=D?"":"none"),M&&(M.style.display=D?"":"none"),nt&&(N?nt.style.display="none":(nt.style.display="",nt.innerHTML='<i data-lucide="save"></i> Lưu thông tin mở thầu',nt.className="btn btn-primary",nt.onclick=()=>this.saveThongTinMoThau()));let z="1G1T_NO_LOT";f?z="TU_VAN":!f&&v?z=y?"1G2T_WITH_LOT":"1G2T_NO_LOT":b&&(z=y?"1G1T_WITH_LOT":"1G1T_NO_LOT");let K="";z==="TU_VAN"?K=`
                <tr>
                    <th style="width: 15%;">Loại nhà thầu</th>
                    <th style="width: 20%;">Mã nhà thầu</th>
                    <th style="width: 30%;">Tên nhà thầu</th>
                    <th style="width: 15%;">Hiệu lực E-HSĐXKT</th>
                    <th style="width: 12%;">Thời gian thực hiện</th>
                    ${D?'<th style="width: 8%; text-align: center;">Thao tác</th>':""}
                </tr>
            `:z==="1G2T_NO_LOT"?K=`
                <tr>
                    <th style="width: 12%;">Loại nhà thầu</th>
                    <th style="width: 18%;">Mã nhà thầu</th>
                    <th style="width: 25%;">Tên nhà thầu</th>
                    <th style="width: 12%;">Đảm bảo dự thầu</th>
                    <th style="width: 12%;">Hiệu lực đảm bảo</th>
                    <th style="width: 13%;">Hiệu lực E-HSĐXKT</th>
                    ${D?'<th style="width: 8%; text-align: center;">Thao tác</th>':""}
                </tr>
            `:z==="1G2T_WITH_LOT"?K=`
                <tr>
                    <th style="width: 10%;">Mã phần lô</th>
                    <th style="width: 10%;">Tên phần lô</th>
                    <th style="width: 10%;">Loại nhà thầu</th>
                    <th style="width: 15%;">Mã nhà thầu</th>
                    <th style="width: 20%;">Tên nhà thầu</th>
                    <th style="width: 9%;">Đảm bảo</th>
                    <th style="width: 9%;">Hiệu lực ĐB</th>
                    <th style="width: 11%;">Hiệu lực E-HSĐXKT</th>
                    ${D?'<th style="width: 6%; text-align: center;">Thao tác</th>':""}
                </tr>
            `:z==="1G1T_NO_LOT"?K=`
                <tr>
                    <th style="width: 10%;">Loại nhà thầu</th>
                    <th style="width: 14%;">Mã nhà thầu</th>
                    <th style="width: 20%;">Tên nhà thầu</th>
                    <th style="width: 10%;">Giá dự thầu</th>
                    <th style="width: 7%;">Tỷ lệ giảm (%)</th>
                    <th style="width: 11%;">Giá sau giảm</th>
                    <th style="width: 9%;">Hiệu lực E-HSDT</th>
                    <th style="width: 9%;">Giá trị ĐB DT</th>
                    <th style="width: 6%;">Hiệu lực ĐB</th>
                    <th style="width: 6%;">Thời gian TH</th>
                    ${D?'<th style="width: 4%; text-align: center;">Thao tác</th>':""}
                </tr>
            `:z==="1G1T_WITH_LOT"&&(K=`
                <tr>
                    <th style="width: 8%;">Mã phần lô</th>
                    <th style="width: 8%;">Tên phần lô</th>
                    <th style="width: 8%;">Loại nhà thầu</th>
                    <th style="width: 12%;">Mã nhà thầu</th>
                    <th style="width: 16%;">Tên nhà thầu</th>
                    <th style="width: 8%;">Giá dự thầu</th>
                    <th style="width: 6%;">Tỷ lệ giảm (%)</th>
                    <th style="width: 10%;">Giá sau giảm</th>
                    <th style="width: 8%;">Hiệu lực E-HSDT</th>
                    <th style="width: 8%;">Giá trị ĐB</th>
                    <th style="width: 6%;">Hiệu lực ĐB</th>
                    <th style="width: 6%;">Thời gian TH</th>
                    ${D?'<th style="width: 4%; text-align: center;">Thao tác</th>':""}
                </tr>
            `),l.innerHTML=K,h.innerHTML="";const H=this.model.state.thongtinmothau.filter(q=>String(q.goiThauId)===String(c));H.sort((q,B)=>{const G=String(q.maPhanLo||"").toLowerCase(),$=String(B.maPhanLo||"").toLowerCase();return G.localeCompare($,"vi",{numeric:!0})}),H.length===0?D&&this.addMoThauRow(z,g):H.forEach(q=>this.addMoThauRow(z,g,q,N)),lucide.createIcons()};u.onchange=d,d(),this.setupExcelImportEvents();const r=document.getElementById("btn-mothau-add-bid");r&&(r.onclick=()=>{const c=u.value,g=this.model.state.goithau.find(b=>b.id===c);if(!g)return;const s=g.linhVuc==="Tư vấn",p=g.phuongThucLuaChon==="Một giai đoạn hai túi hồ sơ",m=g.phuongThucLuaChon==="Một giai đoạn một túi hồ sơ",f=g.phanLo==="Có";let v="1G1T_NO_LOT";s?v="TU_VAN":!s&&p?v=f?"1G2T_WITH_LOT":"1G2T_NO_LOT":m&&(v=f?"1G1T_WITH_LOT":"1G1T_NO_LOT"),this.addMoThauRow(v,g),lucide.createIcons()})}window.openMoThauJVManager=u=>{var f;const t=((f=u.querySelector(".mt-ma-nha-thau"))==null?void 0:f.value.trim())||"",a=(u._thanhVienLienDanh||[]).filter(v=>String(v.maSoThue).toLowerCase().trim()!==String(t).toLowerCase().trim()&&v.vaiTro!=="Đứng đầu liên danh"),n="modal-mothau-jv-manager";let i=document.getElementById(n);i&&i.remove(),i=document.createElement("div"),i.id=n,i.className="modal-overlay active",i.style.zIndex="2000";const e=document.createElement("div");e.className="modal-card",e.style.maxWidth="600px",e.style.width="95%",e.style.margin="20px auto";const o=document.createElement("div");o.className="modal-header",o.innerHTML=`
        <h3>Thành viên liên danh</h3>
        <button class="modal-close" id="btn-close-mothau-jv">&times;</button>
    `;const l=document.createElement("div");l.className="modal-body",l.style.padding="20px";const h=window.appController.model.getLatestNhaThau(),d=t?h.find(v=>v.maNhaThau&&v.maNhaThau.trim().toLowerCase()===t.trim().toLowerCase()):null,r=u._leadMemberName||(d?d.tenNhaThau:""),c=t||"Chưa nhập";l.innerHTML=`
        <div style="background: var(--primary-soft); padding: 12px 16px; border-radius: var(--radius-md); margin-bottom: 20px;">
            <div style="font-size: 0.78rem; font-weight: 800; color: var(--primary); text-transform: uppercase; margin-bottom: 8px;">Thành viên đứng đầu liên danh</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                <div class="form-group" style="margin-bottom: 0;">
                    <label style="font-size: 0.75rem; font-weight: 600; color: var(--text-light); margin-bottom: 4px; display: block;">Mã/MST thành viên đứng đầu</label>
                    <input type="text" class="form-control" value="${c}" readonly style="padding: 6px 10px; font-size: 0.85rem; width:100%; background: rgba(0,0,0,0.05); cursor: not-allowed;">
                </div>
                <div class="form-group" style="margin-bottom: 0;">
                    <label style="font-size: 0.75rem; font-weight: 600; color: var(--text-light); margin-bottom: 4px; display: block;">Tên thành viên đứng đầu</label>
                    <input type="text" id="jv-input-lead-name" class="form-control" required placeholder="Tên thành viên đứng đầu" value="${r}" style="padding: 6px 10px; font-size: 0.85rem; width:100%;">
                </div>
            </div>
        </div>
        
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <h4 style="margin: 0; font-size: 0.88rem; font-weight: 800;">Danh sách Thành viên liên danh</h4>
            <button type="button" class="btn btn-primary btn-sm" id="btn-add-mothau-jv-member" style="padding: 4px 10px; font-size: 0.75rem;">
                + Thêm thành viên
            </button>
        </div>
        
        <div id="mothau-jv-members-list" style="display: flex; flex-direction: column; gap: 12px; max-height: 300px; overflow-y: auto; padding-right: 4px;">
            <!-- Member inputs dynamic list -->
        </div>
    `;const g=document.createElement("div");g.className="modal-footer",g.innerHTML=`
        <button type="button" class="btn btn-outline" id="btn-cancel-mothau-jv">Hủy</button>
        <button type="button" class="btn btn-primary" id="btn-save-mothau-jv">Xác nhận</button>
    `,e.appendChild(o),e.appendChild(l),e.appendChild(g),i.appendChild(e),document.body.appendChild(i);const s=document.getElementById("mothau-jv-members-list"),p=(v={tenNhaThau:"",maSoThue:""})=>{const b=document.createElement("div");b.className="mothau-jv-member-row",b.style.display="grid",b.style.gridTemplateColumns="1fr 1fr auto",b.style.gap="10px",b.style.alignItems="center",b.style.padding="8px",b.style.border="1px solid var(--border-color)",b.style.borderRadius="var(--radius-sm)",b.style.background="var(--bg-nested, rgba(0,0,0,0.02))",b.innerHTML=`
            <div class="form-group" style="margin-bottom: 0;">
                <input type="text" class="jv-input-mst" required placeholder="Mã số thuế / Mã nhà thầu" value="${v.maSoThue||""}" style="padding: 6px 10px; font-size: 0.85rem; width:100%;">
            </div>
            <div class="form-group" style="margin-bottom: 0;">
                <input type="text" class="jv-input-ten" required placeholder="Tên nhà thầu thành viên" value="${v.tenNhaThau||""}" style="padding: 6px 10px; font-size: 0.85rem; width:100%;">
            </div>
            <button type="button" class="action-btn btn-delete btn-remove-jv-row" style="padding: 6px; border:none; background:none;"><i data-lucide="trash-2" style="width: 14px; height: 14px;"></i></button>
        `,b.querySelector(".btn-remove-jv-row").onclick=()=>{b.remove()};const y=b.querySelector(".jv-input-mst"),w=b.querySelector(".jv-input-ten");y.addEventListener("blur",()=>{const x=y.value.trim();if(!x||w.value.trim())return;const L=h.find(T=>T.maNhaThau&&T.maNhaThau.trim().toLowerCase()===x.toLowerCase());L&&(w.value=L.tenNhaThau)}),s.appendChild(b),lucide.createIcons({root:b})};a.length>0?a.forEach(v=>p(v)):p(),document.getElementById("btn-add-mothau-jv-member").onclick=()=>p();const m=()=>i.remove();document.getElementById("btn-close-mothau-jv").onclick=m,document.getElementById("btn-cancel-mothau-jv").onclick=m,document.getElementById("btn-save-mothau-jv").onclick=()=>{const v=document.getElementById("jv-input-lead-name").value.trim();if(!v){window.appController.view.customAlert("Thiếu thông tin","Vui lòng nhập tên thành viên đứng đầu liên danh!","alert-triangle","#jv-input-lead-name");return}const b=s.querySelectorAll(".mothau-jv-member-row"),y=[],w=[];let x=!0;if(b.forEach(T=>{const N=T.querySelector(".jv-input-ten"),D=T.querySelector(".jv-input-mst"),P=(N==null?void 0:N.value.trim())||"",V=(D==null?void 0:D.value.trim())||"";P&&V?y.push({tenNhaThau:P,maSoThue:V}):(P||V)&&(x=!1,!P&&N&&w.push(N),!V&&D&&w.push(D))}),!x){window.appController.view.customAlert("Thiếu thông tin","Vui lòng điền đầy đủ cả Tên nhà thầu và Mã số thuế của Thành viên liên danh!","alert-triangle",w);return}u._leadMemberName=v,u._thanhVienLienDanh=y;const L=u.querySelector(".mt-jv-btn-text");L&&(L.textContent=`Thành viên liên danh (${y.length})`),m()},lucide.createIcons({root:i})};window.openMoThauJVViewModal=(u,t,a)=>{const n="modal-mothau-jv-view";let i=document.getElementById(n);i&&i.remove(),i=document.createElement("div"),i.id=n,i.className="modal-overlay active",i.style.zIndex="2000";const e=document.createElement("div");e.className="modal-card",e.style.maxWidth="600px",e.style.width="95%",e.style.margin="20px auto";const o=document.createElement("div");o.className="modal-header",o.innerHTML=`
        <h3>Thành viên liên danh</h3>
        <button class="modal-close" id="btn-close-mothau-jv-view">&times;</button>
    `;const l=document.createElement("div");l.className="modal-body",l.style.padding="20px";const h=t||"Chưa cập nhật",d=a||"Chưa cập nhật";let r="";u.length===0?r='<div style="text-align: center; color: var(--text-muted); padding: 12px;"><small>Không có Thành viên liên danh</small></div>':r=u.map((s,p)=>`
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-nested, rgba(0,0,0,0.01)); margin-bottom: 8px;">
                <div>
                    <div style="font-size: 0.72rem; color: var(--text-light); margin-bottom: 2px;">Mã số thuế / Mã nhà thầu</div>
                    <div style="font-size: 0.85rem; font-weight: 600;">${s.maSoThue||"--"}</div>
                </div>
                <div>
                    <div style="font-size: 0.72rem; color: var(--text-light); margin-bottom: 2px;">Tên thành viên ${p+2}</div>
                    <div style="font-size: 0.85rem; font-weight: 600;">${s.tenNhaThau||"--"}</div>
                </div>
            </div>
        `).join(""),l.innerHTML=`
        <div style="background: var(--primary-soft); padding: 12px 16px; border-radius: var(--radius-md); margin-bottom: 20px;">
            <div style="font-size: 0.78rem; font-weight: 800; color: var(--primary); text-transform: uppercase; margin-bottom: 8px;">Thành viên đứng đầu liên danh</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                <div>
                    <div style="font-size: 0.72rem; color: var(--text-light); margin-bottom: 2px;">Mã/MST thành viên đứng đầu</div>
                    <div style="font-size: 0.85rem; font-weight: 700; color: var(--primary);">${d}</div>
                </div>
                <div>
                    <div style="font-size: 0.72rem; color: var(--text-light); margin-bottom: 2px;">Tên thành viên đứng đầu</div>
                    <div style="font-size: 0.85rem; font-weight: 700; color: var(--primary);">${h}</div>
                </div>
            </div>
        </div>
        
        <h4 style="margin: 0 0 12px 0; font-size: 0.88rem; font-weight: 800;">Danh sách Thành viên liên danh</h4>
        <div style="display: flex; flex-direction: column; gap: 10px; max-height: 300px; overflow-y: auto; padding-right: 4px;">
            ${r}
        </div>
    `;const c=document.createElement("div");c.className="modal-footer",c.innerHTML=`
        <button type="button" class="btn btn-primary" id="btn-ok-mothau-jv-view">Đóng</button>
    `,e.appendChild(o),e.appendChild(l),e.appendChild(c),i.appendChild(e),document.body.appendChild(i);const g=()=>i.remove();document.getElementById("btn-close-mothau-jv-view").onclick=g,document.getElementById("btn-ok-mothau-jv-view").onclick=g};function ue(u,t,a={},n=!1){const i=document.getElementById("mothau-table-tbody");if(!i)return;const e=document.createElement("tr");e.setAttribute("data-id",a.id||window.generateUUID());let o=a.maNhaThau||"",l=a.tenNhaThau||"",h=a.loaiNhaThau||"Độc lập",d=a.thanhVienLienDanh||[];const r=this.model.getLatestNhaThau();let c=null;a.nhaThauId&&(c=r.find(S=>S.id===a.nhaThauId||S.rootId===a.nhaThauId)),!c&&o&&(c=r.find(S=>S.maNhaThau&&S.maNhaThau.trim().toLowerCase()===o.trim().toLowerCase())),c&&(o||(o=c.maNhaThau||""),h!=="Liên danh"&&(l=c.tenNhaThau||a.tenNhaThau||""),a.loaiNhaThau===void 0&&c.loaiNhaThau&&(h=c.loaiNhaThau),d.length===0&&c.thanhVienLienDanh&&(d=c.thanhVienLienDanh)),e._thanhVienLienDanh=(d||[]).filter(S=>S.vaiTro!=="Đứng đầu liên danh"&&S.maSoThue!==o);const g=(d||[]).find(S=>S.vaiTro==="Đứng đầu liên danh"||S.maSoThue&&String(S.maSoThue).toLowerCase().trim()===String(o).toLowerCase().trim());if(e._leadMemberName=g?g.tenNhaThau:"",!e._leadMemberName&&o){const S=r.find(M=>M.maNhaThau&&String(M.maNhaThau).toLowerCase().trim()===String(o).toLowerCase().trim());S&&(e._leadMemberName=S.tenNhaThau)}const s=n?`<span style="font-size:0.9rem;">${h}</span>`:`<select class="form-control mt-loai-nha-thau" required>
            <option value="Độc lập" ${h==="Độc lập"?"selected":""}>Độc lập</option>
            <option value="Liên danh" ${h==="Liên danh"?"selected":""}>Liên danh</option>
        </select>`,p=t.phanLoList||[],m=p.map(S=>`<option value="${S.maPhanLo}" data-name="${S.tenPhanLo}">${S.maPhanLo}</option>`).join("");let f="";const v=(a.thanhVienLienDanh||[]).length,b=n?h==="Liên danh"?`<div style="margin-top:4px; font-size:0.78rem;"><a href="#" class="mt-jv-view-link" style="color:var(--primary); text-decoration:none; font-weight:600; display:inline-flex; align-items:center; gap:4px;">👥 Liên danh ${v} thành viên</a></div>`:"":`<div class="mt-jv-members-container" style="margin-top: 4px; display: ${h==="Liên danh"?"block":"none"};">
            <button type="button" class="btn btn-outline btn-xs mt-btn-manage-members" style="padding: 2px 6px; font-size: 0.72rem; font-weight: 700; border-style: dashed; width: 100%; display: flex; align-items: center; justify-content: center; gap: 4px; color: var(--primary); border-color: var(--primary-soft);">
                <i data-lucide="users" style="width: 12px; height: 12px;"></i>
                <span class="mt-jv-btn-text">Thành viên liên danh (${v})</span>
            </button>
        </div>`;if(u==="TU_VAN")f=n?`
            <td>${s}</td>
            <td><span class="mt-ma-nha-thau">${o||a.maDinhDanh||"--"}</span></td>
            <td><span class="mt-ten-nha-thau">${l||"--"}</span>${b}</td>
            <td>${a.hieuLucHsdxt||(t.hieuLucHsdt?t.hieuLucHsdt+" ngày":"90 ngày")}</td>
            <td>${a.thoiGianThucHien||t.thoiGianThucHien||"--"}</td>
        `:`
            <td>${s}</td>
            <td><input type="text" class="form-control mt-ma-nha-thau mt-ma-dinh-danh" value="${o||a.maDinhDanh||""}" required placeholder="Mã nhà thầu"></td>
            <td>
                <input type="text" class="form-control mt-ten-nha-thau" value="${l}" required placeholder="Tên nhà thầu">
                ${b}
            </td>
            <td><input type="text" class="form-control mt-hieu-luc-hsdxt" value="${a.hieuLucHsdxt||(t.hieuLucHsdt?t.hieuLucHsdt+" ngày":"90 ngày")}" required placeholder="Hiệu lực"></td>
            <td><input type="text" class="form-control mt-thoi-gian-thuc-hien" value="${a.thoiGianThucHien||t.thoiGianThucHien||""}" required placeholder="Ví dụ: 120 ngày"></td>
            <td style="text-align: center;"><button class="action-btn btn-delete mt-remove-row"><i data-lucide="trash-2"></i></button></td>
        `;else if(u==="1G2T_NO_LOT")f=n?`
            <td>${s}</td>
            <td><span class="mt-ma-nha-thau">${o||a.maDinhDanh||"--"}</span></td>
            <td><span class="mt-ten-nha-thau">${l||"--"}</span>${b}</td>
            <td>${this.model.formatVND(a.damBaoDuThau)||this.model.formatVND(t.giaTriDamBaoDuThau)||"--"}</td>
            <td>${a.hieuLucDamBao||(t.hieuLucDamBaoDuThau?t.hieuLucDamBaoDuThau+" ngày":"120 ngày")}</td>
            <td>${a.hieuLucHsdxt||(t.hieuLucHsdt?t.hieuLucHsdt+" ngày":"90 ngày")}</td>
        `:`
            <td>${s}</td>
            <td><input type="text" class="form-control mt-ma-nha-thau mt-ma-dinh-danh" value="${o||a.maDinhDanh||""}" required placeholder="Mã nhà thầu"></td>
            <td>
                <input type="text" class="form-control mt-ten-nha-thau" value="${l}" required placeholder="Tên nhà thầu">
                ${b}
            </td>
            <td><input type="text" class="form-control mt-dam-bao-du-thau mt-format-vnd" value="${this.model.formatVND(a.damBaoDuThau)||this.model.formatVND(t.giaTriDamBaoDuThau)||""}" required placeholder="Số tiền ĐB"></td>
            <td><input type="text" class="form-control mt-hieu-luc-dam-bao" value="${a.hieuLucDamBao||(t.hieuLucDamBaoDuThau?t.hieuLucDamBaoDuThau+" ngày":"120 ngày")}" placeholder="Hiệu lực bảo đảm"></td>
            <td><input type="text" class="form-control mt-hieu-luc-hsdxt" value="${a.hieuLucHsdxt||(t.hieuLucHsdt?t.hieuLucHsdt+" ngày":"90 ngày")}" required placeholder="Hiệu lực"></td>
            <td style="text-align: center;"><button class="action-btn btn-delete mt-remove-row"><i data-lucide="trash-2"></i></button></td>
        `;else if(u==="1G2T_WITH_LOT"){let S="";if(a.maPhanLo){const M=p.find(z=>z.maPhanLo===a.maPhanLo);M&&(S=this.model.formatVND(M.baoDamDuThau)||"")}f=n?`
            <td>${a.maPhanLo||"--"}</td>
            <td>${a.tenPhanLo||"--"}</td>
            <td>${s}</td>
            <td><span class="mt-ma-nha-thau">${o||a.maDinhDanh||"--"}</span></td>
            <td><span class="mt-ten-nha-thau">${l||"--"}</span>${b}</td>
            <td>${this.model.formatVND(a.damBaoDuThau)||S||"--"}</td>
            <td>${a.hieuLucDamBao||(t.hieuLucDamBaoDuThau?t.hieuLucDamBaoDuThau+" ngày":"120 ngày")}</td>
            <td>${a.hieuLucHsdxt||(t.hieuLucHsdt?t.hieuLucHsdt+" ngày":"90 ngày")}</td>
        `:`
            <td>
                <select class="form-control mt-ma-phan-lo" required>
                    <option value="">-- Chọn Lot --</option>
                    ${m}
                </select>
            </td>
            <td><input type="text" class="form-control mt-ten-phan-lo" value="${a.tenPhanLo||""}" readonly placeholder="Tên lot"></td>
            <td>${s}</td>
            <td><input type="text" class="form-control mt-ma-nha-thau mt-ma-dinh-danh" value="${o||a.maDinhDanh||""}" required placeholder="Mã nhà thầu"></td>
            <td>
                <input type="text" class="form-control mt-ten-nha-thau" value="${l}" required placeholder="Tên nhà thầu">
                ${b}
            </td>
            <td><input type="text" class="form-control mt-dam-bao-du-thau mt-format-vnd" value="${this.model.formatVND(a.damBaoDuThau)||S}" required placeholder="Số tiền ĐB"></td>
            <td><input type="text" class="form-control mt-hieu-luc-dam-bao" value="${a.hieuLucDamBao||(t.hieuLucDamBaoDuThau?t.hieuLucDamBaoDuThau+" ngày":"120 ngày")}" placeholder="Hiệu lực ĐB"></td>
            <td><input type="text" class="form-control mt-hieu-luc-hsdxt" value="${a.hieuLucHsdxt||(t.hieuLucHsdt?t.hieuLucHsdt+" ngày":"90 ngày")}" required placeholder="Hiệu lực"></td>
            <td style="text-align: center;"><button class="action-btn btn-delete mt-remove-row"><i data-lucide="trash-2"></i></button></td>
        `}else if(u==="1G1T_NO_LOT")f=n?`
            <td>${s}</td>
            <td><span class="mt-ma-nha-thau">${o||a.maDinhDanh||"--"}</span></td>
            <td><span class="mt-ten-nha-thau">${l||"--"}</span>${b}</td>
            <td>${this.model.formatVND(a.giaDuThau)||"--"}</td>
            <td style="text-align:right;">${(a.tyLeGiamGia||0).toString().replace(".",",")}</td>
            <td>${this.model.formatVND(a.giaSauGiamGia)||"--"}</td>
            <td>${a.hieuLucHsdt||t.hieuLucHsdt,(a.hieuLucHsdt||t.hieuLucHsdt||90)+" ngày"}</td>
            <td>${this.model.formatVND(a.giaTriDamBao)||this.model.formatVND(t.giaTriDamBaoDuThau)||"--"}</td>
            <td style="text-align:right;">${a.hieuLucBaoDamNgay||t.hieuLucDamBaoDuThau,(a.hieuLucBaoDamNgay||t.hieuLucDamBaoDuThau||120)+" ngày"}</td>
            <td>${a.thoiGianThucHien||t.thoiGianThucHien||"--"}</td>
        `:`
            <td>${s}</td>
            <td><input type="text" class="form-control mt-ma-nha-thau mt-ma-dinh-danh" value="${o||a.maDinhDanh||""}" required placeholder="Mã nhà thầu"></td>
            <td>
                <input type="text" class="form-control mt-ten-nha-thau" value="${l}" required placeholder="Tên nhà thầu">
                ${b}
            </td>
            <td><input type="text" class="form-control mt-gia-du-thau mt-format-vnd" value="${this.model.formatVND(a.giaDuThau)||""}" required placeholder="Giá dự thầu"></td>
            <td><input type="text" class="form-control mt-ty-le-giam-gia" value="${(a.tyLeGiamGia||0).toString().replace(".",",")}" required style="text-align: right;" placeholder="Tỷ lệ %"></td>
            <td><input type="text" class="form-control mt-gia-sau-giam-gia mt-format-vnd" value="${this.model.formatVND(a.giaSauGiamGia)||""}" placeholder="Nhập giá"></td>
            <td><input type="text" class="form-control mt-hieu-luc-hsdt" value="${a.hieuLucHsdt?a.hieuLucHsdt+" ngày":t.hieuLucHsdt?t.hieuLucHsdt+" ngày":"90 ngày"}" required placeholder="Hiệu lực"></td>
            <td><input type="text" class="form-control mt-gia-tri-dam-bao mt-format-vnd" value="${this.model.formatVND(a.giaTriDamBao)||this.model.formatVND(t.giaTriDamBaoDuThau)||""}" required placeholder="Giá trị ĐB"></td>
            <td><input type="text" class="form-control mt-hieu-luc-bao-dam-ngay" value="${a.hieuLucBaoDamNgay?a.hieuLucBaoDamNgay+" ngày":t.hieuLucDamBaoDuThau?t.hieuLucDamBaoDuThau+" ngày":"120 ngày"}" required style="text-align: right;"></td>
            <td><input type="text" class="form-control mt-thoi-gian-thuc-hien" value="${a.thoiGianThucHien||t.thoiGianThucHien||""}" required placeholder="Thực hiện"></td>
            <td style="text-align: center;"><button class="action-btn btn-delete mt-remove-row"><i data-lucide="trash-2"></i></button></td>
        `;else if(u==="1G1T_WITH_LOT"){let S="";if(a.maPhanLo){const M=p.find(z=>z.maPhanLo===a.maPhanLo);M&&(S=this.model.formatVND(M.baoDamDuThau)||"")}f=n?`
            <td>${a.maPhanLo||"--"}</td>
            <td>${a.tenPhanLo||"--"}</td>
            <td>${s}</td>
            <td><span class="mt-ma-nha-thau">${o||a.maDinhDanh||"--"}</span></td>
            <td><span class="mt-ten-nha-thau">${l||"--"}</span>${b}</td>
            <td>${this.model.formatVND(a.giaDuThau)||"--"}</td>
            <td style="text-align:right;">${(a.tyLeGiamGia||0).toString().replace(".",",")}</td>
            <td>${this.model.formatVND(a.giaSauGiamGia)||"--"}</td>
            <td>${a.hieuLucHsdt||t.hieuLucHsdt,(a.hieuLucHsdt||t.hieuLucHsdt||90)+" ngày"}</td>
            <td>${this.model.formatVND(a.giaTriDamBao)||S||"--"}</td>
            <td style="text-align:right;">${a.hieuLucBaoDamNgay||t.hieuLucDamBaoDuThau,(a.hieuLucBaoDamNgay||t.hieuLucDamBaoDuThau||120)+" ngày"}</td>
            <td>${a.thoiGianThucHien||t.thoiGianThucHien||"--"}</td>
        `:`
            <td>
                <select class="form-control mt-ma-phan-lo" required>
                    <option value="">-- Chọn Lot --</option>
                    ${m}
                </select>
            </td>
            <td><input type="text" class="form-control mt-ten-phan-lo" value="${a.tenPhanLo||""}" readonly placeholder="Tên lot"></td>
            <td>${s}</td>
            <td><input type="text" class="form-control mt-ma-nha-thau mt-ma-dinh-danh" value="${o||a.maDinhDanh||""}" required placeholder="Mã nhà thầu"></td>
            <td>
                <input type="text" class="form-control mt-ten-nha-thau" value="${l}" required placeholder="Tên nhà thầu">
                ${b}
            </td>
            <td><input type="text" class="form-control mt-gia-du-thau mt-format-vnd" value="${this.model.formatVND(a.giaDuThau)||""}" required placeholder="Giá dự thầu"></td>
            <td><input type="text" class="form-control mt-ty-le-giam-gia" value="${(a.tyLeGiamGia||0).toString().replace(".",",")}" required style="text-align: right;" placeholder="Tỷ lệ %"></td>
            <td><input type="text" class="form-control mt-gia-sau-giam-gia mt-format-vnd" value="${this.model.formatVND(a.giaSauGiamGia)||""}" placeholder="Giá sau giảm"></td>
            <td><input type="text" class="form-control mt-hieu-luc-hsdt" value="${a.hieuLucHsdt?a.hieuLucHsdt+" ngày":t.hieuLucHsdt?t.hieuLucHsdt+" ngày":"90 ngày"}" required placeholder="Hiệu lực"></td>
            <td><input type="text" class="form-control mt-gia-tri-dam-bao mt-format-vnd" value="${this.model.formatVND(a.giaTriDamBao)||S}" required placeholder="Giá trị ĐB"></td>
            <td><input type="text" class="form-control mt-hieu-luc-bao-dam-ngay" value="${a.hieuLucBaoDamNgay?a.hieuLucBaoDamNgay+" ngày":t.hieuLucDamBaoDuThau?t.hieuLucDamBaoDuThau+" ngày":"120 ngày"}" required style="text-align: right;"></td>
            <td><input type="text" class="form-control mt-thoi-gian-thuc-hien" value="${a.thoiGianThucHien||t.thoiGianThucHien||""}" required placeholder="Thực hiện"></td>
            <td style="text-align: center;"><button class="action-btn btn-delete mt-remove-row"><i data-lucide="trash-2"></i></button></td>
        `}e.innerHTML=f;const y=e.querySelector(".mt-ma-phan-lo");y&&(a.maPhanLo&&(y.value=a.maPhanLo),y.addEventListener("change",()=>{const S=y.options[y.selectedIndex],M=e.querySelector(".mt-ten-phan-lo");M&&(M.value=S&&S.getAttribute("data-name")||"");const z=y.value,K=p.find(H=>H.maPhanLo===z);if(K){const H=e.querySelector(".mt-dam-bao-du-thau");H&&(H.value=this.model.formatVND(K.baoDamDuThau)||"");const q=e.querySelector(".mt-gia-tri-dam-bao");q&&(q.value=this.model.formatVND(K.baoDamDuThau)||"")}}));const w=e.querySelector(".mt-loai-nha-thau"),x=e.querySelector(".mt-jv-members-container");w&&x&&w.addEventListener("change",()=>{x.style.display=w.value==="Liên danh"?"block":"none"});const L=e.querySelector(".mt-btn-manage-members");L&&L.addEventListener("click",S=>{S.preventDefault(),window.openMoThauJVManager(e)});const T=e.querySelector(".mt-ma-nha-thau"),N=e.querySelector(".mt-ten-nha-thau");if(T&&N){const S=()=>{var H;const M=T.value.trim();if(!M)return;const K=this.model.getLatestNhaThau().find(q=>q.maNhaThau&&q.maNhaThau.trim().toLowerCase()===M.toLowerCase());K&&(N.value=K.tenNhaThau||"",((H=e.querySelector(".mt-loai-nha-thau"))==null?void 0:H.value)==="Liên danh"&&(e._leadMemberName=K.tenNhaThau||""))};T.addEventListener("input",S),T.addEventListener("change",S)}e.querySelectorAll(".mt-hieu-luc-hsdt, .mt-hieu-luc-hsdxt, .mt-hieu-luc-dam-bao, .mt-hieu-luc-bao-dam-ngay").forEach(S=>{S.addEventListener("focus",()=>{let M=S.value.trim();if(M){const z=parseInt(M.replace(/[^0-9]/g,""),10);isNaN(z)||(S.value=z)}}),S.addEventListener("blur",()=>{let M=S.value.trim();if(M){const z=parseInt(M.replace(/[^0-9]/g,""),10);isNaN(z)||(S.value=z+" ngày")}})}),e.querySelectorAll(".mt-format-vnd").forEach(S=>{S.addEventListener("input",M=>{const z=M.target.selectionStart,K=M.target.value.length;M.target.value=this.model.formatVND(M.target.value);const H=M.target.value.length;M.target.setSelectionRange(z+(H-K),z+(H-K))})});const D=()=>{const S=e.querySelector(".mt-gia-du-thau"),M=e.querySelector(".mt-ty-le-giam-gia"),z=e.querySelector(".mt-gia-sau-giam-gia");if(S&&M&&z){const K=this.model.parseVND(S.value),H=(M.value||"0").replace(/,/g,"."),q=parseFloat(H)||0,B=K*(1-q/100);z.value=this.model.formatVND(B)}},P=e.querySelector(".mt-gia-du-thau"),V=e.querySelector(".mt-ty-le-giam-gia");P&&P.addEventListener("input",D),V&&(V.addEventListener("input",S=>{let M=S.target.value.replace(/\./g,",");const z=M.split(",");if(z.length>2&&(M=z[0]+","+z.slice(1).join("").replace(/,/g,"")),M=M.replace(/[^0-9,]/g,""),S.target.value!==M){const K=S.target.selectionStart;S.target.value=M,S.target.setSelectionRange(K,K)}D()}),V.addEventListener("change",D));const at=e.querySelector(".mt-remove-row");at&&(at.onclick=async()=>{await this.view.customConfirm("Xác nhận xóa","Bạn có chắc chắn muốn gỡ nhà thầu này khỏi danh sách nộp hồ sơ?","trash-2")&&(e.remove(),i.children.length===0&&(this.addMoThauRow(u,t),lucide.createIcons()))}),i.appendChild(e);const nt=e.querySelector(".mt-jv-view-link");nt&&nt.addEventListener("click",S=>{S.preventDefault(),window.openMoThauJVViewModal(e._thanhVienLienDanh||[],e._leadMemberName||l,o)})}async function ge(){const u=document.getElementById("mothau-goithau-select");if(!u)return;const t=u.value;if(!t){await this.view.customAlert("Chưa chọn gói thầu","Vui lòng chọn một gói thầu để lưu!","alert-triangle");return}const a=this.model.state.goithau.find(s=>s.id===t);if(!a)return;const n=a.phuongThucLuaChon==="Một giai đoạn hai túi hồ sơ";let i=!1;if(a.danhGiaHsdtMetadata)try{const s=JSON.parse(a.danhGiaHsdtMetadata);n?i=!!(s.is1G2T&&s.technical&&s.technical.saved):i=!!s.saved}catch{}if(!(a.trangThai==="Đang mời thầu"||a.trangThai==="Đã mở thầu"||a.trangThai==="Đang chấm thầu"&&!i)){await this.view.customAlert("Không thể lưu",`Không thể chỉnh sửa biên bản mở thầu của gói thầu này vì trạng thái hiện tại là "${a.trangThai}" và giai đoạn tiếp theo đã hoàn tất.`,"x-circle");return}const o=document.querySelectorAll("#mothau-table-tbody tr");let l=!1;const h=[];if(o.forEach(s=>{const p=s.querySelector(".mt-ma-nha-thau"),m=s.querySelector(".mt-ten-nha-thau"),f=p?p.value.trim():"",v=m?m.value.trim():"";let b=!1;f||(b=!0,p&&h.push(p)),v||(b=!0,m&&h.push(m)),b?(l=!0,s.classList.add("invalid")):s.classList.remove("invalid")}),l){await this.view.customAlert("Thiếu dữ liệu","Vui lòng nhập đầy đủ Mã nhà thầu và Tên nhà thầu cho tất cả các dòng!","alert-triangle",h);return}const d=[],r=this.model.getLatestNhaThau();o.forEach(s=>{var O,I,A,F,tt,_,k,C,j,Q,W,U,Y;const p=s.getAttribute("data-id"),m=s.querySelector(".mt-ma-nha-thau"),f=s.querySelector(".mt-ten-nha-thau"),v=s.querySelector(".mt-loai-nha-thau"),b=m?m.value.trim():"",y=f?f.value.trim():"",w=v?v.value:"Độc lập";let x=r.find(et=>et.maNhaThau&&et.maNhaThau.trim().toLowerCase()===b.trim().toLowerCase());if(w==="Độc lập"){if(!x)x={id:window.generateUUID(),maNhaThau:b,tenNhaThau:y,loaiNhaThau:"Độc lập",maSoThue:b,nguoiDaiDien:"",danhXung:"Ông",soDienThoai:"",email:"",diaChi:"",soTaiKhoan:"",noiMoTaiKhoan:"",maNganHang:"",thanhVienLienDanh:[],phienBan:0},this.model.state.nhathau.push(x),this.model.persistData("nhathau"),r.push(x);else if(x.loaiNhaThau!=="Độc lập"){const et=this.model.state.nhathau.find(R=>R.id===x.id);et&&(et.loaiNhaThau="Độc lập",this.model.persistData("nhathau"))}}else{if(!x)x={id:window.generateUUID(),maNhaThau:b,tenNhaThau:s._leadMemberName||"Thành viên đứng đầu "+b,loaiNhaThau:"Độc lập",maSoThue:b,nguoiDaiDien:"",danhXung:"Ông",soDienThoai:"",email:"",diaChi:"",soTaiKhoan:"",noiMoTaiKhoan:"",maNganHang:"",thanhVienLienDanh:[],phienBan:0},this.model.state.nhathau.push(x),this.model.persistData("nhathau"),r.push(x);else if(s._leadMemberName){const R=this.model.state.nhathau.find(E=>E.id===x.id);R&&(R.tenNhaThau=s._leadMemberName,this.model.persistData("nhathau"))}(s._thanhVienLienDanh||[]).forEach(R=>{if(!R.maSoThue)return;let E=r.find(Z=>Z.maNhaThau&&Z.maNhaThau.trim().toLowerCase()===R.maSoThue.trim().toLowerCase());E||(E={id:window.generateUUID(),maNhaThau:R.maSoThue,tenNhaThau:R.tenNhaThau,loaiNhaThau:"Độc lập",maSoThue:R.maSoThue,nguoiDaiDien:R.nguoiDaiDien||"",danhXung:R.danhXung||"Ông",soDienThoai:R.soDienThoai||"",email:R.email||"",diaChi:R.diaChi||"",soTaiKhoan:R.soTaiKhoan||"",noiMoTaiKhoan:R.noiMoTaiKhoan||"",maNganHang:R.maNganHang||"",thanhVienLienDanh:[],phienBan:0},this.model.state.nhathau.push(E),this.model.persistData("nhathau"),r.push(E))})}const L=w==="Liên danh"?y:x?x.tenNhaThau:y,T=x.id,N=((O=s.querySelector(".mt-ma-dinh-danh"))==null?void 0:O.value.trim())||"",D=((I=s.querySelector(".mt-ma-phan-lo"))==null?void 0:I.value)||"",P=((A=s.querySelector(".mt-ten-phan-lo"))==null?void 0:A.value.trim())||"",V=this.model.parseVND(((F=s.querySelector(".mt-gia-du-thau"))==null?void 0:F.value)||""),at=this.model.parseVND(((tt=s.querySelector(".mt-dam-bao-du-thau"))==null?void 0:tt.value)||""),nt=((_=s.querySelector(".mt-hieu-luc-dam-bao"))==null?void 0:_.value.trim())||"",S=((k=s.querySelector(".mt-hieu-luc-hsdxt"))==null?void 0:k.value.trim())||"",M=((C=s.querySelector(".mt-ty-le-giam-gia"))==null?void 0:C.value)||"0",z=parseFloat(M.replace(/,/g,"."))||0,K=this.model.parseVND(((j=s.querySelector(".mt-gia-sau-giam-gia"))==null?void 0:j.value)||""),H=parseInt(((Q=s.querySelector(".mt-hieu-luc-hsdt"))==null?void 0:Q.value)||"0",10),q=this.model.parseVND(((W=s.querySelector(".mt-gia-tri-dam-bao"))==null?void 0:W.value)||""),B=parseInt(((U=s.querySelector(".mt-hieu-luc-bao-dam-ngay"))==null?void 0:U.value)||"0",10),G=((Y=s.querySelector(".mt-thoi-gian-thuc-hien"))==null?void 0:Y.value.trim())||"";let $=[];w==="Liên danh"&&($.push({tenNhaThau:s._leadMemberName||x.tenNhaThau||"Thành viên đứng đầu "+b,maSoThue:x&&x.maSoThue||"",vaiTro:"Đứng đầu liên danh"}),(s._thanhVienLienDanh||[]).filter(R=>String(R.maSoThue).toLowerCase().trim()!==String(b).toLowerCase().trim()&&R.vaiTro!=="Đứng đầu liên danh").forEach(R=>{$.push({tenNhaThau:R.tenNhaThau,maSoThue:R.maSoThue,vaiTro:"Thành viên liên danh"})})),d.push({id:p,goiThauId:t,nhaThauId:T,maPhanLo:D,tenPhanLo:P,maDinhDanh:N,giaDuThau:V,damBaoDuThau:at,hieuLucDamBao:nt,hieuLucHsdxt:S,tyLeGiamGia:z,giaSauGiamGia:K,hieuLucHsdt:H,giaTriDamBao:q,hieuLucBaoDamNgay:B,thoiGianThucHien:G,tenNhaThau:L,loaiNhaThau:w,thanhVienLienDanh:$})}),this.model.state.thongtinmothau=this.model.state.thongtinmothau.filter(s=>String(s.goiThauId)!==String(t)),this.model.state.thongtinmothau.push(...d),this.model.persistData("thongtinmothau"),a.trangThai="Đang chấm thầu",this.model.persistData("goithau");const c=n?"opening_tech":"opening";this.view._editingState&&(this.view._editingState[c]=!1),this.view.renderGoiThauTable(),this.autoSync(),await this.view.customAlert("Lưu thành công",`Đã lưu toàn bộ thông tin mở thầu (E-HSDT / E-HSĐXKT) của gói thầu "${a.tenGoiThau}" thành công! Trạng thái gói thầu đã được chuyển sang Đang chấm thầu.`,"check-circle"),this.renderMoThauPanel();const g=document.getElementById("tab-goithau-detail");g&&g.classList.contains("active")&&(this.view._currentWorkflowTab="eval_tech",this.view.showPackageDetails(t))}class Tt{constructor(t,a){this.model=t,this.view=a,window.appController=this,this.tempChuyenGiaImageBase64="",this.tempChuyenGiaSignatureBase64="",this.packageWizard={active:!1,planId:null,totalCount:0,currentCount:0},this.routeMap={dashboard:"tong-quan",kehoach:"ke-hoach",goithau:"goi-thau",mothau:"mothau",danhgiahsdt:"danh-gia-hsdt",hopdong:"hop-dong",chudautu:"chu-dau-tu",nhathau:"nha-thau",chuyengia:"chuyen-gia",bieumau:"bieu-mau","superadmin-dashboard":"tong-quan-admin",superadmin:"quan-ly-tai-khoan",managernhanvien:"nhan-su",managerhosogiay:"trang-thai-ho-so",profile:"trang-ca-nhan","goithau-detail":"goi-thau-chi-tiet","kehoach-detail":"ke-hoach-chi-tiet","hopdong-detail":"hop-dong-chi-tiet"},this.actionMap={taomoi:"tao-moi",chinhsua:"chinh-sua"},window.toggleSortTable=(n,i)=>{const e=this.model.sortState[n]||{field:"",order:"asc"};e.field===i?e.order=e.order==="asc"?"desc":"asc":(e.field=i,e.order="asc"),this.model.sortState[n]=e,n==="kehoach"?this.view.renderKeHoachTable():n==="goithau"?this.view.renderGoiThauTable():n==="chudautu"?this.view.renderChuDauTuTable():n==="nhathau"?this.view.renderNhaThauTable():n==="chuyengia"?this.view.renderChuyenGiaTable():n==="hopdong"&&this.view.renderHopDongTable()}}async init(){const t=window.fetch;window.fetch=async(i,e={})=>{const o=sessionStorage.getItem("bf_session_token"),l=sessionStorage.getItem("bf_username"),h=localStorage.getItem("bf_active_org");if(typeof i=="string"&&i.startsWith("/api/")&&o&&l&&(e.headers={...e.headers,"X-Session-Token":o,"X-Username":l,...h&&{"X-Active-Org":encodeURIComponent(h)}}),typeof i=="string"&&i.includes("/api/sync")&&e.method==="POST")try{let r={};e.body&&(r=typeof e.body=="string"?JSON.parse(e.body):e.body);const c=JSON.parse(localStorage.getItem("bf_local_deletions")||"[]");r.deletions=c,e.body=JSON.stringify(r)}catch(r){console.error("Failed to inject local deletions to sync request",r)}const d=await t(i,e);if(d.ok&&typeof i=="string"&&i.includes("/api/sync")&&e.method==="POST"&&localStorage.setItem("bf_local_deletions","[]"),d.status===403&&typeof i=="string"&&i.startsWith("/api/")&&!i.includes("/api/auth/login")&&!i.includes("/api/auth/check-session")){let r="Yêu cầu bị từ chối do không đủ quyền hạn hoặc vi phạm cấu hình hệ thống.",c=!1;try{const s=await d.clone().json();s&&s.error&&(r=s.error),r==="Không có quyền truy cập tổ chức này!"&&(localStorage.removeItem("bf_active_org"),localStorage.setItem("bf_last_sync_timestamp","0"),this.model.db&&this.model.db.stores&&this.model.db.stores.forEach(p=>{this.model.db.putTableData(p,[]).catch(()=>{}),this.model.state[p]&&(this.model.state[p]=[])})),(r==="Thiếu thông tin xác thực phiên làm việc!"||r==="Tài khoản không tồn tại!"||r==="Phiên làm việc đã hết hạn hoặc không hợp lệ!"||r==="Phiên đăng nhập đã hết hạn! Vui lòng đăng nhập lại.")&&(c=!0)}catch(g){console.error("Lỗi phân tích phản hồi 403:",g)}if(c){const g=document.getElementById("auth-overlay");if(g&&g.style.display!=="flex"){this.model.clearSessionData(),g.style.display="flex",document.querySelector(".app-container").style.filter="blur(10px)";const s=document.getElementById("form-auth-login"),p=document.getElementById("form-auth-register"),m=document.getElementById("form-auth-forgot");s&&(s.style.display="block"),p&&(p.style.display="none"),m&&(m.style.display="none")}return d}return r==="Không có quyền truy cập tổ chức này!"?await this.view.customAlert("⚠️ LỖI QUYỀN HẠN","Không có quyền truy cập tổ chức này!","log-out"):await this.view.customAlert("⚠️ LỖI QUYỀN HẠN (403)",`${r}

Nhấn Xác nhận để tải lại hệ thống.`,"log-out"),window.location.reload(),d}if(d.status===401&&typeof i=="string"&&i.startsWith("/api/")&&!i.includes("/api/auth/login")&&!i.includes("/api/auth/check-session")){const r=document.getElementById("auth-overlay");if(r&&r.style.display!=="flex"){this.model.clearSessionData(),r.style.display="flex",document.querySelector(".app-container").style.filter="blur(10px)";const c=document.getElementById("form-auth-login"),g=document.getElementById("form-auth-register"),s=document.getElementById("form-auth-forgot");c&&(c.style.display="block"),g&&(g.style.display="none"),s&&(s.style.display="none")}}return d},await this.model.init();const a=document.createElement("div");a.id="offline-indicator-banner",a.className="offline-banner",a.innerHTML='<i data-lucide="wifi-off"></i> Mất kết nối internet. Bạn đang làm việc offline.',document.body.appendChild(a),window.lucide&&window.lucide.createIcons({root:a});const n=()=>{navigator.onLine?a.classList.remove("visible"):(a.innerHTML='<i data-lucide="wifi-off"></i> Mất kết nối internet. Bạn đang làm việc offline.',window.lucide&&window.lucide.createIcons({root:a}),a.classList.add("visible"))};window.addEventListener("online",n),window.addEventListener("offline",n),n(),localStorage.getItem("bf_id_prefix_cleaned_v2")!=="true"&&(localStorage.setItem("bf_last_sync_timestamp","0"),this.model.db&&this.model.db.stores&&this.model.db.stores.forEach(i=>{this.model.db.putTableData(i,[]).catch(()=>{})}),localStorage.setItem("bf_id_prefix_cleaned_v2","true"),console.log("Client-side IndexedDB cache reset for ID prefix removal migration.")),this.view.initDOM(),this.setupAuth(),this.setupActivityTracker(),this.registerGlobals(),this.setupTheme(),this.setupSidebar(),this.setupTabs(),this.setupActionListeners(),this.setupConditionalUI(),this.setupFileUploads(),this.setupWordTemplatesEvents(),this.setupExcelImportEvents(),this.view.updateActiveUserProfileDisplay(),this.setupRBACEvents(),window.addEventListener("popstate",i=>{this.handlePathRouting(window.location.pathname,!1)}),this.handlePathRouting(window.location.pathname,!1,!0),this.forceSyncData();try{const i=await fetch("/api/auth/users");if(i.ok){const e=await i.json(),o=JSON.parse(localStorage.getItem("bf_employees")||"[]");this.model.state.employees=e.map(l=>{const h=o.find(d=>d.email&&d.email.trim().toLowerCase()===(l.email||"").trim().toLowerCase());return{id:l.id,username:l.username,name:h?h.name:l.name,email:l.email||"",phone:h?h.phone:"",role:l.role,package_id:l.package_id}}),this.model.persistData("employees"),this.view.populateNhanVienPhuTrachDropdowns()}}catch(i){console.error("Failed to load users for assignment dropdowns:",i)}try{const i=await fetch("/api/system-packages");if(i.ok){const e=await i.json(),o=JSON.parse(localStorage.getItem("bf_locked_system_packages")||"[]");e.forEach(l=>{l.isLocked=o.includes(l.id)}),this.model.state.systempackages=e,this.model.persistData("systempackages")}}catch(i){console.error("Failed to load system packages from SQLite:",i)}this.setupAutoSyncBackground()}registerGlobals(){window.changePlanRowVersion=(t,a)=>{this.model.state.selectedPlanVersion||(this.model.state.selectedPlanVersion={}),this.model.state.selectedPlanVersion[t]=a,this.view.renderKeHoachTable()},window.changePackageRowVersion=(t,a)=>{this.model.state.selectedPackageVersion||(this.model.state.selectedPackageVersion={}),this.model.state.selectedPackageVersion[t]=a,this.view.renderGoiThauTable()},window.changeChuDauTuRowVersion=(t,a)=>{this.model.state.selectedChuDauTuVersion||(this.model.state.selectedChuDauTuVersion={}),this.model.state.selectedChuDauTuVersion[t]=a,this.view.renderChuDauTuTable()},window.changeNhaThauRowVersion=(t,a)=>{this.model.state.selectedNhaThauVersion||(this.model.state.selectedNhaThauVersion={}),this.model.state.selectedNhaThauVersion[t]=a,this.view.renderNhaThauTable()},window.changeChuyenGiaRowVersion=(t,a)=>{this.model.state.selectedChuyenGiaVersion||(this.model.state.selectedChuyenGiaVersion={}),this.model.state.selectedChuyenGiaVersion[t]=a,this.view.renderChuyenGiaTable()},window.changeHopDongRowVersion=(t,a)=>{this.model.state.selectedHopDongVersion||(this.model.state.selectedHopDongVersion={}),this.model.state.selectedHopDongVersion[t]=a,this.view.renderHopDongTable()},window.showPackageDetails=t=>this.view.showPackageDetails(t),window.showKeHoachDetails=t=>this.view.showKeHoachDetails(t),window.showHopDongDetails=t=>this.view.showHopDongDetails(t),window.showChuyenGiaDetails=t=>this.view.showChuyenGiaDetails(t),window.zoomCertificateImage=t=>{const a=this.model.state.chuyengia.find(i=>i.id===t);if(!a||!a.anhChungChi)return;const n=document.createElement("div");n.className="certificate-lightbox",n.innerHTML=`<img src="${a.anhChungChi}" alt="Chứng chỉ Zoom">`,n.onclick=()=>n.remove(),document.body.appendChild(n)},window.zoomSignatureImage=t=>{const a=this.model.state.chuyengia.find(i=>i.id===t);if(!a||!a.anhChuKy)return;const n=document.createElement("div");n.className="certificate-lightbox",n.innerHTML=`<img src="${a.anhChuKy}" alt="Chữ ký Zoom" style="max-height:60vh; background:#fff; padding:24px; border-radius:12px;">`,n.onclick=()=>n.remove(),document.body.appendChild(n)},window.editKeHoach=t=>this.editKeHoach(t),window.deleteKeHoach=t=>this.deleteKeHoach(t),window.addBreakdownRow=t=>this.addBreakdownRow(t),window.removeBreakdownRow=(t,a)=>this.removeBreakdownRow(t,a),window.editGoiThau=(t,a=!1)=>this.editGoiThau(t,a),window.deleteGoiThau=t=>this.deleteGoiThau(t),window.addGiaHanRow=t=>this.addGiaHanRow(t),window.validateGiaHanRealtime=()=>this.validateGiaHanRealtime(),window.moThauGoiThau=t=>this.moThauGoiThau(t),window.phatHanhHsmtGoiThau=t=>this.phatHanhHsmtGoiThau(t),window.enforceSingleLeader=(t,a)=>this.enforceSingleLeader(t,a),window.editChuDauTu=t=>this.editChuDauTu(t),window.deleteChuDauTu=t=>this.deleteChuDauTu(t),window.editNhaThau=(t,a=!1)=>this.editNhaThau(t,a),window.deleteNhaThau=t=>this.deleteNhaThau(t),window.editChuyenGia=t=>this.editChuyenGia(t),window.deleteChuyenGia=t=>this.deleteChuyenGia(t),window.editHopDong=t=>this.editHopDong(t),window.deleteHopDong=t=>this.deleteHopDong(t),window.exportContractFromHopDong=(t,a)=>{const n=t,i=document.querySelector(`button[onclick*="${t}"][onclick*="${a}"]`),e=i?i.innerHTML:"";i&&(i.disabled=!0,i.innerHTML='<i data-lucide="loader-2" class="animate-spin" style="width:14px;height:14px;"></i>',lucide.createIcons({root:i})),fetch("/api/sync",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({goithau:this.model.state.goithau,hopdong:this.model.state.hopdong})}).then(o=>{if(!o.ok)throw new Error("Không thể đồng bộ dữ liệu");return fetch(`/api/export-report/${n}?type=contract`)}).then(o=>{if(!o.ok)throw new Error("Không thể xuất hợp đồng");return o.blob()}).then(o=>{const l=window.URL.createObjectURL(o),h=document.createElement("a");h.href=l,h.download=`Hop_dong_${a||"LCNT"}.docx`,document.body.appendChild(h),h.click(),h.remove(),window.URL.revokeObjectURL(l)}).catch(o=>{this.view.customAlert("Lỗi xuất hợp đồng",o.message,"x-circle")}).finally(()=>{i&&(i.disabled=!1,i.innerHTML=e,lucide.createIcons({root:i}))})},window.addJointVentureMemberCard=t=>this.addJointVentureMemberCard(t),window.removeJointVentureMemberCard=t=>this.removeJointVentureMemberCard(t),window.switchTab=(t,a=null,n=!0)=>this.switchTab(t,a,n),window.toggleOrgLock=t=>this.toggleOrgLock(t),window.renewOrgSubscription=t=>this.renewOrgSubscription(t),window.editPackageQuota=(t,a)=>this.editPackageQuota(t,a),window.editSystemPackage=t=>this.editSystemPackage(t),window.togglePackageLock=t=>this.togglePackageLock(t),window.editEmployee=t=>this.editEmployee(t),window.deleteEmployee=t=>this.deleteEmployee(t),window.editHoSoGiayStatus=t=>this.editHoSoGiayStatus(t),window.deleteHoSoGiayStatus=t=>this.deleteHoSoGiayStatus(t),window.triggerUpgradePrompt=()=>this.triggerUpgradePrompt(),window.deleteSystemUser=(t,a)=>this.deleteSystemUser(t,a),window.changeUserRole=(t,a)=>this.changeUserRole(t,a),window.changeUserPackage=(t,a)=>this.changeUserPackage(t,a),window.toggleUserPackage=(t,a,n)=>this.toggleUserPackage(t,a,n),window.updateUserMetadata=(t,a,n)=>this.updateUserMetadata(t,a,n),window.showSystemUserDetail=t=>this.showSystemUserDetail(t),window.renderTablePagination=(t,a,n,i)=>{const e=document.getElementById(t);if(!e)return;const o=Math.ceil(a/i)||1;n>o&&(n=o);const l=a===0?0:(n-1)*i+1,h=Math.min(n*i,a);let d=`
                <div class="pagination-info">
                    Hiển thị <strong>${l}-${h}</strong> trên tổng số <strong>${a}</strong> bản ghi
                </div>
                <div class="pagination-buttons">
                    <button class="pagination-btn" ${n===1?"disabled":""} onclick="window.handlePageChange('${t}', 1)" title="Trang đầu">
                        <i data-lucide="chevrons-left" style="width:14px; height:14px;"></i>
                    </button>
                    <button class="pagination-btn" ${n===1?"disabled":""} onclick="window.handlePageChange('${t}', ${n-1})" title="Trang trước">
                        <i data-lucide="chevron-left" style="width:14px; height:14px;"></i>
                    </button>
            `;const r=5;let c=Math.max(1,n-Math.floor(r/2)),g=Math.min(o,c+r-1);g-c+1<r&&(c=Math.max(1,g-r+1));for(let s=c;s<=g;s++)d+=`
                    <button class="pagination-btn ${s===n?"active":""}" onclick="window.handlePageChange('${t}', ${s})">
                        ${s}
                    </button>
                `;d+=`
                    <button class="pagination-btn" ${n===o?"disabled":""} onclick="window.handlePageChange('${t}', ${n+1})" title="Trang sau">
                        <i data-lucide="chevron-right" style="width:14px; height:14px;"></i>
                    </button>
                    <button class="pagination-btn" ${n===o?"disabled":""} onclick="window.handlePageChange('${t}', ${o})" title="Trang cuối">
                        <i data-lucide="chevrons-right" style="width:14px; height:14px;"></i>
                    </button>
                </div>
            `,e.innerHTML=d,lucide.createIcons({root:e})},window.handlePageChange=(t,a)=>{const n=t.split("-")[0];this.model.currentPage[n]=a,this.model.savePage(n),n==="kehoach"?this.view.renderKeHoachTable():n==="goithau"?this.view.renderGoiThauTable():n==="chudautu"?this.view.renderChuDauTuTable():n==="nhathau"?this.view.renderNhaThauTable():n==="chuyengia"?this.view.renderChuyenGiaTable():n==="hopdong"&&this.view.renderHopDongTable()}}}const se=Promise.all([ut(()=>import("../assets/AuthController-c2891ffe.js"),[]),ut(()=>import("../assets/AdminUserController-87b648b1.js"),[]),ut(()=>import("../assets/BiddingWorkflows-77b600a2.js"),[]),ut(()=>import("../assets/PartnerWorkflows-bdade873.js"),[]),ut(()=>import("../assets/BiddingControllerUI-e542f348.js"),[]),ut(()=>import("../assets/BiddingControllerForms-942c6150.js"),[]),ut(()=>import("../assets/BiddingControllerSync-dc97ab0f.js"),[])]);window.addEventListener("DOMContentLoaded",async()=>{const[u,t,a,n,i,e,o]=await se;Object.assign(Tt.prototype,{...u,...t,...a,...n,...i,...e,...o});const l=new yt,h=new wt(l);new Tt(l,h).init()});export{ue as a,he as h,re as m,de as p,ce as r,ge as s};
