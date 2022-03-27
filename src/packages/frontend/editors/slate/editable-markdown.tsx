/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: AGPLv3 s.t. "Commons Clause" – see LICENSE.md for details
 */

// Component that allows WYSIWYG editing of markdown.

const EXPENSIVE_DEBUG = false;
// const EXPENSIVE_DEBUG = (window as any).cc != null && true; // EXTRA SLOW -- turn off before release!

import { MutableRefObject, RefObject } from "react";
import { Map } from "immutable";
import { useFrameContext } from "@cocalc/frontend/frame-editors/frame-tree/frame-context";
import { EditorState } from "@cocalc/frontend/frame-editors/frame-tree/types";
import { createEditor, Descendant, Editor, Transforms } from "slate";
import { withNonfatalRange } from "./patches";
import { Slate, ReactEditor, Editable, withReact } from "./slate-react";
import { debounce, isEqual } from "lodash";
import {
  CSS,
  React,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useIsMountedRef,
} from "@cocalc/frontend/app-framework";
import { Actions } from "./types";
import { Path } from "@cocalc/frontend/frame-editors/frame-tree/path";
import { slate_to_markdown } from "./slate-to-markdown";
import { markdown_to_slate } from "./markdown-to-slate";
import { Element } from "./element";
import Leaf from "./leaf-with-cursor";
import { withAutoFormat } from "./format";
import { withNormalize } from "./normalize";
import { withInsertBreakHack } from "./elements/link/editable";
import { estimateSize } from "./elements";
import { getHandler as getKeyboardHandler } from "./keyboard";
import { withIsInline, withIsVoid } from "./plugins";
import useUpload from "./upload";

import { slateDiff } from "./slate-diff";
import { applyOperations } from "./operations";
import { slatePointToMarkdownPosition } from "./sync";

import { useMentions } from "./slate-mentions";
import { mentionableUsers } from "@cocalc/frontend/editors/markdown-input/mentionable-users";
import { createMention } from "./elements/mention/editable";
import { submit_mentions } from "@cocalc/frontend/editors/markdown-input/mentions";

import { useSearch, SearchHook } from "./search";
import { EditBar, useLinkURL, useListProperties, useMarks } from "./edit-bar";

import { useBroadcastCursors, useCursorDecorate } from "./cursors";
import { resetSelection } from "./control";

import { markdown_to_html } from "@cocalc/frontend/markdown";

import { SAVE_DEBOUNCE_MS } from "@cocalc/frontend/frame-editors/code-editor/const";
//const SAVE_DEBOUNCE_MS = 300;

import { delay } from "awaiting";

import { EditorFunctions } from "@cocalc/frontend/editors/markdown-input/multimode";

import type { SlateEditor } from "./types";
export type { SlateEditor };

// Whether or not to use windowing (=only rendering visible elements).
// I'm going to disable this by default (for production
// releases), but re-enable it frequently for development.
// There are a LOT of missing features when using windowing,
// including subtle issues with selection, scroll state, etc.
// IMPORTANT: Do not set this to false unless you want to make
// slate editing **basically unusable** at scale beyond a few pages!!
// This is the default and the component can be explicitly created
// with a windowing disabled.
const USE_WINDOWING = true;
// const USE_WINDOWING = false;

// Why window?  Unfortunately, due to how slate is designed, actually editing
// text is "unusable" for even medium size documents
// without using windowing. E.g., with say 200 top level blocks,
// just trying to enter random characters quickly on a superfast laptop
// shows nothing until you pause for a moment.  Totally unacceptable.
// This is for lots of reasons, including things like decorations being
// recomputed, caching not really working, DOM being expensive.
// Even click-dragging and selecting a range breaks often due to
// things being slow.
// In contrast, with windowing, everything is **buttery smooth**.

const STYLE = {
  width: "100%",
  overflow: "auto",
} as CSS;

interface Props {
  value?: string;
  placeholder?: string;
  actions?: Actions;
  read_only?: boolean;
  font_size?: number;
  id?: string;
  reload_images?: boolean; // I think this is used only to trigger an update
  is_current?: boolean;
  is_fullscreen?: boolean;
  editor_state?: EditorState;
  cursors?: Map<string, any>;
  hidePath?: boolean;
  disableWindowing?: boolean;
  style?: CSS;
  pageStyle?: CSS;
  editBarStyle?: CSS;
  onFocus?: () => void;
  onBlur?: () => void;
  autoFocus?: boolean;
  hideSearch?: boolean;
  saveDebounceMs?: number;
  noVfill?: boolean;
  divRef?: RefObject<HTMLDivElement>;
  selectionRef?: MutableRefObject<{
    setSelection: Function;
    getSelection: Function;
  } | null>;
  height?: string; // css style or if "auto", then editor will grow to size of content instead of scrolling.
  onCursorTop?: () => void;
  onCursorBottom?: () => void;
  isFocused?: boolean;
  registerEditor?: (editor: EditorFunctions) => void;
  unregisterEditor?: () => void;
}

export const EditableMarkdown: React.FC<Props> = React.memo(
  ({
    actions: actions0,
    id: id0,
    read_only,
    value,
    placeholder,
    font_size: font_size0,
    is_current,
    is_fullscreen,
    editor_state,
    cursors,
    hidePath,
    disableWindowing = !USE_WINDOWING,
    style,
    pageStyle,
    editBarStyle,
    onFocus,
    onBlur,
    autoFocus,
    hideSearch,
    saveDebounceMs,
    noVfill,
    divRef,
    selectionRef,
    height,
    onCursorTop,
    onCursorBottom,
    isFocused,
    registerEditor,
    unregisterEditor,
  }) => {
    const { project_id, path, desc } = useFrameContext();
    const isMountedRef = useIsMountedRef();
    const id = id0 ?? "";
    const actions = actions0 ?? {};
    const font_size = font_size0 ?? desc.get("font_size") ?? 14; // so possible to use without specifying this.  TODO: should be from account settings

    const editor = useMemo(() => {
      const cur = actions.getSlateEditor?.(id);
      if (cur != null) return cur;
      const ed = withNonfatalRange(
        withInsertBreakHack(
          withNormalize(
            withAutoFormat(withIsInline(withIsVoid(withReact(createEditor()))))
          )
        )
      ) as SlateEditor;
      actions.registerSlateEditor?.(id, ed);

      ed.getSourceValue = (fragment?) => {
        return fragment ? slate_to_markdown(fragment) : ed.getMarkdownValue();
      };

      // hasUnsavedChanges is true if the children changed
      // since last time resetHasUnsavedChanges() was called.
      ed._hasUnsavedChanges = false;
      ed.resetHasUnsavedChanges = () => {
        delete ed.markdownValue;
        ed._hasUnsavedChanges = ed.children;
      };
      ed.hasUnsavedChanges = () => {
        if (ed._hasUnsavedChanges === false) {
          // initially no unsaved changes
          return false;
        }
        return ed._hasUnsavedChanges !== ed.children;
      };

      ed.getMarkdownValue = () => {
        if (ed.markdownValue != null && !ed.hasUnsavedChanges()) {
          return ed.markdownValue;
        }
        ed.markdownValue = slate_to_markdown(ed.children, {
          cache: ed.syncCache,
        });
        return ed.markdownValue;
      };

      ed.getPlainValue = (fragment?) => {
        const markdown = ed.getSourceValue(fragment);
        return $("<div>" + markdown_to_html(markdown) + "</div>").text();
      };

      ed.saveValue = (force?) => {
        if (!force && !editor.hasUnsavedChanges()) {
          return;
        }
        setSyncstringFromSlate();
        actions.ensure_syncstring_is_saved?.();
      };

      ed.syncCache = {};
      if (selectionRef != null) {
        selectionRef.current = {
          setSelection: (selection: any) => {
            if (!selection) return;
            // We confirm that the selection is valid.
            // If not, this will throw an error.
            const { anchor, focus } = selection;
            Editor.node(editor, anchor);
            Editor.node(editor, focus);
            ed.selection = selection;
          },
          getSelection: () => {
            return ed.selection;
          },
        };
      }

      ed.onCursorBottom = onCursorBottom;
      ed.onCursorTop = onCursorTop;

      if (actions._syncstring != null) {
        actions._syncstring.on("before-change", () => {
          setSyncstringFromSlate();
        });
        actions._syncstring.on("change", () => {
          setEditorToValue(actions._syncstring.to_str());
        });
      }

      return ed as SlateEditor;
    }, []);

    useEffect(() => {
      if (registerEditor != null) {
        registerEditor({
          set_cursor: ({ y }) => {
            // This is used for navigating in Jupyter.  Of course cursors
            // or NOT given by x,y positions in Slate, so we have to interpret
            // this as follows, since that's what is used by our Jupyter actions.
            //    y = 0: top of document
            //    y = -1: bottom of document
            let path;
            if (y == 0) {
              // top of doc
              path = [0, 0];
            } else if (y == -1) {
              // bottom of doc
              path = [editor.children.length - 1, 0];
            } else {
              return;
            }
            const focus = { path, offset: 0 };
            Transforms.setSelection(editor, {
              focus,
              anchor: focus,
            });
          },
        });

        return unregisterEditor;
      }
    }, [registerEditor, unregisterEditor]);

    useEffect(() => {
      if (isFocused == null) return;
      if (ReactEditor.isFocused(editor) != isFocused) {
        if (isFocused) {
          ReactEditor.focus(editor);
        } else {
          ReactEditor.blur(editor);
        }
      }
    }, [isFocused]);

    const [editorValue, setEditorValue] = useState<Descendant[]>(() =>
      markdown_to_slate(value ?? "", false, editor.syncCache)
    );

    const rowSizeEstimator = useCallback((node) => {
      return estimateSize({ node, fontSize: font_size });
    }, []);

    const mentions = useMentions({
      editor,
      insertMention: (editor, account_id) => {
        Transforms.insertNodes(editor, [
          createMention(account_id),
          { text: " " },
        ]);
        submit_mentions(project_id, path, [{ account_id, description: "" }]);
      },
      matchingUsers: (search) => mentionableUsers(project_id, search),
    });

    const search: SearchHook = useSearch({ editor });

    const { marks, updateMarks } = useMarks(editor);

    const { linkURL, updateLinkURL } = useLinkURL(editor);

    const { listProperties, updateListProperties } = useListProperties(editor);

    const updateScrollState = useMemo(
      () =>
        debounce(() => {
          if (actions.save_editor_state == null) return;
          const scroll = scrollRef.current?.scrollTop;
          if (scroll != null) {
            actions.save_editor_state(id, { scroll });
          }
        }, 500),
      []
    );

    const updateWindowedScrollState = useMemo(
      () =>
        debounce(() => {
          if (disableWindowing || actions.save_editor_state == null) return;
          const scroll =
            editor.windowedListRef.current?.renderInfo?.visibleStartIndex;
          if (scroll != null) {
            actions.save_editor_state(id, { scroll });
          }
        }, 500),
      []
    );

    const broadcastCursors = useBroadcastCursors({
      editor,
      broadcastCursors: (x) => actions.set_cursor_locs?.(x),
    });

    const cursorDecorate = useCursorDecorate({
      editor,
      cursors,
      value: value ?? "",
      search,
    });

    const scrollRef = useRef<HTMLDivElement | null>(null);
    const didRestoreRef = useRef<boolean>(false);
    const restoreScroll = async () => {
      if (didRestoreRef.current) return; // so we only ever do this once.
      didRestoreRef.current = true;

      const scroll = editor_state?.get("scroll");
      if (scroll == null) return;

      // First test for windowing support
      if (!disableWindowing) {
        await new Promise(requestAnimationFrame);
        // Standard embarassing hacks due to waiting to load and measure cells...
        editor.windowedListRef.current?.scrollToItem(scroll, "start");
        await delay(10);
        editor.windowedListRef.current?.scrollToItem(scroll, "start");
        await delay(500);
        editor.windowedListRef.current?.scrollToItem(scroll, "start");
        return;
      }

      // No windowing
      if (scrollRef.current == null) {
        return;
      }
      const elt = $(scrollRef.current);
      // wait until render happens
      await new Promise(requestAnimationFrame);
      elt.scrollTop(scroll);
      await delay(0);
      // do any scrolling after image loads
      elt.find("img").on("load", function () {
        elt.scrollTop(scroll);
      });
    };

    useEffect(() => {
      if (actions._syncstring == null) {
        setEditorToValue(value);
      }
      if (value != "Loading...") {
        restoreScroll();
      }
    }, [value]);

    function setSyncstringFromSlate() {
      if (actions.set_value == null) {
        // no way to save the value out (e.g., just beginning to test
        // using the component).
        return;
      }
      if (!editor.hasUnsavedChanges()) {
        // there are no changes to save
        return;
      }

      const markdown = editor.getMarkdownValue();
      actions.set_value(markdown);

      // Record that the syncstring's value is now equal to ours:
      editor.resetHasUnsavedChanges();
    }

    // We don't want to do saveValue too much, since it presumably can be slow,
    // especially if the document is large. By debouncing, we only do this when
    // the user pauses typing for a moment. Also, this avoids making too many commits.
    // For tiny documents, user can make this small or even 0 to not debounce.
    const saveValueDebounce =
      saveDebounceMs != null && !saveDebounceMs
        ? () => editor.saveValue()
        : useMemo(
            () =>
              debounce(
                () => editor.saveValue(),
                saveDebounceMs ?? SAVE_DEBOUNCE_MS
              ),
            []
          );

    function onKeyDown(e) {
      if (read_only) {
        e.preventDefault();
        return;
      }

      mentions.onKeyDown(e);
      if (e.defaultPrevented) return;

      if (!ReactEditor.isFocused(editor)) {
        // E.g., when typing into a codemirror editor embedded
        // in slate, we get the keystrokes, but at the same time
        // the (contenteditable) editor itself is not focused.
        return;
      }

      const handler = getKeyboardHandler(e);
      if (handler != null) {
        const extra = { actions, id, search };
        if (handler({ editor, extra })) {
          e.preventDefault();
          // key was handled.
          return;
        }
      }
    }

    useEffect(() => {
      if (!is_current) {
        if (editor.hasUnsavedChanges()) {
          // just switched from focused to not and there was
          // an unsaved change, so save state.
          setSyncstringFromSlate();
          actions.ensure_syncstring_is_saved?.();
        }
      }
    }, [is_current]);

    const setEditorToValue = (value) => {
      if (value == null) return;
      if (value == editor.getMarkdownValue()) {
        // nothing to do, and in fact doing something
        // could be really annoying, since we don't want to
        // autoformat via markdown everything immediately,
        // as ambiguity is resolved while typing...
        return;
      }
      const previousEditorValue = editor.children;

      // we only use the latest version of the document
      // for caching purposes.
      editor.syncCache = {};
      // There is an assumption here that markdown_to_slate produces
      // a document that is properly normalized.  If that isn't the
      // case, things will go horribly wrong, since it'll be impossible
      // to convert the document to equal nextEditorValue.  In the current
      // code we do nomalize the output of markdown_to_slate, so
      // that assumption is definitely satisfied.
      const nextEditorValue = markdown_to_slate(value, false, editor.syncCache);

      try {
        if (!ReactEditor.isFocused(editor)) {
          // This is a **MASSIVE** optimization.  E.g., for a few thousand
          // lines markdown file with about 500 top level elements (and lots
          // of nested lists), applying operations below starting with the
          // empty document can take 5-10 seconds, whereas just setting the
          // value is instant.  The drawback to directly setting the value
          // is only that it messes up selection, and it's difficult
          // to know where to move the selection to after changing.
          // However, if the editor isn't focused, we don't have to worry
          // about selection at all.  TODO: we might be able to avoid the
          // slateDiff stuff entirely via some tricky stuff, e.g., managing
          // the cursor on the plain text side before/after the change, since
          // codemirror is much faster att "setValueNoJump".
          // The main time we use this optimization here is when opening the
          // document in the first place, in which case we're converting
          // the document from "Loading..." to it's initial value.
          // Also, the default config is source text focused on the left and
          // editable text acting as a preview on the right not focused, and
          // again this makes things fastest.
          editor.syncCausedUpdate = true;
          // we call "onChange" instead of setEditorValue, since
          // we want all the change handler stuff to happen, e.g.,
          // broadcasting cursors.
          onChange(nextEditorValue);
          return;
        }

        const operations = slateDiff(previousEditorValue, nextEditorValue);
        if (operations.length == 0) {
          // no actual change needed.
          return;
        }
        // Applying this operation below will immediately trigger
        // an onChange, which it is best to ignore to save time and
        // also so we don't update the source editor (and other browsers)
        // with a view with things like loan $'s escaped.'
        //       console.log(
        //         "selection before patching",
        //         JSON.stringify(editor.selection),
        //         /*JSON.stringify(editor.children)*/
        //       );
        editor.syncCausedUpdate = true;
        applyOperations(editor, operations);
      } finally {
        // In all cases, now that we have transformed editor into the new value
        // let's save the fact that we haven't changed anything yet:
        editor.resetHasUnsavedChanges();
      }

      try {
        if (editor.selection != null) {
          const { anchor, focus } = editor.selection;
          Editor.node(editor, anchor);
          Editor.node(editor, focus);
        }
      } catch (err) {
        // TODO!
        console.warn(
          "slate - invalid selection after upstream patch. Resetting selection.",
          err
        );
        // set to beginning of document -- better than crashing.
        resetSelection(editor);
      }

      //       if ((window as any).cc?.slate != null) {
      //         (window as any).cc.slate.eval = (s) => console.log(eval(s));
      //       }

      if (EXPENSIVE_DEBUG) {
        const stringify = require("json-stable-stringify");
        // We use JSON rather than isEqual here, since {foo:undefined}
        // is not equal to {}, but they JSON the same, and this is
        // fine for our purposes.
        if (stringify(editor.children) != stringify(nextEditorValue)) {
          // NOTE -- this does not 100% mean things are wrong.  One case where
          // this is expected behavior is if you put the cursor at the end of the
          // document, say right after a horizontal rule,  and then edit at the
          // beginning of the document in another browser.  The discrepancy
          // is because a "fake paragraph" is placed at the end of the browser
          // so your cursor has somewhere to go while you wait and type; however,
          // that space is not really part of the markdown document, and it goes
          // away when you move your cursor out of that space.
          console.warn(
            "**WARNING:  slateDiff might not have properly transformed editor, though this may be fine. See window.diffBug **"
          );
          (window as any).diffBug = {
            previousEditorValue,
            nextEditorValue,
            editorValue: editor.children,
            stringify,
            slateDiff,
            applyOperations,
            markdown_to_slate,
            value,
          };
        }
      }
    };

    if ((window as any).cc != null) {
      // This only gets set when running in cc-in-cc dev mode.
      const { Editor, Node, Path, Range, Text } = require("slate");
      (window as any).cc.slate = {
        slateDiff,
        editor,
        Transforms,
        ReactEditor,
        Node,
        Path,
        Editor,
        Range,
        Text,
        markdown_to_slate,
        robot: async (s: string, iterations = 1) => {
          let inserted = "";
          let lastOffset = editor.selection?.focus.offset;
          for (let n = 0; n < iterations; n++) {
            for (const x of s) {
              editor.insertText(x);
              inserted += x;
              const offset = editor.selection?.focus.offset;
              console.log(
                `${
                  n + 1
                }/${iterations}: inserted '${inserted}'; focus="${JSON.stringify(
                  editor.selection?.focus
                )}"`
              );
              if (offset != (lastOffset ?? 0) + 1) {
                console.error("SYNC FAIL!!", { offset, lastOffset });
                return;
              }
              lastOffset = offset;
              await delay(130 * Math.random());
              if (Math.random() < 0.2) {
                await delay(1.3 * SAVE_DEBOUNCE_MS);
              }
            }
          }
          console.log("SUCCESS!");
        },
      };
    }

    editor.inverseSearch = async function inverseSearch(
      force?: boolean
    ): Promise<void> {
      if (
        !force &&
        (is_fullscreen || !actions.get_matching_frame?.({ type: "cm" }))
      ) {
        // - if user is fullscreen assume they just want to WYSIWYG edit
        // and double click is to select.  They can use sync button to
        // force opening source panel.
        // - if no source view, also don't do anything.  We only let
        // double click do something when there is an open source view,
        // since double click is used for selecting.
        return;
      }
      // delay to give double click a chance to change current focus.
      // This takes surprisingly long!
      let t = 0;
      while (editor.selection == null) {
        await delay(1);
        t += 50;
        if (t > 2000) return; // give up
      }
      const point = editor.selection?.anchor; // using anchor since double click selects word.
      if (point == null) {
        return;
      }
      const pos = slatePointToMarkdownPosition(editor, point);
      if (pos == null) return;
      actions.programmatical_goto_line?.(
        pos.line + 1, // 1 based (TODO: could use codemirror option)
        true,
        false, // it is REALLY annoying to switch focus to be honest, e.g., because double click to select a word is common in WYSIWYG editing.  If change this to true, make sure to put an extra always 50ms delay above due to focus even order.
        undefined,
        pos.ch
      );
    };

    // WARNING: onChange does not fire immediately after changes occur.
    // It is fired by react and happens in some potentialy later render
    // loop after changes.  Thus you absolutely can't depend on it in any
    // way for checking if the state of the editor has changed.  Instead
    // check editor.children itself explicitly.
    const onChange = (newEditorValue) => {
      if (editor._hasUnsavedChanges === false) {
        // just for initial change.
        editor._hasUnsavedChanges = undefined;
      }
      if (!isMountedRef.current) return;
      broadcastCursors();
      updateMarks();
      updateLinkURL();
      updateListProperties();
      // Track where the last editor selection was,
      // since this is very useful to know, e.g., for
      // understanding cursor movement, format fallback, etc.
      // @ts-ignore
      if (editor.lastSelection == null && editor.selection != null) {
        // initialize
        // @ts-ignore
        editor.lastSelection = editor.curSelection = editor.selection;
      }
      // @ts-ignore
      if (!isEqual(editor.selection, editor.curSelection)) {
        // @ts-ignore
        editor.lastSelection = editor.curSelection;
        if (editor.selection != null) {
          // @ts-ignore
          editor.curSelection = editor.selection;
        }
      }

      if (editorValue === newEditorValue) {
        // Editor didn't actually change value so nothing to do.
        return;
      }

      setEditorValue(newEditorValue);

      // Update mentions state whenever editor actually changes.
      // This may pop up the mentions selector.
      mentions.onChange();

      if (!is_current) {
        // Do not save when editor not current since user could be typing
        // into another editor of the same underlying document.   This will
        // cause bugs (e.g., type, switch from slate to codemirror, type, and
        // see what you typed into codemirror disappear). E.g., this
        // happens due to a spurious change when the editor is defocused.

        return;
      }
      saveValueDebounce();
    };

    useEffect(() => {
      editor.syncCausedUpdate = false;
    }, [editorValue]);

    let slate = (
      <Slate editor={editor} value={editorValue} onChange={onChange}>
        <Editable
          placeholder={placeholder}
          autoFocus={autoFocus}
          className={
            !disableWindowing && height != "auto" ? "smc-vfill" : undefined
          }
          readOnly={read_only}
          renderElement={Element}
          renderLeaf={Leaf}
          onKeyDown={onKeyDown}
          onBlur={() => {
            editor.saveValue();
            updateMarks();
            onBlur?.();
          }}
          onFocus={() => {
            updateMarks();
            onFocus?.();
          }}
          decorate={cursorDecorate}
          divref={scrollRef}
          onScroll={
            !disableWindowing ? updateWindowedScrollState : updateScrollState
          }
          style={
            !disableWindowing
              ? undefined
              : {
                  position: "relative", // CRITICAL!!! Without this, editor will sometimes scroll the entire frame off the screen.  Do NOT delete position:'relative'.  5+ hours of work to figure this out!  Note that this isn't needed when using windowing above.
                  minWidth: "80%",
                  padding: "70px",
                  background: "white",
                  overflow:
                    "auto" /* for this overflow, see https://github.com/ianstormtaylor/slate/issues/3706 */,
                  ...pageStyle,
                }
          }
          windowing={
            !disableWindowing
              ? {
                  rowStyle: {
                    padding: "0 70px",
                    minHeight: "1px", // virtuoso can't deal with 0-height items
                  },
                  marginTop: "40px",
                  marginBottom: "40px",
                  rowSizeEstimator,
                }
              : undefined
          }
        />
      </Slate>
    );
    let body = (
      <div
        ref={divRef}
        className={noVfill || height == "auto" ? undefined : "smc-vfill"}
        style={{
          overflow: noVfill || height == "auto" ? undefined : "auto",
          backgroundColor: "white",
          ...style,
          height,
          minHeight: height == "auto" ? "50px" : undefined,
        }}
      >
        {!hidePath && (
          <Path is_current={is_current} path={path} project_id={project_id} />
        )}
        <EditBar
          Search={search.Search}
          isCurrent={is_current}
          marks={marks}
          linkURL={linkURL}
          listProperties={listProperties}
          editor={editor}
          style={editBarStyle}
          hideSearch={hideSearch}
        />
        <div
          className={noVfill || height == "auto" ? undefined : "smc-vfill"}
          style={{
            ...STYLE,
            fontSize: font_size,
            height,
          }}
        >
          {mentions.Mentions}
          {slate}
        </div>
      </div>
    );
    return useUpload(editor, body);
  }
);
