const { AsyncLocalStorage } = require('async_hooks');

const stageContextStorage = new AsyncLocalStorage();

function runWithStageContext(context, fn) {
  return stageContextStorage.run(context, fn);
}

function getStageContext() {
  return stageContextStorage.getStore() || null;
}

module.exports = { runWithStageContext, getStageContext };
