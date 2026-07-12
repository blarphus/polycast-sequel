// Extension-native tokenizer. Its behavior is locked to the shared golden
// corpus generated from contracts/transcript-tokenization-v1.fixtures.json.
(function installPolycastTextTokens(globalObject) {
  function tokenize(text) {
    return String(text || '').match(/([\p{L}\p{M}\d']+|[^\p{L}\p{M}\d']+)/gu) || [];
  }

  function isWordToken(token) {
    return /^[\p{L}\p{M}\d']+$/u.test(token);
  }

  globalObject.PolycastTextTokens = Object.freeze({ tokenize, isWordToken });
})(globalThis);
