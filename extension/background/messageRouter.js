(() => {
  function createMessageValidator(contract) {
    if (!contract) throw new Error('Generated extension message contract is unavailable');
    const popupOnly = new Set(contract.popupOnly);
    return function validateRuntimeMessage(msg, sender = {}) {
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) throw new Error('Extension message must be an object');
      if (typeof msg.type !== 'string' || !contract.messages[msg.type]) throw new Error(`Unknown extension message type: ${String(msg.type || '(missing)')}`);
      if (sender.id && chrome.runtime.id && sender.id !== chrome.runtime.id) throw new Error('Extension message sender is not this extension');
      if (popupOnly.has(msg.type) && sender.tab) throw new Error(`${msg.type} is only accepted from the extension popup`);
      let serialized;
      try { serialized = JSON.stringify(msg); } catch { throw new Error('Extension message is not serializable'); }
      if (serialized.length > contract.maxBytes) throw new Error(`Extension message exceeds ${contract.maxBytes} bytes`);
      const rule = contract.messages[msg.type];
      for (const field of rule.required || []) {
        if (!(field in msg) || msg[field] == null || msg[field] === '') throw new Error(`${msg.type}.${field} is required`);
      }
      for (const [field, max] of Object.entries(rule.strings || {})) {
        if (msg[field] != null && (typeof msg[field] !== 'string' || msg[field].length > max)) {
          throw new Error(`${msg.type}.${field} must be a string of at most ${max} characters`);
        }
      }
      for (const field of rule.numbers || []) {
        if (msg[field] != null && !Number.isFinite(Number(msg[field]))) throw new Error(`${msg.type}.${field} must be numeric`);
      }
      for (const [field, max] of Object.entries(rule.arrays || {})) {
        if (msg[field] != null && (!Array.isArray(msg[field]) || msg[field].length > max)) {
          throw new Error(`${msg.type}.${field} must be an array with at most ${max} entries`);
        }
      }
      return {
        ...msg,
        correlationId: typeof msg.correlationId === 'string' && msg.correlationId ? msg.correlationId : crypto.randomUUID(),
        occurredAt: typeof msg.occurredAt === 'string' && Number.isFinite(Date.parse(msg.occurredAt)) ? msg.occurredAt : new Date().toISOString(),
      };
    };
  }
  globalThis.PolycastExtensionMessageRouter = { createMessageValidator };
})();
