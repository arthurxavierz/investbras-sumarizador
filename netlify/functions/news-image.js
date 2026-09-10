'use strict';

const { timeoutFetch } = require('./_utils');

const MAX_BYTES = 3 * 1024 * 1024;

const BLOCKED_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', '::1', 'metadata.google.internal'];

/** Evita que o proxy seja usado para alcancar a rede interna do provedor. */
const isPrivateHost = hostname => {
  const host = String(hostname || '').toLowerCase();
  return BLOCKED_HOSTS.includes(host)
    || host.endsWith('.local')
    || host.endsWith('.internal')
    || host.startsWith('10.')
    || host.startsWith('169.254.')
    || host.startsWith('192.168.')
    || /^127\./.test(host)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
};

const plain = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  body
});

exports.handler = async event => {
  const src = (event.queryStringParameters && event.queryStringParameters.src) || '';
  let url;

  try {
    url = new URL(src);
  } catch {
    return plain(400, 'URL de imagem inválida.');
  }

  if (!['http:', 'https:'].includes(url.protocol) || isPrivateHost(url.hostname)) {
    return plain(400, 'Origem de imagem bloqueada.');
  }

  try {
    const response = await timeoutFetch(url.toString(), {
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        Referer: url.origin + '/'
      }
    }, 8000);

    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.startsWith('image/')) {
      return plain(502, 'Imagem indisponível na origem.');
    }

    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > MAX_BYTES) return plain(413, 'Imagem acima do limite.');

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_BYTES) return plain(413, 'Imagem acima do limite.');

    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox"
      },
      body: buffer.toString('base64')
    };
  } catch {
    return plain(502, 'Não foi possível carregar a imagem.');
  }
};
