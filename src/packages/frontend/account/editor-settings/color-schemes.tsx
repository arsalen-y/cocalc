/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: AGPLv3 s.t. "Commons Clause" – see LICENSE.md for details
 */

import { Map } from "immutable";
import { React } from "../../app-framework";
import { LabeledRow, SelectorInput } from "../../components";
import { CodeMirrorStatic } from "../../jupyter/codemirror-static";
import { cm_options } from "../../frame-editors/codemirror/cm-options";
import { Button } from "../../antd-bootstrap";
import { AsyncComponent } from "@cocalc/frontend/misc/async-component";

export const EDITOR_COLOR_SCHEMES: { [name: string]: string } = {
  default: "Default",
  "3024-day": "3024 day",
  "3024-night": "3024 night",
  abcdef: "abcdef",
  //'ambiance-mobile'         : 'Ambiance mobile'  # doesn't highlight python, confusing
  ambiance: "Ambiance",
  "base16-dark": "Base 16 dark",
  "base16-light": "Base 16 light",
  bespin: "Bespin",
  blackboard: "Blackboard",
  cobalt: "Cobalt",
  colorforth: "Colorforth",
  darcula: "Darcula",
  dracula: "Dracula",
  "duotone-dark": "Duotone Dark",
  "duotone-light": "Duotone Light",
  eclipse: "Eclipse",
  elegant: "Elegant",
  "erlang-dark": "Erlang dark",
  "gruvbox-dark": "Gruvbox-Dark",
  hopscotch: "Hopscotch",
  icecoder: "Icecoder",
  idea: "Idea", // this messes with the global hinter CSS!
  isotope: "Isotope",
  "lesser-dark": "Lesser dark",
  liquibyte: "Liquibyte",
  lucario: "Lucario",
  material: "Material",
  mbo: "mbo",
  "mdn-like": "MDN like",
  midnight: "Midnight",
  monokai: "Monokai",
  neat: "Neat",
  neo: "Neo",
  night: "Night",
  "oceanic-next": "Oceanic next",
  "panda-syntax": "Panda syntax",
  "paraiso-dark": "Paraiso dark",
  "paraiso-light": "Paraiso light",
  "pastel-on-dark": "Pastel on dark",
  railscasts: "Railscasts",
  rubyblue: "Rubyblue",
  seti: "Seti",
  shadowfox: "Shadowfox",
  "solarized dark": "Solarized dark",
  "solarized light": "Solarized light",
  ssms: "ssms",
  "the-matrix": "The Matrix",
  "tomorrow-night-bright": "Tomorrow Night - Bright",
  "tomorrow-night-eighties": "Tomorrow Night - Eighties",
  ttcn: "ttcn",
  twilight: "Twilight",
  "vibrant-ink": "Vibrant ink",
  "xq-dark": "Xq dark",
  "xq-light": "Xq light",
  yeti: "Yeti",
  zenburn: "Zenburn",
};

interface Props {
  theme: string;
  on_change: (selected: string) => void;
  editor_settings: Map<string, any>;
  font_size?: number;
}

export function EditorSettingsColorScheme(props: Props): JSX.Element {
  return (
    <div>
      <LabeledRow label="Editor color scheme">
        <Button
          disabled={props.theme == "default"}
          style={{ float: "right" }}
          onClick={() => {
            props.on_change("default");
          }}
        >
          Reset
        </Button>
        <SelectorInput
          style={{ width: "150px" }}
          options={EDITOR_COLOR_SCHEMES}
          selected={props.theme}
          on_change={props.on_change}
        />
      </LabeledRow>
      <CodeMirrorPreview
        editor_settings={props.editor_settings}
        font_size={props.font_size}
      />
    </div>
  );
}

const VALUE = `\
def is_prime_lucas_lehmer(p):
    """Test primality of Mersenne number 2**p - 1.
    >>> is_prime_lucas_lehmer(107)
    True
    """
    k = 2**p - 1; s = 4
    for i in range(3, p+1):
        s = (s*s - 2) % k
    return s == 0\
`;

// We make this async to avoid configuring codemirror as part of the initial
// bundle.  This probably doesn't work so well yet though.
const CodeMirrorPreview = AsyncComponent(async () => {
  await import("@cocalc/frontend/codemirror/init");
  return (props: { editor_settings: Map<string, any>; font_size?: number }) => {
    // Ensure that we load all the codemirror plugins, modes, etc., so that
    // we can show the codemirror preview of the current theme, fonts, etc.
    import("@cocalc/frontend/codemirror/init");
    const options = cm_options("a.py", props.editor_settings);
    options.lineNumbers = false;
    return (
      <CodeMirrorStatic
        options={options}
        value={VALUE}
        font_size={props.font_size}
      />
    );
  };
});
