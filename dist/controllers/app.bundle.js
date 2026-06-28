var Lt=Object.defineProperty;var _t=(c,t,a)=>t in c?Lt(c,t,{enumerable:!0,configurable:!0,writable:!0,value:a}):c[t]=a;var vt=(c,t,a)=>(_t(c,typeof t!="symbol"?t+"":t,a),a);const $t="modulepreload",kt=function(c){return"/"+c},bt={},ut=function(t,a,n){if(!a||a.length===0)return t();const i=document.getElementsByTagName("link");return Promise.all(a.map(e=>{if(e=kt(e),e in bt)return;bt[e]=!0;const o=e.endsWith(".css"),l=o?'[rel="stylesheet"]':"";if(!!n)for(let r=i.length-1;r>=0;r--){const h=i[r];if(h.href===e&&(!o||h.rel==="stylesheet"))return}else if(document.querySelector(`link[href="${e}"]${l}`))return;const d=document.createElement("link");if(d.rel=o?"stylesheet":$t,o||(d.as="script",d.crossOrigin=""),d.href=e,document.head.appendChild(d),o)return new Promise((r,h)=>{d.addEventListener("load",r),d.addEventListener("error",()=>h(new Error(`Unable to preload CSS for ${e}`)))})})).then(()=>t()).catch(e=>{const o=new Event("vite:preloadError",{cancelable:!0});if(o.payload=e,window.dispatchEvent(o),!o.defaultPrevented)throw e})};window.generateUUID=function(){return typeof crypto<"u"&&typeof crypto.randomUUID=="function"?crypto.randomUUID():"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,function(c){const t=Math.random()*16|0;return(c==="x"?t:t&3|8).toString(16)})};window.escapeHTML=function(c){return c==null?"":String(c).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")};class mt{constructor(t="BiddingFlowDB"){this.dbName=t,this.db=null,this.stores=["chudautu","nhathau","chuyengia","kehoach","goithau","hopdong","systempackages","organizations","employees","permissionmatrix","custompaperstatuses","assignments","thongtinmothau","kv_store"]}init(){return new Promise((t,a)=>{const n=indexedDB.open(this.dbName,2);n.onupgradeneeded=i=>{const e=i.target.result;this.stores.forEach(o=>{e.objectStoreNames.contains(o)||e.createObjectStore(o,o==="kv_store"?{}:{keyPath:"id"})})},n.onsuccess=i=>{this.db=i.target.result,t(this)},n.onerror=i=>{a(i.target.error)}})}get(t){return new Promise(a=>{if(!this.db)return a(null);try{const e=this.db.transaction("kv_store","readonly").objectStore("kv_store").get(t);e.onsuccess=()=>a(e.result),e.onerror=()=>a(null)}catch{a(null)}})}set(t,a){return new Promise((n,i)=>{if(!this.db)return i("Database not initialized");try{const l=this.db.transaction("kv_store","readwrite").objectStore("kv_store").put(a,t);l.onsuccess=()=>n(),l.onerror=()=>i(l.error)}catch(e){i(e)}})}getTableData(t){return new Promise(a=>{if(!this.db||!this.db.objectStoreNames.contains(t))return a([]);try{const e=this.db.transaction(t,"readonly").objectStore(t).getAll();e.onsuccess=()=>a(e.result||[]),e.onerror=()=>a([])}catch{a([])}})}putTableData(t,a){return new Promise((n,i)=>{if(!this.db||!this.db.objectStoreNames.contains(t))return n();try{const e=this.db.transaction(t,"readwrite"),o=e.objectStore(t),l=o.getAllKeys();l.onsuccess=()=>{const u=new Set(l.result||[]),d=new Set((a||[]).map(r=>r.id));u.forEach(r=>{d.has(r)||o.delete(r)}),(a||[]).forEach(r=>{o.put(r)})},e.oncomplete=()=>n(),e.onerror=u=>i(u.target.error)}catch(e){i(e)}})}putRecord(t,a){return new Promise((n,i)=>{if(!this.db||!this.db.objectStoreNames.contains(t))return n();try{const l=this.db.transaction(t,"readwrite").objectStore(t).put(a);l.onsuccess=()=>n(),l.onerror=()=>i(l.error)}catch(e){i(e)}})}deleteRecord(t,a){return new Promise((n,i)=>{if(!this.db||!this.db.objectStoreNames.contains(t))return n();try{const l=this.db.transaction(t,"readwrite").objectStore(t).delete(a);l.onsuccess=()=>n(),l.onerror=()=>i(l.error)}catch(e){i(e)}})}putRecords(t,a){return new Promise((n,i)=>{if(!this.db||!this.db.objectStoreNames.contains(t))return n();try{const e=this.db.transaction(t,"readwrite"),o=e.objectStore(t);(a||[]).forEach(l=>{o.put(l)}),e.oncomplete=()=>n(),e.onerror=l=>i(l.target.error)}catch(e){i(e)}})}deleteRecords(t,a){return new Promise((n,i)=>{if(!this.db||!this.db.objectStoreNames.contains(t))return n();try{const e=this.db.transaction(t,"readwrite"),o=e.objectStore(t);(a||[]).forEach(l=>{o.delete(l)}),e.oncomplete=()=>n(),e.onerror=l=>i(l.target.error)}catch(e){i(e)}})}}const pt=class pt{constructor(){this.db=new mt,this.STORAGE_KEYS={CHUDAUTU:"bf_chudautu",NHATHAU:"bf_nhathau",CHUYENGIA:"bf_chuyengia",KEHOACH:"bf_kehoach",GOITHAU:"bf_goithau",HOPDONG:"bf_hopdong",THEME:"bf_dark_mode",USERID:"bf_user_id",ACTIVEROLE:"bf_active_role",ACTIVEUSER:"bf_active_user",ORGANIZATIONS:"bf_organizations",EMPLOYEES:"bf_employees",PERMISSIONMATRIX:"bf_permission_matrix",CUSTOMPAPERSTATUSES:"bf_custom_paper_statuses",ASSIGNMENTS:"bf_assignments",SYSTEMPACKAGES:"bf_system_packages",THONGTINMOTHAU:"bf_thong_tin_mo_thau"},this.state={chudautu:[],nhathau:[],chuyengia:[],kehoach:[],goithau:[],hopdong:[],systempackages:[],selectedPlanVersion:{},selectedPackageVersion:{},organizations:[],employees:[],permissionmatrix:[],custompaperstatuses:[],assignments:[]},this.sortState={kehoach:{field:"maKeHoach",order:"asc"},goithau:{field:"maGoiThau",order:"asc"},chudautu:{field:"tenChuDauTu",order:"asc"},nhathau:{field:"tenNhaThau",order:"asc"},chuyengia:{field:"hoTen",order:"asc"},hopdong:{field:"tenHopDong",order:"asc"}};const t=(()=>{try{return JSON.parse(sessionStorage.getItem("bf_current_pages")||"{}")}catch{return{}}})();this.currentPage={kehoach:t.kehoach||1,goithau:t.goithau||1,chudautu:t.chudautu||1,nhathau:t.nhathau||1,chuyengia:t.chuyengia||1,hopdong:t.hopdong||1},this.pageSize=10}savePage(t){try{const a=JSON.parse(sessionStorage.getItem("bf_current_pages")||"{}");a[t]=this.currentPage[t]||1,sessionStorage.setItem("bf_current_pages",JSON.stringify(a))}catch{}}async init(){const t=sessionStorage.getItem("bf_user_id");if(t){const e=String(t).replace(/[^a-zA-Z0-9_-]/g,"");this.db=new mt(`BiddingFlowDB_${e}`)}else this.db=new mt;await this.db.init();let a=!1;try{a=localStorage.getItem("bf_migrated_v5_clean")==="true"}catch{}if(!a){for(const e of Object.keys(this.STORAGE_KEYS))if(e!=="THEME")try{const o=localStorage.getItem(this.STORAGE_KEYS[e]);if(o){const l=JSON.parse(o);await this.db.set(this.STORAGE_KEYS[e],l)}}catch(o){console.error("Failed to migrate key during startup:",e,o)}try{localStorage.setItem("bf_migrated_v5_clean","true")}catch{}}for(const e of Object.keys(this.STORAGE_KEYS)){if(e==="THEME"||e==="ACTIVEROLE"||e==="ACTIVEUSER")continue;const o=e.toLowerCase();try{let l;if(this.db.stores.includes(o)){if(l=await this.db.getTableData(o),!l||l.length===0){const u=await this.db.get(this.STORAGE_KEYS[e]);u&&u.length>0&&(l=u,await this.db.putTableData(o,l))}}else l=await this.db.get(this.STORAGE_KEYS[e]);l?this.state[o]=l:(this.state[o]=[],this.db.stores.includes(o)?await this.db.putTableData(o,[]):await this.db.set(this.STORAGE_KEYS[e],[]))}catch{this.state[o]=[]}}this.state.systempackages||(this.state.systempackages=[]);let n=null,i=null;try{const e=sessionStorage.getItem(this.STORAGE_KEYS.ACTIVEROLE),o=sessionStorage.getItem(this.STORAGE_KEYS.ACTIVEUSER);e&&(n=JSON.parse(e)),o&&(i=JSON.parse(o))}catch(e){console.error("Lỗi đọc active role/user từ localStorage:",e)}if(!n||!i)try{n=n||await this.db.get(this.STORAGE_KEYS.ACTIVEROLE),i=i||await this.db.get(this.STORAGE_KEYS.ACTIVEUSER)}catch{}try{this.state.activerole=n||"super_admin"}catch{this.state.activerole="super_admin"}try{this.state.activeuser=i||{name:"Admin",title:"Hệ thống",id:"sa-1"}}catch{this.state.activeuser={name:"Admin",title:"Hệ thống",id:"sa-1"}}}async trackDeletions(t){try{const a=await this.db.getTableData(t);if(Array.isArray(a)&&Array.isArray(this.state[t])){const n=new Set(this.state[t].map(e=>e.id).filter(Boolean)),i=a.map(e=>e.id).filter(e=>e&&!n.has(e));if(i.length>0){let e=[];try{e=JSON.parse(localStorage.getItem("bf_local_deletions")||"[]")}catch{e=[]}i.forEach(o=>{e.some(l=>l.id===o&&l.table===t)||e.push({table:t,id:o})}),localStorage.setItem("bf_local_deletions",JSON.stringify(e))}}}catch(a){console.error("Error checking deletions in trackDeletions:",a)}}async persistData(t){const a=t.toUpperCase();if(this.STORAGE_KEYS[a])if(this.db.stores.includes(t)){await this.trackDeletions(t);try{await this.db.putTableData(t,this.state[t])}catch(n){console.error("Failed to persist data for type:",t,n)}}else try{await this.db.set(this.STORAGE_KEYS[a],this.state[t])}catch(n){console.error("Failed to persist data for type:",t,n)}}async addRecord(t,a){this.state[t]||(this.state[t]=[]),this.state[t].push(a),this.db.stores.includes(t)?await this.db.putRecord(t,a):this.persistData(t)}async updateRecord(t,a){this.state[t]||(this.state[t]=[]);const n=this.state[t].findIndex(i=>i.id===a.id);n!==-1?this.state[t][n]=a:this.state[t].push(a),this.db.stores.includes(t)?await this.db.putRecord(t,a):this.persistData(t)}async deleteRecord(t,a){this.state[t]&&(this.state[t]=this.state[t].filter(i=>i.id!==a));let n=[];try{n=JSON.parse(localStorage.getItem("bf_local_deletions")||"[]")}catch{n=[]}n.some(i=>i.id===a&&i.table===t)||(n.push({table:t,id:a}),localStorage.setItem("bf_local_deletions",JSON.stringify(n))),this.db.stores.includes(t)?await this.db.deleteRecord(t,a):this.persistData(t)}switchActiveRole(t,a,n){this.state.activerole=t;let i="Chuyên viên";t==="super_admin"?i="Super Admin":t==="manager"&&(i="Quản lý"),this.state.activeuser={...this.state.activeuser||{},name:a,title:i,id:n},sessionStorage.setItem(this.STORAGE_KEYS.ACTIVEROLE,JSON.stringify(this.state.activerole)),sessionStorage.setItem(this.STORAGE_KEYS.ACTIVEUSER,JSON.stringify(this.state.activeuser))}clearSessionData(){Object.keys(this.STORAGE_KEYS).forEach(t=>{t!=="THEME"&&localStorage.removeItem(this.STORAGE_KEYS[t])}),sessionStorage.removeItem("bf_session_token"),sessionStorage.removeItem("bf_username"),Object.keys(this.state).forEach(t=>{Array.isArray(this.state[t])?this.state[t]=[]:typeof this.state[t]=="object"&&this.state[t]!==null&&(this.state[t]={})}),this.state.activerole=null,this.state.activeuser=null}hasEffectiveRole(t,a){const i=(typeof t=="string"?t:t&&t.role?t.role:"").split(",").map(o=>o.trim()).filter(Boolean);return new Set(i.flatMap(o=>pt.ROLE_HIERARCHY[o]||[o])).has(a)}hasActiveEffectiveRole(t){return this.hasEffectiveRole(this.state.activerole,t)}static getEffectiveRoles(t){const a=(t||"").split(",").map(i=>i.trim()).filter(Boolean);return new Set(a.flatMap(i=>pt.ROLE_HIERARCHY[i]||[i]))}hasPermission(t,a,n){if(this.hasActiveEffectiveRole("manager"))return!0;const i=this.state.permissionmatrix.find(o=>o.empId===t);if(!i)return!1;const e=i[a];return e?n==="edit"?e==="edit":e==="view"||e==="edit":!1}isAssigned(t,a,n){if(this.hasActiveEffectiveRole("manager"))return!0;const i=String(t).replace(/^(emp-|user-|sa-|mgr-)+/,""),e=String(a).replace(/^(gt-|hd-)+/,"");return this.state.assignments.some(o=>String(o.empId).replace(/^(emp-|user-|sa-|mgr-)+/,"")===i&&String(o.targetId).replace(/^(gt-|hd-)+/,"")===e&&o.type===n)}getFilteredKeHoach(){const t=this.getLatestPlans();if(this.hasActiveEffectiveRole("manager"))return t;const a=this.state.activeuser.id,n=String(a).replace(/^(emp-|user-|sa-|mgr-)+/,""),i=this.state.assignments.filter(e=>String(e.empId).replace(/^(emp-|user-|sa-|mgr-)+/,"")===n&&e.type==="goithau").map(e=>String(e.targetId).replace(/^(gt-|hd-)+/,""));return t.filter(e=>this.state.goithau.filter(l=>l.keHoachId===e.id).some(l=>i.includes(String(l.id).replace(/^(gt-|hd-)+/,""))))}getFilteredGoiThau(){const t=this.getLatestPackages();if(this.hasActiveEffectiveRole("manager"))return t;const a=this.state.activeuser.id;return t.filter(n=>this.isAssigned(a,n.id,"goithau"))}getFilteredHopDong(){const t=this.state.hopdong||[];if(this.hasActiveEffectiveRole("manager"))return t;const a=this.state.activeuser.id;return t.filter(n=>this.isAssigned(a,n.id,"hopdong"))}formatCurrency(t){if(t==null||t===""||isNaN(t))return"--";const i=(t%1!==0?t.toFixed(2):t.toFixed(0)).split("."),e=i[0].replace(/\B(?=(\d{3})+(?!\d))/g,"."),o=i[1]?","+i[1]:"";return e+o+" VND"}formatVND(t){if(t==null)return"";let a=t.toString().trim();if(!a)return"";typeof t=="number"&&(a=t.toString().replace(".",","));const n=a.split(",");let i=n[0],e=n.length>1?n[1]:null;if(i=i.replace(/\D/g,""),!i&&e===null)return"";i||(i="0");const o=parseInt(i,10).toLocaleString("vi-VN");return e!==null?(e=e.replace(/\D/g,""),o+","+e):o}parseVND(t){if(t==null)return null;let a=t.toString().trim();if(!a)return null;a=a.replace(/\./g,""),a=a.replace(/,/g,".");const n=parseFloat(a);return isNaN(n)?null:n}formatDate(t){if(!t)return"--";let a=null,n=null,i=null,e="00",o="00",l=!1;if(t instanceof Date){const u=t;i=String(u.getDate()).padStart(2,"0"),n=String(u.getMonth()+1).padStart(2,"0"),a=u.getFullYear(),e=String(u.getHours()).padStart(2,"0"),o=String(u.getMinutes()).padStart(2,"0"),l=u.getHours()!==0||u.getMinutes()!==0}else{const u=String(t).replace(/\s*-\s*/," ").trim(),d=u.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/),r=u.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[T\s](\d{2}):(\d{2}))?/);if(d)a=d[1],n=d[2],i=d[3],d[4]!==void 0&&(e=d[4],o=d[5],l=!0);else if(r)i=r[1],n=r[2],a=r[3],r[4]!==void 0&&(e=r[4],o=r[5],l=!0);else{const h=new Date(t);if(isNaN(h.getTime()))return t;i=String(h.getDate()).padStart(2,"0"),n=String(h.getMonth()+1).padStart(2,"0"),a=h.getFullYear(),e=String(h.getHours()).padStart(2,"0"),o=String(h.getMinutes()).padStart(2,"0"),l=/[T\s]\d{1,2}:\d{2}/.test(t)}}return l?`${i}/${n}/${a} ${e}:${o}`:`${i}/${n}/${a}`}formatDateWithTime(t){if(!t)return"--";let a=null,n=null,i=null,e="00",o="00";if(t instanceof Date){const l=t;i=String(l.getDate()).padStart(2,"0"),n=String(l.getMonth()+1).padStart(2,"0"),a=l.getFullYear(),e=String(l.getHours()).padStart(2,"0"),o=String(l.getMinutes()).padStart(2,"0")}else{const l=String(t).replace(/\s*-\s*/," ").trim(),u=l.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/),d=l.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[T\s](\d{2}):(\d{2}))?/);if(u)a=u[1],n=u[2],i=u[3],u[4]!==void 0&&(e=u[4],o=u[5]);else if(d)i=d[1],n=d[2],a=d[3],d[4]!==void 0&&(e=d[4],o=d[5]);else{const r=new Date(t);if(isNaN(r.getTime()))return t;i=String(r.getDate()).padStart(2,"0"),n=String(r.getMonth()+1).padStart(2,"0"),a=r.getFullYear(),e=String(r.getHours()).padStart(2,"0"),o=String(r.getMinutes()).padStart(2,"0")}}return`${i}/${n}/${a} ${e}:${o}`}formatForDateInput(t){if(!t)return"";let a=null,n=null,i=null;if(t instanceof Date){const e=t;i=String(e.getDate()).padStart(2,"0"),n=String(e.getMonth()+1).padStart(2,"0"),a=e.getFullYear()}else{const e=String(t).replace(/\s*-\s*/," ").trim(),o=e.match(/^(\d{4})-(\d{2})-(\d{2})/),l=e.match(/^(\d{2})\/(\d{2})\/(\d{4})/);if(o)a=o[1],n=o[2],i=o[3];else if(l)i=l[1],n=l[2],a=l[3];else{const u=new Date(t);if(isNaN(u.getTime()))return"";i=String(u.getDate()).padStart(2,"0"),n=String(u.getMonth()+1).padStart(2,"0"),a=u.getFullYear()}}return`${a}-${n}-${i}`}formatForDatetimeLocal(t){if(!t)return"";let a=null,n=null,i=null,e="00",o="00";if(t instanceof Date){const l=t;i=String(l.getDate()).padStart(2,"0"),n=String(l.getMonth()+1).padStart(2,"0"),a=l.getFullYear(),e=String(l.getHours()).padStart(2,"0"),o=String(l.getMinutes()).padStart(2,"0")}else{const l=String(t).replace(/\s*-\s*/," ").trim(),u=l.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/),d=l.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[T\s](\d{2}):(\d{2}))?/);if(u)a=u[1],n=u[2],i=u[3],u[4]!==void 0&&(e=u[4],o=u[5]);else if(d)i=d[1],n=d[2],a=d[3],d[4]!==void 0&&(e=d[4],o=d[5]);else{const r=new Date(t);if(isNaN(r.getTime()))return"";i=String(r.getDate()).padStart(2,"0"),n=String(r.getMonth()+1).padStart(2,"0"),a=r.getFullYear(),e=String(r.getHours()).padStart(2,"0"),o=String(r.getMinutes()).padStart(2,"0")}}return`${a}-${n}-${i}T${e}:${o}`}convertDMYToYMD(t){if(!t)return"";let a=String(t).replace(/\s*-\s*/," ").trim();if(/^\d{4}-\d{2}-\d{2}$/.test(a))return a;const e=a.split(" ")[0].split("/");if(e.length!==3)return t;const o=e[0].padStart(2,"0"),l=e[1].padStart(2,"0");return`${e[2]}-${l}-${o}`}convertDMYHMSToYMDHMS(t){if(!t)return"";let a=String(t).replace("T"," ").replace(/\s*-\s*/," ").trim();if(/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}(:\d{2})?$/.test(a)){const l=a.split(" ");let u=l[1];return u.split(":").length===2&&(u+=":00"),`${l[0]} ${u}`}const n=a.split(" "),i=n[0];let e=n[1]||"00:00:00";return e.split(":").length===2&&(e+=":00"),`${this.convertDMYToYMD(i)} ${e}`}getFileExtensionFromBase64(t){return t?t.startsWith("data:image/jpeg")||t.startsWith("data:image/jpg")?"jpg":t.startsWith("data:image/webp")?"webp":t.startsWith("data:image/gif")?"gif":t.includes(".")?t.split(".").pop():"png":"png"}getPlanBaseCode(t){return t||""}getVersionLabel(t){const a=parseInt(t)||0;return a===0?"V0 (Gốc)":`V${a} (Điều chỉnh ${a})`}getPackageBaseCode(t){return t||""}getLatestPlans(){const t={};return(this.state.kehoach||[]).forEach(a=>{const n=a.rootId||a.id,i=parseInt(a.phienBan)||0,e=a.isLatest==1||a.is_latest==1;if(!t[n])t[n]=a;else{const o=parseInt(t[n].phienBan)||0,l=t[n].isLatest==1||t[n].is_latest==1;(e&&!l||i>o)&&(t[n]=a)}}),Object.values(t)}getLatestPackages(){const t=(this.state.goithau||[]).filter(n=>{if(!n.keHoachId)return!0;const i=this.getLatestPlan(n.keHoachId);return i&&i.id===n.keHoachId}),a={};return t.forEach(n=>{const i=n.rootId||n.id,e=parseInt(n.phienBan)||0,o=n.isLatest==1||n.is_latest==1;if(!a[i])a[i]=n;else{const l=parseInt(a[i].phienBan)||0,u=a[i].isLatest==1||a[i].is_latest==1;(o&&!u||e>l)&&(a[i]=n)}}),Object.values(a)}getLatestChuDauTu(){const t=Array.isArray(this.state.chudautu)?this.state.chudautu:[],a=t.filter(i=>i.isLatest==1);if(a.length>0)return a;const n={};return t.forEach(i=>{const e=i.rootId||i.id,o=parseInt(i.phienBan)||0;(!n[e]||o>n[e].version)&&(n[e]={item:i,version:o})}),Object.values(n).map(i=>i.item)}getLatestNhaThau(){const t=Array.isArray(this.state.nhathau)?this.state.nhathau:[],a=t.filter(i=>i.isLatest==1);if(a.length>0)return a;const n={};return t.forEach(i=>{const e=i.rootId||i.id,o=parseInt(i.phienBan)||0;(!n[e]||o>n[e].version)&&(n[e]={item:i,version:o})}),Object.values(n).map(i=>i.item)}getLatestChuyenGia(){const t=Array.isArray(this.state.chuyengia)?this.state.chuyengia:[],a=t.filter(i=>i.isLatest==1);if(a.length>0)return a;const n={};return t.forEach(i=>{const e=i.rootId||i.id,o=parseInt(i.phienBan)||0;(!n[e]||o>n[e].version)&&(n[e]={item:i,version:o})}),Object.values(n).map(i=>i.item)}getLatestHopDong(){const t=this.getLatestPackages();t.map(e=>e.id);const n=this.getFilteredHopDong().filter(e=>{let o=[];if(e.goiThauId&&o.push(e.goiThauId),e.goiThauIds){if(Array.isArray(e.goiThauIds))o.push(...e.goiThauIds);else if(typeof e.goiThauIds=="string")try{const l=JSON.parse(e.goiThauIds);Array.isArray(l)?o.push(...l):o.push(e.goiThauIds)}catch{o.push(...e.goiThauIds.split(",").map(u=>u.trim()))}}return o=o.filter(Boolean),o.length===0?!0:o.some(l=>{const u=(this.state.goithau||[]).find(r=>r.id===l);if(!u)return!1;const d=u.rootId||u.id;return t.some(r=>r.rootId===d||r.id===d)})}),i={};return n.forEach(e=>{const o=e.rootId||e.id,l=parseInt(e.phienBan)||0,u=e.isLatest==1||e.is_latest==1;if(!i[o])i[o]=e;else{const d=parseInt(i[o].phienBan)||0,r=i[o].isLatest==1||i[o].is_latest==1;(u&&!r||l>d)&&(i[o]=e)}}),Object.values(i)}getLatestPlan(t){if(!t)return null;const a=(this.state.kehoach||[]).find(e=>e.id===t);if(!a)return null;const n=a.rootId||a.id;return(this.state.kehoach||[]).find(e=>(e.rootId===n||e.id===n)&&(e.isLatest==1||e.is_latest==1))||a}getLatestPackage(t){if(!t)return null;const a=(this.state.goithau||[]).find(e=>e.id===t);if(!a)return null;const n=a.rootId||a.id;return(this.state.goithau||[]).find(e=>(e.rootId===n||e.id===n)&&(e.isLatest==1||e.is_latest==1))||a}getLatestContract(t){if(!t)return null;const a=(this.state.hopdong||[]).find(e=>e.id===t);if(!a)return null;const n=a.rootId||a.id;return(this.state.hopdong||[]).find(e=>(e.rootId===n||e.id===n)&&(e.isLatest==1||e.is_latest==1))||a}};vt(pt,"ROLE_HIERARCHY",{super_admin:["super_admin","manager","employee"],manager:["manager","employee"],employee:["employee"]});let yt=pt;function Dt(){const c=this.model.getFilteredGoiThau();document.getElementById("stat-count-kehoach").textContent=this.model.getFilteredKeHoach().length,document.getElementById("stat-count-goithau").textContent=c.length,document.getElementById("stat-count-chudautu").textContent=this.model.getLatestChuDauTu().length,document.getElementById("stat-count-nhathau").textContent=this.model.getLatestNhaThau().length,document.getElementById("stat-count-chuyengia").textContent=this.model.state.chuyengia.length;const t=document.getElementById("stat-count-hopdong");t&&(t.textContent=this.model.getFilteredHopDong().length);const a=this.model.getFilteredHopDong();let n=0;a.forEach(p=>{n+=p.giaTri||0});let i=0;c.forEach(p=>{p.trangThai==="Đang mời thầu"&&i++}),document.getElementById("stat-active-goithau").textContent=`${i} gói đang mời thầu`,document.getElementById("stat-total-budget").textContent=this.model.formatCurrency(n),document.getElementById("stat-savings-value").textContent=`${a.length} Hợp đồng`,document.getElementById("stat-savings-percent").textContent="Đang thực hiện";const e={"Chuẩn bị":0,"Đang mời thầu":0,"Đã mở thầu":0,"Đang chấm thầu":0,"Đã có kết quả":0,"Hủy thầu":0};c.forEach(p=>{e[p.trangThai]!==void 0&&e[p.trangThai]++});const o=c.length||1;document.getElementById("donut-total-count").textContent=c.length;const l={"Chuẩn bị":"var(--text-light)","Đang mời thầu":"var(--primary)","Đã mở thầu":"#f59e0b","Đang chấm thầu":"#9333ea","Đã có kết quả":"var(--success)","Hủy thầu":"var(--danger)"};let u=0;const d=[];let r="";Object.keys(e).forEach(p=>{const m=e[p],v=m/o*100;m>0&&(d.push(`${l[p]} ${u}% ${u+v}%`),u+=v),r+=`
            <div class="legend-item">
                <div class="legend-info">
                    <span class="legend-dot" style="background-color: ${l[p]}"></span>
                    <span>${p}</span>
                </div>
                <span class="legend-val">${m} (${v.toFixed(0)}%)</span>
            </div>
        `});const h=document.querySelector(".status-donut-chart");h&&(d.length>0?h.style.background=`conic-gradient(${d.join(", ")})`:h.style.background="var(--neutral-soft)"),document.getElementById("status-legend-list").innerHTML=r;const g=document.getElementById("recent-packages-table").querySelector("tbody"),s=[...c].reverse().slice(0,4);s.length===0?g.innerHTML='<tr><td colspan="5" class="text-center text-muted">Chưa có gói thầu nào</td></tr>':(g.innerHTML=s.map(p=>`
            <tr>
                <td><a href="#" onclick="event.preventDefault(); window.showPackageDetails('${p.id}')" class="text-blue fw-bold link-hover" title="Xem chi tiết Gói thầu"><span class="detail-code">${p.maGoiThau}</span></a></td>
                <td><a href="#" class="view-package-link" data-id="${p.id}">${p.tenGoiThau}</a></td>
                <td>${this.model.formatCurrency(p.giaGoiThau)}</td>
                <td>${p.hinhThucLuaChon}</td>
                <td>${this.getStatusBadge(p.trangThai)}</td>
            </tr>
        `).join(""),g.querySelectorAll(".view-package-link").forEach(p=>{p.addEventListener("click",m=>{m.preventDefault(),window.showPackageDetails(p.getAttribute("data-id"))})})),lucide.createIcons()}function Ct(){fetch("/api/auth/users").then(c=>c.ok?c.json():[]).then(c=>{const t=[];c.forEach(d=>{d.organization_name&&d.organization_name.split(",").map(r=>r.trim()).filter(Boolean).forEach(r=>{t.push(r)})});const a=new Set(t).size,n=document.getElementById("sad-stat-orgs");n&&(n.textContent=`${a} Đơn vị`);const i=document.getElementById("sad-stat-users");i&&(i.textContent=`${c.length} Người dùng`);const e=[];c.forEach(d=>{d.package_id&&d.package_id!=="none"&&d.organization_name&&d.organization_name.split(",").map(r=>r.trim()).filter(Boolean).forEach(r=>{e.push(r)})});const o=new Set(e).size,l=document.getElementById("sad-stat-active-orgs");l&&(l.textContent=`Đang hoạt động: ${o}`);const u=document.getElementById("sa-org-list-tbody");if(u){const d={};c.forEach(h=>{(h.organization_name?h.organization_name.split(",").map(s=>s.trim()).filter(Boolean):[]).forEach(s=>{d[s]||(d[s]={name:s,manager:"",email:"",package_id:"none",start:"",end:"",userCount:0}),d[s].userCount++,(h.role==="manager"||!d[s].manager)&&(d[s].manager=h.name,d[s].email=h.email,d[s].package_id=h.package_id||"none",d[s].start=h.package_start_date?this.model.formatDate(h.package_start_date):"",d[s].end=h.package_end_date?this.model.formatDate(h.package_end_date):"")})});const r=Object.values(d);r.length===0?u.innerHTML='<tr><td colspan="7" class="text-center text-muted">Chưa có tổ chức nào đăng ký thầu</td></tr>':u.innerHTML=r.map(h=>{const g=h.package_id==="diamond"?"Gói Kim Cương":h.package_id==="gold"?"Gói Vàng":h.package_id==="silver"?"Gói Bạc":"Chưa đăng ký",s=h.package_id==="diamond"?"badge-primary":h.package_id==="gold"?"badge-warning":h.package_id==="silver"?"badge-success":"badge-neutral";return`
                            <tr>
                                <td style="font-weight:700; color:var(--text-main);">${h.name}</td>
                                <td>${h.manager||'<span class="text-muted">Chưa cấu hình</span>'}</td>
                                <td>${h.email||'<span class="text-muted">Chưa có</span>'}</td>
                                <td><span class="badge ${s}">${g}</span></td>
                                <td style="font-weight:600;">${h.end||'<span class="text-muted">Vô thời hạn</span>'}</td>
                                <td style="font-weight:700; text-align:center;">${h.userCount}</td>
                                <td class="text-right">
                                    <div class="actions-group">
                                        <button class="btn btn-icon btn-neutral" onclick="window.switchTab('superadmin')" title="Quản lý chi tiết"><i data-lucide="edit"></i></button>
                                    </div>
                                </td>
                            </tr>
                        `}).join("")}lucide.createIcons()})}const It=Object.freeze(Object.defineProperty({__proto__:null,renderDashboard:Dt,renderSuperAdminDashboard:Ct},Symbol.toStringTag,{value:"Module"}));function Et(c){const t=sessionStorage.getItem("bf_session_token")||"",a=sessionStorage.getItem("bf_username")||"",n=c.includes("?")?"&":"?";return`${c}${n}token=${encodeURIComponent(t)}&username=${encodeURIComponent(a)}`}function ft(c,t){return fetch(c,{headers:{"X-Session-Token":sessionStorage.getItem("bf_session_token")||"","X-Username":sessionStorage.getItem("bf_username")||""}}).then(async a=>{if(!a.ok){let n="Lỗi tải file";try{const i=a.headers.get("content-type");i&&i.includes("application/json")?n=(await a.json()).error||n:n=await a.text()||`${a.status} ${a.statusText}`}catch{n=`${a.status} ${a.statusText}`}throw new Error(n)}return a.blob()}).then(a=>{const n=document.createElement("a"),i=URL.createObjectURL(a);n.href=i,n.download=t||"download",document.body.appendChild(n),n.click(),n.remove(),URL.revokeObjectURL(i)})}function dt(c){return c==null?"--":new Intl.NumberFormat("vi-VN",{style:"currency",currency:"VND"}).format(c)}function rt(c){if(!c)return"--";let t=null,a=null,n=null,i="00",e="00",o=!1;if(c instanceof Date){const l=c;n=String(l.getDate()).padStart(2,"0"),a=String(l.getMonth()+1).padStart(2,"0"),t=l.getFullYear(),i=String(l.getHours()).padStart(2,"0"),e=String(l.getMinutes()).padStart(2,"0"),o=l.getHours()!==0||l.getMinutes()!==0}else{const l=String(c).replace(/\s*-\s*/," ").trim(),u=l.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/),d=l.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[T\s](\d{2}):(\d{2}))?/);if(u)t=u[1],a=u[2],n=u[3],u[4]!==void 0&&(i=u[4],e=u[5],o=!0);else if(d)n=d[1],a=d[2],t=d[3],d[4]!==void 0&&(i=d[4],e=d[5],o=!0);else{const r=new Date(c);if(isNaN(r.getTime()))return c;n=String(r.getDate()).padStart(2,"0"),a=String(r.getMonth()+1).padStart(2,"0"),t=r.getFullYear(),i=String(r.getHours()).padStart(2,"0"),e=String(r.getMinutes()).padStart(2,"0"),o=/[T\s]\d{1,2}:\d{2}/.test(c)}}return o?`${n}/${a}/${t} ${i}:${e}`:`${n}/${a}/${t}`}function ht(c){const t=document.getElementById(c);if(!t)return;const a=t.classList.contains("version-droplist"),n=t.classList.contains("page-version-select")||t.classList.contains("modal-version-select"),i=!a&&!n;t.style.display="none";let e=t.parentElement.querySelector(`.custom-select-container[data-target="${c}"]`);e||(e=document.createElement("div"),e.className="custom-select-container"+(a?" version-select-container":"")+(n?" compact-version-select-container":""),e.setAttribute("data-target",c),t.parentNode.insertBefore(e,t.nextSibling),a?(e.style.display="inline-block",e.style.verticalAlign="middle",e.style.width="52px",e.style.height="22px",e.style.margin="0"):n?(e.style.display="inline-block",e.style.verticalAlign="middle",e.style.margin="0",e.style.width="70px",e.style.minWidth="70px"):t.style.width&&(e.style.width=t.style.width),window._customSelectClickListenerRegistered||(document.addEventListener("click",g=>{document.querySelectorAll(".custom-select-container.open").forEach(s=>{const p=s.getAttribute("data-target"),m=document.querySelector(`.custom-select-dropdown[data-target="${p}"]`),v=s.contains(g.target),b=m&&m.contains(g.target);!v&&!b&&(s.classList.remove("open"),m&&m.parentElement===document.body&&(s.appendChild(m),m.style.opacity="",m.style.visibility="",m.style.transform="",m.style.top="",m.style.left=""))}),document.querySelectorAll("body > .custom-select-dropdown").forEach(s=>{const p=s.getAttribute("data-target"),m=document.getElementById(p),v=document.querySelector(`.custom-select-container[data-target="${p}"]`);(!m||!v||v.offsetWidth===0&&v.offsetHeight===0)&&s.remove()})}),window._customSelectClickListenerRegistered=!0),window._customSelectScrollListenerRegistered||(window.addEventListener("scroll",()=>{document.querySelectorAll(".custom-select-container").forEach(g=>{g.classList.remove("open");const s=g.getAttribute("data-target"),p=document.querySelector(`.custom-select-dropdown[data-target="${s}"]`);p&&p.parentElement===document.body&&(g.appendChild(p),p.style.opacity="",p.style.visibility="",p.style.transform="")})},{passive:!0}),window._customSelectScrollListenerRegistered=!0)),window._customSelectTableScrollListenerRegistered||(document.addEventListener("scroll",g=>{g.target&&g.target.classList&&g.target.classList.contains("table-container")&&document.querySelectorAll(".custom-select-container.open").forEach(s=>{s.classList.remove("open");const p=s.getAttribute("data-target"),m=document.querySelector(`.custom-select-dropdown[data-target="${p}"]`);m&&m.parentElement===document.body&&(s.appendChild(m),m.style.opacity="",m.style.visibility="",m.style.transform="")})},{capture:!0,passive:!0}),window._customSelectTableScrollListenerRegistered=!0);const o=Array.from(t.options);let u=(t.options[t.selectedIndex]||t.options[0]||{text:"",value:""}).text.trim();if(u.startsWith("Tháng ")){let g=u.substring(6).trim();const s={một:"1",hai:"2",ba:"3",bốn:"4",năm:"5",sáu:"6",bảy:"7",tám:"8",chín:"9",mười:"10","mười một":"11","mười hai":"12"};s[g.toLowerCase()]&&(g=s[g.toLowerCase()]),u="Th"+g}const d=e.querySelector(".custom-select-trigger span"),r=Array.from(e.querySelectorAll(".custom-select-option"));let h=!1;if(!d||d.textContent!==u)h=!0;else if(r.length!==o.length)h=!0;else for(let g=0;g<o.length;g++){const s=r[g],p=o[g];if(s.getAttribute("data-value")!==p.value||s.querySelector("span").textContent!==p.text||s.classList.contains("selected")!==p.selected){h=!0;break}}if(h){const g=document.body.querySelector(`.custom-select-dropdown[data-target="${c}"]`);g&&g.remove(),e.innerHTML=`
            <div class="custom-select-trigger">
                <span>${u}</span>
                ${i?`
                <div class="custom-select-trigger-arrow">
                    <i data-lucide="chevron-down" style="width: 14px; height: 14px;"></i>
                </div>
                `:""}
            </div>
            <div class="custom-select-dropdown${a?" version-select-dropdown":""}${n?" compact-version-select-dropdown":""}" data-target="${c}">
                ${o.map(m=>`
                    <div class="custom-select-option ${m.selected?"selected":""}" data-value="${m.value}">
                        <span>${m.text}</span>
                    </div>
                `).join("")}
            </div>
        `;const s=e.querySelector(".custom-select-trigger"),p=e.querySelector(".custom-select-dropdown");s.addEventListener("click",m=>{if(m.stopPropagation(),document.querySelectorAll(".custom-select-container").forEach(b=>{if(b!==e){b.classList.remove("open");const T=b.getAttribute("data-target"),y=document.querySelector(`.custom-select-dropdown[data-target="${T}"]`);y&&y.parentElement===document.body&&(b.appendChild(y),y.style.opacity="",y.style.visibility="",y.style.transform="")}}),e.classList.toggle("open")){const b=s.getBoundingClientRect();document.body.appendChild(p),p.style.position="fixed",p.style.top=b.bottom+4+"px",p.style.left=b.left+"px",p.style.right="auto",p.style.bottom="auto",p.style.margin="0",p.style.transform="none",a?(p.style.width="52px",p.style.minWidth="52px"):n?(p.style.width="70px",p.style.minWidth="70px"):(p.style.minWidth=b.width+"px",p.style.width="max-content"),p.style.zIndex="999999",p.style.opacity="1",p.style.visibility="visible"}else p.style.opacity="0",p.style.visibility="hidden",e.appendChild(p)}),e.querySelectorAll(".custom-select-option").forEach(m=>{m.addEventListener("click",v=>{v.stopPropagation();const b=m.getAttribute("data-value");t.value=b,t.dispatchEvent(new Event("change",{bubbles:!0})),e.classList.remove("open"),p.parentElement===document.body&&(e.appendChild(p),p.style.opacity="",p.style.visibility="",p.style.transform=""),ht(c)})}),i&&window.lucide&&typeof window.lucide.createIcons=="function"&&window.lucide.createIcons()}}async function Ht(){const c=document.getElementById("kehoach-table").querySelector("tbody"),t=document.getElementById("search-kehoach").value.toLowerCase(),a=m=>{if(!m)return{year:null,month:null};let v=String(m).replace(/\s*-\s*/," ").trim();if(v.match(/^\d{4}-\d{2}-\d{2}/)){const T=v.substring(0,4),y=parseInt(v.substring(5,7),10).toString();return{year:T,month:y}}else if(v.match(/^\d{2}\/\d{2}\/\d{4}/)){const T=v.split(" ")[0].split("/"),y=T[2],x=parseInt(T[1],10).toString();return{year:y,month:x}}const b=new Date(v);return isNaN(b.getTime())?{year:null,month:null}:{year:b.getFullYear().toString(),month:(b.getMonth()+1).toString()}},n=document.getElementById("filter-kehoach-nam"),i=document.getElementById("filter-kehoach-thang"),e=this.model.state.kehoach||[];if(n&&i){const m=n.value,v=i.value,b=new Set,T=new Set;e.forEach(f=>{if(f.ngayPheDuyet){const S=a(f.ngayPheDuyet);S.year&&b.add(S.year),S.month&&T.add(S.month)}});const y=Array.from(b).sort((f,S)=>parseInt(S)-parseInt(f)),x=Array.from(T).sort((f,S)=>parseInt(S)-parseInt(f));n.innerHTML='<option value="">Năm</option>'+y.map(f=>`<option value="${f}">${f}</option>`).join(""),i.innerHTML='<option value="">Tháng</option>'+x.map(f=>`<option value="${f}">Tháng ${f}</option>`).join(""),y.includes(m)&&(n.value=m),x.includes(v)&&(i.value=v),ht("filter-kehoach-nam"),ht("filter-kehoach-thang")}const o=n?n.value:"",l=i?i.value:"";let u=[],d=0;const r=this.model.currentPage.kehoach||1,h=this.model.pageSize||10,g=this.model.sortState.kehoach||{},s=g.field||"",p=g.order||"asc";if(this.model.useServerSidePagination){!c.querySelector(".empty-state")&&c.children.length===0&&(c.innerHTML='<tr><td colspan="10" style="text-align: center; padding: 20px; color: var(--primary); font-weight: bold;">Đang tải dữ liệu từ máy chủ...</td></tr>');try{const m=await fetch(`/api/paginate?table=kehoach&page=${r}&pageSize=${h}&search=${encodeURIComponent(t)}&sortBy=${s}&sortOrder=${p}&nam=${encodeURIComponent(o)}&thang=${encodeURIComponent(l)}`,{headers:{"X-Session-Token":sessionStorage.getItem("bf_session_token")||"","X-Username":sessionStorage.getItem("bf_username")||""}});if(m.ok){const v=await m.json();u=v.items,d=v.totalItems}}catch(m){console.error("Failed to fetch paginated plans",m)}}else{const v=this.model.getFilteredKeHoach().filter(T=>{const y=T.maKeHoach.toLowerCase().includes(t)||T.tenKeHoach.toLowerCase().includes(t)||T.tenDuAnDuToan&&T.tenDuAnDuToan.toLowerCase().includes(t);let x=!0,f=!0;if(T.ngayPheDuyet){const S=a(T.ngayPheDuyet);o&&(x=S.year===o),l&&(f=S.month===l)}else(o||l)&&(x=!1,f=!1);return y&&x&&f});s&&v.sort((T,y)=>{let x=T[s]||"",f=y[s]||"";return typeof x=="string"&&(x=x.toLowerCase()),typeof f=="string"&&(f=f.toLowerCase()),x<f?p==="asc"?-1:1:x>f?p==="asc"?1:-1:0}),d=v.length;const b=(r-1)*h;u=v.slice(b,b+h)}if(d===0){c.innerHTML=`
            <tr>
                <td colspan="10">
                    <div class="empty-state">
                        <i data-lucide="file-warning"></i>
                        <p>Không tìm thấy Kế hoạch lựa chọn nhà thầu nào phù hợp</p>
                    </div>
                </td>
            </tr>
        `;const m=document.getElementById("kehoach-pagination");m&&(m.innerHTML="")}else c.innerHTML=u.map(m=>{const v=m.rootId||m.id,b=m.allVersions||this.model.state.kehoach.filter(C=>(C.rootId||C.id)===v).sort((C,V)=>parseInt(V.phienBan)-parseInt(C.phienBan));this.model.state.selectedPlanVersion||(this.model.state.selectedPlanVersion={});const T=this.model.state.selectedPlanVersion[v]||m.id,y=this.model.state.kehoach.find(C=>C.id===T)||m,x=this.model.state.chudautu.find(C=>C.id===y.chuDauTuId),f=b.map(C=>{const V=C.phienBan||"00",P=C.id===y.id?"selected":"";return`<option value="${C.id}" ${P}>${V}</option>`}).join(""),S=`
                <select class="form-control version-droplist" onchange="window.changePlanRowVersion('${v}', this.value)" style="width: 52px; display: inline-block; padding: 2px; height: 22px; font-size: 0.8rem; border-radius: 4px; border: 1px solid var(--border-color, #ccc); background-color: var(--bg-card); color: var(--text-main); text-align-last: center; cursor: pointer; margin: 0; outline: none; vertical-align: middle;">
                    ${f}
                </select>
            `,M=y.id===m.id?`
                            <button class="action-btn btn-edit" onclick="window.editKeHoach('${y.id}')" title="Sửa">
                                <i data-lucide="edit-2"></i>
                            </button>
            `:"";return`
                <tr>
                    <td>
                        <div style="display: inline-flex; align-items: center; gap: 6px; line-height: 1; vertical-align: middle;">
                            <a href="#" onclick="event.preventDefault(); window.showKeHoachDetails('${y.id}')" class="text-blue fw-bold link-hover" style="display: inline-flex; align-items: center; line-height: 1;"><span class="detail-code" style="margin: 0; line-height: 1;">${this.model.getPlanBaseCode(y.maKeHoach)||'<span class="text-muted">(Chưa nhập)</span>'}</span></a>
                            <span style="color: var(--text-muted); font-size: 0.85rem; line-height: 1; display: inline-flex; align-items: center;">-</span>
                            ${S}
                        </div>
                    </td>
                    <td style="min-width: 240px; max-width: 320px;" class="fw-bold text-wrap">${y.tenKeHoach}</td>
                    <td>${y.loaiHinhMuaSam?`<span class="badge ${y.loaiHinhMuaSam==="Dự án"?"badge-info":"badge-warning"}">${y.loaiHinhMuaSam}</span>`:'<span class="text-muted">--</span>'}</td>
                    <td style="min-width: 200px; max-width: 300px;" class="text-muted text-wrap">${y.tenDuAnDuToan||"--"}</td>
                    <td style="min-width: 180px; max-width: 280px;" class="text-wrap">${x?x.tenChuDauTu:'<span class="text-danger">Không rõ</span>'}</td>
                    <td class="text-blue fw-bold">${dt(y.tongMucDauTu)}</td>
                    <td>${rt(y.ngayPheDuyet)}</td>
                    <td>${y.quyetDinhPheDuyet}</td>
                    <td><small class="fw-bold text-muted">${y.thoiGianDangMa?this.model.formatDateWithTime(y.thoiGianDangMa):"--"}</small></td>
                    <td class="text-right">
                        <div class="action-btn-group">
                            ${M}
                            <button class="action-btn btn-delete" onclick="window.deleteKeHoach('${y.id}')" title="Xóa">
                                <i data-lucide="trash-2"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `}).join(""),window.renderTablePagination&&window.renderTablePagination("kehoach-pagination",d,r,h);lucide.createIcons(),this.enhanceTableHeaders("kehoach-table","kehoach")}function Bt(c){const t=document.getElementById("tab-kehoach-detail");if(!t||!t.classList.contains("active")){window.switchTab("kehoach-detail",c);return}if(!this.model.state.kehoach.find(i=>i.id===c))return;const n=document.getElementById("btn-edit-kehoach-fullpage");n&&(n.onclick=()=>{window.editKeHoach(c)}),this.renderPlanVersionDetails(c)}function Mt(c){const t=this.model.state.kehoach.find(w=>w.id===c);if(!t)return;const a=t.rootId||t.id,n=this.model.state.kehoach.filter(w=>(w.rootId||w.id)===a),i={};n.forEach(w=>{const M=w.phienBan||"00";(!i[M]||w.isLatest==1||w.is_latest==1)&&(i[M]=w)});const e=Object.values(i);e.sort((w,M)=>{const C=parseInt(w.phienBan)||0,V=parseInt(M.phienBan)||0;return C-V});const o=this.model.state.chudautu.find(w=>w.id===t.chuDauTuId),u=this.model.getLatestPackages().filter(w=>w.keHoachId===t.id),d=[],r=new Set,h=new Set,g=new Set;u.forEach(w=>{const M=w.rootId,C=w.maGoiThau?w.maGoiThau.trim().toLowerCase():"",V=w.tenGoiThau?w.tenGoiThau.trim().toLowerCase():"";let P=!1;M&&r.has(M)&&(P=!0),C&&C!=="(chưa nhập)"&&h.has(C)&&(P=!0),V&&g.has(V)&&(P=!0),P||(M&&r.add(M),C&&C!=="(chưa nhập)"&&h.add(C),V&&g.add(V),d.push(w))});const s=t.cvDaThucHienList||[],p=t.cvKhongApDungList||[],m=t.cvChuaDuDieuKienList||[];let v="";s.length>0&&(v=`
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
                            ${s.map(w=>`
                                <tr style="border-bottom: 1px solid var(--border-color);">
                                    <td style="padding: 10px 14px; font-size: 0.88rem; font-weight: 600; color: var(--text-main); text-align: left !important;">${w.tenCongViec}</td>
                                    <td style="padding: 10px 14px; font-size: 0.88rem; font-weight: 700; color: var(--primary); text-align: right !important;">${dt(w.giaTri)}</td>
                                    <td style="padding: 10px 14px; font-size: 0.88rem; font-weight: 600; color: var(--text-muted); text-align: left !important;">${w.donViThucHien||"--"}</td>
                                    <td style="padding: 10px 14px; font-size: 0.88rem; font-weight: 600; color: var(--text-muted); text-align: left !important;">${w.vanBanPheDuyet||"--"}</td>
                                </tr>
                            `).join("")}
                        </tbody>
                    </table>
                </div>
            </div>
        `);let b="";p.length>0&&(b=`
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
                            ${p.map(w=>`
                                <tr style="border-bottom: 1px solid var(--border-color);">
                                    <td style="padding: 10px 14px; font-size: 0.88rem; font-weight: 600; color: var(--text-main); text-align: left !important;">${w.tenCongViec}</td>
                                    <td style="padding: 10px 14px; font-size: 0.88rem; font-weight: 700; color: var(--primary); text-align: right !important;">${dt(w.giaTri)}</td>
                                    <td style="padding: 10px 14px; font-size: 0.88rem; font-weight: 600; color: var(--text-muted); text-align: left !important;">${w.donViThucHien||"--"}</td>
                                </tr>
                            `).join("")}
                        </tbody>
                    </table>
                </div>
            </div>
        `);let T="";m.length>0&&(T=`
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
                            ${m.map(w=>`
                                <tr style="border-bottom: 1px solid var(--border-color);">
                                    <td style="padding: 10px 14px; font-size: 0.88rem; font-weight: 600; color: var(--text-main); text-align: left !important;">${w.tenCongViec}</td>
                                    <td style="padding: 10px 14px; font-size: 0.88rem; font-weight: 700; color: var(--primary); text-align: right !important;">${dt(w.giaTri)}</td>
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
        `);let x="";t.loaiHinhMuaSam==="Dự án"&&(x=`
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
        `);const f=`
        <div class="detail-section">
            <div class="detail-header-block" style="padding-bottom: 16px; margin-bottom: 20px; border-bottom: 1px solid var(--border-color);">
                <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 10px;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span class="detail-code" style="margin: 0; display: inline-flex; align-items: center; height: 28px; box-sizing: border-box; font-size: 0.85rem; padding: 4px 10px; background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.15); color: var(--primary); border-radius: 4px; font-weight: 700;">${this.model.getPlanBaseCode(t.maKeHoach)||'<span class="text-muted">(Chưa nhập)</span>'}</span>
                        ${e.length>=2?`
                            <span class="version-separator" style="color: var(--text-muted, #64748b); font-weight: 600;">-</span>
                            <select id="fullpage-kh-version-select" class="page-version-select">
                                ${e.map(w=>`<option value="${w.id}" ${w.id===c?"selected":""}>${w.phienBan||"00"}</option>`).join("")}
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
                ${x}
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

            ${v}
            ${b}
            ${T}

            <div class="detail-sub-section" style="margin-top: 20px;">
                <h5 class="detail-sub-title" style="color: var(--primary);">IV. Phần công việc thuộc kế hoạch lựa chọn nhà thầu (Các gói thầu - ${d.length})</h5>
                <div class="associated-list">
                    ${d.length>0?d.map(w=>`
                        <div class="associated-item">
                            <div class="associated-info">
                                <i data-lucide="briefcase" class="text-blue" style="width:16px;"></i>
                                <span><strong>${w.maGoiThau}</strong> - ${w.tenGoiThau}</span>
                            </div>
                            <span class="badge badge-success">${dt(w.giaGoiThau)}</span>
                        </div>
                    `).join(""):'<div class="text-muted"><small>Phiên bản kế hoạch này hiện chưa có gói thầu trực tiếp liên kết.</small></div>'}
                </div>
            </div>
        </div>
    `;document.getElementById("fullpage-kehoach-content").innerHTML=f;const S=document.getElementById("fullpage-kh-version-select");S&&(S.onchange=w=>{this.renderPlanVersionDetails(w.target.value)},window.initCustomSelect&&window.initCustomSelect("fullpage-kh-version-select")),lucide.createIcons()}function gt(c){if(!c)return!1;const t=String(c.danhGiaKetLuan||"").trim().toLowerCase();if(t)return t==="đạt"||t.startsWith("đạt")||t.includes("trúng thầu");const a=String(c.danhGiaHopLe||"").trim().toLowerCase(),n=String(c.danhGiaNangLuc||"").trim().toLowerCase(),i=String(c.danhGiaKyThuat||"").trim().toLowerCase();return a==="đạt"&&n==="đạt"&&i!=="không đạt"&&i!==""}async function Nt(){const c=document.getElementById("goithau-table").querySelector("tbody"),t=document.getElementById("search-goithau").value.toLowerCase(),a=document.getElementById("filter-goithau-trangthai").value,n=document.getElementById("filter-goithau-hinhthuc").value,i=b=>{if(!b)return{year:null,month:null};let T=String(b).replace(/\s*-\s*/," ").trim();if(T.match(/^\d{4}-\d{2}-\d{2}/)){const x=T.substring(0,4),f=parseInt(T.substring(5,7),10).toString();return{year:x,month:f}}else if(T.match(/^\d{2}\/\d{2}\/\d{4}/)){const x=T.split(" ")[0].split("/"),f=x[2],S=parseInt(x[1],10).toString();return{year:f,month:S}}const y=new Date(T);return isNaN(y.getTime())?{year:null,month:null}:{year:y.getFullYear().toString(),month:(y.getMonth()+1).toString()}},e=document.getElementById("filter-goithau-nam"),o=document.getElementById("filter-goithau-thang"),l=this.model.getLatestPackages();if(e&&o){const b=e.value,T=o.value,y=new Set,x=new Set;l.forEach(w=>{const M=w.ngayQuyetDinh;if(M){const C=i(M);C.year&&y.add(C.year),C.month&&x.add(C.month)}});const f=Array.from(y).sort((w,M)=>parseInt(M)-parseInt(w)),S=Array.from(x).sort((w,M)=>parseInt(M)-parseInt(w));e.innerHTML='<option value="">Năm</option>'+f.map(w=>`<option value="${w}">${w}</option>`).join(""),o.innerHTML='<option value="">Tháng</option>'+S.map(w=>`<option value="${w}">Tháng ${w}</option>`).join(""),f.includes(b)&&(e.value=b),S.includes(T)&&(o.value=T),ht("filter-goithau-trangthai"),ht("filter-goithau-hinhthuc"),ht("filter-goithau-nam"),ht("filter-goithau-thang")}const u=e?e.value:"",d=o?o.value:"";let r=[],h=0;const g=this.model.currentPage.goithau||1,s=this.model.pageSize||10,p=this.model.sortState.goithau||{},m=p.field||"",v=p.order||"asc";if(this.model.useServerSidePagination){!c.querySelector(".empty-state")&&c.children.length===0&&(c.innerHTML='<tr><td colspan="8" style="text-align: center; padding: 20px; color: var(--primary); font-weight: bold;">Đang tải dữ liệu từ máy chủ...</td></tr>');try{const b=await fetch(`/api/paginate?table=goithau&page=${g}&pageSize=${s}&search=${encodeURIComponent(t)}&trangThai=${encodeURIComponent(a)}&hinhThuc=${encodeURIComponent(n)}&sortBy=${m}&sortOrder=${v}&nam=${encodeURIComponent(u)}&thang=${encodeURIComponent(d)}`,{headers:{"X-Session-Token":sessionStorage.getItem("bf_session_token")||"","X-Username":sessionStorage.getItem("bf_username")||""}});if(b.ok){const T=await b.json();r=T.items,h=T.totalItems}}catch(b){console.error("Failed to fetch paginated packages",b)}}else{const T=this.model.getFilteredGoiThau().filter(x=>{const f=x.maGoiThau.toLowerCase().includes(t)||x.tenGoiThau.toLowerCase().includes(t),S=!a||x.trangThai===a,w=!n||x.hinhThucLuaChon===n;let M=!0,C=!0;const V=x.ngayQuyetDinh;if(V){const P=i(V);u&&(M=P.year===u),d&&(C=P.month===d)}else(u||d)&&(M=!1,C=!1);return f&&S&&w&&M&&C});m&&T.sort((x,f)=>{let S=x[m]||"",w=f[m]||"";return typeof S=="string"&&(S=S.toLowerCase()),typeof w=="string"&&(w=w.toLowerCase()),S<w?v==="asc"?-1:1:S>w?v==="asc"?1:-1:0}),h=T.length;const y=(g-1)*s;r=T.slice(y,y+s)}if(h===0){c.innerHTML=`
            <tr>
                <td colspan="8">
                    <div class="empty-state">
                        <i data-lucide="archive"></i>
                        <p>Không tìm thấy Gói thầu nào phù hợp</p>
                    </div>
                </td>
            </tr>
        `;const b=document.getElementById("goithau-pagination");b&&(b.innerHTML="")}else window._jvDataMap=window._jvDataMap||{},c.innerHTML=r.map(b=>{const T=b.rootId||b.id,y=b.allVersions||this.model.state.goithau.filter(k=>{if((k.rootId||k.id)!==T)return!1;if(k.keHoachId){const I=(this.model.state.kehoach||[]).find(q=>q.id===k.keHoachId);if(I&&(I.isLatest===0||I.is_latest===0))return!1}return!0}).sort((k,I)=>parseInt(I.phienBan)-parseInt(k.phienBan));this.model.state.selectedPackageVersion||(this.model.state.selectedPackageVersion={});const x=this.model.state.selectedPackageVersion[T]||b.id,f=this.model.state.goithau.find(k=>k.id===x)||b,S=this.model.getLatestPlan(f.keHoachId),w=f.nhaThauTrungThauId?this.model.state.nhathau.find(k=>k.id===f.nhaThauTrungThauId):null,M=f.nhaThauTrungThauId?this.model.state.thongtinmothau.find(k=>String(k.goiThauId)===String(f.id)&&String(k.nhaThauId)===String(f.nhaThauTrungThauId)):null,C=M?M.tenNhaThau:w?w.tenNhaThau:"--",V=M&&M.loaiNhaThau==="Liên danh";let P;if(V){const k=M.thanhVienLienDanh||[],I=k.find(G=>G.vaiTro==="Đứng đầu liên danh"),q=(I==null?void 0:I.tenNhaThau)||C,j=(I==null?void 0:I.maSoThue)||(w==null?void 0:w.maSoThue)||(w==null?void 0:w.maNhaThau)||M.maDinhDanh||M.maNhaThau||"",$=k.filter(G=>G.vaiTro!=="Đứng đầu liên danh");window._jvDataMap[f.id]={members:$,leadName:q,leadCode:j},P=`<a href="#" onclick="event.preventDefault(); var d=window._jvDataMap['${f.id}']; d && window.openMoThauJVViewModal(d.members, d.leadName, d.leadCode)" class="fw-bold text-success link-hover" title="Xem thành viên liên danh">👥 ${C}</a>`}else w?P=`<a href="#" onclick="event.preventDefault(); window.editNhaThau('${w.id}', true)" class="text-blue fw-bold link-hover">${C}</a>`:P=`<span class="fw-bold text-success">${C}</span>`;let et="--";if(f.phanLo==="Có"){const I=(typeof f.phanLoList=="string"?JSON.parse(f.phanLoList||"[]"):f.phanLoList||[]).filter(j=>j.nhaThauTrungThauId),q=[...new Set(I.map(j=>String(j.nhaThauTrungThauId)).filter(Boolean))];if(q.length>1){window._lotWinnersMap=window._lotWinnersMap||{},window._lotWinnersMap[f.id]=I.map($=>{const G=this.model.state.thongtinmothau.find(_=>String(_.goiThauId)===String(f.id)&&String(_.nhaThauId)===String($.nhaThauTrungThauId)),H=this.model.state.nhathau.find(_=>_.id===$.nhaThauTrungThauId),U=G?G.tenNhaThau:H?H.tenNhaThau:"Nhà thầu #"+$.nhaThauTrungThauId,Y=G&&G.loaiNhaThau==="Liên danh";let W=null;if(Y){const _=G.thanhVienLienDanh||[],D=_.find(Q=>Q.vaiTro==="Đứng đầu liên danh"),B=(D==null?void 0:D.tenNhaThau)||U,K=(D==null?void 0:D.maSoThue)||(H==null?void 0:H.maSoThue)||(H==null?void 0:H.maNhaThau)||G.maDinhDanh||G.maNhaThau||"";W={members:_.filter(Q=>Q.vaiTro!=="Đứng đầu liên danh"),leadName:B,leadCode:K}}return{maPhanLo:$.maPhanLo,tenPhanLo:$.tenPhanLo,nhaThauTrungThauId:$.nhaThauTrungThauId,tenNhaThau:U,giaTrungThau:$.giaTrungThau,isJV:Y,jvData:W}});const j=I.reduce(($,G)=>$+(parseFloat(G.giaTrungThau)||0),0);et=`<a href="#" onclick="event.preventDefault(); window.showLotWinnersModal('${f.id}')" class="text-blue fw-bold link-hover" style="text-decoration: none;" title="Xem chi tiết các nhà thầu trúng thầu">Có nhiều nhà thầu trúng thầu</a><br><small class="text-muted">Tổng giá: ${this.model.formatCurrency(j)}</small>`}else if(q.length===1){const j=q[0],$=this.model.state.nhathau.find(W=>String(W.id)===String(j)),G=this.model.state.thongtinmothau.find(W=>String(W.goiThauId)===String(f.id)&&String(W.nhaThauId)===String(j)),H=G?G.tenNhaThau:$?$.tenNhaThau:"Nhà thầu #"+j,U=I.reduce((W,_)=>W+(parseFloat(_.giaTrungThau)||0),0);let Y;if(G&&G.loaiNhaThau==="Liên danh"){const W=G.thanhVienLienDanh||[],_=W.find(R=>R.vaiTro==="Đứng đầu liên danh"),D=(_==null?void 0:_.tenNhaThau)||H,B=(_==null?void 0:_.maSoThue)||($==null?void 0:$.maSoThue)||($==null?void 0:$.maNhaThau)||G.maDinhDanh||G.maNhaThau||"",K=W.filter(R=>R.vaiTro!=="Đứng đầu liên danh");window._jvDataMap[f.id]={members:K,leadName:D,leadCode:B},Y=`<a href="#" onclick="event.preventDefault(); var d=window._jvDataMap['${f.id}']; d && window.openMoThauJVViewModal(d.members, d.leadName, d.leadCode)" class="fw-bold text-success link-hover" title="Xem thành viên liên danh">👥 ${H}</a>`}else $?Y=`<a href="#" onclick="event.preventDefault(); window.editNhaThau('${$.id}', true)" class="text-blue fw-bold link-hover">${H}</a>`:Y=`<span class="fw-bold text-success">${H}</span>`;et=`${Y}<br><small class="text-muted">Giá: ${this.model.formatCurrency(U)}</small>`}else et="--"}else et=f.nhaThauTrungThauId?P+'<br><small class="text-muted">Giá: '+this.model.formatCurrency(f.giaTrungThau)+"</small>":"--";const it=y.map(k=>{const I=k.phienBan||"00",q=k.id===f.id?"selected":"";return`<option value="${k.id}" ${q}>${I}</option>`}).join(""),L=`
                <select class="form-control version-droplist" onchange="window.changePackageRowVersion('${T}', this.value)" style="width: 52px; display: inline-block; padding: 2px; height: 22px; font-size: 0.8rem; border-radius: 4px; border: 1px solid var(--border-color, #ccc); background-color: var(--bg-card); color: var(--text-main); text-align-last: center; cursor: pointer; margin: 0; outline: none; vertical-align: middle;">
                    ${it}
                </select>
            `,N=f.id===b.id,A=f.trangThai==="Đã có kết quả"||f.trangThai==="Hủy thầu";let z="";return N&&(A?z=`
                        <button class="action-btn btn-view" onclick="window.editGoiThau('${f.id}', true)" title="Xem chi tiết Gói thầu">
                            <i data-lucide="eye" style="color: var(--primary);"></i>
                        </button>
                        <button class="action-btn btn-delete" onclick="window.deleteGoiThau('${f.id}')" title="Xóa">
                            <i data-lucide="trash-2"></i>
                        </button>
                    `:z=`
                        <button class="action-btn btn-edit" onclick="window.editGoiThau('${f.id}')" title="Sửa">
                            <i data-lucide="edit-2"></i>
                        </button>
                        <button class="action-btn btn-delete" onclick="window.deleteGoiThau('${f.id}')" title="Xóa">
                            <i data-lucide="trash-2"></i>
                        </button>
                    `),`
                <tr>
                    <td>
                        <div style="display: inline-flex; align-items: center; gap: 6px; line-height: 1; vertical-align: middle;">
                            <a href="#" onclick="event.preventDefault(); window.showPackageDetails('${f.id}')" class="text-blue fw-bold link-hover" title="Xem chi tiết Gói thầu" style="display: inline-flex; align-items: center; line-height: 1;"><span class="detail-code" style="margin: 0; line-height: 1;">${this.model.getPackageBaseCode(f.maGoiThau)||'<span class="text-muted">(Chưa nhập)</span>'}</span></a>
                            <span style="color: var(--text-muted); font-size: 0.85rem; line-height: 1; display: inline-flex; align-items: center;">-</span>
                            ${L}
                        </div>
                    </td>
                    <td style="min-width: 240px; max-width: 320px;" class="text-wrap"><a href="#" onclick="event.preventDefault(); window.showPackageDetails('${f.id}')" class="text-blue fw-bold link-hover">${f.tenGoiThau}</a></td>
                    <td style="min-width: 240px; max-width: 320px;" class="text-wrap">${S?`<a href="#" onclick="event.preventDefault(); window.showKeHoachDetails('`+S.id+`')" class="text-blue fw-bold link-hover">`+S.tenKeHoach+"</a>":'<span class="text-danger">Không liên kết</span>'}</td>
                    <td class="fw-bold">${this.model.formatCurrency(f.giaGoiThau)}</td>
                    <td>${f.hinhThucLuaChon}</td>
                    <td>${this.getStatusBadge(f.trangThai)}</td>
                    <td style="min-width: 200px; max-width: 300px;" class="text-wrap">${et}</td>
                    <td class="text-right">
                        <div class="action-btn-group">
                            ${z}
                        </div>
                    </td>
                </tr>
            `}).join(""),window.renderTablePagination&&window.renderTablePagination("goithau-pagination",h,g,s);lucide.createIcons(),this.enhanceTableHeaders("goithau-table","goithau")}function Gt(c){const t=document.getElementById("form-goithau"),a=document.querySelector("#modal-goithau .modal-card");t&&a&&!a.contains(t)&&a.appendChild(t),window._editingInPlace=!1;const n=document.getElementById("detail-workflow-tabs-header");n&&(n.style.display="flex");const i=document.getElementById("tab-goithau-detail");if(!i||!i.classList.contains("active")){window.switchTab("goithau-detail",c);return}this._currentWorkflowPackageId!==c&&(this._inPlaceEditMode=!1,this._biddingInfoEditMode=!1);const e=this.model.state.goithau.find(S=>S.id===c);if(!e)return;const o=e.phuongThucLuaChon==="Một giai đoạn hai túi hồ sơ";let l=!1,u=!1,d=!1;if(e.danhGiaHsdtMetadata)try{const S=JSON.parse(e.danhGiaHsdtMetadata);o?S.is1G2T&&(l=!!(S.technical&&S.technical.saved),u=!!(S.financial&&S.financial.saved)):d=!!S.saved}catch(S){console.error("Error parsing evaluation metadata:",S)}const g=this.model.state.thongtinmothau.filter(S=>String(S.goiThauId)===String(e.id)).filter(gt).some(S=>S.giaDuThau&&S.giaDuThau>0),s=[{id:"preparation",label:"Thông tin gói thầu"}];if(e.trangThai==="Chuẩn bị")s.push({id:"preparation_action",label:"Chuẩn bị"});else if(o){s.push({id:"opening_tech",label:e.trangThai==="Đang mời thầu"?"Thông tin mời thầu":"Biên bản mở HSĐXKT"}),e.trangThai!=="Đang mời thầu"&&e.trangThai!=="Đã mở thầu"&&s.push({id:"eval_tech",label:"Báo cáo đánh giá E-HSĐXKT"});let S=!1;if(e.danhGiaHsdtMetadata)try{const w=JSON.parse(e.danhGiaHsdtMetadata);w.is1G2T&&w.technical&&(S=!!w.technical.qualifiedSaved)}catch{}l&&s.push({id:"qualified",label:"Danh sách nhà thầu đạt kỹ thuật"}),l&&S&&s.push({id:"opening_fin",label:"Biên bản mở E-HSĐXTC"}),l&&S&&g&&s.push({id:"eval_fin",label:"Báo cáo đánh giá E-HSĐXTC"}),l&&S&&g&&(u||e.trangThai==="Đã có kết quả")&&s.push({id:"result",label:"Kết quả lựa chọn nhà thầu"})}else s.push({id:"opening",label:e.trangThai==="Đang mời thầu"?"Thông tin mời thầu":"Biên bản mở thầu"}),e.trangThai!=="Đang mời thầu"&&e.trangThai!=="Đã mở thầu"&&s.push({id:"eval_tech",label:"Báo cáo đánh giá E-HSDT"}),(d||e.trangThai==="Đã có kết quả")&&s.push({id:"result",label:"Kết quả lựa chọn nhà thầu"});(!s.some(S=>S.id===this._currentWorkflowTab)||this._currentWorkflowPackageId!==c)&&(this._currentWorkflowTab=s[0]?s[0].id:"preparation",this._currentWorkflowPackageId=c);const p=document.getElementById("btn-edit-goithau-fullpage"),m=document.getElementById("btn-edit-award-result");p&&(this._currentWorkflowTab==="preparation"&&e.trangThai!=="Đang chấm thầu"&&e.trangThai!=="Đã có kết quả"&&e.trangThai!=="Hủy thầu"&&!this._inPlaceEditMode?(p.style.display="flex",p.onclick=()=>{this._inPlaceEditMode=!0,this.showPackageDetails(c)}):p.style.display="none"),m&&(this._currentWorkflowTab==="result"&&(e.trangThai==="Đã có kết quả"||e.trangThai==="Hủy thầu")?(m.style.display="flex",m.onclick=async()=>{e.trangThai="Đang chấm thầu";const S=["Không đạt yêu cầu về tính hợp lệ","Không đạt yêu cầu về năng lực, kinh nghiệm","Không đạt yêu cầu kỹ thuật","Nhà thầu xếp hạng 1 trúng thầu","Đánh giá theo quy trình 2. Nhà thầu giá thấp hơn trúng thầu",""];this.model.state.thongtinmothau.filter(M=>String(M.goiThauId)===String(c)).forEach(M=>{M.lyDoTruot&&S.includes(M.lyDoTruot.trim())&&(M.lyDoTruot="")}),this.model.persistData("thongtinmothau"),this.model.persistData("goithau"),window.appController.autoSync(),this.showPackageDetails(c)}):m.style.display="none"),this.model.getLatestPlan(e.keHoachId);const v=document.getElementById("detail-workflow-code"),b=document.getElementById("detail-workflow-status-badge"),T=document.getElementById("detail-workflow-title");v&&(v.innerText=e.maGoiThau||"Gói thầu"),b&&(b.innerHTML=this.getStatusBadge(e.trangThai)),T&&(T.innerText=e.tenGoiThau||"Chưa nhập tên");const y=document.getElementById("detail-workflow-version-select");if(y){const S=e.rootId||e.id,w=this.model.state.goithau.filter(P=>(P.rootId||P.id)===S),M={};w.forEach(P=>{const et=P.phienBan||"00";if(!M[et])M[et]=P;else{const it=this.model.getLatestPlan(P.keHoachId),L=this.model.getLatestPlan(M[et].keHoachId),N=it&&parseInt(it.phienBan)||0,A=L&&parseInt(L.phienBan)||0;N>A&&(M[et]=P)}});const C=Object.values(M);C.sort((P,et)=>parseInt(P.phienBan||0)-parseInt(et.phienBan||0));const V=document.getElementById("detail-workflow-version-separator");C.length>=2?(V&&(V.style.display="inline-block"),y.style.display="inline-block",y.innerHTML=C.map(P=>{const et=P.phienBan||"00",it=(P.phienBan||"00")===(e.phienBan||"00");return`<option value="${P.id}" ${it?"selected":""}>${et}</option>`}).join(""),y.onchange=P=>{this.showPackageDetails(P.target.value)},window.initCustomSelect&&window.initCustomSelect("detail-workflow-version-select")):(V&&(V.style.display="none"),y.style.display="none")}const x=document.getElementById("detail-workflow-tabs-header");x&&(x.style.display="flex",x.innerHTML=s.map(S=>{const w=this._currentWorkflowTab===S.id?"active":"",M=this._currentWorkflowTab===S.id?"background: var(--bg-card); color: var(--primary); border: 1px solid var(--border-color); border-bottom: 2px solid var(--primary); font-weight: 700;":"background: transparent; color: var(--text-muted); border: 1px solid transparent; cursor: pointer;";return`<button type="button" class="btn ${w}" data-workflow-tab="${S.id}" style="padding: 10px 18px; border-radius: var(--radius-md) var(--radius-md) 0 0; font-size: 0.82rem; transition: all 0.2s; ${M}">${S.label}</button>`}).join(""),x.querySelectorAll("[data-workflow-tab]").forEach(S=>{S.addEventListener("click",()=>{this._inPlaceEditMode=!1,this._biddingInfoEditMode=!1,this._currentWorkflowTab=S.getAttribute("data-workflow-tab"),this.showPackageDetails(c)})}));const f=document.getElementById("detail-workflow-content-wrapper");if(f){switch(f.innerHTML="",this._currentWorkflowTab){case"preparation":{const L=this.model.getLatestPlan(e.keHoachId),N=L?this.model.state.chudautu.find(k=>k.id===L.chuDauTuId):null,A=N?N.tenChuDauTu:"Không rõ",z=L?L.tenKeHoach:"Không rõ";if(e.trangThai==="Chuẩn bị"?`${e.id}`:`${e.trangThai}`,f.innerHTML=`
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
                                        <span style="color: var(--text-main); font-weight: 700; max-width: 60%; text-align: right;">${A}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Kế hoạch liên kết</span>
                                        <span style="color: var(--text-main); font-weight: 700; max-width: 60%; text-align: right;">${z}</span>
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
                `,lucide.createIcons(),this._inPlaceEditMode){const k=document.getElementById("ip-yeucauthamdinh");if(k){const j=()=>{const $=k.value==="Có";document.getElementById("wrapper-sobaocaothamdinh").style.display=$?"flex":"none",document.getElementById("wrapper-ngaybaocaothamdinh").style.display=$?"flex":"none"};k.onchange=j,j()}const I=document.getElementById("btn-save-inplace");I&&(I.onclick=async()=>{const j=document.getElementById("ip-dangtai").value,$=document.getElementById("ip-dongthau").value,G=document.getElementById("ip-mothau").value,H=document.getElementById("ip-soquyetdinh").value,U=document.getElementById("ip-ngayquyetdinh").value,Y=document.getElementById("ip-yeucauthamdinh").value,W=document.getElementById("ip-sobaocaothamdinh").value,_=document.getElementById("ip-ngaybaocaothamdinh").value,D={thoiGianDangTai:j?this.model.convertDMYHMSToYMDHMS(j):"",thoiGianDongThau:$?this.model.convertDMYHMSToYMDHMS($):"",thoiGianMoThau:G?this.model.convertDMYHMSToYMDHMS(G):"",soQuyetDinh:H,ngayQuyetDinh:U?this.model.convertDMYToYMD(U):"",yeuCauThamDinhHsmt:Y,soBaoCaoThamDinhHsmt:Y==="Không"?"":W,ngayBaoCaoThamDinhHsmt:Y==="Không"||!_?"":this.model.convertDMYToYMD(_)},B=e.thoiGianDangTai?String(e.thoiGianDangTai).trim():"",K=String(D.thoiGianDangTai||"").trim(),R=e.thoiGianDongThau?String(e.thoiGianDongThau).trim():"",Q=String(D.thoiGianDongThau||"").trim(),F=e.thoiGianMoThau?String(e.thoiGianMoThau).trim():"",X=String(D.thoiGianMoThau||"").trim();let at=!1;if(B!==""){const E=(ot,Z)=>{if(!ot&&!Z)return!1;if(!ot||!Z)return!0;const lt=new Date(ot),st=new Date(Z);return isNaN(lt.getTime())||isNaN(st.getTime())?ot!==Z:lt.getTime()!==st.getTime()},tt=E(B,K),J=E(R,Q),nt=E(F,X);(tt||J||nt)&&(at=!0)}let O=c;if(at){const E=e.rootId||e.id,tt=this.model.state.goithau.filter(Z=>(Z.rootId||Z.id)===E),J=Math.max(...tt.map(Z=>parseInt(Z.phienBan)||0)),nt=String(J+1).padStart(2,"0");tt.forEach(Z=>{Z.isLatest=0,Z.is_latest=0});const ot=window.generateUUID();if(O=ot,this.model.state.selectedPackageVersion||(this.model.state.selectedPackageVersion={}),this.model.state.selectedPackageVersion[E]=ot,this.model.state.goithau.push({...e,...D,id:ot,phienBan:nt,isLatest:1,is_latest:1,rootId:E,createdAt:e.createdAt||Math.floor(Date.now()/1e3),created_at:e.created_at||Math.floor(Date.now()/1e3),updatedAt:Math.floor(Date.now()/1e3),updated_at:Math.floor(Date.now()/1e3)}),Array.isArray(this.model.state.hopdong)&&(this.model.state.hopdong=this.model.state.hopdong.map(Z=>{if(Z.goiThauIds&&Z.goiThauIds.includes(c)){const lt=[...Z.goiThauIds];return lt.includes(ot)||lt.push(ot),{...Z,goiThauIds:lt}}return Z}),this.model.persistData("hopdong")),Array.isArray(this.model.state.thongtinmothau)){const lt=this.model.state.thongtinmothau.filter(st=>String(st.goiThauId)===String(c)).map(st=>({...st,id:window.generateUUID(),goiThauId:ot}));this.model.state.thongtinmothau=[...this.model.state.thongtinmothau,...lt],this.model.persistData("thongtinmothau")}}else Object.assign(e,D),e.updatedAt=Math.floor(Date.now()/1e3),e.updated_at=e.updatedAt;if(await this.model.persistData("goithau"),window.appController&&typeof window.appController.autoSync=="function")try{await window.appController.autoSync()}catch(E){console.error("Sync failed:",E)}this._inPlaceEditMode=!1,this.showPackageDetails(O),await this.customAlert("Thành công","Cập nhật thông tin gói thầu thành công!","check-circle")});const q=document.getElementById("btn-cancel-inplace");q&&(q.onclick=()=>{this._inPlaceEditMode=!1,this.showPackageDetails(c)})}}break;case"preparation_action":{let L="";e.trangThai==="Chuẩn bị"?L=`
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
                    `:L=`
                        <div style="width: 64px; height: 64px; border-radius: 50%; background: rgba(16, 185, 129, 0.08); display: flex; align-items: center; justify-content: center; margin: 0 auto 20px;">
                            <i data-lucide="check-circle" style="width: 32px; height: 32px; color: #10b981;"></i>
                        </div>
                        <h4 style="font-weight: 700; color: var(--text-main); margin-bottom: 8px; font-size: 1.1rem;">Gói thầu đã phát hành HSMT</h4>
                        <p style="font-size: 0.85rem; max-width: 460px; margin-left: auto; margin-right: auto; line-height: 1.5; color: var(--text-muted);">
                            Gói thầu này đã hoàn thành bước chuẩn bị và đã phát hành hồ sơ mời thầu (Trạng thái hiện tại: <strong style="color: var(--primary);">${e.trangThai}</strong>). Bạn có thể chuyển sang các tab tiếp theo để xem/nhập thông tin mở thầu và chấm thầu.
                        </p>
                    `,f.innerHTML=`
                    <div style="text-align: center; padding: 48px; color: var(--text-muted); background: var(--bg-card); border-radius: var(--radius-lg); border: 1px dashed var(--border-color); margin: 20px 0; display: flex; flex-direction: column; align-items: center; justify-content: center;">
                        ${L}
                    </div>
                `,lucide.createIcons()}break;case"opening":case"opening_tech":if(e.trangThai==="Chuẩn bị"){const L=this.model.getLatestPlan(e.keHoachId),N=L?this.model.state.chudautu.find(z=>z.id===L.chuDauTuId):null,A=N?N.tenChuDauTu:"Không rõ";f.innerHTML=`
                    <div style="background: var(--neutral-soft); padding: 16px 20px; border-radius: var(--radius-md); border: 1px solid var(--border-color); margin-bottom: 20px;">
                        <div style="font-weight: 700; color: var(--primary); border-bottom: 1px solid rgba(59, 130, 246, 0.2); padding-bottom: 4px; margin-bottom: 12px;">Thông số Gói thầu</div>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 8px; font-size: 0.82rem;">
                            <div>• <strong>Chủ đầu tư:</strong> <span class="text-dark fw-bold">${A}</span></div>
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
                `,lucide.createIcons()}else if(e.trangThai==="Đang mời thầu"){const L=this.model.getLatestPlan(e.keHoachId),N=L?this.model.state.chudautu.find(j=>j.id===L.chuDauTuId):null,A=N?N.tenChuDauTu:"Không rõ";f.innerHTML=`
                    <div style="background: var(--neutral-soft); padding: 16px 20px; border-radius: var(--radius-md); border: 1px solid var(--border-color); margin-bottom: 20px;">
                        <div style="font-weight: 700; color: var(--primary); border-bottom: 1px solid rgba(59, 130, 246, 0.2); padding-bottom: 4px; margin-bottom: 12px;">Thông số Gói thầu</div>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 8px; font-size: 0.82rem;">
                            <div>• <strong>Chủ đầu tư:</strong> <span class="text-dark fw-bold">${A}</span></div>
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
                `,window.appController&&(window.appController._loadGiaHanRows(e.giaHanList||[]),window.appController._loadYeuCauLamRoRows(e.yeuCauLamRoList||[]),window.appController._loadTraLoiLamRoRows(e.traLoiLamRoList||[])),this._biddingInfoEditMode||(document.querySelectorAll("#gt-giahan-tbody input, #gt-yeucaulamro-tbody input, #gt-traloilamro-tbody input").forEach(j=>{j.disabled=!0,j.style.background="var(--neutral-soft)",j.style.cursor="not-allowed"}),document.querySelectorAll("#gt-giahan-tbody td:last-child, #gt-yeucaulamro-tbody td:last-child, #gt-traloilamro-tbody td:last-child").forEach(j=>{j.style.display="none"}));const z=document.getElementById("btn-them-giahan");z&&(z.onclick=()=>window.appController.addGiaHanRow());const k=document.getElementById("btn-them-yeucaulamro");k&&(k.onclick=()=>window.appController.addYeuCauLamRoRow());const I=document.getElementById("btn-them-traloilamro");I&&(I.onclick=()=>window.appController.addTraLoiLamRoRow());const q=document.getElementById("btn-luu-thongtinmoithau");q&&(q.onclick=async()=>{if(!this._biddingInfoEditMode){this._biddingInfoEditMode=!0,this.showPackageDetails(c);return}const j=window.appController._collectGiaHanRows(),$=window.appController._collectYeuCauLamRoRows(),G=window.appController._collectTraLoiLamRoRows();if(e.giaHanList=j,e.yeuCauLamRoList=$,e.traLoiLamRoList=G,j.length>0){const H=j[j.length-1];if(H.thoiGianDongThau){const U=this.model.convertDMYHMSToYMDHMS(H.thoiGianDongThau);e.thoiGianDongThau=U,e.thoiGianMoThau=U}}if(await this.model.persistData("goithau"),window.appController&&typeof window.appController.autoSync=="function")try{await window.appController.autoSync()}catch(H){console.error("Sync failed:",H)}this._biddingInfoEditMode=!1,this.showPackageDetails(c),await this.customAlert("Thành công","Lưu thông tin mời thầu thành công!","check-circle")}),lucide.createIcons()}else f.innerHTML=`
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
                `,window.appController.renderMoThauPanel();break;case"eval_tech":f.innerHTML=`
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
            `,window.appController.currentDanhGiaTab="technical",window.appController.renderDanhGiaHsdtPanel();break;case"eval_fin":f.innerHTML=`
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
            `,window.appController.currentDanhGiaTab="financial",window.appController.renderDanhGiaHsdtPanel();break;case"qualified":const w=this.model.state.thongtinmothau.filter(L=>String(L.goiThauId)===String(e.id)).filter(gt);if(w.length===0)f.innerHTML=`
                    <div style="text-align: center; padding: 48px; color: var(--text-muted);">
                        <i data-lucide="shield-alert" style="width: 48px; height: 48px; margin: 0 auto 16px; color: var(--warning);"></i>
                        <h4 style="font-weight: 700; color: var(--text-main);">Chưa có Nhà thầu đạt kỹ thuật</h4>
                        <p style="font-size: 0.85rem;">Vui lòng hoàn thành và Lưu Báo cáo đánh giá E-HSĐXKT trước.</p>
                    </div>
                `;else{let L={is1G2T:!0,technical:{saved:!1},financial:{saved:!1}};if(e.danhGiaHsdtMetadata)try{const q=JSON.parse(e.danhGiaHsdtMetadata);q.is1G2T?L=q:L={is1G2T:!0,technical:q.soBaoCao?q:{saved:!1},financial:{saved:!1}}}catch(q){console.error("Failed to parse metadata",q)}L.technical||(L.technical={saved:!0});const N=L.technical.soQdPheDuyetKt||"",A=L.technical.ngayQdPheDuyetKt||"",z=!!L.technical.qualifiedSaved,k=this._editingState&&this._editingState[this._currentWorkflowTab],I=z&&!k||e.trangThai==="Đã có kết quả";if(f.innerHTML=`
                    <div style="background: var(--neutral-soft); padding: 16px 20px; border-radius: var(--radius-md); border: 1px solid var(--border-color); margin-bottom: 24px;">
                        <div style="font-weight: 700; color: var(--primary); border-bottom: 1px solid rgba(59, 130, 246, 0.2); padding-bottom: 4px; margin-bottom: 12px;">QĐ phê duyệt danh sách nhà thầu đạt kỹ thuật</div>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px;">
                            <div class="form-group" style="margin-bottom: 0;">
                                <label style="font-weight: 600; font-size: 0.85rem; margin-bottom: 4px; display: block;">Số QĐ phê duyệt danh sách nhà thầu đạt kỹ thuật <span class="text-danger">*</span></label>
                                <input type="text" id="qualified-so-qd" class="form-control" value="${N}" placeholder="Ví dụ: 120/QĐ-CDT" style="width: 100%;" ${I?"readonly":""}>
                                <span class="error-text" style="color: var(--danger); font-size: 0.75rem; display: none; margin-top: 4px;">Vui lòng nhập Số QĐ phê duyệt!</span>
                            </div>
                            <div class="form-group" style="margin-bottom: 0;">
                                <label style="font-weight: 600; font-size: 0.85rem; margin-bottom: 4px; display: block;">Ngày QĐ phê duyệt <span class="text-danger">*</span></label>
                                <input type="date" id="qualified-ngay-qd" class="form-control" value="${A?this.model.formatForDateInput(A):""}" style="width: 100%;" ${I?"readonly":""}>
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
                                 ${w.map(q=>`
                                     <tr>
                                         ${e.phanLo==="Có"?`
                                             <td>${q.maPhanLo||"--"}</td>
                                             <td>${q.tenPhanLo||"--"}</td>
                                         `:""}
                                         <td>${q.maNhaThau||q.maDinhDanh||"--"}</td>
                                         <td class="fw-bold">${q.tenNhaThau||"--"}</td>
                                         <td style="text-align: center;">
                                             <span class="badge badge-success" style="font-size: 0.75rem; font-weight: 700; padding: 4px 8px; border-radius: 4px;">Đạt kỹ thuật</span>
                                         </td>
                                     </tr>
                                 `).join("")}
                             </tbody>
                         </table>
                     </div>
                     <div style="display: flex; justify-content: flex-end; margin-top: 16px;">
                         ${I?"":`
                             <button class="btn btn-primary" id="btn-save-qualified-decision" style="padding: 10px 24px; font-weight: 700; display: inline-flex; align-items: center; gap: 8px;"><i data-lucide="save"></i> Lưu QĐ phê duyệt</button>
                         `}
                     </div>
                 `,!I){const q=f.querySelector("#btn-save-qualified-decision");q&&(q.onclick=async()=>{const j=f.querySelector("#qualified-so-qd"),$=f.querySelector("#qualified-ngay-qd"),G=j.value.trim(),H=$.value.trim();let U=!1;G?(j.closest(".form-group").querySelector(".error-text").style.display="none",j.closest(".form-group").classList.remove("invalid")):(U=!0,j.closest(".form-group").querySelector(".error-text").style.display="block",j.closest(".form-group").classList.add("invalid")),H?($.closest(".form-group").querySelector(".error-text").style.display="none",$.closest(".form-group").classList.remove("invalid")):(U=!0,$.closest(".form-group").querySelector(".error-text").style.display="block",$.closest(".form-group").classList.add("invalid")),!U&&(L.technical.soQdPheDuyetKt=G,L.technical.ngayQdPheDuyetKt=this.model.convertDMYToYMD(H),L.technical.qualifiedSaved=!0,e.danhGiaHsdtMetadata=JSON.stringify(L),this.model.persistData("goithau"),window.appController.autoSync(),this._editingState&&(this._editingState[this._currentWorkflowTab]=!1),await this.customAlert("Thành công","Đã lưu QĐ phê duyệt danh sách nhà thầu đạt kỹ thuật thành công!","check-circle"),this._currentWorkflowTab="opening_fin",this.showPackageDetails(e.id))})}}break;case"opening_fin":const C=this.model.state.thongtinmothau.filter(L=>String(L.goiThauId)===String(e.id)).filter(gt);if(C.length===0)f.innerHTML=`
                    <div style="text-align: center; padding: 48px; color: var(--text-muted);">
                        <i data-lucide="lock" style="width: 48px; height: 48px; margin: 0 auto 16px; color: var(--text-muted);"></i>
                        <h4 style="font-weight: 700; color: var(--text-main);">Chưa mở túi hồ sơ Đề xuất Tài chính</h4>
                        <p style="font-size: 0.85rem;">Vui lòng hoàn thành Đánh giá kỹ thuật để xác định danh sách nhà thầu đủ điều kiện mở túi HSĐXTC.</p>
                    </div>
                `;else{const N=C.some(k=>k.giaDuThau&&k.giaDuThau>0),A=this._editingState&&this._editingState[this._currentWorkflowTab],z=N&&!A||e.trangThai==="Đã có kết quả";if(f.innerHTML=`
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                        <h4 style="font-weight: 700; font-size: 1.05rem; color: var(--text-main); margin: 0;">
                            Biên bản mở hồ sơ đề xuất tài chính (E-HSĐXTC)
                        </h4>
                        ${z?"":`
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
                                ${C.map(k=>{const I=this.model.formatVND(k.giaDuThau)||"",q=(k.tyLeGiamGia||0).toString().replace(".",","),j=this.model.formatVND(k.giaSauGiamGia)||"",$=k.hieuLucHsdt||"",G=k.thoiGianThucHien||e.thoiGianThucHien||"";return z?`
                                            <tr>
                                                <td><strong>${k.maNhaThau||k.maDinhDanh||"--"}</strong></td>
                                                <td><strong>${k.tenNhaThau}</strong></td>
                                                <td>${I||"--"}</td>
                                                <td style="text-align:right;">${q}</td>
                                                <td>${j||"--"}</td>
                                                <td>${$?$+" ngày":"--"}</td>
                                                <td>${G||"--"}</td>
                                            </tr>
                                        `:`
                                            <tr data-opening-bid-id="${k.id}">
                                                <td><strong>${k.maNhaThau||k.maDinhDanh||"--"}</strong></td>
                                                <td><strong>${k.tenNhaThau}</strong></td>
                                                <td><input type="text" class="form-control op-gia-du-thau" value="${I}" placeholder="Nhập giá..." style="padding:4px 8px; font-size:0.8rem;"></td>
                                                <td><input type="text" class="form-control op-ty-le-giam" value="${q}" placeholder="0" style="text-align:right; padding:4px 8px; font-size:0.8rem;"></td>
                                                <td><input type="text" class="form-control op-gia-sau-giam" value="${j}" readonly style="background:#f1f5f9; padding:4px 8px; font-size:0.8rem;"></td>
                                                <td><input type="text" class="form-control op-hieu-luc-hsdt" value="${$?$+" ngày":""}" placeholder="Ví dụ: 90 ngày" style="padding:4px 8px; font-size:0.8rem;"></td>
                                                <td><input type="text" class="form-control op-thoi-gian-th" value="${G}" placeholder="Ví dụ: 60 ngày" style="padding:4px 8px; font-size:0.8rem;"></td>
                                            </tr>
                                        `}).join("")}
                            </tbody>
                        </table>
                    </div>
                    <div style="display:flex; justify-content:flex-end;">
                        ${z?"":`
                            <button class="btn btn-primary" id="btn-save-opening-fin" style="padding:10px 24px; font-weight:700;"><i data-lucide="save"></i> Lưu Biên bản mở HSĐXTC</button>
                        `}
                    </div>
                `,!z){const k=f.querySelectorAll("#opening-fin-table tbody tr");k.forEach($=>{const G=$.querySelector(".op-gia-du-thau"),H=$.querySelector(".op-ty-le-giam"),U=$.querySelector(".op-gia-sau-giam"),Y=()=>{const _=this.model.parseVND(G.value),D=H.value||"0",B=parseFloat(D.replace(/,/g,"."))||0,K=_*(1-B/100);U.value=this.model.formatVND(K)||""};(_=>{_&&_.addEventListener("input",D=>{const B=D.target.selectionStart,K=D.target.value.length,R=this.model.formatVND(D.target.value);D.target.value=R;const Q=R.length,F=B+(Q-K);D.target.setSelectionRange(F,F)})})(G),G&&G.addEventListener("input",Y),H&&H.addEventListener("input",Y)});const I=document.getElementById("btn-opening-fin-export-excel");I&&(I.onclick=()=>{const $=(e.maGoiThau||"GoiThau").replace(/[^a-zA-Z0-9_-]/g,"").trim().substring(0,30);ft(`/api/export-opening-fin-template?package_id=${e.id}&package_name=${encodeURIComponent($)}`,`Mau_Mo_Tai_Chinh_${$}.xlsx`)});const q=document.getElementById("btn-opening-fin-import-excel");q&&(q.onclick=()=>{window.appController.openExcelImportModal("opening_fin")});const j=document.getElementById("btn-save-opening-fin");j&&(j.onclick=async()=>{k.forEach($=>{var U,Y,W,_,D;const G=$.getAttribute("data-opening-bid-id"),H=this.model.state.thongtinmothau.find(B=>B.id===G);if(H){H.giaDuThau=this.model.parseVND(((U=$.querySelector(".op-gia-du-thau"))==null?void 0:U.value)||"");const B=((Y=$.querySelector(".op-ty-le-giam"))==null?void 0:Y.value)||"0";H.tyLeGiamGia=parseFloat(B.replace(/,/g,"."))||0,H.giaSauGiamGia=this.model.parseVND(((W=$.querySelector(".op-gia-sau-giam"))==null?void 0:W.value)||""),H.hieuLucHsdt=parseInt(((_=$.querySelector(".op-hieu-luc-hsdt"))==null?void 0:_.value)||"0",10);const K=((D=$.querySelector(".op-thoi-gian-th"))==null?void 0:D.value.trim())||"";H.thoiGianThucHien=K||H.thoiGianThucHien||e.thoiGianThucHien||""}}),this.model.persistData("thongtinmothau"),this.model.persistData("goithau"),window.appController.autoSync(),this._editingState&&(this._editingState[this._currentWorkflowTab]=!1),await this.customAlert("Thành công","Đã lưu Biên bản mở thầu E-HSĐXTC thành công!","check-circle"),this._currentWorkflowTab="eval_fin",this.showPackageDetails(c)})}}break;case"result":const V=this.model.state.thongtinmothau.filter(L=>String(L.goiThauId)===String(e.id)&&gt(L));if(e.trangThai==="Đã có kết quả"){!e.nhaThauTrungThauId&&V.length===1&&(e.nhaThauTrungThauId=V[0].nhaThauId||V[0].id);const L=V.find(_=>String(_.nhaThauId)===String(e.nhaThauTrungThauId))||V[0],N=e.giaGoiThau-(e.giaTrungThau||0),A=e.giaGoiThau>0?(N/e.giaGoiThau*100).toFixed(2):"0,00";let z="",k=!1,I=[],q=[];if(e.phanLo==="Có"&&(I=(typeof e.phanLoList=="string"?JSON.parse(e.phanLoList||"[]"):e.phanLoList||[]).filter(D=>D.nhaThauTrungThauId),q=[...new Set(I.map(D=>String(D.nhaThauTrungThauId)).filter(Boolean))],q.length>1&&(k=!0)),k)window._lotWinnersMap=window._lotWinnersMap||{},window._lotWinnersMap[e.id]=I.map(_=>{const D=this.model.state.thongtinmothau.find(F=>String(F.goiThauId)===String(e.id)&&String(F.nhaThauId)===String(_.nhaThauTrungThauId)),B=this.model.state.nhathau.find(F=>F.id===_.nhaThauTrungThauId),K=D?D.tenNhaThau:B?B.tenNhaThau:"Nhà thầu #"+_.nhaThauTrungThauId,R=D&&D.loaiNhaThau==="Liên danh";let Q=null;if(R){const F=D.thanhVienLienDanh||[],X=F.find(tt=>tt.vaiTro==="Đứng đầu liên danh"),at=(X==null?void 0:X.tenNhaThau)||K,O=(X==null?void 0:X.maSoThue)||(B==null?void 0:B.maSoThue)||(B==null?void 0:B.maNhaThau)||D.maDinhDanh||D.maNhaThau||"";Q={members:F.filter(tt=>tt.vaiTro!=="Đứng đầu liên danh"),leadName:at,leadCode:O}}return{maPhanLo:_.maPhanLo,tenPhanLo:_.tenPhanLo,nhaThauTrungThauId:_.nhaThauTrungThauId,tenNhaThau:K,giaTrungThau:_.giaTrungThau,isJV:R,jvData:Q}}),z=`
                        <h5 style="margin:4px 0 0; font-size:1.1rem; font-weight:800; color:var(--primary);">
                            <a href="#" onclick="event.preventDefault(); window.showLotWinnersModal('${e.id}')" class="link-hover" style="color:var(--primary); text-decoration: none;" title="Xem chi tiết các nhà thầu trúng thầu">Có nhiều nhà thầu trúng thầu</a>
                        </h5>
                    `;else{const _=q.length===1?q[0]:e.nhaThauTrungThauId||(L?L.nhaThauId||L.id:null),D=V.find(B=>String(B.nhaThauId)===String(_))||L;if(D)if(D.loaiNhaThau==="Liên danh"){const B=D.thanhVienLienDanh||[],K=B.find(F=>F.vaiTro==="Đứng đầu liên danh"),R=B.filter(F=>F.vaiTro!=="Đứng đầu liên danh"),Q=this.model.state.nhathau.find(F=>String(F.id)===String(D.nhaThauId));window._jvDataMap=window._jvDataMap||{},window._jvDataMap[e.id]={members:R,leadName:(K==null?void 0:K.tenNhaThau)||D.tenNhaThau,leadCode:(K==null?void 0:K.maSoThue)||(Q==null?void 0:Q.maSoThue)||(Q==null?void 0:Q.maNhaThau)||D.maDinhDanh||D.maNhaThau||""},z=`
                                <div style="display: flex; flex-direction: column; gap: 4px;">
                                    <h5 style="margin:4px 0 0; font-size:1.1rem; font-weight:800; color:var(--primary);">
                                        <a href="#" onclick="event.preventDefault(); var d=window._jvDataMap['${e.id}']; d && window.openMoThauJVViewModal(d.members, d.leadName, d.leadCode)" class="link-hover" title="Xem chi tiết liên danh" style="color:var(--primary);">👥 ${D.tenNhaThau}</a>
                                    </h5>
                                </div>
                            `}else{const B=this.model.state.nhathau.find(R=>String(R.id)===String(D.nhaThauId)),K=B?B.maSoThue||B.maNhaThau:D.maDinhDanh||D.maNhaThau;z=`
                                <h5 style="margin:4px 0 0; font-size:1.1rem; font-weight:800; color:var(--primary);">
                                    <a href="#" onclick="event.preventDefault(); window.editNhaThau('${D.nhaThauId}', true)" class="link-hover" style="color:var(--primary);">${D.tenNhaThau}</a>
                                </h5>
                                <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 4px;">
                                    MST: <strong>${K||"Chưa có"}</strong>
                                </div>
                            `}else z='<h5 style="margin:4px 0 0; font-size:1.1rem; font-weight:800; color:var(--primary);">Chưa xác định</h5>'}const j=this.model.state.thongtinmothau.filter(_=>String(_.goiThauId)===String(e.id));j.sort((_,D)=>{const B=String(_.maPhanLo||"").toLowerCase(),K=String(D.maPhanLo||"").toLowerCase();return B.localeCompare(K,"vi",{numeric:!0})});const $=new Set;if(e.nhaThauTrungThauId&&$.add(String(e.nhaThauTrungThauId)),e.phanLo==="Có"&&e.phanLoList)try{(typeof e.phanLoList=="string"?JSON.parse(e.phanLoList):e.phanLoList).forEach(D=>{D.nhaThauTrungThauId&&$.add(String(D.nhaThauTrungThauId))})}catch(_){console.error(_)}const G={};j.forEach(_=>{const D=String(_.nhaThauId||_.id||"");D&&(G[D]||(G[D]=[]),G[D].push(_))});const H=e.phanLo==="Có",U=j.map((_,D)=>{String(_.nhaThauId||_.id);let B=!1,K="—",R="—";if(H){const E=(typeof e.phanLoList=="string"?JSON.parse(e.phanLoList||"[]"):e.phanLoList||[]).find(tt=>String(tt.maPhanLo)===String(_.maPhanLo)&&String(tt.nhaThauTrungThauId)===String(_.nhaThauId));E?(B=!0,K=this.model.formatCurrency(E.giaTrungThau||0),R=E.thoiGianGoiThau||"—"):R=_.thoiGianThucHien||_.thoiGianGoiThau||"—"}else e.nhaThauTrungThauId&&String(e.nhaThauTrungThauId)===String(_.nhaThauId)?(B=!0,K=this.model.formatCurrency(e.giaTrungThau||0),R=e.thoiGianGoiThau||"—"):R=_.thoiGianThucHien||_.thoiGianGoiThau||"—";const Q=B?'<span class="badge badge-success" style="font-size:0.75rem; padding: 4px 10px; background-color: rgba(16, 185, 129, 0.08); color: #059669; border: 1px solid rgba(16, 185, 129, 0.25);">Trúng thầu</span>':'<span class="badge badge-danger" style="font-size:0.75rem; padding: 4px 10px; background-color: rgba(239,68,68,0.08); color: #dc2626; border: 1px solid rgba(239,68,68,0.25);">Trượt thầu</span>';let F="";if(B)F="—";else if(F=_.lyDoTruot||"",!F)if(e.quyTrinhDanhGia==="quytrinh2"&&_.danhGiaKetLuan==="Không đánh giá")F="Đánh giá theo quy trình 2. Nhà thầu giá thấp hơn trúng thầu";else{const O=_.danhGiaKetLuan;if(O==="Không đạt"||O&&O.startsWith("Không đạt")){const E=[];_.danhGiaHopLe==="Không đạt"&&E.push("Đánh giá hợp lệ"),_.danhGiaNangLuc==="Không đạt"&&E.push("Đánh giá năng lực"),(_.danhGiaKyThuat==="Không đạt"||_.danhGiaKyThuat&&String(_.danhGiaKyThuat).toLowerCase().includes("không đạt"))&&E.push("Đánh giá kỹ thuật"),(_.danhGiaTaiChinh==="Không đạt"||_.danhGiaTaiChinh&&String(_.danhGiaTaiChinh).toLowerCase().includes("không đạt"))&&E.push("Đánh giá tài chính"),E.length>0?F=`Không đạt ở bước: ${E.join(", ")}`:F="Không đạt đánh giá chi tiết"}else F="Nhà thầu xếp hạng 1 trúng thầu"}const X=_.loaiNhaThau==="Liên danh";let at="";if(X){const O=_.thanhVienLienDanh||[],E=O.find(Z=>Z.vaiTro==="Đứng đầu liên danh"),tt=(E==null?void 0:E.tenNhaThau)||_.tenNhaThau,J=(E==null?void 0:E.maSoThue)||_.maDinhDanh||_.maNhaThau||"",nt=O.filter(Z=>Z.vaiTro!=="Đứng đầu liên danh"),ot=`${e.id}_result_bidder_${D}`;window._jvDataMap=window._jvDataMap||{},window._jvDataMap[ot]={members:nt,leadName:tt,leadCode:J},at=`<a href="#" onclick="event.preventDefault(); var d=window._jvDataMap['${ot}']; d && window.openMoThauJVViewModal(d.members, d.leadName, d.leadCode)" class="fw-bold text-success link-hover" title="Xem thành viên liên danh">👥 ${_.tenNhaThau||"--"}</a>`}else at=`<span class="fw-bold">${_.tenNhaThau||"--"}</span>`;return H?`
                            <tr>
                                <td>${_.maPhanLo||"—"}</td>
                                <td>${_.tenPhanLo||"—"}</td>
                                <td>${_.maNhaThau||_.maDinhDanh||"--"}</td>
                                <td>${at}</td>
                                <td class="fw-bold text-success">${K}</td>
                                <td>${R}</td>
                                <td style="text-align: center;">${Q}</td>
                                <td class="text-muted">${F}</td>
                            </tr>
                        `:`
                            <tr>
                                <td>${_.maNhaThau||_.maDinhDanh||"--"}</td>
                                <td>${at}</td>
                                <td class="fw-bold text-success">${K}</td>
                                <td>${R}</td>
                                <td style="text-align: center;">${Q}</td>
                                <td class="text-muted">${F}</td>
                            </tr>
                        `}).join("");let Y="";H?Y=`
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
                    `:Y=`
                        <tr>
                            <th style="width: 15%;">Mã nhà thầu</th>
                            <th style="width: 35%;">Tên nhà thầu</th>
                            <th style="width: 15%;">Giá trị trúng thầu</th>
                            <th style="width: 15%;">Thời gian thực hiện</th>
                            <th style="width: 10%; text-align: center;">Trạng thái</th>
                            <th style="width: 10%;">Lý do trượt thầu</th>
                        </tr>
                    `,f.innerHTML=`
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
                                ${z}
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
                                <h5 style="margin:4px 0 0; font-size:1.1rem; font-weight:800; color:var(--success);">${this.model.formatCurrency(N)} (${A}%)</h5>
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
                                ${Y}
                            </thead>
                            <tbody>
                                ${U}
                            </tbody>
                        </table>
                    </div>
                `;const W=document.getElementById("btn-export-docx-report");W&&(W.onclick=()=>{W.disabled=!0;const _=W.innerHTML;W.innerHTML='<i data-lucide="loader-2" class="animate-spin" style="width:16px;"></i> Đang xuất...',lucide.createIcons();const D=c,B={"X-Session-Token":sessionStorage.getItem("bf_session_token")||"","X-Username":sessionStorage.getItem("bf_username")||""};fetch(`/api/export-report/${D}`,{headers:B}).then(K=>{if(!K.ok)throw new Error("Không thể xuất báo cáo");return K.blob()}).then(K=>{const R=window.URL.createObjectURL(K),Q=document.createElement("a");Q.href=R,Q.download=`Bao_cao_ket_qua_danh_gia_ho_so_du_thau_${e.maGoiThau}.docx`,document.body.appendChild(Q),Q.click(),Q.remove(),window.URL.revokeObjectURL(R)}).catch(K=>{this.customAlert("Lỗi","Lỗi xuất báo cáo: "+K.message,"x-circle")}).finally(()=>{W.disabled=!1,W.innerHTML=_,lucide.createIcons()})})}else{const L=this.model.state.thongtinmothau.filter($=>String($.goiThauId)===String(e.id));L.sort(($,G)=>{const H=String($.maPhanLo||"").trim(),U=String(G.maPhanLo||"").trim();return H.localeCompare(U,"vi",{numeric:!0})}),this.model.state.thongtinmothau.filter($=>String($.goiThauId)===String(e.id)&&gt($));const{rankings:N,scores:A}=window.appController.calculateRankings(e,L),z=e.phuongPhapDanhGia==="Kết hợp giữa kỹ thuật và giá",k=$=>gt($),I=L.map(($,G)=>{const H=k($);let U="";if(e.quyTrinhDanhGia==="quytrinh2"&&$.danhGiaKetLuan==="Không đánh giá")U="Đánh giá theo quy trình 2. Nhà thầu giá thấp hơn trúng thầu";else if(H)U="Nhà thầu xếp hạng 1 trúng thầu";else{const at=String($.danhGiaHopLe||"").trim().toLowerCase(),O=String($.danhGiaNangLuc||"").trim().toLowerCase();at!=="đạt"?U="Không đạt yêu cầu về tính hợp lệ":O!=="đạt"?U="Không đạt yêu cầu về năng lực, kinh nghiệm":U="Không đạt yêu cầu kỹ thuật"}const Y=["Không đạt yêu cầu về tính hợp lệ","Không đạt yêu cầu về năng lực, kinh nghiệm","Không đạt yêu cầu kỹ thuật","Nhà thầu xếp hạng 1 trúng thầu","Đánh giá theo quy trình 2. Nhà thầu giá thấp hơn trúng thầu",""],_=!$.lyDoTruot||Y.includes($.lyDoTruot.trim())?U:$.lyDoTruot,D=this.model.formatVND($.giaSauGiamGia||$.giaDuThau||"")||"",B=$.thoiGianThucHien||e.thoiGianThucHien||"",K=B?B+" + Thời gian thực hiện các nghĩa vụ theo hợp đồng":"",R=N[$.id],Q=A[$.id],F=R?`Xếp hạng ${R}`:H?"--":"Không xếp hạng";let X=!1;if(H)if(e.phanLo==="Có"){const at=typeof e.phanLoList=="string"?JSON.parse(e.phanLoList||"[]"):e.phanLoList||[],O=$.maPhanLo,E=at.find(tt=>tt.maPhanLo===O);E&&E.nhaThauTrungThauId?X=String(E.nhaThauTrungThauId)===String($.nhaThauId||$.id):X=R===1}else e.nhaThauTrungThauId?X=String(e.nhaThauTrungThauId)===String($.nhaThauId||$.id):X=R===1;return`
                        <tr data-approve-bid-id="${$.id}" data-is-qualified="${H}" data-nt-id="${$.nhaThauId||$.id}"
                            data-default-price="${D}" data-default-duration-pkg="${B}" data-default-duration-ctr="${K}"
                            data-default-reason="${U}">
                            ${e.phanLo==="Có"?`
                                <td>${$.maPhanLo||"--"}</td>
                                <td>${$.tenPhanLo||"--"}</td>
                            `:""}
                            <td>${$.maNhaThau||$.maDinhDanh||"--"}</td>
                            <td class="fw-bold">${$.tenNhaThau||"--"}</td>
                            ${z?`
                                <td style="text-align: center; font-weight: 700; color: var(--primary);">${Q!=null&&!isNaN(Q)&&Q>0?Q.toFixed(2):"--"}</td>
                            `:""}
                            <td style="text-align: center; font-weight: bold; color: var(--primary);">${F}</td>
                            <td>
                                <select class="form-control row-status-select" style="padding:4px 8px; font-size:0.8rem; font-weight:600;" ${H?"":"disabled"}>
                                    <option value="truot" ${X?"":"selected"}>Trượt thầu</option>
                                    ${H?`<option value="trung" ${X?"selected":""}>Trúng thầu</option>`:""}
                                </select>
                            </td>
                            <td>
                                <input type="text" class="form-control row-ly-do-truot" value="${X?"":_}" placeholder="Lý do trượt..." style="padding:4px 8px; font-size:0.8rem; width:100%;" ${X?'disabled style="background:#f1f5f9;"':""}>
                            </td>
                            <td>
                                <input type="text" class="form-control row-gia-trung" value="${X?D:""}" placeholder="Giá trúng..." style="padding:4px 8px; font-size:0.8rem; width:100%;" ${X?"":'disabled style="background:#f1f5f9;"'}>
                            </td>
                            <td>
                                <input type="text" class="form-control row-tg-goithau" value="${X?B:""}" placeholder="Thời gian gói..." style="padding:4px 8px; font-size:0.8rem; width:100%;" ${X?"":'disabled style="background:#f1f5f9;"'}>
                            </td>
                            <td>
                                <input type="text" class="form-control row-tg-hopdong" value="${X?K:""}" placeholder="Thời gian HĐ..." style="padding:4px 8px; font-size:0.8rem; width:100%;" ${X?"":'disabled style="background:#f1f5f9;"'}>
                            </td>
                        </tr>
                    `}).join("");f.innerHTML=`
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
                                    ${z?`
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
                                ${I}
                            </tbody>
                        </table>
                    </div>

                    <div style="display:flex; justify-content:flex-end; gap:12px;">
                        <button class="btn btn-primary" id="btn-approve-award" style="padding:12px 24px; font-weight:700; display:flex; align-items:center; gap:8px;">
                            <i data-lucide="check-circle2"></i> Phê duyệt & Hoàn thành LCNT
                        </button>
                    </div>
                `;const q=document.getElementById("approve-bidders-tbody");q&&(q.querySelectorAll(".row-gia-trung").forEach($=>{$.addEventListener("input",G=>{const H=this.model.formatVND(G.target.value);G.target.value=H})}),q.querySelectorAll(".row-tg-goithau").forEach($=>{$.addEventListener("input",G=>{const U=G.target.closest("tr").querySelector(".row-tg-hopdong");if(U){const Y=G.target.value.trim();U.value=Y?Y+" + Thời gian thực hiện các nghĩa vụ theo hợp đồng":""}})}),q.querySelectorAll(".row-status-select").forEach($=>{$.addEventListener("change",G=>{var Y;const H=G.target.closest("tr");if(G.target.value==="trung"){const W=(Y=H.cells[0])==null?void 0:Y.textContent.trim();q.querySelectorAll("tr").forEach(R=>{var Q;if(R!==H){if(e.phanLo==="Có"&&((Q=R.cells[0])==null?void 0:Q.textContent.trim())!==W)return;const F=R.querySelector(".row-status-select");F&&!F.disabled&&(F.value="truot");const X=R.querySelector(".row-ly-do-truot");X&&(X.disabled=!1,X.style.background="",X.value||(X.value=R.getAttribute("data-default-reason")||"Nhà thầu xếp hạng 1 trúng thầu"));const at=R.querySelector(".row-gia-trung");at&&(at.disabled=!0,at.style.background="#f1f5f9",at.value="");const O=R.querySelector(".row-tg-goithau");O&&(O.disabled=!0,O.style.background="#f1f5f9",O.value="");const E=R.querySelector(".row-tg-hopdong");E&&(E.disabled=!0,E.style.background="#f1f5f9",E.value="")}});const _=H.querySelector(".row-gia-trung");_&&(_.disabled=!1,_.style.background="",_.value=H.getAttribute("data-default-price")||"");const D=H.querySelector(".row-tg-goithau");D&&(D.disabled=!1,D.style.background="",D.value=H.getAttribute("data-default-duration-pkg")||"");const B=H.querySelector(".row-tg-hopdong");B&&(B.disabled=!1,B.style.background="",B.value=H.getAttribute("data-default-duration-ctr")||"");const K=H.querySelector(".row-ly-do-truot");K&&(K.disabled=!0,K.style.background="#f1f5f9",K.value="")}else{const W=H.querySelector(".row-gia-trung");W&&(W.disabled=!0,W.style.background="#f1f5f9",W.value="");const _=H.querySelector(".row-tg-goithau");_&&(_.disabled=!0,_.style.background="#f1f5f9",_.value="");const D=H.querySelector(".row-tg-hopdong");D&&(D.disabled=!0,D.style.background="#f1f5f9",D.value="");const B=H.querySelector(".row-ly-do-truot");B&&(B.disabled=!1,B.style.background="",B.value=H.getAttribute("data-default-reason")||"Nhà thầu xếp hạng 1 trúng thầu")}})}));const j=document.getElementById("btn-approve-award");j&&(j.onclick=async()=>{var Q,F,X,at,O;const $=((Q=document.getElementById("award-decision-no"))==null?void 0:Q.value.trim())||"",G=((F=document.getElementById("award-decision-date"))==null?void 0:F.value)||"",H=this.model.convertDMYToYMD(G);let U=!1;const Y=[];[{el:document.getElementById("award-decision-no"),val:$},{el:document.getElementById("award-decision-date"),val:G}].forEach(E=>{var tt;if(!E.val&&(U=!0,E.el)){Y.push(E.el),(tt=E.el.closest(".form-group"))==null||tt.classList.add("invalid");const J=()=>{var nt;(nt=E.el.closest(".form-group"))==null||nt.classList.remove("invalid")};E.el.addEventListener("input",J),E.el.addEventListener("change",J)}});const _=[];if(q.querySelectorAll("tr").forEach(E=>{var J;((J=E.querySelector(".row-status-select"))==null?void 0:J.value)==="trung"&&_.push(E)}),_.forEach(E=>{var Z,lt,st;const tt=((Z=E.querySelector(".row-gia-trung"))==null?void 0:Z.value)||"",J=((lt=E.querySelector(".row-tg-goithau"))==null?void 0:lt.value.trim())||"",nt=((st=E.querySelector(".row-tg-hopdong"))==null?void 0:st.value.trim())||"";[{el:E.querySelector(".row-gia-trung"),val:tt},{el:E.querySelector(".row-tg-goithau"),val:J},{el:E.querySelector(".row-tg-hopdong"),val:nt}].forEach(ct=>{if(!ct.val&&(U=!0,ct.el)){Y.push(ct.el),ct.el.style.border="1px solid var(--danger)";const St=()=>{ct.el.style.border=""};ct.el.addEventListener("input",St)}})}),U){if(Y.length>0){const E=Y[0];E.scrollIntoView({behavior:"smooth",block:"center",inline:"center"}),setTimeout(()=>E.focus({preventScroll:!0}),300)}return}q.querySelectorAll("tr").forEach(E=>{var nt,ot;const tt=E.getAttribute("data-approve-bid-id"),J=this.model.state.thongtinmothau.find(Z=>Z.id===tt);J&&(((nt=E.querySelector(".row-status-select"))==null?void 0:nt.value)==="trung"?J.lyDoTruot="":J.lyDoTruot=((ot=E.querySelector(".row-ly-do-truot"))==null?void 0:ot.value.trim())||"")});let D=_.length>0,B="none";if(e.phanLo==="Có"){const E=typeof e.phanLoList=="string"?JSON.parse(e.phanLoList||"[]"):e.phanLoList||[];E.forEach(J=>{var ot,Z,lt;const nt=_.find(st=>{var ct;return((ct=st.cells[0])==null?void 0:ct.textContent.trim())===J.maPhanLo});if(nt){const st=nt.getAttribute("data-nt-id");J.nhaThauTrungThauId=st?isNaN(st)?st:parseInt(st):"",J.giaTrungThau=this.model.parseVND(((ot=nt.querySelector(".row-gia-trung"))==null?void 0:ot.value)||"0"),J.thoiGianGoiThau=((Z=nt.querySelector(".row-tg-goithau"))==null?void 0:Z.value.trim())||"",J.thoiGianHopDong=((lt=nt.querySelector(".row-tg-hopdong"))==null?void 0:lt.value.trim())||""}else J.nhaThauTrungThauId="",J.giaTrungThau=0,J.thoiGianGoiThau="",J.thoiGianHopDong=""}),e.phanLoList=E;const tt=_[0];if(tt){const J=tt.getAttribute("data-nt-id");e.nhaThauTrungThauId=J?isNaN(J)?J:parseInt(J):"",e.giaTrungThau=_.reduce((nt,ot)=>{var Z;return nt+this.model.parseVND(((Z=ot.querySelector(".row-gia-trung"))==null?void 0:Z.value)||"0")},0),B=J||"none"}else e.nhaThauTrungThauId="",e.giaTrungThau=0;e.thoiGianGoiThau="",e.thoiGianHopDong=""}else{const E=_[0];let tt=0,J="",nt="";E&&(B=E.getAttribute("data-nt-id"),tt=this.model.parseVND(((X=E.querySelector(".row-gia-trung"))==null?void 0:X.value)||"0"),J=((at=E.querySelector(".row-tg-goithau"))==null?void 0:at.value.trim())||"",nt=((O=E.querySelector(".row-tg-hopdong"))==null?void 0:O.value.trim())||""),e.nhaThauTrungThauId=B==="none"?"":isNaN(B)?B:parseInt(B),e.giaTrungThau=tt,e.thoiGianGoiThau=B==="none"?"":J,e.thoiGianHopDong=B==="none"?"":nt}e.soQuyetDinhKetQua=$,e.ngayQuyetDinhKetQua=H,e.trangThai=D?"Đã có kết quả":"Hủy thầu",this.model.persistData("goithau"),this.model.persistData("thongtinmothau"),this.renderGoiThauTable(),window.appController.autoSync();const K=B==="none"?"Hủy thầu thành công":"Chúc mừng",R=B==="none"?`Đã cập nhật trạng thái hủy thầu cho gói thầu "${e.tenGoiThau}" thành công!`:`Đã phê duyệt trúng thầu cho gói thầu "${e.tenGoiThau}" thành công!`;await this.customAlert(K,R,"check-circle"),this.showPackageDetails(c)})}const et=document.getElementById("btn-result-export-excel-template");et&&(et.onclick=()=>{const L=(e.tenGoiThau||"GoiThau").replace(/[^a-zA-Z0-9]/g,"_");ft(`/api/export-ketquaqd-template?package_id=${e.id}&package_name=${encodeURIComponent(L)}`,`KetQua_QD_${L}.xlsx`)});const it=document.getElementById("btn-result-import-excel");it&&(it.onclick=()=>{window.appController._currentResultPackageId=e.id,window.appController.openExcelImportModal("ketquaqd")});break}lucide.createIcons(),window.appController&&window.appController.setupExcelImportEvents&&window.appController.setupExcelImportEvents()}}function Pt(c,t){const a=document.getElementById("excel-preview-container"),n=document.getElementById("excel-preview-header"),i=document.getElementById("excel-preview-tbody");if(!a||!i||!n)return;if(c.length===0){i.innerHTML='<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">Không tìm thấy dữ liệu hợp lệ trong file Excel</td></tr>',a.style.display="block";return}const e={maKeHoach:"Mã kế hoạch",tenKeHoach:"Tên kế hoạch",loaiHinhMuaSam:"Loại hình",tenDuAnDuToan:"Dự án / Dự toán",tongMucDauTu:"Tổng mức đầu tư",ngayPheDuyet:"Ngày phê duyệt",quyetDinhPheDuyet:"QĐ phê duyệt",thoiGianDangMa:"Thời gian đăng mã",maGoiThau:"Mã gói thầu",tenGoiThau:"Tên gói thầu",keHoachId:"Mã Kế hoạch liên kết",giaGoiThau:"Giá gói thầu",hinhThucLuaChon:"Hình thức LCNT",phuongThucLuaChon:"Phương thức LCNT",thoiGianThucHien:"TG thực hiện (ngày)",trangThai:"Trạng thái",loaiHopDong:"Loại hợp đồng",nguonVon:"Nguồn vốn",maChuDauTu:"Mã CĐT",tenChuDauTu:"Tên chủ đầu tư",maSoThue:"Mã số thuế",diaChi:"Địa chỉ",soDienThoai:"Điện thoại",email:"Email",chucVuNguoiDungDau:"Chức vụ người đứng đầu",nguoiKyQuyetDinh:"Người ký QĐ",chucVuNguoiKy:"Chức vụ người ký",danhXung:"Danh xưng",soTaiKhoan:"Số tài khoản",noiMoTaiKhoan:"Nơi mở tài khoản",maQHNS:"Mã QHNS",maNhaThau:"Mã nhà thầu",tenNhaThau:"Tên nhà thầu",loaiNhaThau:"Loại nhà thầu",nguoiDaiDien:"Người đại diện",soTaiKhoan:"Số tài khoản",noiMoTaiKhoan:"Nơi mở tài khoản",hoTen:"Họ và tên",soCCCD:"Số CCCD",ngayCapCCCD:"Ngày cấp CCCD",noiCapCCCD:"Nơi cấp CCCD",soChungChi:"Số chứng chỉ",ngayCapChungChi:"Ngày cấp CC",donViCapChungChi:"Đơn vị cấp CC",soHopDong:"Số hợp đồng",tenHopDong:"Tên hợp đồng",ngayKy:"Ngày ký",giaTri:"Giá trị hợp đồng",soNgayThucHien:"Số ngày thực hiện",maDinhDanh:"Mã nhà thầu",maNhaThau:"Mã nhà thầu",nhaThauId:"Nhà thầu",maPhanLo:"Mã phần lô",tenPhanLo:"Tên phần lô",damBaoDuThau:"Đảm bảo dự thầu",hieuLucDamBao:"Hiệu lực ĐB (ngày)",hieuLucHsdxt:"Hiệu lực E-HSĐXKT",giaDuThau:"Giá dự thầu",tyLeGiamGia:"Tỷ lệ giảm (%)",giaSauGiamGia:"Giá sau giảm giá",hieuLucHsdt:"Hiệu lực E-HSDT",giaTriDamBao:"Giá trị đảm bảo",hieuLucBaoDamNgay:"Hiệu lực ĐB (ngày)",thoiGianThucHien:"Thời gian thực hiện",danhGiaHopLe:"Đánh giá hợp lệ",danhGiaNangLuc:"Đánh giá năng lực",danhGiaKyThuat:"Đánh giá kỹ thuật",danhGiaKetLuan:"Kết luận",giaTrungThau:"Giá trúng thầu",thoiGianGoiThau:"Thời gian thực hiện gói thầu",thoiGianHopDong:"Thời gian thực hiện hợp đồng",lyDoTruot:"Lý do trượt thầu"},o=c[0],l=Object.keys(o).filter(d=>d!=="_valid"&&d!=="_comment");let u="<tr>";l.forEach(d=>{const r=e[d]||d;let h="left";["tongMucDauTu","giaGoiThau","giaTri","giaTriPhanLo","giaTrungThau","damBaoDuThau","giaDuThau","giaSauGiamGia","giaTriDamBao"].includes(d)&&(h="right"),u+=`<th style="text-align: ${h} !important;">${r}</th>`}),u+='<th style="text-align: center !important;">Thông tin kiểm tra</th></tr>',n.innerHTML=u,i.innerHTML=c.map(d=>{const r=d._valid?"":'style="background-color: rgba(239, 68, 68, 0.08);"',h=d._valid?'<span class="badge badge-success"><i data-lucide="check"></i> Hợp lệ</span>':`<span class="badge badge-danger" title="${d._comment}"><i data-lucide="alert-circle"></i> Lỗi dữ liệu</span>`;let g=`<tr ${r}>`;return l.forEach(s=>{let p=d[s],m="left",v="";if(["tongMucDauTu","giaGoiThau","giaTri","giaTriPhanLo","giaTrungThau","damBaoDuThau","giaDuThau","giaSauGiamGia","giaTriDamBao"].includes(s))m="right",v="font-weight:700; color:var(--primary);",p=this.model.formatVND?this.model.formatVND(p||0):this.model.formatCurrency?this.model.formatCurrency(p||0):p;else if(s==="maKeHoach"||s==="maGoiThau"||s==="maChuDauTu"||s==="maNhaThau"||s==="soHopDong"||s==="soChungChi"||s==="maDinhDanh")v="font-weight:700;";else if(s==="nhaThauId"){const b=this.model.state.nhathau.find(T=>T.id===p);b&&(p=b.tenNhaThau)}g+=`<td style="text-align: ${m} !important; ${v}">${p!=null&&p!==""?p:"--"}</td>`}),g+=`<td style="text-align: center; vertical-align: middle;">${h}</td></tr>`,g}).join(""),a.style.display="block",lucide.createIcons()}const qt=Object.freeze(Object.defineProperty({__proto__:null,authFetchDownload:ft,checkBidQualified:gt,formatCurrency:dt,formatDate:rt,getAuthDownloadUrl:Et,initCustomSelect:ht,renderExcelPreview:Pt,renderGoiThauTable:Nt,renderKeHoachTable:Ht,renderPlanVersionDetails:Mt,showKeHoachDetails:Bt,showPackageDetails:Gt},Symbol.toStringTag,{value:"Module"}));async function Vt(){const c=document.getElementById("chudautu-table").querySelector("tbody"),t=document.getElementById("search-chudautu").value.toLowerCase();let a=[],n=0;const i=this.model.currentPage.chudautu||1,e=this.model.pageSize||10,o=this.model.sortState.chudautu||{},l=o.field||"",u=o.order||"asc";if(this.model.useServerSidePagination){!c.querySelector(".empty-state")&&c.children.length===0&&(c.innerHTML='<tr><td colspan="8" style="text-align: center; padding: 20px; color: var(--primary); font-weight: bold;">Đang tải dữ liệu từ máy chủ...</td></tr>');try{const d=await fetch(`/api/paginate?table=chudautu&page=${i}&pageSize=${e}&search=${encodeURIComponent(t)}&sortBy=${l}&sortOrder=${u}`,{headers:{"X-Session-Token":sessionStorage.getItem("bf_session_token")||"","X-Username":sessionStorage.getItem("bf_username")||""}});if(d.ok){const r=await d.json();a=r.items,n=r.totalItems}}catch(d){console.error("Failed to fetch paginated investors",d)}}else{const r=this.model.getLatestChuDauTu().filter(g=>(g.maChuDauTu||"").toLowerCase().includes(t)||(g.tenChuDauTu||"").toLowerCase().includes(t)||g.maSoThue&&g.maSoThue.includes(t));l&&r.sort((g,s)=>{let p=g[l]||"",m=s[l]||"";return typeof p=="string"&&(p=p.toLowerCase()),typeof m=="string"&&(m=m.toLowerCase()),p<m?u==="asc"?-1:1:p>m?u==="asc"?1:-1:0}),n=r.length;const h=(i-1)*e;a=r.slice(h,h+e)}if(n===0){c.innerHTML=`
            <tr>
                <td colspan="8">
                    <div class="empty-state">
                        <i data-lucide="building"></i>
                        <p>Không tìm thấy Chủ đầu tư nào phù hợp</p>
                    </div>
                </td>
            </tr>
        `;const d=document.getElementById("chudautu-pagination");d&&(d.innerHTML="")}else c.innerHTML=a.map(d=>{const r=d.rootId||d.id,h=d.allVersions||this.model.state.chudautu.filter(v=>(v.rootId||v.id)===r).sort((v,b)=>parseInt(b.phienBan||b.phien_ban||0)-parseInt(v.phienBan||v.phien_ban||0));this.model.state.selectedChuDauTuVersion||(this.model.state.selectedChuDauTuVersion={});const g=this.model.state.selectedChuDauTuVersion[r]||d.id,s=this.model.state.chudautu.find(v=>v.id===g)||d,p=h.map(v=>{const b=`V${parseInt(v.phienBan||v.phien_ban||0)}`,T=v.id===s.id?"selected":"";return`<option value="${v.id}" ${T}>${b}</option>`}).join(""),m=`
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
            `}).join(""),window.renderTablePagination&&window.renderTablePagination("chudautu-pagination",n,i,e);lucide.createIcons({root:c}),this.enhanceTableHeaders("chudautu-table","chudautu")}async function At(){const c=document.getElementById("nhathau-table").querySelector("tbody"),t=document.getElementById("search-nhathau").value.toLowerCase();let a=[],n=0;const i=this.model.currentPage.nhathau||1,e=this.model.pageSize||10,o=this.model.sortState.nhathau||{},l=o.field||"",u=o.order||"asc";if(this.model.useServerSidePagination){!c.querySelector(".empty-state")&&c.children.length===0&&(c.innerHTML='<tr><td colspan="8" style="text-align: center; padding: 20px; color: var(--primary); font-weight: bold;">Đang tải dữ liệu từ máy chủ...</td></tr>');try{const d=await fetch(`/api/paginate?table=nhathau&page=${i}&pageSize=${e}&search=${encodeURIComponent(t)}&sortBy=${l}&sortOrder=${u}`,{headers:{"X-Session-Token":sessionStorage.getItem("bf_session_token")||"","X-Username":sessionStorage.getItem("bf_username")||""}});if(d.ok){const r=await d.json();a=r.items,n=r.totalItems}}catch(d){console.error("Failed to fetch paginated contractors",d)}}else{const r=this.model.getLatestNhaThau().filter(g=>(g.maNhaThau||"").toLowerCase().includes(t)||(g.tenNhaThau||"").toLowerCase().includes(t)||g.maSoThue&&g.maSoThue.includes(t)||g.loaiNhaThau==="Liên danh"&&g.thanhVienLienDanh&&g.thanhVienLienDanh.some(s=>(s.tenNhaThau||"").toLowerCase().includes(t)||(s.maSoThue||"").includes(t)));l&&r.sort((g,s)=>{let p=g[l]||"",m=s[l]||"";return typeof p=="string"&&(p=p.toLowerCase()),typeof m=="string"&&(m=m.toLowerCase()),p<m?u==="asc"?-1:1:p>m?u==="asc"?1:-1:0}),n=r.length;const h=(i-1)*e;a=r.slice(h,h+e)}if(n===0){c.innerHTML=`
            <tr>
                <td colspan="8">
                    <div class="empty-state">
                        <i data-lucide="shield-alert"></i>
                        <p>Không tìm thấy Nhà thầu nào phù hợp</p>
                    </div>
                </td>
            </tr>
        `;const d=document.getElementById("nhathau-pagination");d&&(d.innerHTML="")}else c.innerHTML=a.map(d=>{const r=d.rootId||d.id,h=d.allVersions||this.model.state.nhathau.filter(b=>(b.rootId||b.id)===r).sort((b,T)=>parseInt(T.phienBan||T.phien_ban||0)-parseInt(b.phienBan||b.phien_ban||0));this.model.state.selectedNhaThauVersion||(this.model.state.selectedNhaThauVersion={});const g=this.model.state.selectedNhaThauVersion[r]||d.id,s=this.model.state.nhathau.find(b=>b.id===g)||d,p=h.map(b=>{const T=`V${parseInt(b.phienBan||b.phien_ban||0)}`,y=b.id===s.id?"selected":"";return`<option value="${b.id}" ${y}>${T}</option>`}).join(""),m=`
                <select class="form-control version-droplist" onchange="window.changeNhaThauRowVersion('${r}', this.value)" style="width: 52px; display: inline-block; padding: 2px; height: 22px; font-size: 0.8rem; border-radius: 4px; border: 1px solid var(--border-color, #ccc); background-color: var(--bg-card); color: var(--text-main); text-align-last: center; cursor: pointer; margin: 0; outline: none; vertical-align: middle;">
                    ${p}
                </select>
            `;if(s.loaiNhaThau==="Liên danh"){const b=s.thanhVienLienDanh||[],T=b.map(w=>w.tenNhaThau||"").join("<br>+ "),y=b.map(w=>w.maSoThue||"").join(", "),x=b.length>0?`${b[0].danhXung||"Ông"} ${b[0].nguoiDaiDien||"--"} (Trưởng LD)`:"--",f=b.length>0?`<small>SĐT: ${b[0].soDienThoai||"--"}</small><br><small>Email: ${b[0].email||"--"}</small>`:"--",S=b.length>0?`<div style="font-size:0.85rem;" class="fw-bold">${b[0].soTaiKhoan||"--"}</div><div style="font-size:0.75rem; color:var(--text-light);">${b[0].noiMoTaiKhoan||"--"} (+${b.length-1} TV)</div>`:"--";return`
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
                            <div style="margin-top: 4px;"><span class="badge badge-info">Liên danh (${b.length} TV)</span></div>
                            <div style="font-size: 0.75rem; font-weight: normal; color: var(--text-muted); margin-top: 4px; padding-left: 8px; border-left: 2px solid var(--primary-soft); white-space: normal !important;">
                                + ${T}
                            </div>
                        </td>
                        <td><small>${y}</small></td>
                        <td>${x}</td>
                        <td>${f}</td>
                        <td>${S}</td>
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
                `}else{const b=`${s.danhXung||"Ông"} ${s.nguoiDaiDien||"--"}`,T=`<small>SĐT: ${s.soDienThoai||"--"}</small><br><small>Email: ${s.email||"--"}</small>`,y=`<div style="font-size:0.85rem;" class="fw-bold">${s.soTaiKhoan||"--"}</div><div style="font-size:0.75rem; color:var(--text-light);">${s.noiMoTaiKhoan||"--"}${s.maNganHang?" ("+s.maNganHang+")":""}</div>`;return`
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
                        <td>${b}</td>
                        <td>${T}</td>
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
                `}}).join(""),window.renderTablePagination&&window.renderTablePagination("nhathau-pagination",n,i,e);lucide.createIcons({root:c}),this.enhanceTableHeaders("nhathau-table","nhathau")}async function zt(){const c=document.getElementById("chuyengia-table").querySelector("tbody"),t=document.getElementById("search-chuyengia").value.toLowerCase(),a=this.model.state.activerole==="employee",n=document.getElementById("btn-add-chuyengia");n&&(n.style.display=a?"none":"flex");let i=[],e=0;const o=this.model.currentPage.chuyengia||1,l=this.model.pageSize||10,u=this.model.sortState.chuyengia||{},d=u.field||"",r=u.order||"asc";if(this.model.useServerSidePagination){!c.querySelector(".empty-state")&&c.children.length===0&&(c.innerHTML='<tr><td colspan="7" style="text-align: center; padding: 20px; color: var(--primary); font-weight: bold;">Đang tải dữ liệu từ máy chủ...</td></tr>');try{const h=await fetch(`/api/paginate?table=chuyengia&page=${o}&pageSize=${l}&search=${encodeURIComponent(t)}&sortBy=${d}&sortOrder=${r}`,{headers:{"X-Session-Token":sessionStorage.getItem("bf_session_token")||"","X-Username":sessionStorage.getItem("bf_username")||""}});if(h.ok){const g=await h.json();i=g.items,e=g.totalItems}}catch(h){console.error("Failed to fetch paginated experts",h)}}else{const g=this.model.getLatestChuyenGia().filter(p=>(p.hoTen||"").toLowerCase().includes(t)||(p.soCCCD||"").includes(t)||(p.soChungChi||"").toLowerCase().includes(t));d&&g.sort((p,m)=>{let v=p[d]||"",b=m[d]||"";return typeof v=="string"&&(v=v.toLowerCase()),typeof b=="string"&&(b=b.toLowerCase()),v<b?r==="asc"?-1:1:v>b?r==="asc"?1:-1:0}),e=g.length;const s=(o-1)*l;i=g.slice(s,s+l)}if(e===0){c.innerHTML=`
            <tr>
                <td colspan="7">
                    <div class="empty-state">
                        <i data-lucide="user-x"></i>
                        <p>Không tìm thấy Chuyên gia nào phù hợp</p>
                    </div>
                </td>
            </tr>
        `;const h=document.getElementById("chuyengia-pagination");h&&(h.innerHTML="")}else c.innerHTML=i.map(h=>{const g=h.rootId||h.id,s=h.allVersions||this.model.state.chuyengia.filter(T=>(T.rootId||T.id)===g).sort((T,y)=>parseInt(y.phienBan||y.phien_ban||0)-parseInt(T.phienBan||T.phien_ban||0));this.model.state.selectedChuyenGiaVersion||(this.model.state.selectedChuyenGiaVersion={});const p=this.model.state.selectedChuyenGiaVersion[g]||h.id,m=this.model.state.chuyengia.find(T=>T.id===p)||h,v=s.map(T=>{const y=`V${parseInt(T.phienBan||T.phien_ban||0)}`,x=T.id===m.id?"selected":"";return`<option value="${T.id}" ${x}>${y}</option>`}).join(""),b=`
                <select class="form-control version-droplist" onchange="window.changeChuyenGiaRowVersion('${g}', this.value)" style="width: 52px; display: inline-block; padding: 2px; height: 22px; font-size: 0.8rem; border-radius: 4px; border: 1px solid var(--border-color, #ccc); background-color: var(--bg-card); color: var(--text-main); text-align-last: center; cursor: pointer; margin: 0; outline: none; vertical-align: middle;">
                    ${v}
                </select>
            `;return`
            <tr>
                <td class="fw-bold">
                    <div style="display: inline-flex; align-items: center; gap: 6px; line-height: 1; vertical-align: middle;">
                        <a href="#" onclick="event.preventDefault(); window.showChuyenGiaDetails('${m.id}')" class="text-blue fw-bold link-hover" title="Xem chi tiết lý lịch" style="display: inline-flex; align-items: center; line-height: 1;"><span style="margin: 0; line-height: 1;">${m.hoTen||""}</span></a>
                        <span style="color: var(--text-muted); font-size: 0.85rem; line-height: 1; display: inline-flex; align-items: center;">-</span>
                        ${b}
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
            `}).join(""),window.renderTablePagination&&window.renderTablePagination("chuyengia-pagination",e,o,l);lucide.createIcons({root:c}),this.enhanceTableHeaders("chuyengia-table","chuyengia")}async function jt(){const c=document.getElementById("hopdong-table").querySelector("tbody"),t=document.getElementById("search-hopdong").value.toLowerCase(),a=m=>{if(!m)return{year:null,month:null};let v=String(m).replace(/\s*-\s*/," ").trim();if(v.match(/^\d{4}-\d{2}-\d{2}/)){const T=v.substring(0,4),y=parseInt(v.substring(5,7),10).toString();return{year:T,month:y}}else if(v.match(/^\d{2}\/\d{2}\/\d{4}/)){const T=v.split(" ")[0].split("/"),y=T[2],x=parseInt(T[1],10).toString();return{year:y,month:x}}const b=new Date(v);return isNaN(b.getTime())?{year:null,month:null}:{year:b.getFullYear().toString(),month:(b.getMonth()+1).toString()}},n=document.getElementById("filter-hopdong-nam"),i=document.getElementById("filter-hopdong-thang"),e=this.model.state.hopdong||[];if(n&&i){const m=n.value,v=i.value,b=new Set,T=new Set;e.forEach(f=>{if(f.ngayKy){const S=a(f.ngayKy);S.year&&b.add(S.year),S.month&&T.add(S.month)}});const y=Array.from(b).sort((f,S)=>parseInt(S)-parseInt(f)),x=Array.from(T).sort((f,S)=>parseInt(S)-parseInt(f));n.innerHTML='<option value="">Năm</option>'+y.map(f=>`<option value="${f}">${f}</option>`).join(""),i.innerHTML='<option value="">Tháng</option>'+x.map(f=>`<option value="${f}">Tháng ${f}</option>`).join(""),y.includes(m)&&(n.value=m),x.includes(v)&&(i.value=v),ht("filter-hopdong-nam"),ht("filter-hopdong-thang")}const o=n?n.value:"",l=i?i.value:"";let u=[],d=0;const r=this.model.currentPage.hopdong||1,h=this.model.pageSize||10,g=this.model.sortState.hopdong||{},s=g.field||"",p=g.order||"asc";if(this.model.useServerSidePagination){!c.querySelector(".empty-state")&&c.children.length===0&&(c.innerHTML='<tr><td colspan="13" style="text-align: center; padding: 20px; color: var(--primary); font-weight: bold;">Đang tải dữ liệu từ máy chủ...</td></tr>');try{const m=await fetch(`/api/paginate?table=hopdong&page=${r}&pageSize=${h}&search=${encodeURIComponent(t)}&sortBy=${s}&sortOrder=${p}&nam=${encodeURIComponent(o)}&thang=${encodeURIComponent(l)}`,{headers:{"X-Session-Token":sessionStorage.getItem("bf_session_token")||"","X-Username":sessionStorage.getItem("bf_username")||""}});if(m.ok){const v=await m.json();u=v.items,d=v.totalItems}}catch(m){console.error("Failed to fetch paginated contracts",m)}}else{const v=this.model.getLatestHopDong().filter(T=>{const y=(T.soHopDong||"").toLowerCase().includes(t)||(T.tenHopDong||"").toLowerCase().includes(t);let x=!0,f=!0;if(T.ngayKy){const S=a(T.ngayKy);o&&(x=S.year===o),l&&(f=S.month===l)}else(o||l)&&(x=!1,f=!1);return y&&x&&f});s&&v.sort((T,y)=>{let x=T[s]||"",f=y[s]||"";return typeof x=="string"&&(x=x.toLowerCase()),typeof f=="string"&&(f=f.toLowerCase()),x<f?p==="asc"?-1:1:x>f?p==="asc"?1:-1:0}),d=v.length;const b=(r-1)*h;u=v.slice(b,b+h)}if(d===0){c.innerHTML=`
            <tr>
                <td colspan="13">
                    <div class="empty-state">
                        <i data-lucide="file-check-2"></i>
                        <p>Không tìm thấy Hợp đồng nào phù hợp</p>
                    </div>
                </td>
            </tr>
        `;const m=document.getElementById("hopdong-pagination");m&&(m.innerHTML="")}else c.innerHTML=u.map(m=>{const v=m.rootId||m.id,b=m.allVersions||this.model.state.hopdong.filter(k=>(k.rootId||k.id)===v).sort((k,I)=>parseInt(I.phienBan||I.phien_ban||0)-parseInt(k.phienBan||k.phien_ban||0));this.model.state.selectedHopDongVersion||(this.model.state.selectedHopDongVersion={});const T=this.model.state.selectedHopDongVersion[v]||m.id,y=this.model.state.hopdong.find(k=>k.id===T)||m,x=b.map(k=>{const I=`V${parseInt(k.phienBan||k.phien_ban||0)}`,q=k.id===y.id?"selected":"";return`<option value="${k.id}" ${q}>${I}</option>`}).join(""),f=`
                <select class="form-control version-droplist" onchange="window.changeHopDongRowVersion('${v}', this.value)" style="width: 52px; display: inline-block; padding: 2px; height: 22px; font-size: 0.8rem; border-radius: 4px; border: 1px solid var(--border-color, #ccc); background-color: var(--bg-card); color: var(--text-main); text-align-last: center; cursor: pointer; margin: 0; outline: none; vertical-align: middle;">
                    ${x}
                </select>
            `,w=(Array.isArray(this.model.state.chudautu)?this.model.state.chudautu:[]).find(k=>k.id===y.chuDauTuId),M=w?w.tenChuDauTu:"--",V=(Array.isArray(this.model.state.nhathau)?this.model.state.nhathau:[]).find(k=>k.id===y.nhaThauId),P=V?V.tenNhaThau:"--",et=typeof this.model.getLatestPackages=="function"?this.model.getLatestPackages():Array.isArray(this.model.state.goithau)?this.model.state.goithau:[],it=(y.goiThauIds||[]).map(k=>{const I=et.find(q=>q.id===k);return I?`<a href="#" onclick="event.preventDefault(); window.showPackageDetails('${I.id}')" style="margin:2px; display:inline-block;" title="${I.tenGoiThau||""}"><span class="detail-code link-hover">${I.maGoiThau||"Gói"}</span></a>`:""}).filter(Boolean).join(" "),N=(Array.isArray(this.model.state.custompaperstatuses)?this.model.state.custompaperstatuses:[]).find(k=>k.name===y.trangThaiHoSo),A=N?N.color:"#6b7280",z=y.trangThaiHoSo?`<span class="status-pill" style="background-color: ${A}; color: white; padding: 4px 10px; border-radius: 20px; font-weight: 700; font-size: 0.78rem;">${y.trangThaiHoSo}</span>`:'<span class="text-muted" style="font-size:0.8rem;">Chưa cập nhật</span>';return`
                <tr>
                    <td>
                        <div style="display: inline-flex; align-items: center; gap: 6px; line-height: 1; vertical-align: middle;">
                            <a href="#" onclick="event.preventDefault(); window.showHopDongDetails('${y.id}')" class="text-blue fw-bold link-hover" title="Xem chi tiết Hợp đồng" style="display: inline-flex; align-items: center; line-height: 1;"><span class="detail-code link-hover" style="margin: 0; line-height: 1;">${y.soHopDong}</span></a>
                            <span style="color: var(--text-muted); font-size: 0.85rem; line-height: 1; display: inline-flex; align-items: center;">-</span>
                            ${f}
                        </div>
                    </td>
                    <td style="min-width: 200px; max-width: 300px;" class="fw-bold text-wrap">${y.tenHopDong}</td>
                    <td>${y.ngayKy?rt(y.ngayKy):"--"}</td>
                    <td style="min-width: 180px; max-width: 280px;" class="text-wrap">${M}</td>
                    <td style="min-width: 180px; max-width: 280px;" class="text-wrap">${P}</td>
                    <td class="fw-bold text-blue">${dt(y.giaTri)}</td>
                    <td><span class="badge badge-info">${y.loaiHopDong||"Trọn gói"}</span></td>
                    <td><span class="badge badge-secondary" style="background-color: var(--primary-light); color: var(--primary); font-weight: 600;">${y.phanLoai||"Tư vấn"}</span></td>
                    <td>${y.soNgayThucHien?isNaN(y.soNgayThucHien)?y.soNgayThucHien:y.soNgayThucHien+" ngày":"--"}</td>
                    <td>${it||'<span class="text-danger" style="font-weight: 500;">Chưa liên kết</span>'}</td>
                    <td>${z}</td>
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
            `}).join(""),window.renderTablePagination&&window.renderTablePagination("hopdong-pagination",d,r,h);lucide.createIcons({root:c}),this.enhanceTableHeaders("hopdong-table","hopdong")}function Kt(c){const t=this.model.state.chuyengia.find(o=>o.id===c);if(!t)return;const a=t.hoTen.split(" ").map(o=>o[0]).pop().toUpperCase(),n=t.tenAnhChungChi||(t.soCCCD?`CC_${t.soCCCD}.png`:"--"),i=t.tenAnhChuKy||(t.soCCCD?`CK_${t.soCCCD}.png`:"--"),e=`
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
    `;document.getElementById("detail-chuyengia-content").innerHTML=e,this.openModal("modal-detail-chuyengia"),lucide.createIcons({root:document.getElementById("detail-chuyengia-content")})}function Ot(c=[]){const t=document.getElementById("word-templates-tbody");if(t){if(c.length===0){t.innerHTML='<tr><td colspan="3" class="text-center text-muted">Đang tải biểu mẫu...</td></tr>';return}t.innerHTML=c.map(a=>{const n=a.is_active?'<span class="badge badge-success"><i data-lucide="check-circle"></i> Đang hoạt động</span>':`<span class="badge badge-neutral btn-activate-template" data-filename="${a.filename}" style="cursor: pointer; display: inline-flex; align-items: center; gap: 4px;" title="Nhấn để sử dụng làm mẫu chính"><i data-lucide="play" style="width: 12px; height: 12px;"></i> Sẵn sàng</span>`,i=a.is_active?'<span class="text-success fw-bold" style="font-size:0.8rem;">Đang dùng</span>':`<button class="btn btn-outline btn-sm btn-activate-template" data-filename="${a.filename}">Sử dụng</button>`;return`
            <tr>
                <td class="fw-bold">${a.name}</td>
                <td>${n}</td>
                <td class="text-right">${i}</td>
            </tr>
        `}).join(""),lucide.createIcons({root:t})}}function xt(c){const t=document.getElementById("dictionary-table-body");if(!t)return;const a={global:[],experts:[{code:"{#Danh_Sach_Chuyen_Gia}",desc:"Bắt đầu vòng lặp tổ chuyên gia"},{code:"{STT}",desc:"Số thứ tự chuyên gia"},{code:"{/Danh_Sach_Chuyen_Gia}",desc:"Kết thúc vòng lặp tổ chuyên gia"},{code:"{#Danh_Sach_Tham_Dinh}",desc:"Bắt đầu vòng lặp tổ thẩm định"},{code:"{STT}",desc:"Số thứ tự thẩm định viên"},{code:"{/Danh_Sach_Tham_Dinh}",desc:"Kết thúc vòng lặp tổ thẩm định"}],contractors:[{code:"{#Danh_Sach_Nha_Thau}",desc:"Bắt đầu vòng lặp danh sách nhà thầu tham dự"},{code:"{STT}",desc:"Số thứ tự nhà thầu tham dự"},{code:"{#Thanh_Vien_Lien_Danh}",desc:"(Liên danh) Bắt đầu vòng lặp thành viên liên danh của nhà thầu trúng"},{code:"{Ten_TV}",desc:"(Liên danh) Tên thành viên liên danh"},{code:"{MST_TV}",desc:"(Liên danh) Mã số thuế thành viên liên danh"},{code:"{Vai_Tro_TV}",desc:"(Liên danh) Vai trò thành viên (Liên danh chính / liên danh phụ)"},{code:"{Nguoi_Dai_Dien_TV}",desc:"(Liên danh) Người đại diện thành viên liên danh"},{code:"{Dia_Chi_TV}",desc:"(Liên danh) Địa chỉ thành viên liên danh"},{code:"{So_Tai_Khoan_TV}",desc:"(Liên danh) Số tài khoản thành viên liên danh"},{code:"{Noi_Mo_Tai_Khoan_TV}",desc:"(Liên danh) Nơi mở tài khoản thành viên liên danh"},{code:"{/Thanh_Vien_Lien_Danh}",desc:"(Liên danh) Kết thúc vòng lặp thành viên liên danh"},{code:"{/Danh_Sach_Nha_Thau}",desc:"Kết thúc vòng lặp nhà thầu"},{code:"{#Danh_Sach_Nha_Thau_Truot}",desc:"Bắt đầu vòng lặp danh sách nhà thầu trượt thầu"},{code:"{Ten_Nha_Thau}",desc:"Tên nhà thầu trượt thầu"},{code:"{Ma_Nha_Thau}",desc:"Mã định danh/MST nhà thầu trượt"},{code:"{Ly_Do_Truot}",desc:"Lý do trượt thầu (phân tích tự động hoặc người dùng tự gõ)"},{code:"{/Danh_Sach_Nha_Thau_Truot}",desc:"Kết thúc vòng lặp danh sách nhà thầu trượt"}],phanlo:[{code:"{#Danh_Sach_Phan_Lo}",desc:"Bắt đầu vòng lặp danh sách phân lô gói thầu"},{code:"{STT}",desc:"Số thứ tự phân lô"},{code:"{Ten_Phan_Lo}",desc:"Tên phân lô"},{code:"{Gia_Tri_Phan_Lo}",desc:"Giá trúng thầu phân lô"},{code:"{Nha_Thau_Trung}",desc:"Tên nhà thầu trúng thầu phân lô tương ứng"},{code:"{Thoi_Gian_Thuc_Hien}",desc:"Thời gian thực hiện hợp đồng phân lô"},{code:"{/Danh_Sach_Phan_Lo}",desc:"Kết thúc vòng lặp phân lô"}],tuychonmuathem:[{code:"{#Danh_Sach_Tuy_Chon_Mua_Them}",desc:"Bắt đầu vòng lặp tùy chọn mua thêm"},{code:"{STT}",desc:"Số thứ tự tùy chọn mua thêm"},{code:"{Hang_Muc}",desc:"Tên hạng mục tùy chọn mua thêm"},{code:"{Don_Vi}",desc:"Đơn vị tính"},{code:"{So_Luong}",desc:"Số lượng mua thêm"},{code:"{Ty_Le}",desc:"Tỷ lệ % mua thêm"},{code:"{Gia_Tri_Uoc_Tinh}",desc:"Giá trị ước tính mua thêm"},{code:"{/Danh_Sach_Tuy_Chon_Mua_Them}",desc:"Kết thúc vòng lặp mua thêm"}]},n=o=>({chu_dau_tu:"Chủ đầu tư",ke_hoach_lcnt:"Kế hoạch LCNT",goi_thau:"Gói thầu",nha_thau:"Nhà thầu",hop_dong:"Hợp đồng",chuyen_gia:"Chuyên gia",thong_tin_mo_thau:"Thông tin mở thầu",tai_khoan:"Tài khoản cá nhân",to_chuc:"Tổ chức / Doanh nghiệp",goi_dich_vu:"Gói dịch vụ"})[o]||o,i=(o,l)=>{const u={chu_dau_tu:{ten_chu_dau_tu:"Tên chủ đầu tư",ma_chu_dau_tu:"Mã chủ đầu tư",ma_so_thue:"Mã số thuế",chuc_vu_nguoi_dung_dau:"Chức vụ người đứng đầu",nguoi_ky_quyet_dinh:"Người ký QĐ",chuc_vu_nguoi_ky:"Chức vụ người ký",danh_xung:"Danh xưng",dia_chi:"Địa chỉ",so_dien_thoai:"Số điện thoại",email:"Email",so_tai_khoan:"Số tài khoản",noi_mo_tai_khoan:"Nơi mở tài khoản",ma_qhns:"Mã QHNS",co_quan_chu_quan:"Cơ quan chủ quản",phien_ban:"Phiên bản"},ke_hoach_lcnt:{ten_ke_hoach:"Tên kế hoạch LCNT",ma_ke_hoach:"Mã kế hoạch LCNT",ma_du_an:"Mã dự án",ten_du_an_du_toan:"Tên dự án / Dự toán",loai_hinh_mua_sam:"Loại hình mua sắm",tong_muc_dau_tu:"Tổng mức đầu tư",quyet_dinh_phe_duyet:"QĐ phê duyệt",ngay_phe_duyet:"Ngày phê duyệt",thoi_gian_dang_tai:"Thời gian đăng tải",nguon_von:"Nguồn vốn",thoi_gian_du_an:"Thời gian dự án",dia_diem_quy_mo:"Địa điểm quy mô",thong_tin_khac:"Thông tin khác",so_qd_phe_duyet_du_an:"Số QĐ phê duyệt dự án",ngay_qd_phe_duyet_du_an:"Ngày QĐ phê duyệt dự án",co_quan_phe_duyet_du_an:"Cơ quan phê duyệt dự án",phien_ban:"Phiên bản"},goi_thau:{ten_goi_thau:"Tên gói thầu",ma_goi_thau:"Mã gói thầu",gia_goi_thau:"Giá gói thầu",hinh_thuc_lua_chon:"Hình thức LCNT",phuong_thuc_lua_chon:"Phương thức LCNT",loai_hop_dong:"Loại hợp đồng",thoi_gian_thuc_hien:"Thời gian thực hiện",nguon_von:"Nguồn vốn",gia_trung_thau:"Giá trúng thầu",linh_vuc:"Lĩnh vực",tuy_chon_mua_them:"Tùy chọn mua thêm",thoi_gian_to_chuc:"Thời gian tổ chức",thoi_gian_bat_dau_to_chuc:"Thời gian bắt đầu tổ chức",phan_lo:"Phân lô",thoi_gian_dang_tai:"Thời gian đăng tải",thoi_gian_dong_thau:"Thời gian đóng thầu",thoi_gian_mo_thau:"Thời gian mở thầu",so_quyet_dinh:"Số QĐ phê duyệt",ngay_quyet_dinh:"Ngày QĐ phê duyệt",so_quyet_dinh_ket_qua:"Số QĐ kết quả",ngay_quyet_dinh_ket_qua:"Ngày QĐ kết quả",thoi_gian_goi_thau:"Thời gian gói thầu",thoi_gian_hop_dong:"Thời gian hợp đồng",gia_tri_dam_bao_du_thau:"Giá trị bảo đảm dự thầu",hieu_luc_hsdt:"Hiệu lực HSDT",hieu_luc_dam_bao_du_thau:"Hiệu lực bảo đảm dự thầu",gia_han_list:"Gia hạn thời gian mở thầu / đóng thầu",yeu_cau_lam_ro_list:"Làm rõ hồ sơ mời thầu (Yêu cầu)",tra_loi_lam_ro_list:"Trả lời làm rõ hồ sơ mời thầu",trang_thai:"Trạng thái",phien_ban:"Phiên bản"},nha_thau:{ten_nha_thau:"Tên nhà thầu",ma_nha_thau:"Mã nhà thầu",loai_nha_thau:"Loại nhà thầu",ma_so_thue:"Mã số thuế",nguoi_dai_dien:"Người đại diện",danh_xung:"Danh xưng",so_dien_thoai:"Số điện thoại",email:"Email",dia_chi:"Địa chỉ",so_tai_khoan:"Số tài khoản",noi_mo_tai_khoan:"Nơi mở tài khoản",ma_ngan_hang:"Mã ngân hàng",phien_ban:"Phiên bản"},hop_dong:{ten_hop_dong:"Tên hợp đồng",so_hop_dong:"Số hợp đồng",ngay_ky:"Ngày ký",gia_tri:"Giá trị hợp đồng",loai_hop_dong:"Loại hợp đồng",thoi_gian_thuc_hien:"Thời gian thực hiện",trang_thai_ho_so:"Trạng thái hồ sơ"},chuyen_gia:{ho_ten:"Họ tên chuyên gia",so_cccd:"Số CCCD",ngay_cap_cccd:"Ngày cấp CCCD",noi_cap_cccd:"Nơi cấp CCCD",so_chung_chi:"Số chứng chỉ",ngay_cap_chung_chi:"Ngày cấp chứng chỉ",don_vi_cap_chung_chi:"Đơn vị cấp chứng chỉ",chuc_vu:"Chức vụ trong tổ",cong_viec:"Nhiệm vụ phân công"},thong_tin_mo_thau:{gia_du_thau:"Giá dự thầu",dam_bao_du_thau:"Bảo đảm dự thầu",hieu_luc_dam_bao:"Hiệu lực bảo đảm",hieu_luc_hsdxt:"Hiệu lực HSDXT",ty_le_giam_gia:"Tỷ lệ giảm giá",gia_sau_giam_gia:"Giá sau giảm giá",hieu_luc_hsdt:"Hiệu lực HSDT",gia_tri_dam_bao:"Giá trị bảo đảm",hieu_luc_bao_dam_ngay:"Hiệu lực bảo đảm (ngày)",thoi_gian_thuc_hien:"Thời gian thực hiện",ten_nha_thau:"Tên nhà thầu",loai_nha_thau:"Loại nhà thầu",danh_gia_hop_le:"Đánh giá hợp lệ",danh_gia_nang_luc:"Đánh giá năng lực",danh_gia_ky_thuat:"Đánh giá kỹ thuật",danh_gia_tai_chinh:"Đánh giá tài chính",danh_gia_ket_luan:"Đánh giá kết luận",ly_do_truot:"Lý do trượt",lam_ro_hop_le:"Làm rõ hợp lệ",lam_ro_nang_luc:"Làm rõ năng lực",lam_ro_ky_thuat:"Làm rõ kỹ thuật",lam_ro_tai_chinh:"Làm rõ tài chính"},tai_khoan:{ten_dang_nhap:"Tên đăng nhập",ho_ten:"Họ và tên",email:"Email",so_dien_thoai:"Số điện thoại",chuc_vu:"Chức vụ"},to_chuc:{ten_to_chuc:"Tên tổ chức",ma_so_thue:"Mã số thuế",dia_chi:"Địa chỉ",nguoi_dai_dien:"Người đại diện"},goi_dich_vu:{ten_goi:"Tên gói dịch vụ",gia_goi:"Giá gói dịch vụ",thoi_han_thang:"Thời hạn (tháng)"}};return u[o]&&u[o][l]||l};let e=a[c]||[];if(c==="global"&&this.model.state&&this.model.state.wordMappings){const o=this.model.state.wordMappings.map(l=>({code:`{${l.tenBien}}`,desc:`Biến tự định nghĩa (Ánh xạ: Bảng ${n(l.sourceTable)} -> ${i(l.sourceTable,l.sourceColumn)})`,isCustom:!0,id:l.id,sourceTable:l.sourceTable,sourceColumn:l.sourceColumn,tenBien:l.tenBien}));e=[...e,...o]}if(e.length===0){t.innerHTML='<tr><td colspan="3" class="text-center text-muted" style="padding: 24px;">Chưa có biến nào trong nhóm này.</td></tr>';return}t.innerHTML=e.map(o=>{let l="";o.isCustom?l=`
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
            `;let u="";return o.isCustom?u=`
                <span class="badge badge-info" style="font-size:0.7rem; padding: 2px 6px;">${n(o.sourceTable)}</span>
                <span style="color:var(--text-muted); margin:0 4px;">&rarr;</span>
                <span class="fw-bold" style="font-size: 0.8rem;">${i(o.sourceTable,o.sourceColumn)}</span>
            `:u=`<span style="font-size: 0.8rem; color: var(--text-muted);">${o.desc}</span>`,`
            <tr>
                <td><code style="font-size:0.82rem; color:var(--primary); font-weight:700; background:var(--primary-soft); padding:4px 8px; border-radius:4px;">${o.code}</code></td>
                <td>${u}</td>
                <td class="text-right">${l}</td>
            </tr>
        `}).join(""),lucide.createIcons({root:t})}function Rt(c=[]){const t=document.getElementById("dictionary-group-select"),a=t?t.value:"global";xt.call(this,a)}function Ut(c=[]){this.renderBieumauTab(c)}function Qt(c,t=null){return`
        <button type="button" class="btn-remove-member" onclick="window.removeJointVentureMemberCard('${c}')" style="position: absolute; top: 12px; right: 12px; background: none; border: none; font-size: 1.25rem; color: var(--danger); cursor: pointer;">&times;</button>
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
    `}function Ft(c){const t=document.getElementById("tab-hopdong-detail");if(!t||!t.classList.contains("active")){window.switchTab("hopdong-detail",c);return}if(!this.model.state.hopdong.find(i=>i.id===c))return;const n=document.getElementById("btn-edit-hopdong-fullpage");n&&(n.onclick=()=>{window.editHopDong(c)}),this.renderContractVersionDetails(c)}function Wt(c){const t=this.model.state.hopdong.find(y=>y.id===c);if(!t)return;const a=this.model.state.chudautu.find(y=>y.id===t.chuDauTuId),n=this.model.state.nhathau.find(y=>y.id===t.nhaThauId),i=this.model.getLatestPlan(t.keHoachId),e=typeof this.model.getLatestPackages=="function"?this.model.getLatestPackages():this.model.state.goithau||[],o=(t.goiThauIds||[]).map(y=>e.find(x=>x.id===y)).filter(Boolean),u=(this.model.state.custompaperstatuses||[]).find(y=>y.name===t.trangThaiHoSo),d=u?u.color:"#6b7280",r=t.trangThaiHoSo?`<span class="status-pill" style="background-color: ${d}; color: white; padding: 4px 12px; border-radius: 20px; font-weight: 700; font-size: 0.85rem;">${t.trangThaiHoSo}</span>`:'<span class="text-muted">Chưa cập nhật</span>',h=t.rootId||t.id,g=this.model.state.hopdong.filter(y=>(y.rootId||y.id)===h),s={};g.forEach(y=>{const x=y.phienBan||y.phien_ban||"00";(!s[x]||y.isLatest==1||y.is_latest==1)&&(s[x]=y)});const p=Object.values(s);p.sort((y,x)=>{const f=parseInt(y.phienBan||y.phien_ban||0);return parseInt(x.phienBan||x.phien_ban||0)-f});const v=`
        <select id="fullpage-hd-version-select" class="page-version-select" style="min-width: 100px; max-width: 320px; width: auto;">
            ${p.map(y=>{const x=y.phienBan||y.phien_ban||"00",f=`V${parseInt(x)}`;return`<option value="${y.id}" ${y.id===c?"selected":""}>${f}</option>`}).join("")}
        </select>
    `,b=`
        <div class="detail-section">
            <div class="detail-header-block" style="padding-bottom: 16px; margin-bottom: 20px; border-bottom: 1px solid var(--border-color);">
                <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 10px;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span class="detail-code" style="margin: 0; display: inline-flex; align-items: center; height: 28px; box-sizing: border-box;">${t.soHopDong||"--"}</span>
                        <span class="version-separator" style="color: var(--text-muted, #64748b); font-weight: 600;">-</span>
                        ${v}
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
    `,T=document.getElementById("fullpage-hopdong-content");if(T){T.innerHTML=b;const y=document.getElementById("fullpage-hd-version-select");y&&(y.onchange=x=>{this.renderContractVersionDetails(x.target.value)},window.initCustomSelect&&window.initCustomSelect("fullpage-hd-version-select")),lucide.createIcons()}}const Yt=Object.freeze(Object.defineProperty({__proto__:null,getJointVentureMemberHTML:Qt,renderBieumauTab:Ot,renderChuDauTuTable:Vt,renderChuyenGiaTable:zt,renderContractVersionDetails:Wt,renderDictionary:xt,renderHopDongTable:jt,renderNhaThauTable:At,renderWordMappingsTable:Rt,renderWordTemplates:Ut,showChuyenGiaDetails:Kt,showHopDongDetails:Ft},Symbol.toStringTag,{value:"Module"}));function Xt(){const c=document.getElementById("header-profile-avatar"),t=document.getElementById("header-profile-name"),a=document.getElementById("header-profile-role");if(c&&t&&a){const o=this.model.state.activeuser;t.textContent=o.name;const l=o.organization_name?o.organization_name.split(",").map(g=>g.trim()).filter(Boolean):[];let u=localStorage.getItem("bf_active_org");(!u||!l.includes(u))&&(u=l[0]||"",u?localStorage.setItem("bf_active_org",u):localStorage.removeItem("bf_active_org")),a.textContent=`Chế độ: ${o.title}`;const d=document.getElementById("header-active-org-pill"),r=document.getElementById("header-active-org-name");d&&r&&(u?(r.textContent=u,d.style.display="flex",d.style.cursor="default"):d.style.display="none"),window.appController&&typeof window.appController.renderWorkspaceSwitcher=="function"&&window.appController.renderWorkspaceSwitcher(),o.avatar?(c.innerHTML=`<img src="${o.avatar}" alt="Avatar">`,c.style.background="none"):(c.textContent=o.name.split(" ").map(g=>g[0]).join("").slice(0,2).toUpperCase(),this.model.state.activerole==="super_admin"?c.style.background="linear-gradient(135deg, #a855f7 0%, #4f46e5 100%)":this.model.state.activerole==="manager"?c.style.background="linear-gradient(135deg, #3b82f6 0%, #10b981 100%)":c.style.background="linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)");const h=document.getElementById("sa-role-switch-section");if(h){if(o.dbRole==="super_admin"||o.dbRole==="manager"){h.style.display="block";const g=document.querySelector('.dropdown-role-btn[data-switch-role="super_admin"]'),s=document.querySelector('.dropdown-role-btn[data-switch-role="manager"]'),p=document.querySelector('.dropdown-role-btn[data-switch-role="employee"]');o.dbRole==="super_admin"?(g&&(g.style.display="flex"),s&&(s.style.display="flex"),p&&(p.style.display="flex")):o.dbRole==="manager"&&(g&&(g.style.display="none"),s&&(s.style.display="flex"),p&&(p.style.display="flex"))}else h.style.display="none";document.querySelectorAll(".dropdown-role-btn").forEach(g=>{g.getAttribute("data-switch-role")===this.model.state.activerole?(g.style.background="rgba(147, 51, 234, 0.08)",g.style.color="#a855f7"):(g.style.background="transparent",g.style.color="var(--text-main)")})}}const n=document.querySelectorAll(".role-menu-superadmin"),i=document.querySelectorAll(".role-menu-manager"),e=document.querySelectorAll(".role-menu-client");n.forEach(o=>{o.style.display=this.model.state.activerole==="super_admin"?"block":"none"}),i.forEach(o=>{o.style.display=this.model.state.activerole==="manager"?"block":"none"}),e.forEach(o=>{o.style.display=this.model.state.activerole==="super_admin"?"none":"block"}),this.applySecurityLockOverlay(),this.populateNhanVienPhuTrachDropdowns()}function Jt(){document.querySelectorAll(".security-lock-overlay").forEach(c=>c.remove())}function Zt(){const c=document.getElementById("gt-nhanvienphutrach"),t=document.getElementById("hd-nhanvienphutrach");let a=Array.isArray(this.model.state.employees)?this.model.state.employees:[];if(this.model.state.activerole!=="super_admin"){const e=localStorage.getItem("bf_active_org");e&&(a=a.filter(o=>(o.organization_name?o.organization_name.split(",").map(u=>u.trim()).filter(Boolean):[]).includes(e)))}const n={super_admin:"Super Admin / Quản lý / Chuyên viên",manager:"Quản lý / Chuyên viên",employee:"Chuyên viên"},i=a.map(e=>{const o=n[e.role]||e.role;return`<option value="${escapeHTML(e.id)}">${escapeHTML(e.name)} — ${escapeHTML(o)}${e.email?" ("+escapeHTML(e.email)+")":""}</option>`}).join("");c&&(c.innerHTML='<option value="">-- Chọn Chuyên viên phụ trách --</option>'+i),t&&(t.innerHTML='<option value="">-- Chọn Chuyên viên phụ trách --</option>'+i)}function te(){const c=document.getElementById("sa-pricing-grid");c&&this.model.state.systempackages&&(c.innerHTML=this.model.state.systempackages.map(t=>{const a=t.id==="silver"?"Silver":t.id==="gold"?"Bán chạy":"Diamond",n=t.id==="gold"?"badge-popular":"",i=t.id==="silver"?"silver-card":t.id==="gold"?"gold-card popular":"diamond-card",e=this.model.formatCurrency(t.price),o=t.quota>=999?"Không giới hạn":`Tối đa ${t.quota} Nhân sự`,l=t.isLocked||!1,u=l?"Đã khóa":"Hoạt động",d=l?"btn-danger":"btn-emerald";return`
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
                            onclick="window.togglePackageLock('${t.id}')">${u}</button>
                    </div>
                </div>
            `}).join("")),fetch("/api/auth/users").then(t=>t.ok?t.json():[]).then(t=>{const a={};t.forEach(r=>{(r.organization_name?r.organization_name.split(",").map(g=>g.trim()).filter(Boolean):[]).forEach(g=>{a[g]||(a[g]={id:r.id,name:g,contact:"",phone:"",packageId:"none",regDate:r.package_start_date||"",expDate:r.package_end_date||"",status:"Hoạt động"}),(r.role==="manager"||!a[g].contact)&&(a[g].contact=r.name,a[g].packageId=r.package_id||"none",a[g].regDate=r.package_start_date||"",a[g].expDate=r.package_end_date||"")})}),this.model.state.organizations=Object.values(a),this.model.state.employees=t.map(r=>({id:r.id,name:r.name,email:r.email||"",phone:"",role:r.role,username:r.username,package_id:r.package_id,package_start_date:r.package_start_date,package_end_date:r.package_end_date,organization_name:r.organization_name}));const n=this.model.state.organizations.filter(r=>r.status==="Hoạt động");this.model.state.organizations.filter(r=>r.status==="Đã khóa");let i=0;this.model.state.organizations.forEach(r=>{if(r.status==="Hoạt động"){const h=this.model.state.systempackages.find(g=>g.id===r.packageId);h&&(i+=h.price)}});const e=document.getElementById("sa-stat-revenue");e&&(e.textContent=this.model.formatCurrency(i));const o=document.getElementById("sa-stat-orgs");o&&(o.textContent=`${this.model.state.organizations.length} Đơn vị`);const l=document.querySelector("#sa-stat-orgs + .stat-trend");l&&(l.textContent=`Đang hoạt động: ${n.length}`);const u=document.getElementById("sa-stat-employees");u&&(u.textContent=`${this.model.state.employees.length} Nhân sự`);const d=document.getElementById("sa-organizations-tbody");d&&(d.innerHTML=this.model.state.organizations.map(r=>{const h=this.model.state.systempackages.find(m=>m.id===r.packageId),g=h?`<span class="badge ${r.packageId==="diamond"?"badge-warning":r.packageId==="gold"?"badge-info":"badge-neutral"}">${h.name}</span>`:"--",s=r.status==="Hoạt động"?'<span class="badge badge-success"><i data-lucide="check-circle"></i> Hoạt động</span>':'<span class="badge badge-danger"><i data-lucide="lock"></i> Đã khóa</span>',p=r.status==="Hoạt động"?`<button class="action-btn btn-delete" onclick="window.toggleOrgLock('${r.id}')" title="Khóa Đơn vị"><i data-lucide="lock"></i></button>`:`<button class="action-btn btn-edit" style="color:var(--success); background:rgba(16,185,129,0.1);" onclick="window.toggleOrgLock('${r.id}')" title="Mở khóa Đơn vị"><i data-lucide="unlock"></i></button>`;return`
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
                    `}).join("")),lucide.createIcons()})}function ee(){const c=sessionStorage.getItem("bf_username"),t=this.model.state.employees.find(s=>s.username===c),a=t&&t.package_id?t.package_id.split(",").filter(s=>s&&s!=="none"):["silver"];let n="silver";a.includes("diamond")?n="diamond":a.includes("gold")&&(n="gold");const i=this.model.state.systempackages.find(s=>s.id===n),e=i?i.quota:5,o=localStorage.getItem("bf_active_org"),l=this.model.state.employees.filter(s=>s.role!=="employee"?!1:o?(s.organization_name?s.organization_name.split(",").map(m=>m.trim()).filter(Boolean):[]).includes(o):!0),u=document.getElementById("manager-quota-label");u&&(u.textContent=`${l.length} / ${e===999?"Không giới hạn":e} Nhân sự`);const d=document.getElementById("manager-quota-progress-fill");if(d){const s=e===999?20:l.length/e*100;d.style.width=`${Math.min(s,100)}%`,s>=90?d.style.background="var(--danger)":s>=70?d.style.background="var(--warning)":d.style.background="linear-gradient(90deg, var(--primary) 0%, #1d4ed8 100%)"}const r=document.getElementById("manager-package-name");r&&(r.textContent=i?i.name:"--");const h=document.getElementById("manager-employees-tbody");h&&(h.innerHTML=l.map(s=>{const m=this.model.state.assignments.filter(v=>v.empId===s.id).map(v=>{if(v.type==="goithau"){const b=this.model.state.goithau.find(T=>T.id===v.targetId);return b?`<span class="badge badge-neutral" style="margin:2px;">GT: ${b.maGoiThau}</span>`:""}else if(v.type==="hopdong"){const b=this.model.state.hopdong.find(T=>T.id===v.targetId);return b?`<span class="badge badge-info" style="margin:2px;">HD: ${b.soHopDong}</span>`:""}return""}).filter(Boolean).join(" ");return`
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
            `}).join(""));const g=document.getElementById("manager-matrix-tbody");g&&(g.innerHTML=l.map(s=>{const p=this.model.state.permissionmatrix.find(v=>v.empId===s.id)||{kehoach:"view",goithau:"view",hopdong:"view",chudautu:"view",nhathau:"view",chuyengia:"view"},m=v=>{const b=p[v]||"view";return`
                    <td class="matrix-checkbox-cell">
                        <select class="form-control matrix-select" data-emp-id="${s.id}" data-module="${v}" style="width: 100px; display: inline-block; padding: 2px 4px; height: auto; font-size: 0.82rem; border-radius: 4px; border: 1px solid var(--border-color, #ccc); background-color: var(--bg-card); color: var(--text-main);">
                            <option value="view" ${b==="view"?"selected":""}>Xem</option>
                            <option value="edit" ${b==="edit"?"selected":""}>Sửa đổi</option>
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
            `}).join("")),lucide.createIcons()}function ae(){const c="1",t=this.model.state.custompaperstatuses.filter(n=>n.orgId===c),a=document.getElementById("manager-hosogiay-tbody");a&&(t.length===0?a.innerHTML='<tr><td colspan="3" class="text-center text-muted">Chưa cấu hình trạng thái hồ sơ giấy nào.</td></tr>':a.innerHTML=t.map(n=>`
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
            `).join("")),lucide.createIcons()}function ne(c){if(!c)return;const t=document.getElementById("profile-username"),a=document.getElementById("profile-fullname"),n=document.getElementById("profile-email");t&&(t.value=c.username||sessionStorage.getItem("bf_username")||""),a&&(a.value=c.name||""),n&&(n.value=c.email||"");const i=document.getElementById("profile-organization"),e=document.getElementById("profile-org-container");e&&i&&(c.organization_name||c.package_id&&c.package_id!=="none"?(e.style.display="block",i.value=c.organization_name||""):(e.style.display="none",i.value=""));const o=document.getElementById("profile-avatar-preview"),l=document.getElementById("profile-avatar-fallback");c.avatar?(o&&(o.src=c.avatar,o.style.display="block"),l&&(l.style.display="none")):(o&&(o.src="",o.style.display="none"),l&&(l.textContent=(c.name||"AD").split(" ").map(u=>u[0]).join("").slice(0,2).toUpperCase(),l.style.display="flex"))}function ie(c,t){const a=document.getElementById("sa-users-tbody");if(!a)return;if(!c||c.length===0){a.innerHTML='<tr><td colspan="7" class="text-center text-muted">Không có người dùng nào.</td></tr>';return}const n=o=>{if(!o)return'<span class="text-muted" style="font-size:0.8rem;">Chưa kích hoạt</span>';const l=new Date(o),u=new Date;l.setHours(0,0,0,0),u.setHours(0,0,0,0);const d=l-u,r=Math.ceil(d/(1e3*60*60*24));return r<0?`<span class="badge badge-danger" style="background-color: rgba(239,68,68,0.1); color: var(--danger); font-size: 0.8rem; font-weight: 600;"><i data-lucide="alert-circle" style="width:12px;height:12px;display:inline-block;vertical-align:middle;margin-right:2px;"></i> Hết hạn (${Math.abs(r)} ngày trước)</span>`:r===0?'<span class="badge badge-warning" style="background-color: rgba(245,158,11,0.1); color: #f59e0b; font-size: 0.8rem; font-weight: 600;"><i data-lucide="alert-triangle" style="width:12px;height:12px;display:inline-block;vertical-align:middle;margin-right:2px;"></i> Hôm nay hết hạn</span>':r<=30?`<span class="badge badge-warning" style="background-color: rgba(245,158,11,0.1); color: #f59e0b; font-size: 0.8rem; font-weight: 600;">Còn ${r} ngày</span>`:`<span class="badge badge-success" style="background-color: rgba(16,185,129,0.1); color: var(--success); font-size: 0.8rem; font-weight: 600;">Còn ${r} ngày</span>`},i=o=>({super_admin:'<span class="badge badge-purple" style="font-size:0.8rem; font-weight:600;"><i data-lucide="shield-alert" style="width:12px;height:12px;display:inline-block;vertical-align:middle;margin-right:2px;"></i> Super Admin</span>',manager:'<span class="badge badge-info" style="font-size:0.8rem; font-weight:600;"><i data-lucide="shield" style="width:12px;height:12px;display:inline-block;vertical-align:middle;margin-right:2px;"></i> Quản lý</span>',employee:'<span class="badge badge-neutral" style="font-size:0.8rem; font-weight:600;"><i data-lucide="user" style="width:12px;height:12px;display:inline-block;vertical-align:middle;margin-right:2px;"></i> Chuyên viên</span>'})[o]||`<span class="badge badge-neutral">${o}</span>`,e=o=>({silver:'<span class="badge badge-neutral" style="font-size:0.8rem; font-weight:600; background:rgba(148,163,184,0.1); color:#475569; border:1px solid rgba(148,163,184,0.2);">Gói Bạc (Silver)</span>',gold:'<span class="badge badge-warning" style="font-size:0.8rem; font-weight:600; background:rgba(245,158,11,0.1); color:#b45309; border:1px solid rgba(245,158,11,0.2);">Gói Vàng (Gold)</span>',diamond:'<span class="badge badge-info" style="font-size:0.8rem; font-weight:600; background:rgba(14,165,233,0.1); color:#0284c7; border:1px solid rgba(14,165,233,0.2);">Gói Kim Cương (Diamond)</span>',none:'<span class="text-muted" style="font-size:0.8rem;">Chưa chọn gói</span>'})[o]||'<span class="text-muted" style="font-size:0.8rem;">Chưa chọn gói</span>';a.innerHTML=c.map(o=>{const u=o.username===t?'<span class="text-muted" style="font-size:0.8rem; font-style:italic;">(Tài khoản hiện tại)</span>':`<button class="action-btn btn-delete" onclick="window.deleteSystemUser('${o.id}', '${o.username}')" title="Xóa tài khoản"><i data-lucide="trash-2"></i></button>`,d=`<button class="action-btn btn-edit" onclick="window.showSystemUserDetail('${o.id}')" title="Xem chi tiết & Cấu hình"><i data-lucide="user-cog"></i></button>`;return`
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
                        ${u}
                    </div>
                </td>
            </tr>
        `}).join(""),lucide.createIcons()}const oe=Object.freeze(Object.defineProperty({__proto__:null,applySecurityLockOverlay:Jt,populateNhanVienPhuTrachDropdowns:Zt,renderManagerHoSoGiayPanel:ae,renderManagerNhanVienPanel:ee,renderProfileTab:ne,renderSuperAdminPanel:te,renderSystemUsersTable:ie,updateActiveUserProfileDisplay:Xt},Symbol.toStringTag,{value:"Module"}));class wt{constructor(t){this.model=t,this.elements={}}initDOM(){this.elements={themeToggle:document.getElementById("theme-toggle"),sunIcon:document.getElementById("sun-icon"),moonIcon:document.getElementById("moon-icon"),sidebarToggle:document.getElementById("sidebar-toggle"),sidebar:document.getElementById("sidebar"),currentDateSpan:document.getElementById("current-date").querySelector("span"),pageTitle:document.getElementById("page-title"),navButtons:document.querySelectorAll(".nav-btn"),tabPanes:document.querySelectorAll(".tab-pane")},this._tableObserver||(this._tableObserver=new MutationObserver(()=>{this.enhanceAllTables()}),this._tableObserver.observe(document.body,{childList:!0,subtree:!0})),setTimeout(()=>this.enhanceAllTables(),100)}enhanceAllTables(){this._tableObserver&&this._tableObserver.disconnect(),document.querySelectorAll("table").forEach(a=>{this.enhanceTableHeaders(a)}),this.upgradeAllSelects(),this._tableObserver&&this._tableObserver.observe(document.body,{childList:!0,subtree:!0})}upgradeAllSelects(){document.querySelectorAll("body > .custom-select-dropdown").forEach(t=>{const a=t.getAttribute("data-target"),n=document.getElementById(a),i=document.querySelector(`.custom-select-container[data-target="${a}"]`);(!n||!i||i.offsetWidth===0&&i.offsetHeight===0)&&t.remove()}),document.querySelectorAll("select").forEach(t=>{const a=t.getAttribute("data-no-custom")==="true",n=t.id&&t.parentNode.querySelector(`.custom-select-wrapper[data-select-id="${t.id}"]`);if(t.classList.contains("version-select")||t.classList.contains("phienban-select")||t.classList.contains("modal-version-select")||a||n){if(t.id){const i=t.parentNode.querySelector(`.custom-select-container[data-target="${t.id}"]`);i&&(i.remove(),n||(t.style.display=""))}return}t.id||(t.id="select-"+Math.random().toString(36).substring(2,9)),ht(t.id)})}enhanceTableHeaders(t,a){let n=typeof t=="string"?document.getElementById(t):t;if(!n)return;const i='<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevrons-up-down" style="display: block;"><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg>',e='<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-up" style="display: block;"><path d="m18 15-6-6-6 6"/></svg>',o='<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-down" style="display: block;"><path d="m6 9 6 6 6-6"/></svg>';!a&&n.id&&(a={"kehoach-table":"kehoach","goithau-table":"goithau","chudautu-table":"chudautu","nhathau-table":"nhathau","chuyengia-table":"chuyengia","hopdong-table":"hopdong"}[n.id]);const l=h=>h?h.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]/g,"").trim():"",u={kehoach:{makehoach:"maKeHoach",phienban:"phienBan",tenkehoachluachonnhathau:"tenKeHoach",phanloai:"loaiHinhMuaSam",duandutoan:"tenDuAnDuToan",chudautu:"chuDauTuId",tonggiatri:"tongMucDauTu",ngaypheduyet:"ngayPheDuyet",soqd:"quyetDinhPheDuyet",thoigiandangma:"thoiGianDangMa"},goithau:{magoi:"maGoiThau",magoithau:"maGoiThau",phienban:"phienBan",tengoithau:"tenGoiThau",kehoachlienket:"keHoachId",giagoithau:"giaGoiThau",hinhthuc:"hinhThucLuaChon",hinhthuclcnt:"hinhThucLuaChon",trangthai:"trangThai",nhathautrungthau:"nhaThauTrungThauId"},chudautu:{macdt:"maChuDauTu",machudautu:"maChuDauTu",phienban:"phienBan",tenchudautu:"tenChuDauTu",masothue:"maSoThue",daidien:"nguoiKyQuyetDinh",diachisdt:"diaChi",sotaikhoan:"soTaiKhoan"},nhathau:{manhathau:"maNhaThau",phienban:"phienBan",tennhathau:"tenNhaThau",masothue:"maSoThue",nguoidaidien:"nguoiDaiDien",lienhe:"soDienThoai",taikhoannganhang:"soTaiKhoan"},chuyengia:{hovatenchuyengia:"hoTen",hotenchuyengia:"hoTen",phienban:"phienBan",socancuoccongdan:"soCCCD",sochungchidauthau:"soChungChi",donvicapchungchi:"donViCapChungChi",ngaycapchungchi:"ngayCapChungChi",ngaycapcccd:"ngayCapCCCD"},hopdong:{sohopdong:"soHopDong",phienban:"phienBan",tenhopdong:"tenHopDong",ngayky:"ngayKy",chudautu:"chuDauTuId",nhathau:"nhaThauId",giatrihopdong:"giaTri",loaihopdong:"loaiHopDong",thoigianthuchien:"soNgayThucHien",goithaulienket:"goiThauId",trangthaihoso:"trangThaiHoSo"}},d=n.querySelectorAll("thead th"),r=a?u[a]:null;d.forEach((h,g)=>{const s=h.textContent.replace(/[↕▲▼]/g,"").trim(),p=l(s);if(!p||["thaotac","hanhdong","chucnang","chon","tuychon"].includes(p))return;const m=r?r[p]:null;if(!h.querySelector(".sort-header-container")){h.style.cursor="pointer",h.style.userSelect="none";const b=h.innerHTML;h.innerHTML=`
                    <div class="sort-header-container">
                        <span class="th-label" style="flex-grow: 1; text-align: inherit;">${b}</span>
                        <span class="sort-icon-btn">
                            ${i}
                        </span>
                    </div>
                `,h.addEventListener("click",T=>{if(!(T.target.closest("select")||T.target.closest("input")||T.target.closest("button")||T.target.closest("a")))if(a&&m)window.toggleSortTable(a,m);else{const y=h.getAttribute("data-sort-order")==="asc"?"desc":"asc";d.forEach(S=>{if(S!==h){S.removeAttribute("data-sort-order");const w=S.querySelector(".sort-icon-btn");w&&(w.innerHTML=i,w.classList.remove("active"),w.style.opacity="",w.style.color="",w.style.fontWeight="")}}),h.setAttribute("data-sort-order",y);const x=h.querySelector(".sort-icon-btn");x&&(x.innerHTML=y==="asc"?e:o,x.classList.add("active"),x.style.opacity="",x.style.color="",x.style.fontWeight="");const f=n.querySelector("tbody");if(f){const S=Array.from(f.querySelectorAll("tr")),w=C=>{const V=C.children[g];if(!V)return"";const P=V.querySelector("input, select");return P?P.value.trim():V.textContent.trim()},M=C=>{const V=C.replace(/\./g,"").replace(/,/g,".").replace(/[^0-9.-]/g,"");if(V&&!isNaN(V))return parseFloat(V);const P=C.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);return P?new Date(P[3],P[2]-1,P[1]).getTime():C.toLowerCase()};S.sort((C,V)=>{const P=M(w(C)),et=M(w(V));return typeof P=="number"&&typeof et=="number"?y==="asc"?P-et:et-P:y==="asc"?String(P).localeCompare(String(et),"vi"):String(et).localeCompare(String(P),"vi")}),S.forEach(C=>f.appendChild(C))}}})}if(a&&m){const b=this.model.sortState[a]||{},T=h.querySelector(".sort-icon-btn");T&&(b.field===m?(T.innerHTML=b.order==="asc"?e:o,T.classList.add("active"),T.style.opacity="",T.style.color="",T.style.fontWeight=""):(T.innerHTML=i,T.classList.remove("active"),T.style.opacity="",T.style.color="",T.style.fontWeight=""))}})}openModal(t){const a=document.getElementById(t);a&&a.classList.add("active")}closeModal(t){const a=document.getElementById(t);a&&a.classList.remove("active")}customConfirm(t,a,n="help-circle"){return new Promise(i=>{const e=document.getElementById("modal-custom-dialog"),o=document.getElementById("dialog-title"),l=document.getElementById("dialog-message"),u=document.getElementById("dialog-icon-container"),d=document.getElementById("dialog-icon"),r=document.getElementById("btn-dialog-ok"),h=document.getElementById("btn-dialog-cancel"),g=document.getElementById("btn-dialog-close");o.textContent=t,l.textContent=a,h.style.display="block",g&&(g.style.display="block"),d.setAttribute("data-lucide",n),n==="trash-2"||n==="user-x"||n==="log-out"?(u.style.background="var(--danger-soft)",u.style.color="var(--danger)",r.className="btn btn-primary bg-danger",r.style.background="var(--danger)",r.style.borderColor="var(--danger)"):n==="alert-triangle"||n==="alert-circle"||n==="info"||n==="help-circle"||n==="save"?(u.style.background="var(--warning-soft)",u.style.color="var(--warning)",r.className="btn btn-primary bg-warning",r.style.background="var(--warning)",r.style.borderColor="var(--warning)"):(u.style.background="rgba(59, 130, 246, 0.1)",u.style.color="var(--primary)",r.className="btn btn-primary",r.style.background="",r.style.borderColor=""),lucide.createIcons();const s=()=>{v(),i(!0)},p=()=>{v(),i(!1)},m=()=>{v(),i(null)},v=()=>{r.removeEventListener("click",s),h.removeEventListener("click",p),g&&g.removeEventListener("click",m),e.classList.remove("active")};r.addEventListener("click",s),h.addEventListener("click",p),g&&g.addEventListener("click",m),e.classList.add("active")})}customVersionDeleteChoice(t,a,n="Xóa phiên bản gần nhất",i="Xóa toàn bộ các phiên bản"){return new Promise(e=>{const o=document.getElementById("modal-custom-dialog"),l=document.getElementById("dialog-title"),u=document.getElementById("dialog-message"),d=document.getElementById("dialog-icon-container"),r=document.getElementById("dialog-icon"),h=document.getElementById("dialog-buttons"),g=document.getElementById("btn-dialog-close");l.textContent=t,u.textContent=a,g&&(g.style.display="block"),r.setAttribute("data-lucide","trash-2"),d.style.background="var(--danger-soft)",d.style.color="var(--danger)";const s=h.innerHTML,p=h.style.flexDirection,m=h.style.gap,v=o.querySelector(".modal-card"),b=v.style.width,T=v.style.maxWidth;v.style.setProperty("width","480px","important"),v.style.setProperty("max-width","480px","important"),h.style.flexDirection="row",h.style.gap="10px",h.innerHTML=`
                <button type="button" class="btn btn-outline" id="btn-dialog-cancel" style="flex: 1; padding: 8px 10px; font-size: 0.8rem; font-weight: 600; white-space: nowrap; height: 38px;">Hủy</button>
                <button type="button" class="btn btn-primary" id="btn-dialog-opt1" style="flex: 1.6; background: var(--warning); border-color: var(--warning); padding: 8px 10px; font-size: 0.8rem; color: #fff; font-weight: 600; white-space: nowrap; height: 38px;">${n}</button>
                <button type="button" class="btn btn-primary" id="btn-dialog-opt2" style="flex: 1.6; background: var(--danger); border-color: var(--danger); padding: 8px 10px; font-size: 0.8rem; color: #fff; font-weight: 600; white-space: nowrap; height: 38px;">${i}</button>
            `,lucide.createIcons();const y=document.getElementById("btn-dialog-opt1"),x=document.getElementById("btn-dialog-opt2"),f=document.getElementById("btn-dialog-cancel"),S=()=>{V(),e(1)},w=()=>{V(),e(2)},M=()=>{V(),e(null)},C=()=>{V(),e(null)},V=()=>{y.removeEventListener("click",S),x.removeEventListener("click",w),f.removeEventListener("click",M),g&&g.removeEventListener("click",C),v.style.width=b,v.style.maxWidth=T,h.style.flexDirection=p,h.style.gap=m,h.innerHTML=s,o.classList.remove("active")};y.addEventListener("click",S),x.addEventListener("click",w),f.addEventListener("click",M),g&&g.addEventListener("click",C),o.classList.add("active")})}customAlert(t,a,n="info",i=null){return new Promise(e=>{const o=document.getElementById("modal-custom-dialog"),l=document.getElementById("dialog-title"),u=document.getElementById("dialog-message"),d=document.getElementById("dialog-icon-container"),r=document.getElementById("dialog-icon"),h=document.getElementById("btn-dialog-ok"),g=document.getElementById("btn-dialog-cancel"),s=document.getElementById("btn-dialog-close");l.textContent=t,u.textContent=a,g.style.display="none",s&&(s.style.display="block");let p=[];if(i){const f=document.querySelector(".tab-pane.active")||document;typeof i=="string"?p=Array.from(f.querySelectorAll(i)):i instanceof HTMLElement?p=[i]:i.length!==void 0&&Array.from(i).forEach(S=>{typeof S=="string"?p.push(...f.querySelectorAll(S)):S instanceof HTMLElement&&p.push(S)})}const m=[];p.forEach(x=>{m.push(x);const f=x.closest(".form-group")||x.parentElement;f&&f.classList.add("invalid");const S=()=>{const w=x.closest(".form-group")||x.parentElement;w&&w.classList.remove("invalid"),x.removeEventListener("input",S),x.removeEventListener("change",S)};x.addEventListener("input",S),x.addEventListener("change",S)}),r.setAttribute("data-lucide",n),n==="check-circle"?(d.style.background="rgba(16, 185, 129, 0.1)",d.style.color="var(--success)",h.className="btn btn-primary",h.style.background="",h.style.borderColor=""):n==="alert-triangle"||n==="alert-circle"||n==="info"||n==="save"?(d.style.background="var(--warning-soft)",d.style.color="var(--warning)",h.className="btn btn-primary bg-warning",h.style.background="var(--warning)",h.style.borderColor="var(--warning)"):n==="x-circle"||n==="trash-2"||n==="user-x"||n==="log-out"?(d.style.background="var(--danger-soft)",d.style.color="var(--danger)",h.className="btn btn-primary bg-danger",h.style.background="var(--danger)",h.style.borderColor="var(--danger)"):(d.style.background="rgba(59, 130, 246, 0.1)",d.style.color="var(--primary)",h.className="btn btn-primary",h.style.background="",h.style.borderColor=""),lucide.createIcons();const v=()=>{if(m.length>0){const x=m[0];x.scrollIntoView({behavior:"smooth",block:"center",inline:"center"}),setTimeout(()=>{x.focus({preventScroll:!0})},300)}},b=()=>{y(),e(!0),v()},T=()=>{y(),e(null),v()},y=()=>{h.removeEventListener("click",b),s&&s.removeEventListener("click",T),o.classList.remove("active")};h.addEventListener("click",b),s&&s.addEventListener("click",T),o.classList.add("active")})}customPrompt(t,a,n="",i="",e=!1){return new Promise(o=>{const l=document.getElementById("modal-custom-dialog"),u=document.getElementById("dialog-title"),d=document.getElementById("dialog-message"),r=document.getElementById("dialog-icon-container"),h=document.getElementById("dialog-icon"),g=document.getElementById("btn-dialog-ok"),s=document.getElementById("btn-dialog-cancel"),p=document.getElementById("btn-dialog-close");u.textContent=t,d.textContent=a,s.style.display="block",p&&(p.style.display="block");const m=document.createElement("div");m.id="dialog-prompt-container",m.style.marginTop="16px",m.style.textAlign="left";const v=document.createElement("input");v.type="text",v.id="dialog-prompt-input",v.value=n,v.placeholder=i,v.style.width="100%",v.style.padding="10px 14px",v.style.border="1px solid var(--border-color)",v.style.borderRadius="var(--radius-md)",v.style.background="var(--bg-card)",v.style.color="var(--text-main)",v.style.fontFamily="inherit",v.style.fontSize="0.95rem",v.style.outline="none",v.style.boxSizing="border-box",m.appendChild(v),d.parentNode.insertBefore(m,d.nextSibling),e?(v.type="datetime-local",n&&(v.value=this.model.formatForDatetimeLocal(n)),setTimeout(()=>v.focus(),100)):setTimeout(()=>v.focus(),100),h.setAttribute("data-lucide","calendar"),r.style.background="rgba(59, 130, 246, 0.1)",r.style.color="var(--primary)",g.className="btn btn-primary",g.style.background="",g.style.borderColor="",lucide.createIcons();const b=()=>{let f=v.value;e&&f&&(f=this.model.formatDate(f)),x(),o(f)},T=()=>{x(),o(null)},y=()=>{x(),o(null)},x=()=>{g.removeEventListener("click",b),s.removeEventListener("click",T),p&&p.removeEventListener("click",y);const f=document.getElementById("dialog-prompt-container");f&&f.remove(),l.classList.remove("active")};e||v.addEventListener("keyup",f=>{f.key==="Enter"&&b()}),g.addEventListener("click",b),s.addEventListener("click",T),p&&p.addEventListener("click",y),l.classList.add("active")})}validateForm(t){let a=!0;const n=t.querySelectorAll("[required]"),i=[];if(n.forEach(e=>{const o=e.closest(".form-group");if(o&&o.offsetWidth===0&&o.offsetHeight===0||!o&&e.offsetWidth===0&&e.offsetHeight===0&&e.type!=="hidden")return;let l=!0;if(e.value.trim()==="")l=!1;else if(e.type==="number"){const u=parseFloat(e.value),d=e.getAttribute("min")?parseFloat(e.getAttribute("min")):-1/0;(isNaN(u)||u<d)&&(l=!1)}else e.type==="email"&&(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.value.trim())||(l=!1));if(o){l?o.classList.remove("invalid"):(o.classList.add("invalid"),i.push(e),a=!1);const u=()=>{e.value.trim()!==""&&(o.classList.remove("invalid"),e.removeEventListener("input",u),e.removeEventListener("change",u))};e.addEventListener("input",u),e.addEventListener("change",u)}}),!a&&i.length>0){const e=i[0];e.scrollIntoView({behavior:"smooth",block:"center",inline:"center"}),setTimeout(()=>{if(e.tagName==="SELECT"&&e.style.display==="none"){const o=e.parentNode.querySelector(`.custom-select-wrapper[data-select-id="${e.id}"]`),l=o?o.querySelector(".custom-select-search"):null;if(l){l.focus({preventScroll:!0});return}}e.focus({preventScroll:!0})},300)}return a}getActiveElement(t){const a=document.querySelector(".tab-pane.active");if(a){const n=a.querySelector("#"+t);if(n)return n}return document.getElementById(t)}debounce(t,a){let n;return function(...i){const e=this;clearTimeout(n),n=setTimeout(()=>t.apply(e,i),a)}}formatCurrencyInput(t){let a=t.value.replace(/[^0-9]/g,"");if(a===""){t.value="";return}t.value=new Intl.NumberFormat("vi-VN").format(parseInt(a,10))}customConflictDialog(t,a){return new Promise(n=>{const i=document.getElementById("modal-custom-dialog"),e=document.getElementById("dialog-title"),o=document.getElementById("dialog-message"),l=document.getElementById("dialog-icon-container"),u=document.getElementById("dialog-icon"),d=document.getElementById("dialog-buttons"),r=document.getElementById("btn-dialog-close");if(!i||!e||!o||!d)return console.error("Conflict modal element not found!"),n("local");e.textContent=t,o.textContent=a,r&&(r.style.display="none"),l&&u&&(l.style.background="var(--warning-soft)",l.style.color="var(--warning)",u.setAttribute("data-lucide","alert-circle"),window.lucide&&window.lucide.createIcons({root:l})),d.innerHTML=`
                <button type="button" class="btn btn-outline" id="btn-conflict-server" style="flex: 1; font-size: 0.8rem; padding: 6px 8px;">Dùng bản Server</button>
                <button type="button" class="btn btn-outline" id="btn-conflict-local" style="flex: 1; font-size: 0.8rem; padding: 6px 8px;">Dùng bản Local</button>
                <button type="button" class="btn btn-primary" id="btn-conflict-new" style="flex: 1; font-size: 0.8rem; padding: 6px 8px;">Tạo bản mới</button>
            `;const h=m=>{i.classList.remove("active"),d.innerHTML=`
                    <button type="button" class="btn btn-outline" id="btn-dialog-cancel" style="flex: 1;">Hủy</button>
                    <button type="button" class="btn btn-primary" id="btn-dialog-ok" style="flex: 1;">Xác nhận</button>
                `,r&&(r.style.display="block"),n(m)},g=document.getElementById("btn-conflict-server"),s=document.getElementById("btn-conflict-local"),p=document.getElementById("btn-conflict-new");g&&(g.onclick=()=>h("server")),s&&(s.onclick=()=>h("local")),p&&(p.onclick=()=>h("new")),i.classList.add("active")})}getStatusBadge(t){return{"Chuẩn bị":'<span class="badge badge-neutral"><i data-lucide="circle-dot"></i> Chuẩn bị</span>',"Đang mời thầu":'<span class="badge badge-info"><i data-lucide="megaphone"></i> Đang mời thầu</span>',"Đã mở thầu":'<span class="badge" style="background-color: #f59e0b; color: white;"><i data-lucide="folder-open"></i> Đã mở thầu</span>',"Đang chấm thầu":'<span class="badge badge-warning"><i data-lucide="award"></i> Đang chấm thầu</span>',"Đã có kết quả":'<span class="badge badge-success"><i data-lucide="check-circle"></i> Đã có kết quả</span>',"Hủy thầu":'<span class="badge badge-danger"><i data-lucide="x-circle"></i> Hủy thầu</span>'}[t]||`<span class="badge">${t}</span>`}}Object.assign(wt.prototype,{...It,...qt,...Yt,...oe});async function re(c){const t=this.model.state.goithau.find(s=>s.id===c);if(!t)return;const a=await this.view.customPrompt("Chọn thời gian mở thầu",`Chọn Thời gian mở thầu cho gói thầu "${t.tenGoiThau}":`,"","Chọn ngày và giờ...",!0);if(a===null)return;const n=a.trim();if(!n){await this.view.customAlert("Lỗi","Vui lòng chọn thời gian mở thầu!","x-circle");return}const i=n.split(" "),e=i[0].split("/"),o=(i[1]||"").split(":"),l=parseInt(e[0]),u=parseInt(e[1]),d=parseInt(e[2]),r=parseInt(o[0]||0),h=parseInt(o[1]||0);if(isNaN(l)||isNaN(u)||isNaN(d)||isNaN(r)||isNaN(h)){await this.view.customAlert("Lỗi","Thời gian mở thầu không hợp lệ. Vui lòng chọn lại!","x-circle");return}if(await this.view.customConfirm("Mở thầu gói thầu",`Bạn có chắc chắn muốn tiến hành mở thầu cho gói thầu "${t.tenGoiThau}" lúc ${n}? Trạng thái sẽ được chuyển sang "Đã mở thầu".`,"unlock")){const s=`${d}-${String(u).padStart(2,"0")}-${String(l).padStart(2,"0")}T${String(r).padStart(2,"0")}:${String(h).padStart(2,"0")}:00`;t.thoiGianMoThau=s,t.trangThai="Đã mở thầu",this.model.persistData("goithau"),this.view.renderGoiThauTable(),this.autoSync(),await this.view.customAlert("Thành công",`Đã tiến hành mở thầu thành công cho gói thầu "${t.tenGoiThau}". Trạng thái hiện tại: Đã mở thầu. Hãy tiến hành điền thông tin mở thầu và lưu lại!`,"check-circle"),this.switchTab("goithau-detail",c)}}async function de(c){const t=this.model.state.goithau.find(d=>d.id===c);if(!t)return;const a=document.getElementById("form-phathanh-hsmt");a&&a.querySelectorAll(".form-group").forEach(d=>d.classList.remove("invalid")),document.getElementById("phathanh-gt-id").value=t.id,document.getElementById("phathanh-magoithau").value=t.maGoiThau||"",document.getElementById("phathanh-soquyetdinh").value=t.soQuyetDinh||"",document.getElementById("phathanh-hieuluchsdt").value=t.hieuLucHsdt||"",document.getElementById("phathanh-giatribaomothau").value=t.giaTriDamBaoDuThau?this.model.formatVND(t.giaTriDamBaoDuThau):"",this.view.fpPhathanhNgayQuyetDinh?this.view.fpPhathanhNgayQuyetDinh.setDate(t.ngayQuyetDinh?new Date(t.ngayQuyetDinh):""):document.getElementById("phathanh-ngayquyetdinh").value=t.ngayQuyetDinh?this.model.formatDate(t.ngayQuyetDinh):"",this.view.fpPhathanhThoiGianDangTai?this.view.fpPhathanhThoiGianDangTai.setDate(t.thoiGianDangTai?new Date(t.thoiGianDangTai):""):document.getElementById("phathanh-thoigiandangtai").value=t.thoiGianDangTai?this.model.formatDateWithTime(t.thoiGianDangTai):"",this.view.fpPhathanhThoiGianDongThau?this.view.fpPhathanhThoiGianDongThau.setDate(t.thoiGianDongThau?new Date(t.thoiGianDongThau):""):document.getElementById("phathanh-thoigiandongthau").value=t.thoiGianDongThau?this.model.formatDateWithTime(t.thoiGianDongThau):"";const n=t.linhVuc==="Tư vấn",i=t.phanLo==="Có",e=document.getElementById("phathanh-baodam-container"),o=document.getElementById("phathanh-giatribaomothau"),l=document.getElementById("phathanh-phanlo-baodam-container"),u=document.getElementById("phathanh-phanlo-baodam-tbody");e&&o&&l&&u&&(n?(e.style.display="none",o.removeAttribute("required"),l.style.display="none",u.innerHTML=""):i?(e.style.display="none",o.removeAttribute("required"),l.style.display="block",u.innerHTML="",(t.phanLoList||[]).forEach(r=>{const h=document.createElement("tr");h.setAttribute("data-id",r.id);const g=r.baoDamDuThau||"",s=r.giaTriPhanLo||0;h.innerHTML=`
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
                    `,u.appendChild(h);const p=m=>{m&&m.addEventListener("input",v=>{const b=v.target.selectionStart,T=v.target.value.length,y=this.model.parseVND(v.target.value);v.target.value=this.model.formatVND(y);const x=v.target.value.length;v.target.setSelectionRange(b+(x-T),b+(x-T))})};p(h.querySelector(".phathanh-pl-price-input")),p(h.querySelector(".phathanh-pl-baodam-input"))})):(e.style.display="block",o.setAttribute("required",""),o.setAttribute("required","true"),o.value=t.giaTriDamBaoDuThau?this.model.formatVND(t.giaTriDamBaoDuThau):"",l.style.display="none",u.innerHTML="")),this.view.openModal("modal-phathanh-hsmt")}async function he(c){c.preventDefault();const t=document.getElementById("form-phathanh-hsmt");if(!this.view.validateForm(t))return;const a=document.getElementById("phathanh-gt-id").value,n=this.model.state.goithau.find(r=>r.id===a);if(!n)return;const i=n.linhVuc==="Tư vấn",e=n.phanLo==="Có",o=document.getElementById("phathanh-magoithau").value.trim();if(!o){await this.view.customAlert("Thiếu thông tin","Mã gói thầu là bắt buộc khi chuyển sang trạng thái Đang mời thầu!","alert-triangle",document.getElementById("phathanh-magoithau"));return}const l=parseInt(document.getElementById("phathanh-hieuluchsdt").value)||0;if(l<=0){await this.view.customAlert("Thiếu thông tin","Thời gian hiệu lực hồ sơ dự thầu phải lớn hơn 0!","alert-triangle",document.getElementById("phathanh-hieuluchsdt"));return}let u=0;if(!i&&!e&&(u=this.model.parseVND(document.getElementById("phathanh-giatribaomothau").value),u<=0)){await this.view.customAlert("Thiếu thông tin","Giá trị bảo đảm dự thầu phải lớn hơn 0 (trừ gói tư vấn)!","alert-triangle",document.getElementById("phathanh-giatribaomothau"));return}if(e&&!i){let r=null,h=null,g="";if(document.querySelectorAll("#phathanh-phanlo-baodam-tbody tr").forEach(s=>{s.getAttribute("data-id");const p=s.querySelector(".phathanh-pl-baodam-input"),m=p?this.model.parseVND(p.value):0,v=s.querySelector(".phathanh-pl-price-input"),b=v?this.model.parseVND(v.value):0;m<=0&&!r&&(r=p),b>0&&m>b&&!h&&(h=p,g=`Giá trị bảo đảm dự thầu (${this.model.formatVND(m)}) không được lớn hơn giá trị phần lô (${this.model.formatVND(b)})!`)}),r||!n.phanLoList||n.phanLoList.length===0){await this.view.customAlert("Thiếu thông tin","Gói thầu bắt buộc phải có Giá trị bảo đảm dự thầu lớn hơn 0 cho tất cả các phần lô (trừ gói tư vấn)!","alert-triangle",r);return}if(h){await this.view.customAlert("Dữ liệu không hợp lệ",g,"alert-triangle",h);return}}if(await this.view.customConfirm("Xác nhận phát hành",`Bạn có chắc chắn muốn phát hành HSMT và chuyển gói thầu "${n.tenGoiThau}" sang trạng thái "Đang mời thầu" không?`,"send")){const r=document.getElementById("phathanh-thoigiandangtai").value,h=document.getElementById("phathanh-thoigiandongthau").value,g=document.getElementById("phathanh-ngayquyetdinh").value;n.maGoiThau=o,n.soQuyetDinh=document.getElementById("phathanh-soquyetdinh").value.trim(),n.ngayQuyetDinh=g?this.model.convertDMYToYMD(g):"",n.thoiGianDangTai=r?this.model.convertDMYHMSToYMDHMS(r):"",n.thoiGianDongThau=h?this.model.convertDMYHMSToYMDHMS(h):"",n.thoiGianMoThau=n.thoiGianDongThau,n.hieuLucHsdt=l,n.hieuLucDamBaoDuThau=l+30,e&&!i&&n.phanLoList?(document.querySelectorAll("#phathanh-phanlo-baodam-tbody tr").forEach(s=>{const p=s.getAttribute("data-id"),m=n.phanLoList.find(v=>v.id===p);if(m){const v=s.querySelector(".phathanh-pl-code-input"),b=s.querySelector(".phathanh-pl-name-input"),T=s.querySelector(".phathanh-pl-price-input"),y=s.querySelector(".phathanh-pl-baodam-input"),x=s.querySelector(".phathanh-pl-duration-input");m.maPhanLo=v?v.value.trim():"",m.tenPhanLo=b?b.value.trim():"",m.giaTriPhanLo=T?this.model.parseVND(T.value):0,m.baoDamDuThau=y?this.model.parseVND(y.value):0,m.thoiGianThucHien=x?x.value.trim():""}}),n.giaTriDamBaoDuThau=n.phanLoList.reduce((s,p)=>s+(p.baoDamDuThau||0),0)):!i&&!e?n.giaTriDamBaoDuThau=u:n.giaTriDamBaoDuThau=0,n.trangThai="Đang mời thầu",this.model.persistData("goithau"),this.view.closeModal("modal-phathanh-hsmt"),this.view.showPackageDetails(a),this.autoSync(),await this.view.customAlert("Thành công","Đã phát hành HSMT và chuyển gói thầu sang trạng thái Đang mời thầu!","check-circle")}}function ce(){const c=document.getElementById("mothau-goithau-select");if(!c)return;const t=new Date,a=this.model.state.goithau.filter(h=>!(h.trangThai!=="Đang mời thầu"&&h.trangThai!=="Đã mở thầu"&&h.trangThai!=="Đang chấm thầu"&&h.trangThai!=="Đã có kết quả"||h.trangThai==="Đang mời thầu"&&(!h.thoiGianDongThau||new Date(h.thoiGianDongThau)>=t))),n=c.value;c.innerHTML='<option value="">-- Chọn Gói thầu (Đang mời thầu / Đã mở thầu / Đang chấm thầu / Đã có kết quả) --</option>'+a.map(h=>`<option value="${h.id}" data-search="${h.maGoiThau||""} ${h.tenGoiThau||""}">${h.tenGoiThau} (${h.maGoiThau||"Chưa có mã"})</option>`).join(""),n&&a.some(h=>h.id===n)?c.value=n:c.value="",this.makeSearchableSelect(c,"Tìm kiếm Gói thầu...");const i=document.getElementById("mothau-goithau-summary"),e=document.getElementById("mothau-bid-container"),o=document.getElementById("mothau-empty-state"),l=document.getElementById("mothau-table-thead"),u=document.getElementById("mothau-table-tbody"),d=()=>{const h=c.value;if(!h){i.style.display="none",e.style.display="none",o.style.display="block";return}const g=this.model.state.goithau.find(I=>I.id===h);if(!g)return;const s=this.model.getLatestPlan(g.keHoachId),p=s?this.model.state.chudautu.find(I=>I.id===s.chuDauTuId):null,m=p?p.tenChuDauTu:"Không rõ",v=g.linhVuc==="Tư vấn",b=g.phuongThucLuaChon==="Một giai đoạn hai túi hồ sơ",T=g.phuongThucLuaChon==="Một giai đoạn một túi hồ sơ",y=g.phanLo==="Có",x=b?"opening_tech":"opening";let f=!1;if(g.danhGiaHsdtMetadata)try{const I=JSON.parse(g.danhGiaHsdtMetadata);b?f=!!(I.is1G2T&&I.technical&&I.technical.saved):f=!!I.saved}catch{}const S=g.trangThai!=="Đang mời thầu"&&g.trangThai!=="Đã mở thầu"&&f,w=this.view._editingState&&this.view._editingState[x],M=S&&!w,C=!M,P=["Đã có kết quả","Hủy thầu"].includes(g.trangThai);i.style.display="block",i.innerHTML=`
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
            ${P||M?`<div style="margin-top:8px; padding:8px 12px; background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.25); border-radius:6px; color:#dc2626; font-weight:600; font-size:0.82rem; display:flex; align-items:center; gap:6px;">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                Biên bản mở thầu đã bị khóa — Gói thầu có trạng thái <strong style="margin-left:4px;">${g.trangThai}</strong>
            </div>`:""}
        `,o.style.display="none",e.style.display="block";const et=document.getElementById("btn-mothau-add-bid"),it=document.getElementById("btn-mothau-save"),L=document.getElementById("btn-mothau-import-excel"),N=document.getElementById("btn-mothau-download-excel");et&&(et.style.display=C?"":"none"),L&&(L.style.display=C?"":"none"),N&&(N.style.display=C?"":"none"),it&&(M?it.style.display="none":(it.style.display="",it.innerHTML='<i data-lucide="save"></i> Lưu thông tin mở thầu',it.className="btn btn-primary",it.onclick=()=>this.saveThongTinMoThau()));let A="1G1T_NO_LOT";v?A="TU_VAN":!v&&b?A=y?"1G2T_WITH_LOT":"1G2T_NO_LOT":T&&(A=y?"1G1T_WITH_LOT":"1G1T_NO_LOT");let z="";A==="TU_VAN"?z=`
                <tr>
                    <th style="width: 15%;">Loại nhà thầu</th>
                    <th style="width: 20%;">Mã nhà thầu</th>
                    <th style="width: 30%;">Tên nhà thầu</th>
                    <th style="width: 15%;">Hiệu lực E-HSĐXKT</th>
                    <th style="width: 12%;">Thời gian thực hiện</th>
                    ${C?'<th style="width: 8%; text-align: center;">Thao tác</th>':""}
                </tr>
            `:A==="1G2T_NO_LOT"?z=`
                <tr>
                    <th style="width: 12%;">Loại nhà thầu</th>
                    <th style="width: 18%;">Mã nhà thầu</th>
                    <th style="width: 25%;">Tên nhà thầu</th>
                    <th style="width: 12%;">Đảm bảo dự thầu</th>
                    <th style="width: 12%;">Hiệu lực đảm bảo</th>
                    <th style="width: 13%;">Hiệu lực E-HSĐXKT</th>
                    ${C?'<th style="width: 8%; text-align: center;">Thao tác</th>':""}
                </tr>
            `:A==="1G2T_WITH_LOT"?z=`
                <tr>
                    <th style="width: 10%;">Mã phần lô</th>
                    <th style="width: 10%;">Tên phần lô</th>
                    <th style="width: 10%;">Loại nhà thầu</th>
                    <th style="width: 15%;">Mã nhà thầu</th>
                    <th style="width: 20%;">Tên nhà thầu</th>
                    <th style="width: 9%;">Đảm bảo</th>
                    <th style="width: 9%;">Hiệu lực ĐB</th>
                    <th style="width: 11%;">Hiệu lực E-HSĐXKT</th>
                    ${C?'<th style="width: 6%; text-align: center;">Thao tác</th>':""}
                </tr>
            `:A==="1G1T_NO_LOT"?z=`
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
                    ${C?'<th style="width: 4%; text-align: center;">Thao tác</th>':""}
                </tr>
            `:A==="1G1T_WITH_LOT"&&(z=`
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
                    ${C?'<th style="width: 4%; text-align: center;">Thao tác</th>':""}
                </tr>
            `),l.innerHTML=z,u.innerHTML="";const k=this.model.state.thongtinmothau.filter(I=>String(I.goiThauId)===String(h));k.sort((I,q)=>{const j=String(I.maPhanLo||"").toLowerCase(),$=String(q.maPhanLo||"").toLowerCase();return j.localeCompare($,"vi",{numeric:!0})}),k.length===0?C&&this.addMoThauRow(A,g):k.forEach(I=>this.addMoThauRow(A,g,I,M)),lucide.createIcons()};c.onchange=d,d(),this.setupExcelImportEvents();const r=document.getElementById("btn-mothau-add-bid");r&&(r.onclick=()=>{const h=c.value,g=this.model.state.goithau.find(T=>T.id===h);if(!g)return;const s=g.linhVuc==="Tư vấn",p=g.phuongThucLuaChon==="Một giai đoạn hai túi hồ sơ",m=g.phuongThucLuaChon==="Một giai đoạn một túi hồ sơ",v=g.phanLo==="Có";let b="1G1T_NO_LOT";s?b="TU_VAN":!s&&p?b=v?"1G2T_WITH_LOT":"1G2T_NO_LOT":m&&(b=v?"1G1T_WITH_LOT":"1G1T_NO_LOT"),this.addMoThauRow(b,g),lucide.createIcons()})}window.openMoThauJVManager=c=>{var v;const t=((v=c.querySelector(".mt-ma-nha-thau"))==null?void 0:v.value.trim())||"",a=(c._thanhVienLienDanh||[]).filter(b=>String(b.maSoThue).toLowerCase().trim()!==String(t).toLowerCase().trim()&&b.vaiTro!=="Đứng đầu liên danh"),n="modal-mothau-jv-manager";let i=document.getElementById(n);i&&i.remove(),i=document.createElement("div"),i.id=n,i.className="modal-overlay active",i.style.zIndex="2000";const e=document.createElement("div");e.className="modal-card",e.style.maxWidth="600px",e.style.width="95%",e.style.margin="20px auto";const o=document.createElement("div");o.className="modal-header",o.innerHTML=`
        <h3>Thành viên liên danh</h3>
        <button class="modal-close" id="btn-close-mothau-jv">&times;</button>
    `;const l=document.createElement("div");l.className="modal-body",l.style.padding="20px";const u=window.appController.model.getLatestNhaThau(),d=t?u.find(b=>b.maNhaThau&&b.maNhaThau.trim().toLowerCase()===t.trim().toLowerCase()):null,r=c._leadMemberName||(d?d.tenNhaThau:""),h=t||"Chưa nhập";l.innerHTML=`
        <div style="background: var(--primary-soft); padding: 12px 16px; border-radius: var(--radius-md); margin-bottom: 20px;">
            <div style="font-size: 0.78rem; font-weight: 800; color: var(--primary); text-transform: uppercase; margin-bottom: 8px;">Thành viên đứng đầu liên danh</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                <div class="form-group" style="margin-bottom: 0;">
                    <label style="font-size: 0.75rem; font-weight: 600; color: var(--text-light); margin-bottom: 4px; display: block;">Mã/MST thành viên đứng đầu</label>
                    <input type="text" class="form-control" value="${h}" readonly style="padding: 6px 10px; font-size: 0.85rem; width:100%; background: rgba(0,0,0,0.05); cursor: not-allowed;">
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
    `,e.appendChild(o),e.appendChild(l),e.appendChild(g),i.appendChild(e),document.body.appendChild(i);const s=document.getElementById("mothau-jv-members-list"),p=(b={tenNhaThau:"",maSoThue:""})=>{const T=document.createElement("div");T.className="mothau-jv-member-row",T.style.display="grid",T.style.gridTemplateColumns="1fr 1fr auto",T.style.gap="10px",T.style.alignItems="center",T.style.padding="8px",T.style.border="1px solid var(--border-color)",T.style.borderRadius="var(--radius-sm)",T.style.background="var(--bg-nested, rgba(0,0,0,0.02))",T.innerHTML=`
            <div class="form-group" style="margin-bottom: 0;">
                <input type="text" class="jv-input-mst" required placeholder="Mã số thuế / Mã nhà thầu" value="${b.maSoThue||""}" style="padding: 6px 10px; font-size: 0.85rem; width:100%;">
            </div>
            <div class="form-group" style="margin-bottom: 0;">
                <input type="text" class="jv-input-ten" required placeholder="Tên nhà thầu thành viên" value="${b.tenNhaThau||""}" style="padding: 6px 10px; font-size: 0.85rem; width:100%;">
            </div>
            <button type="button" class="action-btn btn-delete btn-remove-jv-row" style="padding: 6px; border:none; background:none;"><i data-lucide="trash-2" style="width: 14px; height: 14px;"></i></button>
        `,T.querySelector(".btn-remove-jv-row").onclick=()=>{T.remove()};const y=T.querySelector(".jv-input-mst"),x=T.querySelector(".jv-input-ten");y.addEventListener("blur",()=>{const f=y.value.trim();if(!f||x.value.trim())return;const S=u.find(w=>w.maNhaThau&&w.maNhaThau.trim().toLowerCase()===f.toLowerCase());S&&(x.value=S.tenNhaThau)}),s.appendChild(T),lucide.createIcons({root:T})};a.length>0?a.forEach(b=>p(b)):p(),document.getElementById("btn-add-mothau-jv-member").onclick=()=>p();const m=()=>i.remove();document.getElementById("btn-close-mothau-jv").onclick=m,document.getElementById("btn-cancel-mothau-jv").onclick=m,document.getElementById("btn-save-mothau-jv").onclick=()=>{const b=document.getElementById("jv-input-lead-name").value.trim();if(!b){window.appController.view.customAlert("Thiếu thông tin","Vui lòng nhập tên thành viên đứng đầu liên danh!","alert-triangle","#jv-input-lead-name");return}const T=s.querySelectorAll(".mothau-jv-member-row"),y=[],x=[];let f=!0;if(T.forEach(w=>{const M=w.querySelector(".jv-input-ten"),C=w.querySelector(".jv-input-mst"),V=(M==null?void 0:M.value.trim())||"",P=(C==null?void 0:C.value.trim())||"";V&&P?y.push({tenNhaThau:V,maSoThue:P}):(V||P)&&(f=!1,!V&&M&&x.push(M),!P&&C&&x.push(C))}),!f){window.appController.view.customAlert("Thiếu thông tin","Vui lòng điền đầy đủ cả Tên nhà thầu và Mã số thuế của Thành viên liên danh!","alert-triangle",x);return}c._leadMemberName=b,c._thanhVienLienDanh=y;const S=c.querySelector(".mt-jv-btn-text");S&&(S.textContent=`Thành viên liên danh (${y.length})`),m()},lucide.createIcons({root:i})};window.openMoThauJVViewModal=(c,t,a)=>{const n="modal-mothau-jv-view";let i=document.getElementById(n);i&&i.remove(),i=document.createElement("div"),i.id=n,i.className="modal-overlay active",i.style.zIndex="2000";const e=document.createElement("div");e.className="modal-card",e.style.maxWidth="600px",e.style.width="95%",e.style.margin="20px auto";const o=document.createElement("div");o.className="modal-header",o.innerHTML=`
        <h3>Thành viên liên danh</h3>
        <button class="modal-close" id="btn-close-mothau-jv-view">&times;</button>
    `;const l=document.createElement("div");l.className="modal-body",l.style.padding="20px";const u=t||"Chưa cập nhật",d=a||"Chưa cập nhật";let r="";c.length===0?r='<div style="text-align: center; color: var(--text-muted); padding: 12px;"><small>Không có Thành viên liên danh</small></div>':r=c.map((s,p)=>`
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
                    <div style="font-size: 0.85rem; font-weight: 700; color: var(--primary);">${u}</div>
                </div>
            </div>
        </div>
        
        <h4 style="margin: 0 0 12px 0; font-size: 0.88rem; font-weight: 800;">Danh sách Thành viên liên danh</h4>
        <div style="display: flex; flex-direction: column; gap: 10px; max-height: 300px; overflow-y: auto; padding-right: 4px;">
            ${r}
        </div>
    `;const h=document.createElement("div");h.className="modal-footer",h.innerHTML=`
        <button type="button" class="btn btn-primary" id="btn-ok-mothau-jv-view">Đóng</button>
    `,e.appendChild(o),e.appendChild(l),e.appendChild(h),i.appendChild(e),document.body.appendChild(i);const g=()=>i.remove();document.getElementById("btn-close-mothau-jv-view").onclick=g,document.getElementById("btn-ok-mothau-jv-view").onclick=g};function ue(c,t,a={},n=!1){const i=document.getElementById("mothau-table-tbody");if(!i)return;const e=document.createElement("tr");e.setAttribute("data-id",a.id||window.generateUUID());let o=a.maNhaThau||"",l=a.tenNhaThau||"",u=a.loaiNhaThau||"Độc lập",d=a.thanhVienLienDanh||[];const r=this.model.getLatestNhaThau();let h=null;a.nhaThauId&&(h=r.find(L=>L.id===a.nhaThauId||L.rootId===a.nhaThauId)),!h&&o&&(h=r.find(L=>L.maNhaThau&&L.maNhaThau.trim().toLowerCase()===o.trim().toLowerCase())),h&&(o||(o=h.maNhaThau||""),u!=="Liên danh"&&(l=h.tenNhaThau||a.tenNhaThau||""),a.loaiNhaThau===void 0&&h.loaiNhaThau&&(u=h.loaiNhaThau),d.length===0&&h.thanhVienLienDanh&&(d=h.thanhVienLienDanh)),e._thanhVienLienDanh=(d||[]).filter(L=>L.vaiTro!=="Đứng đầu liên danh"&&L.maSoThue!==o);const g=(d||[]).find(L=>L.vaiTro==="Đứng đầu liên danh"||L.maSoThue&&String(L.maSoThue).toLowerCase().trim()===String(o).toLowerCase().trim());if(e._leadMemberName=g?g.tenNhaThau:"",!e._leadMemberName&&o){const L=r.find(N=>N.maNhaThau&&String(N.maNhaThau).toLowerCase().trim()===String(o).toLowerCase().trim());L&&(e._leadMemberName=L.tenNhaThau)}const s=n?`<span style="font-size:0.9rem;">${u}</span>`:`<select class="form-control mt-loai-nha-thau" required>
            <option value="Độc lập" ${u==="Độc lập"?"selected":""}>Độc lập</option>
            <option value="Liên danh" ${u==="Liên danh"?"selected":""}>Liên danh</option>
        </select>`,p=t.phanLoList||[],m=p.map(L=>`<option value="${L.maPhanLo}" data-name="${L.tenPhanLo}">${L.maPhanLo}</option>`).join("");let v="";const b=(a.thanhVienLienDanh||[]).length,T=n?u==="Liên danh"?`<div style="margin-top:4px; font-size:0.78rem;"><a href="#" class="mt-jv-view-link" style="color:var(--primary); text-decoration:none; font-weight:600; display:inline-flex; align-items:center; gap:4px;">👥 Liên danh ${b} thành viên</a></div>`:"":`<div class="mt-jv-members-container" style="margin-top: 4px; display: ${u==="Liên danh"?"block":"none"};">
            <button type="button" class="btn btn-outline btn-xs mt-btn-manage-members" style="padding: 2px 6px; font-size: 0.72rem; font-weight: 700; border-style: dashed; width: 100%; display: flex; align-items: center; justify-content: center; gap: 4px; color: var(--primary); border-color: var(--primary-soft);">
                <i data-lucide="users" style="width: 12px; height: 12px;"></i>
                <span class="mt-jv-btn-text">Thành viên liên danh (${b})</span>
            </button>
        </div>`;if(c==="TU_VAN")v=n?`
            <td>${s}</td>
            <td><span class="mt-ma-nha-thau">${o||a.maDinhDanh||"--"}</span></td>
            <td><span class="mt-ten-nha-thau">${l||"--"}</span>${T}</td>
            <td>${a.hieuLucHsdxt||(t.hieuLucHsdt?t.hieuLucHsdt+" ngày":"90 ngày")}</td>
            <td>${a.thoiGianThucHien||t.thoiGianThucHien||"--"}</td>
        `:`
            <td>${s}</td>
            <td><input type="text" class="form-control mt-ma-nha-thau mt-ma-dinh-danh" value="${o||a.maDinhDanh||""}" required placeholder="Mã nhà thầu"></td>
            <td>
                <input type="text" class="form-control mt-ten-nha-thau" value="${l}" required placeholder="Tên nhà thầu">
                ${T}
            </td>
            <td><input type="text" class="form-control mt-hieu-luc-hsdxt" value="${a.hieuLucHsdxt||(t.hieuLucHsdt?t.hieuLucHsdt+" ngày":"90 ngày")}" required placeholder="Hiệu lực"></td>
            <td><input type="text" class="form-control mt-thoi-gian-thuc-hien" value="${a.thoiGianThucHien||t.thoiGianThucHien||""}" required placeholder="Ví dụ: 120 ngày"></td>
            <td style="text-align: center;"><button class="action-btn btn-delete mt-remove-row"><i data-lucide="trash-2"></i></button></td>
        `;else if(c==="1G2T_NO_LOT")v=n?`
            <td>${s}</td>
            <td><span class="mt-ma-nha-thau">${o||a.maDinhDanh||"--"}</span></td>
            <td><span class="mt-ten-nha-thau">${l||"--"}</span>${T}</td>
            <td>${this.model.formatVND(a.damBaoDuThau)||this.model.formatVND(t.giaTriDamBaoDuThau)||"--"}</td>
            <td>${a.hieuLucDamBao||(t.hieuLucDamBaoDuThau?t.hieuLucDamBaoDuThau+" ngày":"120 ngày")}</td>
            <td>${a.hieuLucHsdxt||(t.hieuLucHsdt?t.hieuLucHsdt+" ngày":"90 ngày")}</td>
        `:`
            <td>${s}</td>
            <td><input type="text" class="form-control mt-ma-nha-thau mt-ma-dinh-danh" value="${o||a.maDinhDanh||""}" required placeholder="Mã nhà thầu"></td>
            <td>
                <input type="text" class="form-control mt-ten-nha-thau" value="${l}" required placeholder="Tên nhà thầu">
                ${T}
            </td>
            <td><input type="text" class="form-control mt-dam-bao-du-thau mt-format-vnd" value="${this.model.formatVND(a.damBaoDuThau)||this.model.formatVND(t.giaTriDamBaoDuThau)||""}" required placeholder="Số tiền ĐB"></td>
            <td><input type="text" class="form-control mt-hieu-luc-dam-bao" value="${a.hieuLucDamBao||(t.hieuLucDamBaoDuThau?t.hieuLucDamBaoDuThau+" ngày":"120 ngày")}" placeholder="Hiệu lực bảo đảm"></td>
            <td><input type="text" class="form-control mt-hieu-luc-hsdxt" value="${a.hieuLucHsdxt||(t.hieuLucHsdt?t.hieuLucHsdt+" ngày":"90 ngày")}" required placeholder="Hiệu lực"></td>
            <td style="text-align: center;"><button class="action-btn btn-delete mt-remove-row"><i data-lucide="trash-2"></i></button></td>
        `;else if(c==="1G2T_WITH_LOT"){let L="";if(a.maPhanLo){const N=p.find(A=>A.maPhanLo===a.maPhanLo);N&&(L=this.model.formatVND(N.baoDamDuThau)||"")}v=n?`
            <td>${a.maPhanLo||"--"}</td>
            <td>${a.tenPhanLo||"--"}</td>
            <td>${s}</td>
            <td><span class="mt-ma-nha-thau">${o||a.maDinhDanh||"--"}</span></td>
            <td><span class="mt-ten-nha-thau">${l||"--"}</span>${T}</td>
            <td>${this.model.formatVND(a.damBaoDuThau)||L||"--"}</td>
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
                ${T}
            </td>
            <td><input type="text" class="form-control mt-dam-bao-du-thau mt-format-vnd" value="${this.model.formatVND(a.damBaoDuThau)||L}" required placeholder="Số tiền ĐB"></td>
            <td><input type="text" class="form-control mt-hieu-luc-dam-bao" value="${a.hieuLucDamBao||(t.hieuLucDamBaoDuThau?t.hieuLucDamBaoDuThau+" ngày":"120 ngày")}" placeholder="Hiệu lực ĐB"></td>
            <td><input type="text" class="form-control mt-hieu-luc-hsdxt" value="${a.hieuLucHsdxt||(t.hieuLucHsdt?t.hieuLucHsdt+" ngày":"90 ngày")}" required placeholder="Hiệu lực"></td>
            <td style="text-align: center;"><button class="action-btn btn-delete mt-remove-row"><i data-lucide="trash-2"></i></button></td>
        `}else if(c==="1G1T_NO_LOT")v=n?`
            <td>${s}</td>
            <td><span class="mt-ma-nha-thau">${o||a.maDinhDanh||"--"}</span></td>
            <td><span class="mt-ten-nha-thau">${l||"--"}</span>${T}</td>
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
                ${T}
            </td>
            <td><input type="text" class="form-control mt-gia-du-thau mt-format-vnd" value="${this.model.formatVND(a.giaDuThau)||""}" required placeholder="Giá dự thầu"></td>
            <td><input type="text" class="form-control mt-ty-le-giam-gia" value="${(a.tyLeGiamGia||0).toString().replace(".",",")}" required style="text-align: right;" placeholder="Tỷ lệ %"></td>
            <td><input type="text" class="form-control mt-gia-sau-giam-gia mt-format-vnd" value="${this.model.formatVND(a.giaSauGiamGia)||""}" placeholder="Nhập giá"></td>
            <td><input type="text" class="form-control mt-hieu-luc-hsdt" value="${a.hieuLucHsdt?a.hieuLucHsdt+" ngày":t.hieuLucHsdt?t.hieuLucHsdt+" ngày":"90 ngày"}" required placeholder="Hiệu lực"></td>
            <td><input type="text" class="form-control mt-gia-tri-dam-bao mt-format-vnd" value="${this.model.formatVND(a.giaTriDamBao)||this.model.formatVND(t.giaTriDamBaoDuThau)||""}" required placeholder="Giá trị ĐB"></td>
            <td><input type="text" class="form-control mt-hieu-luc-bao-dam-ngay" value="${a.hieuLucBaoDamNgay?a.hieuLucBaoDamNgay+" ngày":t.hieuLucDamBaoDuThau?t.hieuLucDamBaoDuThau+" ngày":"120 ngày"}" required style="text-align: right;"></td>
            <td><input type="text" class="form-control mt-thoi-gian-thuc-hien" value="${a.thoiGianThucHien||t.thoiGianThucHien||""}" required placeholder="Thực hiện"></td>
            <td style="text-align: center;"><button class="action-btn btn-delete mt-remove-row"><i data-lucide="trash-2"></i></button></td>
        `;else if(c==="1G1T_WITH_LOT"){let L="";if(a.maPhanLo){const N=p.find(A=>A.maPhanLo===a.maPhanLo);N&&(L=this.model.formatVND(N.baoDamDuThau)||"")}v=n?`
            <td>${a.maPhanLo||"--"}</td>
            <td>${a.tenPhanLo||"--"}</td>
            <td>${s}</td>
            <td><span class="mt-ma-nha-thau">${o||a.maDinhDanh||"--"}</span></td>
            <td><span class="mt-ten-nha-thau">${l||"--"}</span>${T}</td>
            <td>${this.model.formatVND(a.giaDuThau)||"--"}</td>
            <td style="text-align:right;">${(a.tyLeGiamGia||0).toString().replace(".",",")}</td>
            <td>${this.model.formatVND(a.giaSauGiamGia)||"--"}</td>
            <td>${a.hieuLucHsdt||t.hieuLucHsdt,(a.hieuLucHsdt||t.hieuLucHsdt||90)+" ngày"}</td>
            <td>${this.model.formatVND(a.giaTriDamBao)||L||"--"}</td>
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
                ${T}
            </td>
            <td><input type="text" class="form-control mt-gia-du-thau mt-format-vnd" value="${this.model.formatVND(a.giaDuThau)||""}" required placeholder="Giá dự thầu"></td>
            <td><input type="text" class="form-control mt-ty-le-giam-gia" value="${(a.tyLeGiamGia||0).toString().replace(".",",")}" required style="text-align: right;" placeholder="Tỷ lệ %"></td>
            <td><input type="text" class="form-control mt-gia-sau-giam-gia mt-format-vnd" value="${this.model.formatVND(a.giaSauGiamGia)||""}" placeholder="Giá sau giảm"></td>
            <td><input type="text" class="form-control mt-hieu-luc-hsdt" value="${a.hieuLucHsdt?a.hieuLucHsdt+" ngày":t.hieuLucHsdt?t.hieuLucHsdt+" ngày":"90 ngày"}" required placeholder="Hiệu lực"></td>
            <td><input type="text" class="form-control mt-gia-tri-dam-bao mt-format-vnd" value="${this.model.formatVND(a.giaTriDamBao)||L}" required placeholder="Giá trị ĐB"></td>
            <td><input type="text" class="form-control mt-hieu-luc-bao-dam-ngay" value="${a.hieuLucBaoDamNgay?a.hieuLucBaoDamNgay+" ngày":t.hieuLucDamBaoDuThau?t.hieuLucDamBaoDuThau+" ngày":"120 ngày"}" required style="text-align: right;"></td>
            <td><input type="text" class="form-control mt-thoi-gian-thuc-hien" value="${a.thoiGianThucHien||t.thoiGianThucHien||""}" required placeholder="Thực hiện"></td>
            <td style="text-align: center;"><button class="action-btn btn-delete mt-remove-row"><i data-lucide="trash-2"></i></button></td>
        `}e.innerHTML=v;const y=e.querySelector(".mt-ma-phan-lo");y&&(a.maPhanLo&&(y.value=a.maPhanLo),y.addEventListener("change",()=>{const L=y.options[y.selectedIndex],N=e.querySelector(".mt-ten-phan-lo");N&&(N.value=L&&L.getAttribute("data-name")||"");const A=y.value,z=p.find(k=>k.maPhanLo===A);if(z){const k=e.querySelector(".mt-dam-bao-du-thau");k&&(k.value=this.model.formatVND(z.baoDamDuThau)||"");const I=e.querySelector(".mt-gia-tri-dam-bao");I&&(I.value=this.model.formatVND(z.baoDamDuThau)||"")}}));const x=e.querySelector(".mt-loai-nha-thau"),f=e.querySelector(".mt-jv-members-container");x&&f&&x.addEventListener("change",()=>{f.style.display=x.value==="Liên danh"?"block":"none"});const S=e.querySelector(".mt-btn-manage-members");S&&S.addEventListener("click",L=>{L.preventDefault(),window.openMoThauJVManager(e)});const w=e.querySelector(".mt-ma-nha-thau"),M=e.querySelector(".mt-ten-nha-thau");if(w&&M){const L=()=>{var k;const N=w.value.trim();if(!N)return;const z=this.model.getLatestNhaThau().find(I=>I.maNhaThau&&I.maNhaThau.trim().toLowerCase()===N.toLowerCase());z&&(M.value=z.tenNhaThau||"",((k=e.querySelector(".mt-loai-nha-thau"))==null?void 0:k.value)==="Liên danh"&&(e._leadMemberName=z.tenNhaThau||""))};w.addEventListener("input",L),w.addEventListener("change",L)}e.querySelectorAll(".mt-hieu-luc-hsdt, .mt-hieu-luc-hsdxt, .mt-hieu-luc-dam-bao, .mt-hieu-luc-bao-dam-ngay").forEach(L=>{L.addEventListener("focus",()=>{let N=L.value.trim();if(N){const A=parseInt(N.replace(/[^0-9]/g,""),10);isNaN(A)||(L.value=A)}}),L.addEventListener("blur",()=>{let N=L.value.trim();if(N){const A=parseInt(N.replace(/[^0-9]/g,""),10);isNaN(A)||(L.value=A+" ngày")}})}),e.querySelectorAll(".mt-format-vnd").forEach(L=>{L.addEventListener("input",N=>{const A=N.target.selectionStart,z=N.target.value.length;N.target.value=this.model.formatVND(N.target.value);const k=N.target.value.length;N.target.setSelectionRange(A+(k-z),A+(k-z))})});const C=()=>{const L=e.querySelector(".mt-gia-du-thau"),N=e.querySelector(".mt-ty-le-giam-gia"),A=e.querySelector(".mt-gia-sau-giam-gia");if(L&&N&&A){const z=this.model.parseVND(L.value),k=(N.value||"0").replace(/,/g,"."),I=parseFloat(k)||0,q=z*(1-I/100);A.value=this.model.formatVND(q)}},V=e.querySelector(".mt-gia-du-thau"),P=e.querySelector(".mt-ty-le-giam-gia");V&&V.addEventListener("input",C),P&&(P.addEventListener("input",L=>{let N=L.target.value.replace(/\./g,",");const A=N.split(",");if(A.length>2&&(N=A[0]+","+A.slice(1).join("").replace(/,/g,"")),N=N.replace(/[^0-9,]/g,""),L.target.value!==N){const z=L.target.selectionStart;L.target.value=N,L.target.setSelectionRange(z,z)}C()}),P.addEventListener("change",C));const et=e.querySelector(".mt-remove-row");et&&(et.onclick=async()=>{await this.view.customConfirm("Xác nhận xóa","Bạn có chắc chắn muốn gỡ nhà thầu này khỏi danh sách nộp hồ sơ?","trash-2")&&(e.remove(),i.children.length===0&&(this.addMoThauRow(c,t),lucide.createIcons()))}),i.appendChild(e);const it=e.querySelector(".mt-jv-view-link");it&&it.addEventListener("click",L=>{L.preventDefault(),window.openMoThauJVViewModal(e._thanhVienLienDanh||[],e._leadMemberName||l,o)})}async function ge(){const c=document.getElementById("mothau-goithau-select");if(!c)return;const t=c.value;if(!t){await this.view.customAlert("Chưa chọn gói thầu","Vui lòng chọn một gói thầu để lưu!","alert-triangle");return}const a=this.model.state.goithau.find(s=>s.id===t);if(!a)return;const n=a.phuongThucLuaChon==="Một giai đoạn hai túi hồ sơ";let i=!1;if(a.danhGiaHsdtMetadata)try{const s=JSON.parse(a.danhGiaHsdtMetadata);n?i=!!(s.is1G2T&&s.technical&&s.technical.saved):i=!!s.saved}catch{}if(!(a.trangThai==="Đang mời thầu"||a.trangThai==="Đã mở thầu"||a.trangThai==="Đang chấm thầu"&&!i)){await this.view.customAlert("Không thể lưu",`Không thể chỉnh sửa biên bản mở thầu của gói thầu này vì trạng thái hiện tại là "${a.trangThai}" và giai đoạn tiếp theo đã hoàn tất.`,"x-circle");return}const o=document.querySelectorAll("#mothau-table-tbody tr");let l=!1;const u=[];if(o.forEach(s=>{const p=s.querySelector(".mt-ma-nha-thau"),m=s.querySelector(".mt-ten-nha-thau"),v=p?p.value.trim():"",b=m?m.value.trim():"";let T=!1;v||(T=!0,p&&u.push(p)),b||(T=!0,m&&u.push(m)),T?(l=!0,s.classList.add("invalid")):s.classList.remove("invalid")}),l){await this.view.customAlert("Thiếu dữ liệu","Vui lòng nhập đầy đủ Mã nhà thầu và Tên nhà thầu cho tất cả các dòng!","alert-triangle",u);return}const d=[],r=this.model.getLatestNhaThau();o.forEach(s=>{var G,H,U,Y,W,_,D,B,K,R,Q,F,X;const p=s.getAttribute("data-id"),m=s.querySelector(".mt-ma-nha-thau"),v=s.querySelector(".mt-ten-nha-thau"),b=s.querySelector(".mt-loai-nha-thau"),T=m?m.value.trim():"",y=v?v.value.trim():"",x=b?b.value:"Độc lập";let f=r.find(at=>at.maNhaThau&&at.maNhaThau.trim().toLowerCase()===T.trim().toLowerCase());if(x==="Độc lập"){if(!f)f={id:window.generateUUID(),maNhaThau:T,tenNhaThau:y,loaiNhaThau:"Độc lập",maSoThue:T,nguoiDaiDien:"",danhXung:"Ông",soDienThoai:"",email:"",diaChi:"",soTaiKhoan:"",noiMoTaiKhoan:"",maNganHang:"",thanhVienLienDanh:[],phienBan:0},this.model.state.nhathau.push(f),this.model.persistData("nhathau"),r.push(f);else if(f.loaiNhaThau!=="Độc lập"){const at=this.model.state.nhathau.find(O=>O.id===f.id);at&&(at.loaiNhaThau="Độc lập",this.model.persistData("nhathau"))}}else{if(!f)f={id:window.generateUUID(),maNhaThau:T,tenNhaThau:s._leadMemberName||"Thành viên đứng đầu "+T,loaiNhaThau:"Độc lập",maSoThue:T,nguoiDaiDien:"",danhXung:"Ông",soDienThoai:"",email:"",diaChi:"",soTaiKhoan:"",noiMoTaiKhoan:"",maNganHang:"",thanhVienLienDanh:[],phienBan:0},this.model.state.nhathau.push(f),this.model.persistData("nhathau"),r.push(f);else if(s._leadMemberName){const O=this.model.state.nhathau.find(E=>E.id===f.id);O&&(O.tenNhaThau=s._leadMemberName,this.model.persistData("nhathau"))}(s._thanhVienLienDanh||[]).forEach(O=>{if(!O.maSoThue)return;let E=r.find(tt=>tt.maNhaThau&&tt.maNhaThau.trim().toLowerCase()===O.maSoThue.trim().toLowerCase());E||(E={id:window.generateUUID(),maNhaThau:O.maSoThue,tenNhaThau:O.tenNhaThau,loaiNhaThau:"Độc lập",maSoThue:O.maSoThue,nguoiDaiDien:O.nguoiDaiDien||"",danhXung:O.danhXung||"Ông",soDienThoai:O.soDienThoai||"",email:O.email||"",diaChi:O.diaChi||"",soTaiKhoan:O.soTaiKhoan||"",noiMoTaiKhoan:O.noiMoTaiKhoan||"",maNganHang:O.maNganHang||"",thanhVienLienDanh:[],phienBan:0},this.model.state.nhathau.push(E),this.model.persistData("nhathau"),r.push(E))})}const S=x==="Liên danh"?y:f?f.tenNhaThau:y,w=f.id,M=((G=s.querySelector(".mt-ma-dinh-danh"))==null?void 0:G.value.trim())||"",C=((H=s.querySelector(".mt-ma-phan-lo"))==null?void 0:H.value)||"",V=((U=s.querySelector(".mt-ten-phan-lo"))==null?void 0:U.value.trim())||"",P=this.model.parseVND(((Y=s.querySelector(".mt-gia-du-thau"))==null?void 0:Y.value)||""),et=this.model.parseVND(((W=s.querySelector(".mt-dam-bao-du-thau"))==null?void 0:W.value)||""),it=((_=s.querySelector(".mt-hieu-luc-dam-bao"))==null?void 0:_.value.trim())||"",L=((D=s.querySelector(".mt-hieu-luc-hsdxt"))==null?void 0:D.value.trim())||"",N=((B=s.querySelector(".mt-ty-le-giam-gia"))==null?void 0:B.value)||"0",A=parseFloat(N.replace(/,/g,"."))||0,z=this.model.parseVND(((K=s.querySelector(".mt-gia-sau-giam-gia"))==null?void 0:K.value)||""),k=parseInt(((R=s.querySelector(".mt-hieu-luc-hsdt"))==null?void 0:R.value)||"0",10),I=this.model.parseVND(((Q=s.querySelector(".mt-gia-tri-dam-bao"))==null?void 0:Q.value)||""),q=parseInt(((F=s.querySelector(".mt-hieu-luc-bao-dam-ngay"))==null?void 0:F.value)||"0",10),j=((X=s.querySelector(".mt-thoi-gian-thuc-hien"))==null?void 0:X.value.trim())||"";let $=[];x==="Liên danh"&&($.push({tenNhaThau:s._leadMemberName||f.tenNhaThau||"Thành viên đứng đầu "+T,maSoThue:f&&f.maSoThue||"",vaiTro:"Đứng đầu liên danh"}),(s._thanhVienLienDanh||[]).filter(O=>String(O.maSoThue).toLowerCase().trim()!==String(T).toLowerCase().trim()&&O.vaiTro!=="Đứng đầu liên danh").forEach(O=>{$.push({tenNhaThau:O.tenNhaThau,maSoThue:O.maSoThue,vaiTro:"Thành viên liên danh"})})),d.push({id:p,goiThauId:t,nhaThauId:w,maPhanLo:C,tenPhanLo:V,maDinhDanh:M,giaDuThau:P,damBaoDuThau:et,hieuLucDamBao:it,hieuLucHsdxt:L,tyLeGiamGia:A,giaSauGiamGia:z,hieuLucHsdt:k,giaTriDamBao:I,hieuLucBaoDamNgay:q,thoiGianThucHien:j,tenNhaThau:S,loaiNhaThau:x,thanhVienLienDanh:$})}),this.model.state.thongtinmothau=this.model.state.thongtinmothau.filter(s=>String(s.goiThauId)!==String(t)),this.model.state.thongtinmothau.push(...d),this.model.persistData("thongtinmothau"),a.trangThai="Đang chấm thầu",this.model.persistData("goithau");const h=n?"opening_tech":"opening";this.view._editingState&&(this.view._editingState[h]=!1),this.view.renderGoiThauTable(),this.autoSync(),await this.view.customAlert("Lưu thành công",`Đã lưu toàn bộ thông tin mở thầu (E-HSDT / E-HSĐXKT) của gói thầu "${a.tenGoiThau}" thành công! Trạng thái gói thầu đã được chuyển sang Đang chấm thầu.`,"check-circle"),this.renderMoThauPanel();const g=document.getElementById("tab-goithau-detail");g&&g.classList.contains("active")&&(this.view._currentWorkflowTab="eval_tech",this.view.showPackageDetails(t))}class Tt{constructor(t,a){this.model=t,this.view=a,window.appController=this,this.tempChuyenGiaImageBase64="",this.tempChuyenGiaSignatureBase64="",this.packageWizard={active:!1,planId:null,totalCount:0,currentCount:0},this.routeMap={dashboard:"tong-quan",kehoach:"ke-hoach",goithau:"goi-thau",mothau:"mothau",danhgiahsdt:"danh-gia-hsdt",hopdong:"hop-dong",chudautu:"chu-dau-tu",nhathau:"nha-thau",chuyengia:"chuyen-gia",bieumau:"bieu-mau","superadmin-dashboard":"tong-quan-admin",superadmin:"quan-ly-tai-khoan",managernhanvien:"nhan-su",managerhosogiay:"trang-thai-ho-so",profile:"trang-ca-nhan","goithau-detail":"goi-thau-chi-tiet","kehoach-detail":"ke-hoach-chi-tiet","hopdong-detail":"hop-dong-chi-tiet"},this.actionMap={taomoi:"tao-moi",chinhsua:"chinh-sua"},window.toggleSortTable=(n,i)=>{const e=this.model.sortState[n]||{field:"",order:"asc"};e.field===i?e.order=e.order==="asc"?"desc":"asc":(e.field=i,e.order="asc"),this.model.sortState[n]=e,n==="kehoach"?this.view.renderKeHoachTable():n==="goithau"?this.view.renderGoiThauTable():n==="chudautu"?this.view.renderChuDauTuTable():n==="nhathau"?this.view.renderNhaThauTable():n==="chuyengia"?this.view.renderChuyenGiaTable():n==="hopdong"&&this.view.renderHopDongTable()}}async init(){const t=window.fetch;window.fetch=async(i,e={})=>{const o=sessionStorage.getItem("bf_session_token"),l=sessionStorage.getItem("bf_username"),u=localStorage.getItem("bf_active_org");if(typeof i=="string"&&i.startsWith("/api/")&&o&&l&&(e.headers={...e.headers,"X-Session-Token":o,"X-Username":l,...u&&{"X-Active-Org":encodeURIComponent(u)}}),typeof i=="string"&&i.includes("/api/sync")&&e.method==="POST")try{let r={};e.body&&(r=typeof e.body=="string"?JSON.parse(e.body):e.body);const h=JSON.parse(localStorage.getItem("bf_local_deletions")||"[]");r.deletions=h,e.body=JSON.stringify(r)}catch(r){console.error("Failed to inject local deletions to sync request",r)}const d=await t(i,e);if(d.ok&&typeof i=="string"&&i.includes("/api/sync")&&e.method==="POST"&&localStorage.setItem("bf_local_deletions","[]"),d.status===403&&typeof i=="string"&&i.startsWith("/api/")&&!i.includes("/api/auth/login")&&!i.includes("/api/auth/check-session")){let r="Yêu cầu bị từ chối do không đủ quyền hạn hoặc vi phạm cấu hình hệ thống.",h=!1;try{const s=await d.clone().json();s&&s.error&&(r=s.error),r==="Không có quyền truy cập tổ chức này!"&&(localStorage.removeItem("bf_active_org"),localStorage.setItem("bf_last_sync_timestamp","0"),this.model.db&&this.model.db.stores&&this.model.db.stores.forEach(p=>{this.model.db.putTableData(p,[]).catch(()=>{}),this.model.state[p]&&(this.model.state[p]=[])})),(r==="Thiếu thông tin xác thực phiên làm việc!"||r==="Tài khoản không tồn tại!"||r==="Phiên làm việc đã hết hạn hoặc không hợp lệ!"||r==="Phiên đăng nhập đã hết hạn! Vui lòng đăng nhập lại.")&&(h=!0)}catch(g){console.error("Lỗi phân tích phản hồi 403:",g)}if(h){const g=document.getElementById("auth-overlay");if(g&&g.style.display!=="flex"){this.model.clearSessionData(),g.style.display="flex",document.querySelector(".app-container").style.filter="blur(10px)";const s=document.getElementById("form-auth-login"),p=document.getElementById("form-auth-register"),m=document.getElementById("form-auth-forgot");s&&(s.style.display="block"),p&&(p.style.display="none"),m&&(m.style.display="none")}return d}return r==="Không có quyền truy cập tổ chức này!"?await this.view.customAlert("⚠️ LỖI QUYỀN HẠN","Không có quyền truy cập tổ chức này!","log-out"):await this.view.customAlert("⚠️ LỖI QUYỀN HẠN (403)",`${r}

Nhấn Xác nhận để tải lại hệ thống.`,"log-out"),window.location.reload(),d}if(d.status===401&&typeof i=="string"&&i.startsWith("/api/")&&!i.includes("/api/auth/login")&&!i.includes("/api/auth/check-session")){const r=document.getElementById("auth-overlay");if(r&&r.style.display!=="flex"){this.model.clearSessionData(),r.style.display="flex",document.querySelector(".app-container").style.filter="blur(10px)";const h=document.getElementById("form-auth-login"),g=document.getElementById("form-auth-register"),s=document.getElementById("form-auth-forgot");h&&(h.style.display="block"),g&&(g.style.display="none"),s&&(s.style.display="none")}}return d},await this.model.init();const a=document.createElement("div");a.id="offline-indicator-banner",a.className="offline-banner",a.innerHTML='<i data-lucide="wifi-off"></i> Mất kết nối internet. Bạn đang làm việc offline.',document.body.appendChild(a),window.lucide&&window.lucide.createIcons({root:a});const n=()=>{navigator.onLine?a.classList.remove("visible"):(a.innerHTML='<i data-lucide="wifi-off"></i> Mất kết nối internet. Bạn đang làm việc offline.',window.lucide&&window.lucide.createIcons({root:a}),a.classList.add("visible"))};window.addEventListener("online",n),window.addEventListener("offline",n),n(),localStorage.getItem("bf_id_prefix_cleaned_v2")!=="true"&&(localStorage.setItem("bf_last_sync_timestamp","0"),this.model.db&&this.model.db.stores&&this.model.db.stores.forEach(i=>{this.model.db.putTableData(i,[]).catch(()=>{})}),localStorage.setItem("bf_id_prefix_cleaned_v2","true"),console.log("Client-side IndexedDB cache reset for ID prefix removal migration.")),this.view.initDOM(),this.setupAuth(),this.setupActivityTracker(),this.registerGlobals(),this.setupTheme(),this.setupSidebar(),this.setupTabs(),this.setupActionListeners(),this.setupConditionalUI(),this.setupFileUploads(),this.setupWordTemplatesEvents(),this.setupExcelImportEvents(),this.view.updateActiveUserProfileDisplay(),this.setupRBACEvents(),window.addEventListener("popstate",i=>{this.handlePathRouting(window.location.pathname,!1)}),this.handlePathRouting(window.location.pathname,!1,!0),this.forceSyncData();try{const i=await fetch("/api/auth/users");if(i.ok){const e=await i.json(),o=JSON.parse(localStorage.getItem("bf_employees")||"[]");this.model.state.employees=e.map(l=>{const u=o.find(d=>d.email&&d.email.trim().toLowerCase()===(l.email||"").trim().toLowerCase());return{id:l.id,username:l.username,name:u?u.name:l.name,email:l.email||"",phone:u?u.phone:"",role:l.role,package_id:l.package_id}}),this.model.persistData("employees"),this.view.populateNhanVienPhuTrachDropdowns()}}catch(i){console.error("Failed to load users for assignment dropdowns:",i)}try{const i=await fetch("/api/system-packages");if(i.ok){const e=await i.json(),o=JSON.parse(localStorage.getItem("bf_locked_system_packages")||"[]");e.forEach(l=>{l.isLocked=o.includes(l.id)}),this.model.state.systempackages=e,this.model.persistData("systempackages")}}catch(i){console.error("Failed to load system packages from SQLite:",i)}this.setupAutoSyncBackground()}registerGlobals(){window.changePlanRowVersion=(t,a)=>{this.model.state.selectedPlanVersion||(this.model.state.selectedPlanVersion={}),this.model.state.selectedPlanVersion[t]=a,this.view.renderKeHoachTable()},window.changePackageRowVersion=(t,a)=>{this.model.state.selectedPackageVersion||(this.model.state.selectedPackageVersion={}),this.model.state.selectedPackageVersion[t]=a,this.view.renderGoiThauTable()},window.changeChuDauTuRowVersion=(t,a)=>{this.model.state.selectedChuDauTuVersion||(this.model.state.selectedChuDauTuVersion={}),this.model.state.selectedChuDauTuVersion[t]=a,this.view.renderChuDauTuTable()},window.changeNhaThauRowVersion=(t,a)=>{this.model.state.selectedNhaThauVersion||(this.model.state.selectedNhaThauVersion={}),this.model.state.selectedNhaThauVersion[t]=a,this.view.renderNhaThauTable()},window.changeChuyenGiaRowVersion=(t,a)=>{this.model.state.selectedChuyenGiaVersion||(this.model.state.selectedChuyenGiaVersion={}),this.model.state.selectedChuyenGiaVersion[t]=a,this.view.renderChuyenGiaTable()},window.changeHopDongRowVersion=(t,a)=>{this.model.state.selectedHopDongVersion||(this.model.state.selectedHopDongVersion={}),this.model.state.selectedHopDongVersion[t]=a,this.view.renderHopDongTable()},window.showPackageDetails=t=>this.view.showPackageDetails(t),window.showKeHoachDetails=t=>this.view.showKeHoachDetails(t),window.showHopDongDetails=t=>this.view.showHopDongDetails(t),window.showChuyenGiaDetails=t=>this.view.showChuyenGiaDetails(t),window.zoomCertificateImage=t=>{const a=this.model.state.chuyengia.find(i=>i.id===t);if(!a||!a.anhChungChi)return;const n=document.createElement("div");n.className="certificate-lightbox",n.innerHTML=`<img src="${a.anhChungChi}" alt="Chứng chỉ Zoom">`,n.onclick=()=>n.remove(),document.body.appendChild(n)},window.zoomSignatureImage=t=>{const a=this.model.state.chuyengia.find(i=>i.id===t);if(!a||!a.anhChuKy)return;const n=document.createElement("div");n.className="certificate-lightbox",n.innerHTML=`<img src="${a.anhChuKy}" alt="Chữ ký Zoom" style="max-height:60vh; background:#fff; padding:24px; border-radius:12px;">`,n.onclick=()=>n.remove(),document.body.appendChild(n)},window.editKeHoach=t=>this.editKeHoach(t),window.deleteKeHoach=t=>this.deleteKeHoach(t),window.addBreakdownRow=t=>this.addBreakdownRow(t),window.removeBreakdownRow=(t,a)=>this.removeBreakdownRow(t,a),window.editGoiThau=(t,a=!1)=>this.editGoiThau(t,a),window.deleteGoiThau=t=>this.deleteGoiThau(t),window.addGiaHanRow=t=>this.addGiaHanRow(t),window.validateGiaHanRealtime=()=>this.validateGiaHanRealtime(),window.moThauGoiThau=t=>this.moThauGoiThau(t),window.phatHanhHsmtGoiThau=t=>this.phatHanhHsmtGoiThau(t),window.enforceSingleLeader=(t,a)=>this.enforceSingleLeader(t,a),window.editChuDauTu=t=>this.editChuDauTu(t),window.deleteChuDauTu=t=>this.deleteChuDauTu(t),window.editNhaThau=(t,a=!1)=>this.editNhaThau(t,a),window.deleteNhaThau=t=>this.deleteNhaThau(t),window.editChuyenGia=t=>this.editChuyenGia(t),window.deleteChuyenGia=t=>this.deleteChuyenGia(t),window.editHopDong=t=>this.editHopDong(t),window.deleteHopDong=t=>this.deleteHopDong(t),window.exportContractFromHopDong=(t,a)=>{const n=t,i=document.querySelector(`button[onclick*="${t}"][onclick*="${a}"]`),e=i?i.innerHTML:"";i&&(i.disabled=!0,i.innerHTML='<i data-lucide="loader-2" class="animate-spin" style="width:14px;height:14px;"></i>',lucide.createIcons({root:i})),fetch("/api/sync",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({goithau:this.model.state.goithau,hopdong:this.model.state.hopdong})}).then(o=>{if(!o.ok)throw new Error("Không thể đồng bộ dữ liệu");return fetch(`/api/export-report/${n}?type=contract`)}).then(o=>{if(!o.ok)throw new Error("Không thể xuất hợp đồng");return o.blob()}).then(o=>{const l=window.URL.createObjectURL(o),u=document.createElement("a");u.href=l,u.download=`Hop_dong_${a||"LCNT"}.docx`,document.body.appendChild(u),u.click(),u.remove(),window.URL.revokeObjectURL(l)}).catch(o=>{this.view.customAlert("Lỗi xuất hợp đồng",o.message,"x-circle")}).finally(()=>{i&&(i.disabled=!1,i.innerHTML=e,lucide.createIcons({root:i}))})},window.addJointVentureMemberCard=t=>this.addJointVentureMemberCard(t),window.removeJointVentureMemberCard=t=>this.removeJointVentureMemberCard(t),window.switchTab=(t,a=null,n=!0)=>this.switchTab(t,a,n),window.toggleOrgLock=t=>this.toggleOrgLock(t),window.renewOrgSubscription=t=>this.renewOrgSubscription(t),window.editPackageQuota=(t,a)=>this.editPackageQuota(t,a),window.editSystemPackage=t=>this.editSystemPackage(t),window.togglePackageLock=t=>this.togglePackageLock(t),window.editEmployee=t=>this.editEmployee(t),window.deleteEmployee=t=>this.deleteEmployee(t),window.editHoSoGiayStatus=t=>this.editHoSoGiayStatus(t),window.deleteHoSoGiayStatus=t=>this.deleteHoSoGiayStatus(t),window.triggerUpgradePrompt=()=>this.triggerUpgradePrompt(),window.deleteSystemUser=(t,a)=>this.deleteSystemUser(t,a),window.changeUserRole=(t,a)=>this.changeUserRole(t,a),window.changeUserPackage=(t,a)=>this.changeUserPackage(t,a),window.toggleUserPackage=(t,a,n)=>this.toggleUserPackage(t,a,n),window.updateUserMetadata=(t,a,n)=>this.updateUserMetadata(t,a,n),window.showSystemUserDetail=t=>this.showSystemUserDetail(t),window.renderTablePagination=(t,a,n,i)=>{const e=document.getElementById(t);if(!e)return;const o=Math.ceil(a/i)||1;n>o&&(n=o);const l=a===0?0:(n-1)*i+1,u=Math.min(n*i,a);let d=`
                <div class="pagination-info">
                    Hiển thị <strong>${l}-${u}</strong> trên tổng số <strong>${a}</strong> bản ghi
                </div>
                <div class="pagination-buttons">
                    <button class="pagination-btn" ${n===1?"disabled":""} onclick="window.handlePageChange('${t}', 1)" title="Trang đầu">
                        <i data-lucide="chevrons-left" style="width:14px; height:14px;"></i>
                    </button>
                    <button class="pagination-btn" ${n===1?"disabled":""} onclick="window.handlePageChange('${t}', ${n-1})" title="Trang trước">
                        <i data-lucide="chevron-left" style="width:14px; height:14px;"></i>
                    </button>
            `;const r=5;let h=Math.max(1,n-Math.floor(r/2)),g=Math.min(o,h+r-1);g-h+1<r&&(h=Math.max(1,g-r+1));for(let s=h;s<=g;s++)d+=`
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
            `,e.innerHTML=d,lucide.createIcons({root:e})},window.handlePageChange=(t,a)=>{const n=t.split("-")[0];this.model.currentPage[n]=a,this.model.savePage(n),n==="kehoach"?this.view.renderKeHoachTable():n==="goithau"?this.view.renderGoiThauTable():n==="chudautu"?this.view.renderChuDauTuTable():n==="nhathau"?this.view.renderNhaThauTable():n==="chuyengia"?this.view.renderChuyenGiaTable():n==="hopdong"&&this.view.renderHopDongTable()}}}const se=Promise.all([ut(()=>import("../assets/AuthController-48c55733.js"),[]),ut(()=>import("../assets/AdminUserController-c5f2013f.js"),[]),ut(()=>import("../assets/BiddingWorkflows-4aaaa841.js"),[]),ut(()=>import("../assets/PartnerWorkflows-6c485681.js"),[]),ut(()=>import("../assets/BiddingControllerUI-1af93826.js"),[]),ut(()=>import("../assets/BiddingControllerForms-11c6d9a2.js"),[]),ut(()=>import("../assets/BiddingControllerSync-497b7706.js"),[])]);window.addEventListener("DOMContentLoaded",async()=>{const[c,t,a,n,i,e,o]=await se;Object.assign(Tt.prototype,{...c,...t,...a,...n,...i,...e,...o});const l=new yt,u=new wt(l);new Tt(l,u).init()});export{ue as a,he as h,re as m,de as p,ce as r,ge as s};
