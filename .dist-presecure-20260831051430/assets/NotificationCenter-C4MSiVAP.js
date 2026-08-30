import{n as w}from"./apiClient-CeM1mzJZ.js";import{l as m,n as g,o as b}from"./view_helpers-CdPIbaii.js";import{ct as k}from"./app-RPlYyKwL.js";import{i as D,l as x,r as E,s as B}from"./workspaceLease-Cgztl2XS.js";import{ALERT_META as K,deriveContractExpiryAlerts as S,deriveDashboardAlerts as F,derivePlanPublishingAlerts as O,selectDashboardActionItems as P}from"./DashboardView-CfWiTaif.js";var R=`
  <div class="notification-empty">
    ${b("inbox",'aria-hidden="true"')}
    <span>Chưa có thông báo mới</span>
  </div>`,_=`
  <div class="notification-empty is-error" role="status">
    ${b("cloud-off",'aria-hidden="true"')}
    <span>Không thể tải thông báo lúc này.</span>
    <button type="button" class="notification-retry" data-notification-retry>Thử lại</button>
  </div>`;function z(e){const o=Number(e),t=Number.isFinite(o)&&o>0?new Date(o*1e3):new Date(e);return Number.isNaN(t.getTime())?"":new Intl.DateTimeFormat("vi-VN",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(t).replace(/[-–—]/g,"/")}function G(e){return e==="assignment_added"?"briefcase-business":e==="assignment_removed"?"shield-off":e==="organization_added"?"building-2":"log-out"}function j(e){const o=String(e?.severity||"").toLowerCase();return["error","danger","failed","failure"].includes(o)||o==="warning"?"red":"info"}function q(e){const o=e?.model?.dashboardSummary?.alertItems;if(Array.isArray(o))return o;const t=e?.model;if(!t)return[];const n=t.getFilteredGoiThau?.()||[],c=t.getFilteredKeHoach?.()||[],r=t.getFilteredHopDong?.()||[];return P([...F(n).items,...O(c).items,...S(r).items])}function V(e){return e.targetType==="contract"?e.soHopDong||e.tenHopDong||"Hợp đồng":e.targetType==="plan"?e.maKeHoach||e.tenKeHoach||"Kế hoạch LCNT":e.maGoiThau||e.tenGoiThau||"Gói thầu"}function L(e,o,t){if(!t||!e?.switchTab)return;const n={goithau:"goithau-detail",package:"goithau-detail",hopdong:"hopdong-detail",contract:"hopdong-detail",plan:"kehoach-detail"}[o];n&&e.switchTab(n,String(t))}function p(e,o,t){if(e.unavailable){t.readAll.disabled=!0,t.list.innerHTML=k(_),window.lucide?.createIcons?.({root:t.list});return}const n=e.items||[],c=q(o);if(t.readAll.disabled=!e.unreadCount,!n.length&&!c.length){t.list.innerHTML=k(R);return}const r=n.map(i=>{const d=!i.readAt,u=!!(i.route&&i.targetId),h=j(i);return`
      <button type="button" class="notification-item ${d?"is-unread":""} notification-item-tone-${h}"
          data-notification-id="${m(i.id)}"
          data-target-type="${m(i.targetType||"")}"
          data-target-id="${m(i.targetId||"")}" ${u?"":'data-static="true"'}>
        <span class="notification-item-icon tone-${h}">
          ${b(G(i.kind),'aria-hidden="true"')}
        </span>
        <span class="notification-item-copy">
          <strong>${g(i.title)}</strong>
          <span>${g(i.message)}</span>
          <time>${g(z(i.createdAt))}</time>
        </span>
        ${d?'<span class="notification-unread-dot" aria-label="Chưa đọc"></span>':""}
      </button>`}).join(""),l=c.map(i=>{const d=K[i.alertKey]||{label:"Công việc cần xử lý",detail:"Kiểm tra tiến độ",icon:"triangle-alert",tone:"amber"},u=i.alertDetail||d.detail;return`
      <button type="button" class="notification-item notification-work-item"
          data-work-target-type="${m(i.targetType||"")}"
          data-work-target-id="${m(i.id||"")}">
        <span class="notification-item-icon tone-${m(d.tone)}">
          ${b(d.icon,'aria-hidden="true"')}
        </span>
        <span class="notification-item-copy">
          <strong>${g(d.label)}</strong>
          <span>${g(V(i))}${u?` · ${g(u)}`:""}</span>
          ${i.deadline?`<time>Hạn: ${g(i.deadline)}</time>`:""}
        </span>
        ${b("chevron-right",'class="notification-chevron" aria-hidden="true"')}
      </button>`}).join("");t.list.innerHTML=k(`${r}${l}`),window.lucide?.createIcons?.({root:t.list})}function y(e,o){const t=Math.max(0,Number(e.unreadCount||0));o.badge.hidden=t===0,o.badge.textContent=t>99?"99+":String(t),o.trigger.setAttribute("aria-label",t?`Mở trung tâm thông báo, ${t} thông báo chưa đọc`:"Mở trung tâm thông báo")}function X(e){const o=document.getElementById("notification-center");if(!o||o.dataset.initialized==="true")return null;const t={root:o,trigger:document.getElementById("notification-trigger"),badge:document.getElementById("notification-badge"),panel:document.getElementById("notification-panel"),readAll:document.getElementById("notification-read-all"),list:document.getElementById("notification-list")};if(Object.values(t).some(a=>!a))return null;o.dataset.initialized="true";const n={items:[],unreadCount:0,loading:!1,unavailable:!1};let c=null,r=!1;const l=async()=>{if(r||n.loading)return;n.loading=!0;const a=D(e.model);c=a;try{const s=await w("/api/notifications?limit=40",{signal:a.signal});if(E(e.model,a.lease),!s.ok){n.unavailable=!0,p(n,e,t),y(n,t);return}const f=await s.json();E(e.model,a.lease),n.unavailable=!1,n.items=Array.isArray(f.items)?f.items:[],n.unreadCount=Number(f.unreadCount||0),p(n,e,t),y(n,t),window.lucide?.createIcons?.({root:t.panel})}catch(s){!r&&s?.code!=="WORKSPACE_CHANGED"&&(console.warn("Unable to refresh notifications:",s),n.unavailable=!0,p(n,e,t),y(n,t))}finally{B(e.model,a),c===a&&(c=null),n.loading=!1}},i=a=>{r||(t.panel.hidden=!a,t.trigger.setAttribute("aria-expanded",String(a)),a&&(p(n,e,t),l()))},d=a=>{a.stopPropagation(),i(t.panel.hidden)},u=async()=>{if(r||!n.unreadCount)return;const a=await w("/api/notifications/read-all",{method:"POST"});!r&&a.ok&&await l()},h=async a=>{if(r)return;if(a.target.closest?.("[data-notification-retry]")){await l();return}const s=a.target.closest?.("[data-notification-id]");if(s){const $=s.dataset.notificationId,v=n.items.find(M=>M.id===$);if(v&&!v.readAt){if(await w(`/api/notifications/${encodeURIComponent($)}/read`,{method:"POST"}),r)return;v.readAt=Math.floor(Date.now()/1e3),n.unreadCount=Math.max(0,n.unreadCount-1),p(n,e,t),y(n,t)}s.dataset.static!=="true"&&(i(!1),L(e,s.dataset.targetType,s.dataset.targetId));return}const f=a.target.closest?.("[data-work-target-id]");f&&(i(!1),L(e,f.dataset.workTargetType,f.dataset.workTargetId))},T=a=>{a.target.closest?.("#notification-center")||i(!1)},I=a=>{a.key==="Escape"&&!t.panel.hidden&&(i(!1),t.trigger.focus())},A=()=>{document.hidden||l()},N=()=>{document.hidden||l()};t.trigger.addEventListener("click",d),t.readAll.addEventListener("click",u),t.list.addEventListener("click",h),document.addEventListener("click",T),document.addEventListener("keydown",I),document.addEventListener("visibilitychange",A);const H=window.setInterval(N,6e4),C={refresh:l,dispose(){r||(r=!0,c?.controller?.abort?.(x()),window.clearInterval(H),t.trigger.removeEventListener("click",d),t.readAll.removeEventListener("click",u),t.list.removeEventListener("click",h),document.removeEventListener("click",T),document.removeEventListener("keydown",I),document.removeEventListener("visibilitychange",A),t.panel.hidden=!0,t.trigger.setAttribute("aria-expanded","false"),delete o.dataset.initialized,e.notificationCenter===C&&(e.notificationCenter=null))}};return p(n,e,t),l(),C}export{z as formatMoment,X as initializeNotificationCenter};
