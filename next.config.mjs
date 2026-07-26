/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.fella.cc" }],
        destination: "https://fella.cc/:path*",
        permanent: true,
      },
    ];
  },
};
export default nextConfig;
