import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: { unoptimized: true },
  serverExternalPackages: ["pg", "pdfkit", "exceljs"],
  env: { NEXT_PUBLIC_BASE_PATH: "" },
  sassOptions: {
    includePaths: [path.join(__dirname, "node_modules")],
    quietDeps: true,
    silenceDeprecations: ["import", "global-builtin", "color-functions", "mixed-decls", "legacy-js-api"],
  },
};
export default nextConfig;
