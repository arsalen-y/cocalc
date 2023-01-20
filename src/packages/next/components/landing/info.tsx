/*
 *  This file is part of CoCalc: Copyright © 2021 Sagemath, Inc.
 *  License: AGPLv3 s.t. "Commons Clause" – see LICENSE.md for details
 */

import { Col, Row } from "antd";
import { CSSProperties, ReactNode } from "react";

import { Icon, IconName } from "@cocalc/frontend/components/icon";
import { COLORS } from "@cocalc/util/theme";
import { Paragraph, Title } from "components/misc";
import { MAX_WIDTH } from "lib/config";
import Image, { StaticImageData } from "./image";
import { MediaURL } from "./util";

const showcase: CSSProperties = {
  width: "100%",
  boxShadow: "2px 2px 4px rgb(0 0 0 / 25%), 0 2px 4px rgb(0 0 0 / 22%)",
  borderRadius: "3px",
} as const;

interface Props {
  alt: string;
  anchor: string;
  below?: ReactNode;
  caption?: ReactNode;
  children: ReactNode;
  icon?: IconName;
  image?: string | StaticImageData;
  style?: CSSProperties;
  swapCols?: boolean; // if true, then put text on left and image on right.
  textStyleExtra?: CSSProperties;
  title: ReactNode;
  video?: string | string[];
  wide?: boolean; // if given image is wide and could use more space or its very hard to see.
}

export default function Info(props: Props) {
  const {
    alt,
    anchor,
    below,
    caption,
    children,
    icon,
    image,
    style,
    swapCols,
    textStyleExtra,
    title,
    video,
    wide,
  } = props;

  const head = (
    <Title
      level={1}
      id={anchor}
      style={{
        textAlign: "center",
        marginBottom: "30px",
        color: COLORS.GRAY_D,
      }}
    >
      {icon && (
        <span style={{ fontSize: "24pt", marginRight: "5px" }}>
          <Icon name={icon} />{" "}
        </span>
      )}
      {title}
    </Title>
  );

  let graphic: ReactNode = null;

  if (image != null) {
    graphic = <Image style={showcase} src={image} alt={alt ?? caption} />;
  } else if (video != null) {
    const videoSrcs = typeof video == "string" ? [video] : video;
    verifyHasMp4(videoSrcs);
    graphic = (
      <div style={{ position: "relative", width: "100%" }}>
        <video style={showcase} loop controls>
          {sources(videoSrcs)}
        </video>
      </div>
    );
  }

  if (graphic != null && caption != null) {
    graphic = (
      <div>
        {graphic}
        <br />
        <br />
        <Paragraph
          style={{
            textAlign: "center",
            color: COLORS.GRAY_D,
          }}
        >
          {caption}
        </Paragraph>
      </div>
    );
  }

  if (!graphic) {
    const noGraphicTextStyle: CSSProperties = {
      background: "#fafafa",
      padding: "20px",
      marginBottom: "15px",
    };

    if (textStyleExtra != null) {
      // if textColStyleExtra is given, then merge it into noGraphicTextStyle.
      Object.assign(noGraphicTextStyle, textStyleExtra);
    }

    return (
      <div style={{ width: "100%", ...style }}>
        <div style={{ maxWidth: MAX_WIDTH, margin: "0 auto" }}>
          <div style={noGraphicTextStyle}>
            <div style={{ textAlign: "center" }}>{head}</div>
            <div
              style={{ margin: "auto", maxWidth: wide ? "600px" : undefined }}
            >
              {children}
            </div>
            {below && <div style={{ marginTop: "20px" }}>{below}</div>}
          </div>
        </div>
      </div>
    );
  }

  const textColStyle: CSSProperties = {
    padding: "0 20px 0 20px",
    marginBottom: "15px",
    display: "flex",
    justifyContent: "start",
    alignContent: "start",
    flexDirection: "column",
  };

  if (textStyleExtra != null) {
    // if textColStyleExtra is given, then merge it into textColStyle.
    Object.assign(textColStyle, textStyleExtra);
  }

  const textCol = (
    <Col key="text" lg={wide ? 7 : 9} style={textColStyle}>
      {children}
    </Col>
  );
  const graphicCol = (
    <Col
      key="graphics"
      lg={wide ? 17 : 15}
      style={{ padding: "0 30px 15px 30px", width: "100%" }}
    >
      {graphic}
    </Col>
  );

  const cols = swapCols ? [textCol, graphicCol] : [graphicCol, textCol];

  return (
    <div
      style={{
        padding: "40px 5%",
        background: "white",
        fontSize: "11pt",
        ...style,
      }}
    >
      <>
        {head}
        <Row>
          {cols}
          {below && (
            <Col
              lg={{ span: 16, offset: 4 }}
              md={{ span: 18, offset: 3 }}
              style={{ paddingTop: "30px" }}
            >
              {below}
            </Col>
          )}
        </Row>
      </>
    </div>
  );
}

function sources(video: string[]) {
  const v: JSX.Element[] = [];
  for (const x of video) {
    v.push(<source key={x} src={MediaURL(x)} />);
  }
  return v;
}

function verifyHasMp4(video: string[]) {
  for (const x of video) {
    if (x.endsWith(".mp4")) {
      return;
    }
  }
  console.warn(
    "include mp4 format for the video, so that it is viewable on iOS!!",
    video
  );
}

interface HeadingProps {
  children: ReactNode;
  description?: ReactNode;
  style?: CSSProperties;
}

Info.Heading = ({ children, description, style }: HeadingProps) => {
  return (
    <div
      style={{
        ...{
          textAlign: "center",
          margin: "0",
          padding: "20px",
          borderTop: `1px solid ${COLORS.GRAY_L}`,
        },
        ...style,
      }}
    >
      <Title
        level={1}
        style={{
          fontSize: "400%",
          color: "#444",
        }}
      >
        {children}
      </Title>
      <Paragraph style={{ fontSize: "13pt", color: COLORS.GRAY_D }}>
        {description}
      </Paragraph>
    </div>
  );
};
