function normalizedIdentity(value) {
  return String(value || "").trim().toLowerCase();
}

function currentExpert(record) {
  return Number(record?.isLatest) === 1;
}

export function buildExpertImportIndex(records = [], { latestOnly = true } = {}) {
  const byCitizenId = new Map();
  const byCertificate = new Map();
  const positions = new Map();
  for (const [position, record] of (records || []).entries()) {
    if (latestOnly && !currentExpert(record)) continue;
    positions.set(record, position);
    const citizenId = normalizedIdentity(record.soCCCD);
    const certificate = normalizedIdentity(record.soChungChi);
    if (citizenId && !byCitizenId.has(citizenId)) {
      byCitizenId.set(citizenId, record);
    }
    if (certificate && !byCertificate.has(certificate)) {
      byCertificate.set(certificate, record);
    }
  }
  return Object.freeze({ byCitizenId, byCertificate, positions });
}

export function findIndexedExpert(index, { soCCCD = "", soChungChi = "" } = {}) {
  const citizenId = normalizedIdentity(soCCCD);
  const certificate = normalizedIdentity(soChungChi);
  const citizenMatch = citizenId ? index?.byCitizenId?.get(citizenId) : null;
  const certificateMatch = certificate
    ? index?.byCertificate?.get(certificate)
    : null;
  if (!citizenMatch) return certificateMatch || null;
  if (!certificateMatch || citizenMatch === certificateMatch) return citizenMatch;
  return (index.positions.get(citizenMatch) ?? Number.MAX_SAFE_INTEGER)
      < (index.positions.get(certificateMatch) ?? Number.MAX_SAFE_INTEGER)
    ? citizenMatch
    : certificateMatch;
}
