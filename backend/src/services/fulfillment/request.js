async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...options.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`Fulfillment provider request failed with status ${response.status}.`);
  }
  return response.json();
}

module.exports = {
  requestJson,
};
