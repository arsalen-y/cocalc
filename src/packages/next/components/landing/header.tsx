import Link from "next/link";
import SquareLogo from "components/logo-square";
import A from "components/misc/A";
import { join } from "path";
import { Layout } from "antd";
import { useCustomize } from "lib/customize";
import basePath from "lib/base-path";
import SubNav, { Page, SubPage } from "./sub-nav";
import Analytics from "components/analytics";

const GAP = "32px";

const LinkStyle = {
  color: "white",
  marginRight: GAP,
  display: "inline-block",
};

const SelectedStyle = {
  ...LinkStyle,
  color: "#c7d9f5",
  fontWeight: "bold",
  borderBottom: "5px solid #c7d9f5",
};

interface Props {
  page?: Page;
  subPage?: SubPage;
}

export default function Header({ page, subPage }: Props) {
  const {
    anonymousSignup,
    siteName,
    termsOfServiceURL,
    shareServer,
    landingPages,
    account,
  } = useCustomize();
  if (basePath == null) return null;

  return (
    <>
      <Analytics />
      <Layout.Header
        style={{
          minHeight: "64px",
          height: "auto",
          lineHeight: "32px",
          padding: "16px",
          textAlign: "center",
        }}
      >
        <A href="/">
          {/* WARNING: This mess is all to support using the next/image component for the image via our Image component.  It's ugly. */}
          <div
            style={{
              position: "relative",
              display: "inline-block",
              height: "40px",
              width: "40px",
              marginTop: "-30px",
              marginRight: "64px",
            }}
          >
            <SquareLogo
              style={{
                height: "40px",
                width: "40px",
                position: "absolute",
                top: "15px",
              }}
            />
          </div>
        </A>
        {landingPages && (
          <>
            <A
              href="/features/"
              style={page == "features" ? SelectedStyle : LinkStyle}
            >
              Why CoCalc?
            </A>
            <A
              href="/software"
              style={page == "software" ? SelectedStyle : LinkStyle}
            >
              Software
            </A>
            <A
              href="/pricing"
              style={page == "pricing" ? SelectedStyle : LinkStyle}
            >
              Pricing
            </A>
            <A
              href="/policies"
              style={page == "policies" ? SelectedStyle : LinkStyle}
            >
              Policies
            </A>
          </>
        )}
        {shareServer && (
          <Link href={"/share/public_paths/page/1"}>
            <a
              style={page == "share" ? SelectedStyle : LinkStyle}
              title="View files that people have published."
            >
              Explore
            </a>
          </Link>
        )}
        {!landingPages && termsOfServiceURL && (
          <A
            style={LinkStyle}
            href={termsOfServiceURL}
            title="View the terms of service and other legal documents."
          >
            Legal
          </A>
        )}
        <A
          style={page == "info" ? SelectedStyle : LinkStyle}
          href="/info"
          title="Information and links to resources for learning more about CoCalc"
        >
          Info
        </A>
        {anonymousSignup && (
          <a
            style={LinkStyle}
            href={join(basePath, "static/app.html?anonymous=jupyter")}
            title={`Try ${siteName} immediately without creating an account.`}
          >
            Try {siteName}
          </a>
        )}{" "}
        <a
          style={LinkStyle}
          href={join(basePath, "static/app.html")}
          title={`Sign in to ${siteName} or create an account.`}
        >
          {account ? "Signed In" : "Sign In"}
        </a>
      </Layout.Header>
      {landingPages && page && <SubNav page={page} subPage={subPage} />}
    </>
  );
}
