//import modules libraries
import type { Metadata } from "next";
import { Public_Sans } from "next/font/google";

//import custom components
import ClientWrapper from "components/common/ClientWrapper";

// Import Swiper styles
import "swiper/css";
import "swiper/css/navigation";
import "swiper/css/pagination";
import "swiper/css/scrollbar";

// import main theme scss
import "styles/theme.scss";

const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Arshith Group Finance ERP",
  description: "Multi-company financial management ERP",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClientWrapper>
      <html lang="en" className="expanded">
        <body className={`${publicSans.variable}`}>{children}</body>
      </html>
    </ClientWrapper>
  );
}
