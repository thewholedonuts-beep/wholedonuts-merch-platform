const crypto = require('crypto');
const { ipKeyGenerator, rateLimit } = require('express-rate-limit');

const FIFTEEN_MINUTES = 15 * 60 * 1000;

function keyedIdentifier(value) {
  const salt = process.env.RATE_LIMIT_KEY_SALT || 'development-only-rate-limit-salt';
  return crypto.createHmac('sha256', salt).update(String(value).trim().toLowerCase()).digest('hex');
}

function accountIdentifier(req) {
  return req.user?.sponsorId
    || (req.user?.isOperator && req.headers['x-operator-key'])
    || req.body?.email
    || req.body?.customerEmail
    || `anonymous:${ipKeyGenerator(req.ip, 56)}`;
}

function accountRateLimitKey(req) {
  return keyedIdentifier(accountIdentifier(req));
}

function referralRateLimitKey(req) {
  return keyedIdentifier(req.body?.code || `anonymous:${ipKeyGenerator(req.ip, 56)}`);
}

function ipLimiter({ limit, message, windowMs = FIFTEEN_MINUTES }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip, 56),
    message: { error: message },
  });
}

function accountLimiter({ keyGenerator = accountRateLimitKey, limit, message, windowMs = FIFTEEN_MINUTES }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator,
    message: { error: message },
  });
}

const generalApiLimiter = ipLimiter({
  limit: Number(process.env.GENERAL_RATE_LIMIT_MAX_PER_IP || 100),
  message: 'Too many API requests. Please try again later.',
});

const registrationLimiters = [
  ipLimiter({
    limit: Number(process.env.REGISTRATION_RATE_LIMIT_MAX_PER_IP || 20),
    message: 'Too many registration attempts from this network. Please try again later.',
  }),
  accountLimiter({
    limit: Number(process.env.REGISTRATION_RATE_LIMIT_MAX_PER_ACCOUNT || 5),
    message: 'Too many registration attempts for this email. Please try again later.',
  }),
];

const loginLimiters = [
  ipLimiter({
    limit: Number(process.env.LOGIN_RATE_LIMIT_MAX_PER_IP || 30),
    message: 'Too many login attempts from this network. Please try again later.',
  }),
  accountLimiter({
    limit: Number(process.env.LOGIN_RATE_LIMIT_MAX_PER_ACCOUNT || 10),
    message: 'Too many login attempts for this account. Please try again later.',
  }),
];

const checkoutLimiters = [
  ipLimiter({
    limit: Number(process.env.CHECKOUT_RATE_LIMIT_MAX_PER_IP || 60),
    message: 'Too many checkout attempts from this network. Please try again later.',
  }),
  accountLimiter({
    limit: Number(process.env.CHECKOUT_RATE_LIMIT_MAX_PER_ACCOUNT || 20),
    message: 'Too many checkout attempts for this account. Please try again later.',
  }),
];

const referralLimiters = [
  ipLimiter({
    windowMs: Number(process.env.REFERRAL_RATE_LIMIT_WINDOW_MS || 60 * 60 * 1000),
    limit: Number(process.env.REFERRAL_RATE_LIMIT_MAX_PER_IP || 20),
    message: 'Too many referral attempts from this network. Please try again later.',
  }),
  accountLimiter({
    keyGenerator: referralRateLimitKey,
    windowMs: Number(process.env.REFERRAL_RATE_LIMIT_WINDOW_MS || 60 * 60 * 1000),
    limit: Number(process.env.REFERRAL_RATE_LIMIT_MAX_PER_CODE || 10),
    message: 'Too many attempts for this referral code. Please try again later.',
  }),
];

const sensitiveAccountLimiters = [
  ipLimiter({
    limit: Number(process.env.SENSITIVE_ACTION_RATE_LIMIT_MAX_PER_IP || 60),
    message: 'Too many sensitive actions from this network. Please try again later.',
  }),
  accountLimiter({
    limit: Number(process.env.SENSITIVE_ACTION_RATE_LIMIT_MAX_PER_ACCOUNT || 20),
    message: 'Too many sensitive actions for this account. Please try again later.',
  }),
];

module.exports = {
  accountRateLimitKey,
  checkoutLimiters,
  generalApiLimiter,
  loginLimiters,
  referralLimiters,
  registrationLimiters,
  sensitiveAccountLimiters,
};
