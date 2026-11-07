const getTrustProxySetting = ({ TRUST_PROXY = '', RENDER = '' } = process.env) => {
  if (TRUST_PROXY) return Number(TRUST_PROXY) || TRUST_PROXY;
  return RENDER === 'true' ? 1 : false;
};

module.exports = { getTrustProxySetting };
