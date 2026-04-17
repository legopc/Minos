// S7 s7-ui-toast-stack — stacking toast queue.
//
// Replaces current single-slot toast.js with a queue and severity variants.
// API:
//   toast(message, {severity: 'info'|'warn'|'error'|'success', ttl: 4000})
//   toast.info(msg), toast.warn(msg), toast.error(msg), toast.success(msg)

// TODO: migrate callers from toast(msg, isErr) → toast.error(msg)
