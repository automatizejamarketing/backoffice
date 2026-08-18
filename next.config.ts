import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack running under Bun cannot resolve the hashed external aliases
  // generated for these CommonJS packages. Bundle them with the server route
  // so product uploads work in the local Portless environment as well.
  transpilePackages: [
    "@aws-sdk/client-s3",
    "@aws-sdk/s3-request-presigner",
  ],
  // Allow images from Google profile pictures
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      {
        hostname: "avatar.vercel.sh",
      },
      {
        protocol: "https",
        //https://nextjs.org/docs/messages/next-image-unconfigured-host
        // Legado: URLs antigas do Vercel Blob ainda persistidas no banco
        hostname: "*.public.blob.vercel-storage.com",
      },
      {
        protocol: "https",
        // Mídia migrada para o R2, servida pelo frontend em /api/media
        hostname: "www.automatizemarketing.com",
      },
      {
        protocol: "https",
        hostname: "staging.automatizemarketing.com",
      },
      {
        protocol: "https",
        hostname: "*.vercel.app",
      },
      {
        protocol: "https",
        hostname: "*.fbcdn.net",
      },
      {
        protocol: "https",
        hostname: "scontent*.fbcdn.net",
      },
      {
        protocol: "https",
        hostname: "*.cdninstagram.com",
      },
      {
        protocol: "https",
        hostname: "scontent.cdninstagram.com",
      },
    ],
  },
};

export default nextConfig;
