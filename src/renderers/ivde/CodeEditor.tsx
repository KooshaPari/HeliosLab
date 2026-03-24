import { For, Show, createEffect, on, onCleanup, onMount } from "solid-js";
import * as monaco from "monaco-editor";
import {
  state,
  setState,
  getUniqueId,
  type AppState,
  getCurrentTab,
  openNewTab,
  getEditorForTab,
  focusTabWithId,
  openFileAt,
} from "./store";

// Import "monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution";
import "monaco-editor/esm/vs/language/typescript/monaco.contribution";
import "monaco-editor/esm/vs/language/css/monaco.contribution";
import "monaco-editor/esm/vs/language/html/monaco.contribution";
import "monaco-editor/esm/vs/language/json/monaco.contribution";
// Note: there is no markdown worker, just use plaintext

import "monaco-editor/min/vs/editor/editor.main.css";
import { _getNode, createModel, getNode } from "./FileWatcher";
import { MarkerSeverity } from "monaco-editor";
import { getWindow } from "./store";

import type ts from "typescript";

import { produce } from "solid-js/store";
import { relative, basename } from "../utils/pathUtils";
import { aiCompletionService } from "./services/aiCompletionService";
import { getProjectForNodePath } from "./files";
import { electrobun } from "./init";
import type { ParsedResponseType } from "../../shared/types/types";

let currentRequestId = 0;

// Import "monaco-editor/editor.main.css";
// Import TypeScriptIcon from "../../../assets/file-icons/TypeScript.svg";

// Todo (yoav):[blocking] we're storing editors

monaco.editor.defineTheme("darkPlus", {
  base: "vs-dark",
  inherit: true,
  rules: [
    // { token: "keyword", foreground: "C586C0", background: "000000", fontStyle: '' },
    { token: "keyword", foreground: "C586C0" },
    { token: "identifier", foreground: "69B3E3" },
    { token: "string", foreground: "CE9178" },
    { token: "number", foreground: "B5CEA8" },
    { token: "type", foreground: "4EC9B0" },
    { token: "comment", foreground: "608B4E" },
    { token: "unusedIdentifier", foreground: "FFFFFF" },
  ],
  encodedTokensColors: [],
  colors: {},
});

const editors: Record<string, monaco.editor.IStandaloneCodeEditor> = {};

const tsSeverityToMonacoSeverity = (severity: "error" | "warning" | "suggestion" | string) => {
  switch (severity) {
    case "error": {
      return MarkerSeverity.Error;
    }
    case "warning": {
      return MarkerSeverity.Warning;
    }
    case "suggestion": {
      return MarkerSeverity.Info;
    }
    default: {
      return MarkerSeverity.Info;
    }
  }
};

const reSizeEditors = () => {
  for (const key in editors) {
    editors[key].layout();
  }
};

createEffect(
  on(
    () => state.ui.showSidebar,
    () => {
      reSizeEditors();
    },
  ),
);

monaco.languages.register({
  id: "typescript",
  extensions: [".ts", ".tsx"],
  aliases: ["TypeScript", "ts", "typescript"],
  mimetypes: ["text/typescript"],
});

monaco.languages.register({
  id: "javascript",
  extensions: [".js"],
  aliases: ["JavaScript", "javascript", "js"],
  mimetypes: ["text/javascript"],
});

monaco.languages.register({
  id: "css",
  extensions: [".css"],
  aliases: ["CSS", "css"],
  mimetypes: ["text/css"],
});

monaco.languages.register({
  id: "html",
  extensions: [".html", ".htm"],
  aliases: ["HTML", "html"],
  mimetypes: ["text/html"],
});

monaco.languages.register({
  id: "json",
  extensions: [".json"],
  aliases: ["JSON", "json"],
  mimetypes: ["application/json"],
});

monaco.languages.register({
  id: "markdown",
  extensions: [".md", ".markdown"],
  aliases: ["Markdown", "markdown", "md"],
  mimetypes: ["text/markdown"],
});

// Disable built-in TypeScript diagnostics
monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: true,
  noSyntaxValidation: true,
  noSuggestionDiagnostics: true,
});

monaco.languages.typescript.typescriptDefaults.setModeConfiguration({
  // Disable hovers for typescript since we use tsserver quickinfo for that
  hovers: false,
  // Disable go to definition for typescript since we use tsserver for that
  definitions: false,
  // Disable TypeScript's built-in completions to reserve inline for AI only
  completionItems: false,
});

// Register plugin completion provider for all languages
const pluginCompletionLanguages = [
  "typescript",
  "javascript",
  "typescriptreact",
  "javascriptreact",
];
pluginCompletionLanguages.forEach((lang) => {
  monaco.languages.registerCompletionItemProvider(lang, {
    triggerCharacters: [".", "(", '"', "'", "`", "<", "/", "@", "#"],
    provideCompletionItems: async (model, position, context, token) => {
      try {
        const lineText = model.getLineContent(position.lineNumber);
        const linePrefix = lineText.slice(0, position.column - 1);

        const completions = await electrobun.rpc?.request.pluginGetCompletions({
          language: lang,
          linePrefix,
          lineText,
          lineNumber: position.lineNumber,
          column: position.column,
          filePath: model.uri.path,
          triggerCharacter: context.triggerCharacter,
        });

        if (!completions || completions.length === 0) {
          return { suggestions: [] };
        }

        const kindMap: Record<string, monaco.languages.CompletionItemKind> = {
          function: monaco.languages.CompletionItemKind.Function,
          snippet: monaco.languages.CompletionItemKind.Snippet,
          text: monaco.languages.CompletionItemKind.Text,
          keyword: monaco.languages.CompletionItemKind.Keyword,
          variable: monaco.languages.CompletionItemKind.Variable,
          class: monaco.languages.CompletionItemKind.Class,
          method: monaco.languages.CompletionItemKind.Method,
          property: monaco.languages.CompletionItemKind.Property,
        };

        const suggestions: monaco.languages.CompletionItem[] = completions.map((item, index) => ({
          label: item.label,
          kind: kindMap[item.kind || "snippet"] || monaco.languages.CompletionItemKind.Snippet,
          insertText: item.insertText,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: item.detail,
          documentation: item.documentation,
          sortText: `0${index}`, // Ensure plugin completions appear at top
          range: {
            startLineNumber: position.lineNumber,
            startColumn: position.column,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          },
        }));

        return { suggestions };
      } catch (error) {
        console.error("Failed to get plugin completions:", error);
        return { suggestions: [] };
      }
    },
  });
});

// Const libSource = `
//     Declare var React: any;
// `;

// Add your type to the global TypeScript definitions
// Monaco.languages.typescript.typescriptDefaults.addExtraLib(libSource);

// Todo (yoav): support preact, solidjs, etc.
// Monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
//   Jsx: "react"
// });

// Monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
//   NoSemanticValidation: false,
//   NoSyntaxValidation: false
// })
// NOTE: we probably want different settings for deno/node/electron/etc.
// And maybe an option to customize it via a tsconfig.json file in the project that's
// Visually editable
// Monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
//   Target: monaco.languages.typescript.ScriptTarget.ES2015,
//   AllowNonTsExtensions: true,
//   ModuleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
//   Module: monaco.languages.typescript.ModuleKind.CommonJS,
//   NoEmit: true,
//   Jsx: monaco.languages.typescript.JsxEmit.React,
//   TypeRoots: ["node_modules/@types"],
// });

self.MonacoEnvironment = {
  baseUrl: "./",
  getWorkerUrl: function (moduleId, label) {
    if (label === "json") {
      return "./vs/language/json/json.worker.js";
    }
    if (label === "css") {
      return "./vs/language/css/css.worker.js";
    }
    if (label === "html") {
      return "./vs/language/html/html.worker.js";
    }
    if (label === "typescript" || label === "javascript") {
      return "./vs/language/typescript/ts.worker.js";
    }

    return "./vs/editor/editor.worker.js";
  },
};

export const Editor = ({ currentTabId }: { currentTabId: string }) => {
  // Todo: currentTab sounds like activeTab. rename this to tabid or thisTabId
  const currentTab = () => {
    return getWindow()?.tabs[currentTabId];
  };
  // When loading a window it can spin up tons of tabs so we need some
  // Uniqueness to the id system
  const uniqueId = getUniqueId();

  // Todo (yoav): controlling whether files/folders are readonly
  const isReadOnly = false;
  let editor: monaco.editor.IStandaloneCodeEditor;
  let editorRef: HTMLDivElement | undefined;
  let prevListeners: any[] = [];
  let providerDisposables: monaco.IDisposable[] = [];
  let resizeObserver: ResizeObserver;
  const windowId = state.windowId;
  const workspaceId = state.workspace.id;

  const sendTsServerRequest = ({ command, args }: { command: string; args: any }) => {
    const model = editor.getModel();
    if (model) {
      electrobun.rpc?.send("tsServerRequest", {
        command,
        args,
        metadata: {
          workspaceId,
          windowId,
          editorId: uniqueId,
        },
      });
    }
  };

  const handleTsServerResponse = (parsedResponse: ParsedResponseType) => {
    const model = editor.getModel();

    if (model) {
      handleDiagnosticResponse(parsedResponse, model, sendTsServerRequest);
    }
  };

  setState(
    produce((_state: AppState) => {
      _state.editors[uniqueId] = {
        tabId: currentTabId,
        editor,
        handleTsServerResponse,
      };
    }),
  );

  const onResize = () => {
    editor.layout();
  };

  const setModel = async () => {
    const _currentTab = currentTab();
    if (!_currentTab || !editor) {
      return;
    }
    const absolutePath = _currentTab.path;

    const prevModel = editor.getModel();

    if (prevModel) {
      // Todo (yoav): [blocking] remove event listener
      prevListeners.forEach((listener) => listener.dispose());
    }

    // Let model = state.files[currentTab.path].model;
    const model: monaco.editor.ITextModel = await createModel(_currentTab.path);

    // Todo (yoav): move this to where the file path is changed
    // TsServer.stdin.write(
    //   JSON.stringify({
    //     Seq: seq++,
    //     Type: "request",
    //     Command: "open",
    //     Arguments: {
    //       File: model.uri.path,
    //     },
    //   }) + "\n"
    // );

    // Todo (yoav): update open files since this is a single tab/editor that
    // Is loading a different file. For this tsserver instance the only open file
    // Has just changed
    //Github.com/microsoft/TypeScript/blob/97147915ab667a52e31ac743843786cbc9049559/src/server/protocol.ts#L1875-L1896

    const closedFiles = prevModel?.getLanguageId() === "typescript" ? [prevModel.uri.path] : [];
    const openFiles = model.getLanguageId() === "typescript" ? [model.uri.path] : [];

    const wasTypescript = prevModel?.getLanguageId() === "typescript";
    const isTypescript = model.getLanguageId() === "typescript";

    if (wasTypescript && isTypescript) {
      sendTsServerRequest({
        command: "updateOpen",
        args: {
          closedFiles: closedFiles, //[prevModel.uri.path],
          openFiles: openFiles, //[model.uri.path],
          // ChangedFiles: [],
        },
      });
    } else if (!wasTypescript && isTypescript) {
      sendTsServerRequest({
        command: "open",
        args: {
          file: model.uri.path,
        },
      });
    } else if (wasTypescript && !isTypescript) {
      sendTsServerRequest({
        command: "close",
        args: {
          file: prevModel.uri.path,
        },
      });
    }

    // SetState('files', currentTab.path, 'model', model)
    // }

    // Note: since models can be shared between editors, we need to make sure
    // We don't add duplicate event listeners or remove duplicate listeners. But since
    // We keep track of them here in this array we don't risk

    prevListeners = [
      // Model.onDidChangeAttached((e) => {

      //   DiagnoseErrors(model, tsServer);
      //   // setTimeout(() => {
      //   //   diagnoseErrors(model, tsServer);
      //   // }, 1000);
      // }),

      // Editor.onDidCreateModel((e) => {
      //   // diagnoseErrors(model, tsServer);
      //   // diagnoseErrors(model, tsServer);

      // }),

      // When editing a file
      model.onDidChangeContent((e) => {
        const { changes, isFlush, isEolChange, isRedoing, isUndoing, versionId, eol } = e;
        const model = editor.getModel();

        if (!model) {
          return;
        }

        const content = model.getValue();

        if (_currentTab.path.endsWith(".ts") || _currentTab.path.endsWith(".tsx")) {
          const activeTab = getCurrentTab();

          // Note: We only send changes for the active tab, otherwise if you have multiple tabs
          // Open on the same file tsserver will get the update multiple times and have a corrupted
          // Internal state of the file.
          if (_currentTab.id !== activeTab?.id) {
            return;
          }

          changes.forEach((change) => {
            sendTsServerRequest({
              command: "change",
              args: {
                file: model.uri.path,
                line: change.range.startLineNumber,
                offset: change.range.startColumn,
                endLine: change.range.endLineNumber,
                endOffset: change.range.endColumn,
                insertString: change.text,
              },
            });
          });

          diagnoseErrors(model, sendTsServerRequest);
        }

        setState(
          produce((_state: AppState) => {
            const _node = _getNode(absolutePath, _state);

            if (_node?.type === "file") {
              const { persistedContent, isDirty } = _node;
              const isNowDirty = content !== persistedContent;
              if (isDirty !== isNowDirty) {
                _node.isDirty = isNowDirty;
              }
            }
          }),
        );
      }),
    ];

    editor.setModel(model);

    // Apply selection if this tab was opened with a specific line/column
    const tabWithSelection = currentTab();
    if (tabWithSelection && "selection" in tabWithSelection && tabWithSelection.selection) {
      const selection = tabWithSelection.selection as monaco.IRange;
      // Use setTimeout to ensure the editor is fully ready
      setTimeout(() => {
        editor.setSelection(selection);
        editor.revealLineInCenter(selection.startLineNumber);
        editor.focus();
      }, 0);
    }
  };

  createEffect(() => {
    setModel();
  });

  onMount(() => {
    const _currentTab = currentTab();

    if (!_currentTab) {
      return;
    }
    // Sometimes a file is deleted or renamed outside of Colab but we still have a tab for it
    // We should render a message or something i the editor to let users know
    // Todo (yoav):
    if (!state.fileCache[_currentTab.path]) {
      return;
    }

    if (!editorRef) {
      return;
    }

    editor = monaco.editor.create(editorRef, {
      theme: "vs-dark",
      hover: { enabled: true },
      minimap: { enabled: true },
      lineNumbers: "on",
      inlayHints: {},
      readOnly: isReadOnly,
      // Enable inline suggestions for AI but try to limit TypeScript's role
      inlineSuggest: {
        enabled: true,
      },
      suggest: {
        preview: false,
        showInlineDetails: false,
      },
      // AutoLayout: true,
    });

    setState("editors", uniqueId, "editor", editor);

    createEffect(() => {
      // When resizing the pane (draging the pane dividers) the pane divider creates a div
      // That covers all the content. Monaco editors will resize themselves and if they need
      // A scrollbar the scrollbar will respond to mouse events which will block the mouse up
      // Make it hard to exit the pane resize.
      if (state.isResizingPane) {
        editor.updateOptions({
          scrollbar: {
            vertical: "hidden",
            horizontal: "hidden",
          },
        });
      } else {
        editor.updateOptions({
          scrollbar: {
            vertical: "auto",
            horizontal: "auto",
          },
        });
      }
    });

    monaco.editor.setTheme("darkPlus");

    resizeObserver = new ResizeObserver(() => {
      editor.layout();
    });

    resizeObserver.observe(editorRef);

    // Todo (yoav): create editor and add actions need to be broken out into its own thing
    editor.addAction({
      id: "saveCommand",
      label: "Save File",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: async function (ed) {
        const model = ed.getModel();
        const value = model?.getValue();

        if (!model || value == null) {
          return;
        }
        // Save your file here
        const result = await electrobun.rpc?.request.writeFile({
          path: model.uri.path,
          value,
        });

        if (!result?.success) {
          // Todo: handle failed write
          return;
        }

        const biomeExtensions = [
          ".js",
          ".jsx",
          ".ts",
          ".tsx",
          ".mjs",
          ".cjs",
          ".mts",
          ".cts",
          ".json",
          ".jsonc",
          ".css",
          ".html",
          ".graphql",
          ".gql",
        ];
        if (biomeExtensions.some((ext) => model.uri.path.endsWith(ext))) {
          electrobun.rpc?.send("formatFile", {
            path: model.uri.path,
          });
        }

        setState(
          produce((_state: AppState) => {
            const _node = _getNode(_currentTab.path, _state);

            if (_node?.type === "file") {
              _node.isDirty = false;
              _node.persistedContent = value;
            }
          }),
        );
      },
    });

    monaco.editor.registerEditorOpener({
      openCodeEditor: async (_, uri: monaco.Uri, selectionOrPosition: monaco.IRange) => {
        const { path } = uri;
        const { startLineNumber, startColumn } = selectionOrPosition;

        openFileAt(path, startLineNumber, startColumn);
        // Todo: it should also focus a specific line/column

        return true;
      },
    });

    monaco.editor.registerLinkOpener({
      open: async (uri: monaco.Uri) => {
        const { path } = uri;

        openNewTab({
          type: "web",
          path,
          url: path,
        });

        return true;
      },
    });

    // Todo (yoav): [blocking] we should probably only keep track of files here that have open tabs associated with them
    // Since we use tsserver now we don't need to know about every fle in the project
    setState(
      produce((_state: AppState) => {
        const _node = _getNode(_currentTab.path, _state);

        if (_node?.type === "file") {
          _node.editors[uniqueId] = editor;
        }
      }),
    );
    // Editors[uniqueId] = editor;
    window.addEventListener("resize", onResize);

    if (_currentTab.path.endsWith(".ts") || _currentTab.path.endsWith(".tsx")) {
      providerDisposables.push(
        monaco.languages.registerHoverProvider("typescript", {
          provideHover: function (model, position) {
            // Note: since this is a global provider it will be triggered
            // Along with all the other CodeEditor providers registered
            if (model.uri.path !== _currentTab.path) {
              return;
            }

            return new Promise((resolve) => {
              if (hoverProviderResolver) {
                hoverProviderResolver({
                  contents: [
                    {
                      value: "",
                      /*
              Readonly isTrusted?: boolean | MarkdownStringTrustedOptions;
              readonly supportThemeIcons?: boolean;
              readonly supportHtml?: boolean;
              readonly baseUri?: UriComponents; 
              */
                    },
                  ],
                });
              }

              // We omit range to get around a monaco bug
              hoverProviderResolver = resolve as HoverResolverType;

              sendTsServerRequest({
                command: "quickinfo",
                args: {
                  file: model.uri.path,
                  line: position.lineNumber,
                  offset: position.column,
                },
              });
            });
          },
        }),
      );

      providerDisposables.push(
        monaco.languages.registerDefinitionProvider("typescript", {
          provideDefinition: function (model, position, token) {
            return new Promise((resolve) => {
              if (definitionProviderResolver) {
                definitionProviderResolver();
              }

              // We omit range to get around a monaco bug
              definitionProviderResolver = resolve;

              const filePath = model.uri.path;
              const offset = position.column;

              const line = position.lineNumber;

              sendTsServerRequest({
                command: "findSourceDefinition",
                args: {
                  file: filePath,
                  line,
                  offset,
                },
              });
            });
          },
        }),
      );

      // Register AI inline completion provider for grey text suggestions
      const languagesToRegister = [
        "typescript",
        "javascript",
        "typescriptreact",
        "javascriptreact",
      ];
      languagesToRegister.forEach((lang) => {
        providerDisposables.push(
          monaco.languages.registerInlineCompletionsProvider(lang, {
            provideInlineCompletions: async function (model, position, context, token) {
              // Note: since this is a global provider it will be triggered
              // Along with all the other CodeEditor providers registered
              if (model.uri.path !== _currentTab.path) {
                console.log("❌ Wrong file path, skipping AI completion");
                return { items: [] };
              }

              // Always provide AI completions - don't skip for TypeScript

              // Allow both automatic and manual triggers for AI completions

              try {
                // Build context for AI inline completion
                const lineStartOffset = model.getOffsetAt({
                  lineNumber: position.lineNumber,
                  column: 1,
                });
                const currentOffset = model.getOffsetAt(position);
                const totalLength = model.getValueLength();

                // Get prefix (before cursor) - last ~1000 chars for context
                const prefixStart = Math.max(0, currentOffset - 1000);
                const codePrefix = model
                  .getValueInRange({
                    startLineNumber: 1,
                    startColumn: 1,
                    endLineNumber: position.lineNumber,
                    endColumn: position.column,
                  })
                  .slice(prefixStart - (currentOffset - position.column + 1));

                // Get suffix (after cursor) - next ~500 chars for context
                const suffixEnd = Math.min(totalLength, currentOffset + 500);
                const codeSuffix = model
                  .getValueInRange({
                    startLineNumber: position.lineNumber,
                    startColumn: position.column,
                    endLineNumber: model.getLineCount(),
                    endColumn: model.getLineMaxColumn(model.getLineCount()),
                  })
                  .slice(0, suffixEnd - currentOffset);

                // Generate request ID and track latest request
                const requestId = ++currentRequestId;

                // Get AI inline completions
                const aiResponse = await aiCompletionService.getInlineCompletions({
                  prefix: codePrefix,
                  suffix: codeSuffix,
                  language: "typescript",
                  filename: model.uri.path,
                  position: position,
                  triggerCharacter:
                    context.triggerKind === monaco.languages.InlineCompletionTriggerKind.Automatic
                      ? undefined
                      : undefined,
                });

                // Check if this is still the latest request
                if (requestId !== currentRequestId) {
                  return { items: [] };
                }

                // If (aiResponse.items?.length > 0) {
                //   Console.log("First inline completion item:", aiResponse.items[0]);
                //   // Create custom AI completion overlay
                //   SetTimeout(() => {
                //     Try {
                //       // Calculate what the user has already typed on the current line
                //       Const currentLine = model.getLineContent(position.lineNumber);
                //       Const textBeforeCursor = currentLine.substring(0, position.column - 1);

                //       // Get the AI completion text
                //       Const fullCompletion = aiResponse.items[0].insertText;

                //       // Find what part of the completion is actually new
                //       Let remainingCompletion = fullCompletion;

                //       // Get the last partial word the user is typing
                //       Const lastWordMatch = textBeforeCursor.match(/(\w+)$/);
                //       If (lastWordMatch) {
                //         Const lastPartialWord = lastWordMatch[1];
                //         Const reconstructed = lastPartialWord + fullCompletion;

                //         Console.log("Last partial word:", lastPartialWord);
                //         Console.log("AI completion:", fullCompletion);
                //         Console.log("Reconstructed:", reconstructed);

                //         // Advanced overlap detection: try different overlap lengths
                //         Let overlapLength = 0;

                //         // Method 1: Check if AI completion starts with the partial word
                //         If (fullCompletion.toLowerCase().startsWith(lastPartialWord.toLowerCase())) {
                //           OverlapLength = lastPartialWord.length;
                //           Console.log("Direct prefix match found");
                //         } else {
                //           // Method 2: Check for character overlap at the junction
                //           For (let i = 1; i <= Math.min(lastPartialWord.length, fullCompletion.length); i++) {
                //             Const partialSuffix = lastPartialWord.slice(-i);
                //             Const completionPrefix = fullCompletion.slice(0, i);
                //             If (partialSuffix.toLowerCase() === completionPrefix.toLowerCase()) {
                //               OverlapLength = i;
                //             }
                //           }

                //           // Method 3: Check if reconstruction forms known words
                //           If (overlapLength === 0) {
                //             Const commonWords = ['console', 'function', 'const', 'class', 'import', 'export', 'return', 'document'];
                //             For (const word of commonWords) {
                //               If (reconstructed.toLowerCase().startsWith(word.toLowerCase()) &&
                //                   LastPartialWord.length < word.length &&
                //                   Word.startsWith(lastPartialWord.toLowerCase())) {
                //                 // Calculate exact overlap needed for this word
                //                 // For "c" + "onsole" -> "console", we want to keep "onsole" (no overlap removal)
                //                 Const expectedRemaining = word.substring(lastPartialWord.length);
                //                 If (fullCompletion.toLowerCase().startsWith(expectedRemaining.toLowerCase())) {
                //                   OverlapLength = 0; // Don't remove anything, the AI gave us exactly what we need
                //                   Console.log(`Perfect completion for word: ${word}, keeping full AI response`);
                //                 } else {
                //                   OverlapLength = lastPartialWord.length;
                //                   Console.log(`Partial overlap for word: ${word}`);
                //                 }
                //                 Break;
                //               }
                //             }
                //           }
                //         }

                //         If (overlapLength > 0) {
                //           RemainingCompletion = fullCompletion.substring(overlapLength);
                //           Console.log(`Removing ${overlapLength} characters of overlap. Remaining: "${remainingCompletion}"`);
                //         } else {
                //           Console.log("No overlap detected, using full completion");
                //           RemainingCompletion = fullCompletion;
                //         }
                //       }

                //       Console.log("Text before cursor:", textBeforeCursor);
                //       Console.log("Full AI completion:", fullCompletion);
                //       Console.log("Remaining completion:", remainingCompletion);

                //       // Only show if we have a meaningful remaining completion
                //       If (remainingCompletion.length > 0 && remainingCompletion !== fullCompletion && remainingCompletion.trim().length > 0) {
                //         Console.log("✅ Showing remaining completion overlay");
                //         ShowAICompletionOverlay(editor, position, remainingCompletion);
                //       } else if (fullCompletion.length > 0) {
                //         Console.log("✅ Showing full completion overlay (no partial word)");
                //         ShowAICompletionOverlay(editor, position, fullCompletion);
                //       } else {
                //         Console.log("❌ No overlay shown - conditions not met");
                //       }
                //     } catch (e) {
                //       Console.log("Failed to show AI completion overlay:", e);
                //     }
                //   }, 50);
                // }
                return aiResponse;
              } catch {
                return { items: [] };
              }
            },
            freeInlineCompletions: function (completions) {
              // Nothing to clean up
            },
          }),
        );
      });
    }

    setModel();
  });

  onCleanup(() => {
    // Todo (yoav): move to a single event listener model
    window.removeEventListener("resize", onResize);
    if (editorRef) {
      resizeObserver?.unobserve(editorRef);
    }
    resizeObserver?.disconnect();
    // Dispose global language providers registered by this editor instance
    providerDisposables.forEach((d) => d.dispose());
    providerDisposables = [];
    // TODO: consider telling server when the last file is closed to shut down tsserver
  });

  const getBreadcrumbParts = () => {
    const currentTabPath = currentTab()?.path;
    if (!currentTabPath) {
      return [];
    }
    const project = getProjectForNodePath(currentTabPath);
    const projectPath = project?.path;
    if (!projectPath) {
      return [];
    }

    const relativePath = relative(projectPath, currentTabPath);

    const projectName = project.name || basename(projectPath);
    return [projectName, ...relativePath.split("/")];
  };

  return (
    <div style="height: 100%; display: flex; flex-direction: column ">
      <div style=" padding: 3px 15px 4px; color: #bbb; font-size: 12px;">
        <For each={getBreadcrumbParts()}>
          {(part, i) => {
            if (i() === 0) {
              // Project name
              return <span style="margin-right: 5px; color: #60a1d0 ">{part}:</span>;
            }
              return (
                <span style="margin-right: 5px">
                  <Show when={i() > 1}>
                    <span style="color: #888;margin-right: 5px">{"/"}</span>
                  </Show>
                  {part}
                </span>
              );
            
          }}
        </For>
      </div>

      <div ref={editorRef} style="height: calc(100% - 22px)" />
    </div>
  );
};

const convertTsServerDiagnosticsToMonacoMarkers = (
  diagnostics:
    | ts.server.protocol.Diagnostic[]
    | ts.server.protocol.DiagnosticWithLinePosition[]
    | ts.server.protocol.CompletionEntry[],
) => {
  if (!diagnostics) {
    return [];
  }

  return (
    diagnostics
      .map((d) => {
        if ("end" in d) {
          // Ts.Diagnostic
          return {
            severity: tsSeverityToMonacoSeverity(d.category),
            startLineNumber: d.start.line,
            startColumn: d.start.offset,
            endLineNumber: d.end.line,
            endColumn: d.end.offset,
            message: d.text,
          };
        } else if ("endLocation" in d) {
          // Ts.DiagnosticWithLocation
          return {
            severity: tsSeverityToMonacoSeverity(d.category),
            startLineNumber: d.startLocation.line,
            startColumn: d.startLocation.offset,
            endLineNumber: d.endLocation.line,
            endColumn: d.endLocation.offset,
            message: d.message,
          };
        }
          // ts.CompletionEntry
          // Note: this shouldn't happen, the tsserver types are likely mistaken
          // we process completeions using a different function when the command is "completions"
          // and we surface them as suggestions and not markers.
          console.error("completion entry while processing diagnostics", d);
          return null;
        
      })
      // Note: typescript doesn't understand filter functions, so we just tell it
      // That we're returning a nonnullable array
      .filter((b): b is NonNullable<typeof b> => b !== undefined)
  );
};

// Functions that interface with monaco
const diagnoseErrors = (
  model: monaco.editor.ITextModel,
  sendTsServerRequest: (params: any) => void,
) => {
  if (model.getLanguageId() === "typescript") {
    checkTypescriptForErrors(model, sendTsServerRequest);
  }
};

// Let seq = 0;

// This is a custom type that's more readable than what
// Tsserver puts out and includes a severity that's relevant
// To how the error is displayed in monaco
interface DiagnosticMarkers {
  severity: MarkerSeverity;
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  message: string;
}

// Todo (yoav): move this to global state, and save it per editor or per model
const _diagnostics: {
  suggestions: DiagnosticMarkers[];
  syntactic: DiagnosticMarkers[];
  semantic: DiagnosticMarkers[];
} = {
  suggestions: [],
  syntactic: [],
  semantic: [],
};

const updateMarkers = (model: monaco.editor.ITextModel) => {
  const { suggestions, syntactic, semantic } = _diagnostics;

  monaco.editor.setModelMarkers(model, "custom", [...suggestions, ...syntactic, ...semantic]);
};
// Functions that interface with tsServer
// https://github.com/microsoft/TypeScript/blob/main/src/server/protocol.ts
// TsServer requests:
let diagnosticsDebounceTimer: ReturnType<typeof setTimeout> | null = null;

const checkTypescriptForErrors = async (
  model: monaco.editor.ITextModel,
  sendTsServerRequest: (params: any) => void,
) => {
  // Debounce diagnostics so file content can render before CPU-heavy tsserver work starts.
  // Also avoids tsserver dropping requests when three arrive simultaneously.
  if (diagnosticsDebounceTimer) {
    clearTimeout(diagnosticsDebounceTimer);
  }

  diagnosticsDebounceTimer = setTimeout(() => {
    diagnosticsDebounceTimer = null;
    const filePath = model.uri.path;

    // Todo (yoav): since monaco.editor.setModelMarkers(model, "custom", errors);
    // Replaces the markers, we should store suggestions, syntactic, and semantic errors
    // In separate stores and then combine them into a single array of markers
    // Todo (yoav): we probably also want this so that we can show the errors in the
    // Sidebar and let the user click on them to jump to the error or other places
    sendTsServerRequest({
      command: "suggestionDiagnosticsSync",
      args: {
        file: filePath,
      },
    });

    // Syntax, eg: missing closing bracket
    setTimeout(() => {
      sendTsServerRequest({
        command: "syntacticDiagnosticsSync",
        args: {
          file: filePath,
          includeLinePosition: true,
        },
      });
    }, 100);

    // Semantic, eg: type mismatch
    setTimeout(() => {
      sendTsServerRequest({
        command: "semanticDiagnosticsSync",
        args: {
          file: filePath,
          includeLinePosition: true,
        },
      });
    }, 200);
  }, 500);
};

type HoverResolverType =
  | undefined
  | (({ contents }: { contents: monaco.IMarkdownString[] }) => void);
let hoverProviderResolver: HoverResolverType;
type DefinitionResolverType = undefined | ((value?: monaco.languages.Location[]) => void);
let definitionProviderResolver: DefinitionResolverType;

// Let tsServerResponse = {
//   ContentLength: 0,
//   LengthReceived: 0,

//   Text: "",
// };

function getTagBody(tag: ts.server.protocol.JSDocTagInfo): Array<string> | undefined {
  if (tag.name === "template") {
    const parts = tag.text;
    if (parts && typeof parts !== "string") {
      const params = parts
        .filter((p) => p.kind === "typeParameterName")
        .map((p) => p.text)
        .join(", ");
      const docs = parts
        .filter((p) => p.kind === "text")
        .map((p) => p.text.replace(/^\s*-?\s*/, ""))
        .join(" ");
      return params ? ["", params, docs] : undefined;
    }
  }
  if (typeof tag.text === "string") {
    return tag.text.split(/^(\S+)\s*-?\s*/);
  }
    return [""];
  
}

function asPlainText(parts: string | ts.server.protocol.SymbolDisplayPart[]): string {
  if (typeof parts === "string") {
    return parts;
  }
  return parts.map((part) => part.text).join("");
}

function getTagBodyText(tag: ts.server.protocol.JSDocTagInfo): string | undefined {
  if (!tag.text) {
    return undefined;
  }

  // Convert to markdown code block if it does not already contain one
  function makeCodeblock(text: string): string {
    if (/^\s*[~`]{3}/m.test(text)) {
      return text;
    }
    return "```\n" + text + "\n```";
  }

  let text = tag.text;
  switch (tag.name) {
    case "example": {
      // Example text does not support `{@link}` as it is considered code.
      // TODO: should we support it if it appears outside of an explicit code block?
      text = asPlainText(tag.text);

      // Check for caption tags, fix for #79704
      const captionTagMatches = text.match(/<caption>(.*?)<\/caption>\s*(\r\n|\n)/);
      if (captionTagMatches && captionTagMatches.index === 0) {
        return (
          captionTagMatches[1] + "\n" + makeCodeblock(text.slice(captionTagMatches[0].length))
        );
      }
        return makeCodeblock(text);
      
    }
    case "author": {
      const stringText = text as string;
      // Fix obsucated email address, #80898
      const emailMatch = stringText.match(/(.+)\s<([-.\w]+@[-.\w]+)>/);

      if (emailMatch === null) {
        return stringText;
      }
        return `${emailMatch[1]} ${emailMatch[2]}`;
      
    }
    case "default": {
      const stringText = text as string;
      return makeCodeblock(stringText);
    }
  }

  const stringText = text as string;

  return stringText;
}

const tagToMarkdown = (tag: ts.server.protocol.JSDocTagInfo) => {
  switch (tag.name) {
    case "augments":
    case "extends":
    case "param":
    case "template": {
      const body = getTagBody(tag);
      if (body?.length === 3) {
        const param = body[1];
        const doc = body[2];
        const label = `*@${tag.name}* \`${param}\``;
        if (!doc) {
          return label;
        }
        return label + (/\r\n|\n/g.test(doc) ? "  \n" + doc : ` \u2014 ${doc}`);
      }
      break;
    }

    case "return":
    case "returns": {
      // For return(s), we require a non-empty body
      if (!tag.text?.length) {
        return;
      }

      break;
    }
  }

  // Generic tag
  const label = `*@${tag.name}*`;
  const text = getTagBodyText(tag);
  if (!text) {
    return label;
  }
  return label + (/\r\n|\n/g.test(text) ? "  \n" + text : ` \u2014 ${text}`);
};

// TsServer response handlers
const handleDiagnosticResponse = (
  parsedResponse: ParsedResponseType,
  model: monaco.editor.ITextModel,
  sendTsServerRequest: (params: any) => void,
) => {
  // NOTE: tsserver trigger send data events where a response spans multiple events. You can also
  // Have another response added to the end of the last part of the previous response
  // So we actually need a function that just breaks apart the responses as a loop and handles them separately
  // Todo (yoav): create onDataHandler that handles this and calls handleDiagnosticResponse

  // JsonString = new TextDecoder("utf-8").decode(tsServerResponse.byteArray);
  // JsonString = tsServerResponse.text;

  //   // reset the response
  //   TsServerResponse.contentLength = 0;
  //   TsServerResponse.lengthReceived = 0;
  //   TsServerResponse.byteArray = [];
  //   TsServerResponse.text = "";
  // }
  // Todo (yoav): maybe hanle long or partial responses

  // If (contentLength === jsonString.length) {

  // Const parsedResponse = JSON.parse(jsonString);
  // Console.log("response", parsedResponse);
  if (parsedResponse.type === "event") {
    const { event, body } = parsedResponse;
    if (event === "projectLoadingStart") {
      const {
        // Absolute path to tsconfig
        projectName,
        // Human text reason for loading
        reason,
      } = body;

      // Todo (yoav): show loading indicator in the UI to show tsserver status
    } else if (event === "projectLoadingFinish") {
      const {
        // Absolute path to tsconfig
        projectName,
      } = body;

      // You can only start running diagnostics after the project has finished loading
      // In tsserver and we want it to diagnose right after loading
      diagnoseErrors(model, sendTsServerRequest);
    } else if (event === "telemetry") {
      const {
        // Lots of info about the project
        // CompilerOptions, fileStats, typeAcquisition, and more
        payload,
      } = body;
    } else if (event === "syntaxDiag") {
      if (!body) {
        return;
      }
      const {
        // Filepath
        file,
        // Array of diagnostics
        diagnostics,
      } = body;

      const errors = diagnostics?.map((d) => {
        return {
          severity: tsSeverityToMonacoSeverity(d.category),
          startLineNumber: d.start.line,
          startColumn: d.start.offset,
          endLineNumber: d.end.line,
          endColumn: d.end.offset,
          message: "syntaxDiag: " + d.text,
        };
      });
      _diagnostics.syntactic = errors;
      updateMarkers(model);
    } else if (event === "semanticDiag") {
      if (!body) {
        return;
      }
      const {
        // Filepath
        file,
        // Array of diagnostics {category, code, start, end, text}
        diagnostics,
      } = body;

      const errors = diagnostics?.map((d) => {
        return {
          severity: tsSeverityToMonacoSeverity(d.category),
          startLineNumber: d.start.line,
          startColumn: d.start.offset,
          endLineNumber: d.end.line,
          endColumn: d.end.offset,
          message: "semanticDiag: " + d.text,
        };
      });

      // Todo (yoav):  if we add custom errors, we need to manage them in a more central
      // Place because setModelMarkers replaces all markers
      _diagnostics.semantic = errors;
      updateMarkers(model);
      // Monaco.editor.setModelMarkers(model, "custom", errors);
    } else if (event === "suggestionDiag") {
      if (!body) {
        return;
      }
      const {
        // Filepath

        file,
        // Array of diagnostics {category, code, start, end, text}
        diagnostics,
      } = body;

      const errors = diagnostics?.map((d) => {
        return {
          severity: tsSeverityToMonacoSeverity(d.category),
          startLineNumber: d.start.line,
          startColumn: d.start.offset,
          endLineNumber: d.end.line,
          endColumn: d.end.offset,
          message: "suggestion: " + d.text,
        };
      });

      // Console.log("suggestionsDiag", errors, body);

      // Todo (yoav):  if we add custom errors, we need to manage them in a more central
      // Place because setModelMarkers replaces all markers
      // Monaco.editor.setModelMarkers(model, "custom", errors);
      _diagnostics.suggestions = errors;

      updateMarkers(model);
    } else if (event === "requestCompleted") {
      const {
        // The seq of the request that was completed
        request_seq,
      } = body;
    }
  } else if (parsedResponse.type === "response") {
    const { command, success, body } = parsedResponse;
    if (command === "suggestionDiagnosticsSync") {
      // Const { body } = parsedResponse;
      // Note: for the sync query the body is the array of diagnostics
      // Which is different from the expected return type
      const diagnostics = body;
      if (!diagnostics) {
        return;
      }

      const errors = convertTsServerDiagnosticsToMonacoMarkers(diagnostics);

      // Todo (yoav):  if we add custom errors, we need to manage them in a more central
      // Place because setModelMarkers replaces all markers
      // Monaco.editor.setModelMarkers(model, "custom", errors);
      _diagnostics.suggestions = errors;

      updateMarkers(model);
    } else if (command === "syntacticDiagnosticsSync") {
      // Array of diagnostics {category, code, start, end, text}
      // Note: for the sync query the body is the array of diagnostics
      const diagnostics = body;
      if (!diagnostics) {
        return;
      }

      const errors = convertTsServerDiagnosticsToMonacoMarkers(diagnostics);

      // Todo (yoav):  if we add custom errors, we need to manage them in a more central
      // Place because setModelMarkers replaces all markers
      // Monaco.editor.setModelMarkers(model, "custom", errors);
      _diagnostics.syntactic = errors;

      updateMarkers(model);
    } else if (command === "semanticDiagnosticsSync") {
      // Array of diagnostics {category, code, start, end, text}
      // Note: for the sync query the body is the array of diagnostics
      const diagnostics = body;
      if (!diagnostics) {
        return;
      }

      const errors = convertTsServerDiagnosticsToMonacoMarkers(diagnostics);

      // Todo (yoav):  if we add custom errors, we need to manage them in a more central
      // Place because setModelMarkers replaces all markers
      // Monaco.editor.setModelMarkers(model, "custom", errors);
      _diagnostics.semantic = errors;

      updateMarkers(model);
    } else if (command === "quickinfo") {
      if (success === true) {
        const quickInfo = body as ts.server.protocol.QuickInfoResponseBody;

        if (!quickInfo || !hoverProviderResolver) {
          return;
        }

        const documentationArray =
          typeof quickInfo.documentation !== "string"
            ? quickInfo.documentation.map((documentation) => {
                // Todo (yoav): find examples of these and customize how it looks
                if (documentation.kind === "className") {
                  return {
                    value: "className: " + documentation.text,
                    isTrusted: true,
                    supportHtml: true,
                  };
                } else if (documentation.kind === "parameterName") {
                  return {
                    value: "parameter: " + documentation.text,
                    isTrusted: true,
                    supportHtml: true,
                  };
                }
                  // Note: the default kind is "text"
                  return {
                    value: documentation.text,
                    isTrusted: true,
                    supportHtml: true,
                  };
                
              })
            : [
                {
                  value: quickInfo.documentation,
                  isTrusted: true,
                  supportHtml: true,
                },
              ];

        // Jsdoc tags
        const tags =
          quickInfo.tags?.map((tag) => {
            const text = tagToMarkdown(tag);

            return {
              value: text || "", //`@${tag.name} ${tag.text}`,
            };
          }) || [];

        /**[
    {
        "name": "param",
        "text": "paths paths to join."
    },
    {
        "name": "throws",
        "text": "{TypeError} if any of the path segments is not a string."
    }
] */

        hoverProviderResolver({
          contents: [
            {
              value: "```typescript\n" + quickInfo.displayString + "\n\n```",
              // IsTrusted: true,
              // SupportHtml: true,
            },
            ...documentationArray,
            ...tags,
          ],
        });

        hoverProviderResolver = undefined;
      }
    } else if (command === "findSourceDefinition") {
      const rawDefinitions = (body || []) as ts.server.protocol.DefinitionInfo[];
      if (parsedResponse.success === false) {
        console.error("response error", parsedResponse.message);
        // Return;
      }

      const definitions = rawDefinitions.map((rawDefinition) => {
        // Make sure the model exists or monaco will throw an error
        createModel(rawDefinition.file);

        return {
          uri: monaco.Uri.parse(rawDefinition.file),
          range: {
            startLineNumber: rawDefinition.start.line,
            startColumn: rawDefinition.start.offset,
            endLineNumber: rawDefinition.end.line,
            endColumn: rawDefinition.end.offset,
          },
        };
      });

      definitionProviderResolver?.(definitions);
    } else if (!parsedResponse.success) {
      console.error("response error", parsedResponse);
      return;
    }
  }

  // } else {
  //   Console.error("jsonString partial response");
  //   Return;
  // }
};
