function getPersistPayload(mock, callIndex = 0) {
  const call = mock.findByIdAndUpdate.mock.calls[callIndex][1];
  return call.$set || call;
}

module.exports = { getPersistPayload };
