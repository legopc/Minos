// undo.js — client-side in-memory undo/redo stack (s7-ui-undo)
//
// Usage pattern (recommended):
//   1) Apply change (API call + local state updates)
//   2) undo.push({ label, apply: () => redoChange(), revert: () => undoChange() })
//
// Events (window):
//   undo:change  {canUndo, canRedo, undoLabel, redoLabel, undoCount, redoCount}
//   undo:applied {direction: 'undo'|'redo', label}
//   undo:failed  {direction, label, error}

const DEFAULT_CAPACITY = 50;

function _dispatch(type, detail) {
  window.dispatchEvent(new CustomEvent(type, { detail }));
}

class UndoStack {
  constructor(capacity = DEFAULT_CAPACITY) {
    this._cap = capacity;
    this._ops = [];     // [{label, apply, revert, ts}]
    this._idx = -1;     // index of last-applied op; -1 means "at beginning"
    this._groups = [];  // stack of {label, ops: []}
  }

  setCapacity(n) {
    this._cap = Math.max(1, Number(n) || DEFAULT_CAPACITY);
    this._trimToCapacity();
    this._emitChange();
  }

  clear() {
    this._ops = [];
    this._idx = -1;
    this._groups = [];
    this._emitChange();
  }

  beginGroup(label = 'Grouped change') {
    this._groups.push({ label, ops: [] });
  }

  endGroup() {
    const g = this._groups.pop();
    if (!g) return;
    if (g.ops.length === 0) return;

    const label = g.label ?? (g.ops.length === 1 ? g.ops[0].label : 'Grouped change');
    const compound = {
      label,
      ts: Date.now(),
      apply: async () => {
        for (const op of g.ops) await op.apply?.();
      },
      revert: async () => {
        for (let i = g.ops.length - 1; i >= 0; i--) {
          await g.ops[i].revert?.();
        }
      },
    };

    if (this._groups.length) {
      this._groups[this._groups.length - 1].ops.push(compound);
    } else {
      this.push(compound);
    }
  }

  canUndo() {
    return this._idx >= 0;
  }

  canRedo() {
    return this._idx + 1 < this._ops.length;
  }

  undoLabel() {
    return this.canUndo() ? (this._ops[this._idx].label ?? 'Undo') : '';
  }

  redoLabel() {
    return this.canRedo() ? (this._ops[this._idx + 1].label ?? 'Redo') : '';
  }

  undoCount() {
    return Math.max(0, this._idx + 1);
  }

  redoCount() {
    return Math.max(0, this._ops.length - (this._idx + 1));
  }

  push(op) {
    if (!op || (typeof op.apply !== 'function') || (typeof op.revert !== 'function')) return;

    const entry = {
      label: op.label ?? 'Change',
      ts: Date.now(),
      apply: op.apply,
      revert: op.revert,
    };

    if (this._groups.length) {
      this._groups[this._groups.length - 1].ops.push(entry);
      return;
    }

    if (this._idx + 1 < this._ops.length) {
      this._ops = this._ops.slice(0, this._idx + 1);
    }

    this._ops.push(entry);
    this._idx = this._ops.length - 1;

    this._trimToCapacity();
    this._emitChange();
  }

  _trimToCapacity() {
    if (this._ops.length <= this._cap) return;
    const drop = this._ops.length - this._cap;
    this._ops.splice(0, drop);
    this._idx = Math.max(-1, this._idx - drop);
  }

  _emitChange() {
    _dispatch('undo:change', {
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      undoLabel: this.undoLabel(),
      redoLabel: this.redoLabel(),
      undoCount: this.undoCount(),
      redoCount: this.redoCount(),
    });
  }

  async undo() {
    if (!this.canUndo()) return false;
    const op = this._ops[this._idx];

    try {
      await op.revert();
      this._idx--;
      this._emitChange();
      _dispatch('undo:applied', { direction: 'undo', label: op.label ?? 'Undo' });
      return true;
    } catch (e) {
      _dispatch('undo:failed', { direction: 'undo', label: op.label ?? 'Undo', error: e && e.message ? e.message : String(e) });
      throw e;
    }
  }

  async redo() {
    if (!this.canRedo()) return false;
    const op = this._ops[this._idx + 1];

    try {
      await op.apply();
      this._idx++;
      this._emitChange();
      _dispatch('undo:applied', { direction: 'redo', label: op.label ?? 'Redo' });
      return true;
    } catch (e) {
      _dispatch('undo:failed', { direction: 'redo', label: op.label ?? 'Redo', error: e && e.message ? e.message : String(e) });
      throw e;
    }
  }
}

export const undo = new UndoStack(DEFAULT_CAPACITY);
export const undoStack = undo;
