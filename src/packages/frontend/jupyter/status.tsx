/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: AGPLv3 s.t. "Commons Clause" – see LICENSE.md for details
 */

// Kernel display

import {
  Button,
  Popconfirm,
  Popover,
  Progress,
  Tooltip,
  Typography,
} from "antd";
import * as immutable from "immutable";
import { ReactNode, useEffect } from "react";

import { CSS, React, useRedux } from "@cocalc/frontend/app-framework";
import { A, Icon, IconName, Loading } from "@cocalc/frontend/components";
import { IS_MOBILE } from "@cocalc/frontend/feature";
import { capitalize, closest_kernel_match, rpad_html } from "@cocalc/util/misc";
import { COLORS } from "@cocalc/util/theme";
import { PROJECT_INFO_TITLE } from "../project/info";
import { JupyterActions } from "./browser-actions";
import Logo from "./logo";
import { Mode } from "./mode";
import { AlertLevel, BackendState, NotebookMode, Usage } from "@cocalc/jupyter/types";
import { ALERT_COLS } from "./usage";
import ProgressEstimate from "../components/progress-estimate";
import { HiddenXS } from "@cocalc/frontend/components/hidden-visible";

const KERNEL_STYLE: CSS = {
  float: "right",
  paddingLeft: "5px",
  backgroundColor: COLORS.GRAY_LLL,
  overflow: "hidden",
  whiteSpace: "nowrap",
  margin: "7px 5px 0px 0px",
  position: "relative",
  zIndex: 1,
  cursor: "pointer",
} as const;

const KERNEL_NAME_STYLE: CSS = {
  margin: "0px 5px",
  display: "block",
  color: COLORS.BS_BLUE_TEXT,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
} as const;

const KERNEL_USAGE_STYLE: CSS = {
  margin: "0px 5px",
  color: COLORS.GRAY,
  borderRight: `1px solid ${COLORS.GRAY}`,
  paddingRight: "5px",
} as const;

const KERNEL_USAGE_STYLE_SMALL: CSS = {
  height: "5px",
  marginBottom: "4px",
  width: "5em",
} as const;

const KERNEL_USAGE_STYLE_NUM: CSS = {
  fontFamily: "monospace",
} as const;

const KERNEL_ERROR_STYLE: CSS = {
  margin: "5px",
  color: "white",
  padding: "5px",
  backgroundColor: COLORS.ATND_BG_RED_M,
} as const;

const BACKEND_STATE_STYLE: CSS = {
  display: "flex",
  marginRight: "5px",
  color: KERNEL_NAME_STYLE.color,
  paddingTop: "2.5px",
} as const;

const BACKEND_STATE_HUMAN = {
  init: "Initializing",
  ready: "Ready to start",
  starting: "Starting",
  running: "Running",
} as const;

interface KernelProps {
  actions: JupyterActions;
  is_fullscreen?: boolean;
  usage?: Usage;
  expected_cell_runtime?: number;
  mode?: NotebookMode;
  style?: CSS;
}

export const Kernel: React.FC<KernelProps> = React.memo(
  (props: KernelProps) => {
    const {
      actions,
      expected_cell_runtime,
      is_fullscreen,
      mode,
      style,
      usage,
    } = props;
    const name = actions.name;

    // redux section
    const trust: undefined | boolean = useRedux([name, "trust"]);
    const read_only: undefined | boolean = useRedux([name, "read_only"]);
    const redux_kernel = useRedux([name, "kernel"]);
    const no_kernel = redux_kernel === "";
    // no redux_kernel or empty string (!) means there is no kernel
    const kernel: string | null = !redux_kernel ? null : redux_kernel;
    const kernels: undefined | immutable.List<any> = useRedux([
      name,
      "kernels",
    ]);
    const project_id: string = useRedux([name, "project_id"]);
    const kernel_info: undefined | immutable.Map<string, any> = useRedux([
      name,
      "kernel_info",
    ]);
    const backend_state: undefined | BackendState = useRedux([
      name,
      "backend_state",
    ]);
    const kernel_state: undefined | string = useRedux([name, "kernel_state"]);

    const backendIsStarting =
      backend_state === "starting" || backend_state === "spawning";

    const [isSpwarning, setIsSpawarning] = React.useState(false);
    useEffect(() => {
      if (isSpwarning && !backendIsStarting) {
        setIsSpawarning(false);
      } else if (!isSpwarning && backendIsStarting) {
        setIsSpawarning(true);
      }
    }, [backend_state]);

    // render functions start there

    // wrap "Logo" component
    function render_logo() {
      if (project_id == null) {
        return;
      }
      return (
        <HiddenXS>
          <div style={{ display: "flex" }} className="pull-right">
            <Logo kernel={kernel} kernel_info_known={kernel_info != null} />
          </div>
        </HiddenXS>
      );
    }

    // this renders the name of the kernel, if known, or a button to change to a similar but known one
    function render_name() {
      let display_name = kernel_info?.get("display_name");
      if (display_name == null && kernel != null && kernels != null) {
        // Definitely an unknown kernel
        const closestKernel = closest_kernel_match(
          kernel,
          kernels as any // TODO
        );
        if (closestKernel == null) {
          return <span style={KERNEL_ERROR_STYLE}>Unknown kernel</span>;
        } else {
          const closestKernelDisplayName = closestKernel.get("display_name");
          const closestKernelName = closestKernel.get("name") as string;
          return (
            <span
              style={KERNEL_ERROR_STYLE}
              onClick={() => actions.set_kernel(closestKernelName)}
            >
              Unknown kernel{" "}
              <span style={{ fontWeight: "bold" }}>{kernel}</span>, click here
              to use {closestKernelDisplayName} instead.
            </span>
          );
        }
      } else {
        // List of known kernels just not loaded yet.
        if (display_name == null) {
          display_name = kernel ?? "No Kernel";
        }
        const style = { ...KERNEL_NAME_STYLE, maxWidth: "10em" };
        return (
          <div
            style={style}
            onClick={() => actions.show_select_kernel("user request")}
          >
            {display_name}
          </div>
        );
      }
    }

    // at the very right, an icon to indicate at a quick glance if the kernel is active or not
    function render_backend_state_icon() {
      if (read_only) {
        return;
      }
      if (backend_state == null) {
        return <Loading />;
      }
      /*
      The backend_states are:
         'init' --> 'ready'  --> 'spawning' --> 'starting' --> 'running'

      When the backend_state is 'running', then the kernel_state is either
          'idle' or 'running'
      */
      let spin = false;
      let name: IconName | undefined;
      let color: string | undefined;
      switch (backend_state) {
        case "init":
          name = "unlink";
          break;
        case "ready": // ready to start but NOT running
          name = "stop";
          break;
        case "spawning":
        case "starting":
          name = "cocalc-ring";
          spin = true;
          break;
        case "running":
          switch (kernel_state) {
            case "busy":
              name = "circle";
              color = "#5cb85c";
              break;
            case "idle":
              name = "cocalc-ring";
              break;
            default:
              name = "cocalc-ring";
          }
          break;
      }

      return (
        <div style={BACKEND_STATE_STYLE}>
          <Icon name={name} spin={spin} style={{ color }} />
        </div>
      );
    }

    function render_trust() {
      if (trust) {
        if (!is_fullscreen) return;
        return (
          <div
            style={{
              display: "flex",
              color: COLORS.GRAY,
              paddingRight: "5px",
              borderRight: "1px solid gray",
            }}
          >
            Trusted
          </div>
        );
      } else {
        return (
          <div
            style={{
              paddingRight: "5px",
              borderRight: "1px solid gray",
            }}
          >
            <Tooltip title={"Notebook is not trusted"}>
              <Button
                danger
                onClick={() => actions.trust_notebook()}
                size="small"
              >
                Not Trusted
              </Button>
            </Tooltip>
          </div>
        );
      }
    }

    function kernelState(): ReactNode {
      if (kernel === null) {
        return (
          <>
            No kernel{" "}
            <Tooltip title={"Select a kernel"}>
              <a
                onClick={() => {
                  actions.show_select_kernel("user request");
                }}
              >
                (select...)
              </a>
            </Tooltip>
          </>
        );
      }

      if (backend_state === "running") {
        switch (kernel_state) {
          case "busy":
            return (
              <>
                Kernel is busy{" "}
                <Tooltip title={"Interrupt the running computation"}>
                  <a
                    onClick={() => {
                      // using actions rather than frame actions, since I want
                      // this to work in places other than Jupyter notebooks.
                      actions.signal("SIGINT");
                    }}
                  >
                    (interrupt)
                  </a>
                </Tooltip>
              </>
            );
          case "idle":
            return (
              <>
                Kernel is idle{" "}
                <Popconfirm
                  title={
                    "Terminal the kernel process? All variable state will be lost."
                  }
                  onConfirm={() => {
                    actions.shutdown();
                  }}
                  okText={"Halt"}
                  cancelText={"Cancel"}
                >
                  <Tooltip title={"Terminate the kernel process"}>
                    <a>(halt...)</a>
                  </Tooltip>
                </Popconfirm>
              </>
            );
        }
      } else if (backendIsStarting) {
        return "Kernel is starting";
      }
      return "Kernel will start when you run code";
    }

    function get_kernel_name(): JSX.Element {
      if (kernel_info != null) {
        const name = kernel_info.get(
          "display_name",
          kernel_info.get("name", "No Kernel")
        );
        return <div>Kernel: {name}</div>;
      } else {
        return <span />;
      }
    }

    function renderKernelState() {
      if (!backend_state) return <div></div>;
      return (
        <div
          className="pull-right"
          style={{
            float: "right",
            display: "inline-block",
            paddingRight: "5px",
            marginRight: "5px",
            color: COLORS.GRAY,
            borderRight: "1px solid grey",
            position: "relative",
            zIndex: 1,
          }}
        >
          {kernelState()}
        </div>
      );
    }

    // a popover information, containin more in depth details about the kernel
    function render_tip(title: any, body: any) {
      const backend_tip =
        backend_state == null ? (
          ""
        ) : (
          <>
            Backend is {BACKEND_STATE_HUMAN[backend_state] ?? backend_state}.
            <br />
          </>
        );
      const kernel_tip = kernelState();

      const usage_tip = (
        <>
          <p>
            This shows this kernel's resource usage. The memory limit is
            determined by the remaining "free" memory of this project. Open the
            "{PROJECT_INFO_TITLE}" tab see all activities of this project.
          </p>
          <p>
            <Typography.Text type="secondary">
              Keep in mind that "shared memory" could compete with other
              projects on the same machine and hence you might not be able to
              fully attain it.
            </Typography.Text>
          </p>
          <p>
            <Typography.Text type="secondary">
              You can clear all cpu and memory usage by{" "}
              <em>restarting your kernel</em>. Learn more about{" "}
              <A href={"https://doc.cocalc.com/howto/low-memory.html"}>
                Low Memory
              </A>{" "}
              mitigations.
            </Typography.Text>
          </p>
        </>
      );

      const description = kernel_info?.getIn([
        "metadata",
        "cocalc",
        "description",
      ]);
      const language = capitalize(kernel_info?.get("language", "Unknown"));
      const langTxt = `${language}${description ? ` (${description})` : ""}`;
      const langURL = kernel_info?.getIn(["metadata", "cocalc", "url"]) as string|undefined;
      const lang = (
        <>
          Language:{" "}
          {langURL != null ? <A href={langURL}>{langTxt}</A> : langTxt}
          <br />
        </>
      );

      const tip = (
        <span>
          {lang}
          {backend_tip}
          {kernel_tip}
          <hr />
          {render_usage_text()}
          {usage_tip}
        </span>
      );
      return (
        <Popover
          mouseEnterDelay={1}
          title={title}
          content={<div style={{ maxWidth: "400px" }}>{tip}</div>}
          placement={"bottom"}
        >
          {body}
        </Popover>
      );
    }

    // show progress bar indicators for memory usage and the progress of the current cell (expected time)
    // if not fullscreen, i.e. smaller, pack this into two small bars.
    // the main use case is to communicate to the user if there is a cell that takes extraordinarily long to run,
    // or if the memory usage is eating up almost all of the reminining (shared) memory.

    function render_usage_graphical() {
      if (kernel == null) return;

      const style: CSS = is_fullscreen
        ? { display: "flex" }
        : {
            display: "flex",
            flexFlow: "column",
            marginTop: "-6px",
          };
      const pstyle: CSS = {
        margin: "2px",
        width: "5em",
        position: "relative",
        top: "-1px",
      };
      const usage_style: CSS = is_fullscreen
        ? KERNEL_USAGE_STYLE
        : KERNEL_USAGE_STYLE_SMALL;

      if (isSpwarning) {
        // we massively overestimate: 15s for python and co, and 30s for sage and julia
        const s =
          kernel.startsWith("sage") || kernel.startsWith("julia") ? 30 : 15;
        return (
          <div style={{ ...usage_style, display: "flex" }}>
            <ProgressEstimate
              style={{ ...pstyle, width: "175px", top: "-3px" }}
              seconds={s}
            />
          </div>
        );
      }

      // unknown, e.g, not reporting/working or old backend.
      if (usage == null || expected_cell_runtime == null) return;

      // const status = usage.cpu > 50 ? "active" : undefined
      // const status = usage.cpu_runtime != null ? "active" : undefined;
      // **WARNING**: Including the status icon (which is computed above,
      // and done via status={status} for cpu below), leads to a MASSIVE
      // RENDERING BUG, where the cpu burns at like 50% anytime a Jupyter
      // notebook is being displayed. See
      //      https://github.com/sagemathinc/cocalc/issues/5185
      // we calibrate "100%" at the median – color changes at 2 x timings_q
      const cpu_val = Math.min(
        100,
        100 * (usage.cpu_runtime / expected_cell_runtime)
      );

      return (
        <div style={style}>
          <span style={usage_style}>
            {is_fullscreen && "CPU "}
            <Progress
              style={pstyle}
              showInfo={false}
              percent={cpu_val}
              size="small"
              trailColor="white"
              strokeColor={ALERT_COLS[usage.time_alert]}
            />
          </span>
          <span style={usage_style}>
            {is_fullscreen && "Memory "}
            <Progress
              style={pstyle}
              showInfo={false}
              percent={usage.mem_pct}
              size="small"
              trailColor="white"
              strokeColor={ALERT_COLS[usage.mem_alert]}
            />
          </span>
        </div>
      );
    }

    // helper for render_usage_text
    function usage_text_style_level(level: AlertLevel) {
      // ATTN for text, the high background color is different, with white text
      const style = KERNEL_USAGE_STYLE_NUM;
      switch (level) {
        case "low":
          return { ...style, backgroundColor: ALERT_COLS.low };
        case "mid":
          return { ...style, backgroundColor: ALERT_COLS.mid };
        case "high":
          return {
            ...style,
            backgroundColor: ALERT_COLS.high,
            color: "white",
          };
        case "none":
        default:
          return style;
      }
    }

    // this ends up in the popover tip. it contains the actual values and the same color coded usage levels
    function render_usage_text() {
      if (usage == null) return;
      const cpu_style = usage_text_style_level(usage.cpu_alert);
      const memory_style = usage_text_style_level(usage.mem_alert);
      const time_style = usage_text_style_level(usage.time_alert);
      const { cpu, mem, mem_pct } = usage;
      const cpu_disp = `${rpad_html(cpu, 3)}%`;
      const mem_disp = `${rpad_html(mem, 4)}MB`;
      const round = (val) => val.toFixed(1);
      const time_disp = `${rpad_html(usage.cpu_runtime, 5, round)}s`;
      const mem_pct_disp = `${rpad_html(mem_pct, 3)}%`;
      const style: CSS = { whiteSpace: "nowrap" };
      return (
        <p style={style}>
          <span>
            CPU{" "}
            <span
              className={"cocalc-jupyter-usage-info"}
              style={cpu_style}
              dangerouslySetInnerHTML={{ __html: cpu_disp }}
            />
          </span>
          <span>
            Time:{" "}
            <span
              className={"cocalc-jupyter-usage-info"}
              style={time_style}
              dangerouslySetInnerHTML={{ __html: time_disp }}
            />
          </span>
          <span>
            Memory{" "}
            <span
              className={"cocalc-jupyter-usage-info"}
              style={memory_style}
              dangerouslySetInnerHTML={{ __html: mem_disp }}
            />
            <span
              className={"cocalc-jupyter-usage-info"}
              style={memory_style}
              dangerouslySetInnerHTML={{ __html: mem_pct_disp }}
            />
          </span>
        </p>
      );
    }

    function renderMode() {
      if (mode == null) return;
      return <Mode mode={mode} />;
    }

    if (!no_kernel && kernel == null) {
      return null;
    }

    if (IS_MOBILE) {
      return renderKernelState();
    }

    const info = (
      <div
        style={{
          display: "flex",
          flex: "1 0",
          flexDirection: "row",
          flexWrap: "nowrap",
        }}
      >
        {render_usage_graphical()}
        {render_trust()}
        {render_name()}
        {render_backend_state_icon()}
      </div>
    );

    const body = (
      <div
        className="pull-right"
        style={{
          color: COLORS.GRAY,
          cursor: "pointer",
        }}
      >
        {info}
      </div>
    );

    return (
      <div style={{ ...KERNEL_STYLE, ...style }}>
        {render_logo()}
        {render_tip(get_kernel_name(), body)}
        {renderKernelState()}
        {renderMode()}
      </div>
    );
  }
);
