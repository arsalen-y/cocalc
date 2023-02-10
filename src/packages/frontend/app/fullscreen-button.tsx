/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: AGPLv3 s.t. "Commons Clause" – see LICENSE.md for details
 */

import {
  CSS,
  React,
  useActions,
  useRedux,
} from "@cocalc/frontend/app-framework";
import { Icon, Tip } from "@cocalc/frontend/components";
import { COLORS } from "@cocalc/util/theme";
import { user_tracking } from "../user-tracking";
import {
  NAV_HEIGHT_PX,
  PageStyle,
  TOP_BAR_ELEMENT_CLASS,
} from "./top-nav-consts";

const TIP_STYLE: CSS = {
  position: "fixed",
  zIndex: 100,
  right: 0,
  top: 0,
} as const;

interface Props {
  pageStyle: PageStyle;
}

export const FullscreenButton: React.FC<Props> = React.memo((props: Props) => {
  const { pageStyle } = props;
  const { fontSizeIcons } = pageStyle;

  const fullscreen: undefined | "default" | "kiosk" | "project" = useRedux(
    "page",
    "fullscreen"
  );
  const page_actions = useActions("page");

  if (fullscreen == "kiosk" || fullscreen == "project") {
    // no button, since can't get out.
    return <></>;
  }

  const icon = fullscreen ? "compress" : "expand";
  const icon_style: CSS = {
    fontSize: fontSizeIcons,
    color: COLORS.GRAY,
    cursor: "pointer",
    ...(fullscreen
      ? {
          background: "white",
          opacity: 0.7,
          border: "1px solid grey",
        }
      : {
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: `${NAV_HEIGHT_PX}px`,
          width: `${NAV_HEIGHT_PX}px`,
        }),
  };

  return (
    <Tip
      style={TIP_STYLE}
      title={"Fullscreen mode, focused on the current document or page."}
      placement={"bottomRight"}
      delayShow={2000}
    >
      <Icon
        className={TOP_BAR_ELEMENT_CLASS}
        style={icon_style}
        name={icon}
        onClick={(_) => {
          user_tracking("top_nav", {
            name: "fullscreen",
            enabled: !fullscreen,
          });
          page_actions.toggle_fullscreen();
        }}
      />
    </Tip>
  );
});
