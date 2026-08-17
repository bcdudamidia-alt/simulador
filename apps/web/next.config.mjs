/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Cabeçalhos de segurança do lado do frontend. A CSP fica deliberadamente
  // fora daqui no MVP: ela precisa do hash do script anti-flash e das origens
  // reais de deploy, e uma CSP genérica copiada de tutorial ou quebra a app ou
  // não protege nada. Definir em produção, com report-only antes de enforce.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
