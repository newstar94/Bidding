export function renderEvaluationLockNotice({ isTwoEnvelope = false, stage = "technical" } = {}) {
  const message = isTwoEnvelope
    ? stage === "technical"
      ? "Báo cáo đánh giá kỹ thuật đã được khóa"
      : "Báo cáo đánh giá tài chính đã được khóa"
    : "Báo cáo đánh giá E-HSDT đã được khóa";
  return `<div style="margin-top:8px; padding:8px 12px; background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.25); border-radius:6px; color:#dc2626; font-weight:600; font-size:0.82rem; display:flex; align-items:center; gap:6px;">
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
    ${message}
  </div>`;
}
