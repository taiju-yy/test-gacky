import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',  // 'standalone' から 'export' に変更
  reactStrictMode: true,
  
  env: {
    // 公開しても問題ない環境変数をここに定義
  },
  poweredByHeader: false,
  compress: true,
};

export default nextConfig;