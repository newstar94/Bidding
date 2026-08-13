function revisionSortKey(value) {
  const text = String(value ?? "").trim();
  return /^\d+$/.test(text) ? [Number(text), text] : [-1, text];
}

function compareRevisions(left, right) {
  const a = revisionSortKey(left?.revisionNumber);
  const b = revisionSortKey(right?.revisionNumber);
  return a[0] - b[0] || a[1].localeCompare(b[1]);
}

export class SequentialRevisionController {
  constructor({ revisions, loadRevision, saveRevision, afterRevisionSaved } = {}) {
    this.revisions = [...(revisions || [])].sort(compareRevisions);
    if (!this.revisions.length) throw new TypeError("Cần ít nhất một phiên bản nguồn.");
    this.loadRevision = loadRevision;
    this.saveRevision = saveRevision;
    this.afterRevisionSaved = afterRevisionSaved;
    this.currentIndex = 0;
    this.state = "READY";
  }

  current() {
    return this.revisions[this.currentIndex] || null;
  }

  hasNext() {
    return this.currentIndex + 1 < this.revisions.length;
  }

  async loadCurrent() {
    if (["CANCELLED", "COMPLETED"].includes(this.state)) return null;
    this.state = "EDITING_REVISION";
    return this.loadRevision?.(this.current(), this.currentIndex);
  }

  async saveCurrent(...args) {
    if (this.state !== "EDITING_REVISION") {
      throw new Error("PROCUREMENT_REVISION_INVALID_STATE");
    }
    this.state = "SAVING_REVISION";
    try {
      const result = await this.saveRevision?.(this.current(), ...args);
      this.state = this.hasNext() ? "WAITING_NEXT_CONFIRMATION" : "COMPLETED";
      await this.afterRevisionSaved?.(this.current(), result, this.hasNext());
      return result;
    } catch (error) {
      this.state = "EDITING_REVISION";
      throw error;
    }
  }

  async next() {
    if (this.state !== "WAITING_NEXT_CONFIRMATION" || !this.hasNext()) {
      throw new Error("PROCUREMENT_REVISION_INVALID_STATE");
    }
    this.currentIndex += 1;
    return this.loadCurrent();
  }

  complete() {
    this.state = "COMPLETED";
  }

  cancel() {
    this.state = "CANCELLED";
  }
}
