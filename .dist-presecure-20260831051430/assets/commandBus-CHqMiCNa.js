var t=null;function e(n){t=typeof n=="function"?n:null}function r(n,...o){if(!t){console.warn(`[Command] Executor is not ready: ${n}`);return}return t(n,...o)}export{e as n,r as t};
