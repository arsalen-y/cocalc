import { CSSProperties } from "react";

const misc = require("smc-util/misc");
const { types } = misc;

export const entry_style: CSSProperties = {
};

export const selected_entry: CSSProperties = {
  border: "1px solid #aaa",
  boxShadow: "5px 5px 5px #999",
  borderRadius: "5px",
  marginBottom: "10px",
  paddingTop: "0px",
  paddingBottom: "5px"
};

export const note: CSSProperties = {
  borderTop: "3px solid #aaa",
  marginTop: "10px",
  paddingTop: "5px"
};

export function show_hide_deleted(opts): CSSProperties {
  types(opts, { needs_margin: types.bool.isRequired });

  return {
    marginTop: opts.needs_margin ? "15px" : "0px",
    float: "right"
  };
}
