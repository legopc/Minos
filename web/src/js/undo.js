// S7 s7-ui-undo — undo/redo stack for config mutations.
//
// Ring buffer of inverse operations. Hooked into api.js put/patch so any
// state-mutating call records the inverse.
//
// API:
//   undoStack.push({ forward, inverse })
//   undoStack.undo()   // applies inverse of last op
//   undoStack.redo()
//
// Keybindings: Ctrl+Z / Ctrl+Shift+Z (added in shortcuts.js).

export const undoStack = {
  _ops: [],
  _idx: -1,
  _cap: 200,
  push(op) { /* TODO */ },
  undo() { /* TODO */ },
  redo() { /* TODO */ },
  canUndo() { return false; },
  canRedo() { return false; },
};
