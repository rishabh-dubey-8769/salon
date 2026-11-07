const test = require('node:test');
const assert = require('node:assert/strict');
const { cookieOptions } = require('../utils/generateToken');

const withEnvironment = (environment, callback) => {
  const original = {
    nodeEnv: process.env.NODE_ENV,
    cookieSameSite: process.env.COOKIE_SAME_SITE,
  };
  if (environment.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = environment.nodeEnv;
  if (environment.cookieSameSite === undefined) delete process.env.COOKIE_SAME_SITE;
  else process.env.COOKIE_SAME_SITE = environment.cookieSameSite;

  try {
    callback();
  } finally {
    if (original.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original.nodeEnv;
    if (original.cookieSameSite === undefined) delete process.env.COOKIE_SAME_SITE;
    else process.env.COOKIE_SAME_SITE = original.cookieSameSite;
  }
};

test('production auth cookies support cross-site frontend and API requests', () => {
  withEnvironment({ nodeEnv: 'production', cookieSameSite: undefined }, () => {
    assert.deepEqual(cookieOptions(), {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });
  });
});

test('local auth cookies remain compatible with HTTP development', () => {
  withEnvironment({ nodeEnv: 'development', cookieSameSite: undefined }, () => {
    assert.equal(cookieOptions().sameSite, 'lax');
    assert.equal(cookieOptions().secure, false);
  });
});

test('configured SameSite cookie settings are normalized and respected', () => {
  withEnvironment({ nodeEnv: 'production', cookieSameSite: 'LAX' }, () => {
    assert.equal(cookieOptions().sameSite, 'lax');
    assert.equal(cookieOptions().secure, true);
  });
});
