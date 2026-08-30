import{l as t,n as c}from"./view_helpers-CdPIbaii.js";import{f,l as u,u as $}from"./versionResolver-C4iQLmXG.js";function m(e,n,s={}){if(!n)return null;const i=s[n.rootId||n.id]||n.id;return(e||[]).find(o=>String(o.id)===String(i))||n}function g({versions:e,selectedId:n,rootId:s,changeAction:i,className:o="form-control version-droplist",ariaLabel:l="Chọn phiên bản",name:a=""}){const d=(e||[]).map(r=>{const p=String(Number.parseInt(r.phienBan||"0",10)||0).padStart(2,"0");return`<option value="${t(r.id)}" ${String(r.id)===String(n)?"selected":""}>${c(p)}</option>`}).join("");return`
    <select class="${t(o)} bf-s-1249e0db6b" data-bf-change="${t(i)}" data-root="${t(s)}" aria-label="${t(l)}"${a?` name="${t(a)}"`:""}
     >
      ${d}
    </select>`}function v(e,n,s={}){return{rootId:f(n),versions:u(n?.allVersions||$(e,n)),displayed:m(e,n,s)}}export{v as n,g as t};
