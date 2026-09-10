'use strict';

const { json, fail, preflight } = require('./_utils');
const { requireSession } = require('./_auth');

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return preflight();
  try {
    const session = requireSession(event);
    return json(200, {
      success: true,
      status: 'authenticated',
      data: {
        user: { email: session.sub, name: session.name, role: session.role, provider: session.provider },
        expiresAt: new Date(session.exp).toISOString()
      }
    }, 0);
  } catch (error) {
    return fail(error, 'Sessão inválida.');
  }
};
