(() => {
  "use strict";
  globalThis.CSL = globalThis.module.exports;
  globalThis.CSL.debug = () => {};
  if (globalThis.__journalLensPreviousModule === undefined) delete globalThis.module;
  else globalThis.module = globalThis.__journalLensPreviousModule;
  delete globalThis.__journalLensPreviousModule;
})();
