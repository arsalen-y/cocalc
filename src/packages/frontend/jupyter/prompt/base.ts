import type { JupyterActions } from "../browser-actions";
import type { NotebookFrameActions } from "@cocalc/frontend/frame-editors/jupyter-editor/cell-notebook/actions";

export const PROMPT_MIN_WIDTH = "7em";

export const INPUT_PROMPT_COLOR: string = "#303F9F";

export const INPUT_STYLE: React.CSSProperties = {
  color: INPUT_PROMPT_COLOR,
  minWidth: PROMPT_MIN_WIDTH,
  fontFamily: "monospace",
  textAlign: "right",
  paddingRight: "5px",
};

export interface InputPromptProps {
  type?: string;
  state?: string;
  exec_count?: number;
  kernel?: string;
  start?: number;
  end?: number;
  actions?: JupyterActions;
  frame_actions?: NotebookFrameActions;
  id?: string;
}

export const OUTPUT_STYLE: React.CSSProperties = {
  color: "#D84315",
  minWidth: PROMPT_MIN_WIDTH,
  fontFamily: "monospace",
  textAlign: "right",
  paddingRight: "5px",
  paddingBottom: "2px",
};

export interface OutputPromptProps {
  state?: string;
  exec_count?: number;
  collapsed?: boolean;
}
