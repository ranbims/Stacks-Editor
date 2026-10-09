import { EditorState, Transaction } from "prosemirror-state";
import { DecorationSet, EditorView } from "prosemirror-view";
import { RichTextEditor } from "../../../src/rich-text/editor";
import {
    hideLinkEditor,
    LinkEditor,
    linkEditorPlugin,
    showLinkEditor,
} from "../../../src/rich-text/plugins/link-editor";
import {
    getCurrentTextNode,
    stackOverflowValidateLink,
} from "../../../src/shared/utils";
import {
    applySelection,
    cleanupPasteSupport,
    createState,
    createView,
    setupPasteSupport,
} from "../test-helpers";
import { interfaceManagerPlugin } from "../../../src/shared/prosemirror-plugins/interface-manager";
import { externalPluginProvider, onViewDispatch } from "../../test-helpers";

const editorPlugin = linkEditorPlugin({
    validateLink: stackOverflowValidateLink,
});

describe("link-editor", () => {
    describe("plugin view", () => {
        let pluginContainer: Element;
        let menuContainer: Element;
        let view: RichTextEditor;
        let editor: LinkEditor;

        beforeEach(() => {
            pluginContainer = document.createElement("div");
            menuContainer = document.createElement("div");
            view = richTextView(
                "",
                () => pluginContainer,
                () => menuContainer
            );
            editor = new LinkEditor(view.editorView, stackOverflowValidateLink);
        });

        it("should show link editor", () => {
            expect(getViewContainer(editor).parentElement).toBeNull();

            showLinkEditor(view.editorView);
            editor.update(view.editorView);
            const updatedUploadContainer =
                pluginContainer.querySelector(".js-link-editor");

            expect(updatedUploadContainer.parentElement).toBeTruthy();
        });

        it("should focus first input when showing image uploader", () => {
            // we need to add our DOM to the doc's body in order to make jsdom's "focus" handling work
            // see https://github.com/jsdom/jsdom/issues/2586#issuecomment-742593116
            document.body.appendChild(pluginContainer);

            expect(getViewContainer(editor).parentElement).toBeNull();

            showLinkEditor(view.editorView);
            editor.update(view.editorView);
            const input = pluginContainer.querySelector(
                ".js-link-editor .js-link-editor-href"
            );

            // the actual element changes when the plugin state is updated, so we can't check exact match
            expect(document.activeElement.className).toEqual(input.className);

            // cleanup the appended child
            pluginContainer.remove();
        });

        it("should hide link editor", () => {
            showLinkEditor(view.editorView);
            editor.update(view.editorView);

            hideLinkEditor(view.editorView);
            editor.update(view.editorView);

            expect(getViewContainer(editor).parentElement).toBeNull();
        });

        it("should show error when failing link validation", () => {
            expect(getViewContainer(editor).parentElement).toBeNull();

            showLinkEditor(view.editorView);
            editor.update(view.editorView);
            const updatedUploadContainer =
                pluginContainer.querySelector<HTMLFormElement>(
                    "form.js-link-editor"
                );

            // submit the form without filling in any inputs
            updatedUploadContainer.submit();

            const inputContainer = updatedUploadContainer.querySelector(
                ".js-link-editor-href"
            ).parentElement;

            expect(inputContainer.classList).toContain("has-error");
        });

        it("should hide error when hiding editor", () => {
            expect(getViewContainer(editor).parentElement).toBeNull();

            showLinkEditor(view.editorView);
            editor.update(view.editorView);
            const updatedUploadContainer =
                pluginContainer.querySelector<HTMLFormElement>(
                    "form.js-link-editor"
                );

            // submit the form without filling in any inputs
            updatedUploadContainer.submit();

            let inputContainer = updatedUploadContainer.querySelector(
                ".js-link-editor-href"
            ).parentElement;

            expect(inputContainer.classList).toContain("has-error");

            hideLinkEditor(view.editorView);
            editor.update(view.editorView);

            showLinkEditor(view.editorView);
            editor.update(view.editorView);

            inputContainer = pluginContainer.querySelector(
                ".js-link-editor-href"
            ).parentElement;

            expect(inputContainer.classList).not.toContain("has-error");
        });

        it("should prefill fields when a link is edited via the tooltip", async () => {
            view = richTextView(
                "[link text](https://www.example.com)",
                () => pluginContainer
            );

            view.editorView.updateState(
                applySelection(view.editorView.state, 1)
            );

            const promise = onViewDispatch(view.editorView, (_, tr) => {
                if (!tr || !tr.getMeta("LinkEditor$")) {
                    return false;
                }

                const updatedUploadContainer =
                    pluginContainer.querySelector<HTMLFormElement>(
                        "form.js-link-editor"
                    );

                expect(formValue(updatedUploadContainer, "href")).toBe(
                    "https://www.example.com"
                );
                expect(formValue(updatedUploadContainer, "text")).toBe(
                    "link text"
                );

                return true;
            });

            // simulate clicking the button
            const renderedDeco = getRenderedDecoration(view.editorView);
            renderedDeco
                .querySelector<HTMLButtonElement>(".js-link-tooltip-edit")
                .dispatchEvent(new Event("mousedown"));

            return promise;
        });

        it("should prefill fields when a link is edited via the menu command", () => {
            view = richTextView(
                "[link text](https://www.example.com)",
                () => pluginContainer,
                () => menuContainer
            );

            view.editorView.updateState(
                applySelection(view.editorView.state, 1)
            );

            return onLinkEditorChange(view.editorView, menuContainer, {
                onOpen: () => {
                    const updatedUploadContainer =
                        pluginContainer.querySelector<HTMLFormElement>(
                            "form.js-link-editor"
                        );

                    expect(formValue(updatedUploadContainer, "href")).toBe(
                        "https://www.example.com"
                    );
                    expect(formValue(updatedUploadContainer, "text")).toBe(
                        "link text"
                    );

                    return true;
                },
                onClose: null,
            });
        });

        it("should prefill fields when a link is inserted over selected text via the menu command", () => {
            view = richTextView(
                "test",
                () => pluginContainer,
                () => menuContainer
            );

            view.editorView.updateState(
                applySelection(view.editorView.state, 0, 4)
            );

            return onLinkEditorChange(view.editorView, menuContainer, {
                onOpen: () => {
                    const updatedUploadContainer =
                        pluginContainer.querySelector<HTMLFormElement>(
                            "form.js-link-editor"
                        );

                    expect(formValue(updatedUploadContainer, "href")).toBe("");
                    expect(formValue(updatedUploadContainer, "text")).toBe(
                        "test"
                    );

                    return true;
                },
                onClose: null,
            });
        });

        it("should show insert new links on save", () => {
            const newLinkText = "link text";

            view.editorView.updateState(
                applySelection(view.editorView.state, 0)
            );

            return onLinkEditorChange(view.editorView, menuContainer, {
                onOpen: () => {
                    const updatedUploadContainer =
                        pluginContainer.querySelector<HTMLFormElement>(
                            "form.js-link-editor"
                        );

                    expect(formValue(updatedUploadContainer, "href")).toBe("");
                    expect(formValue(updatedUploadContainer, "text")).toBe("");

                    // set the values, then submit the form
                    setFormValue(
                        updatedUploadContainer,
                        "href",
                        "https://www.example.com"
                    );
                    setFormValue(updatedUploadContainer, "text", newLinkText);
                    updatedUploadContainer.submit();

                    return false;
                },
                onClose: (newView) => {
                    expect(newView.state.doc).toMatchNodeTree({
                        content: [
                            {
                                content: [
                                    {
                                        "isText": true,
                                        "text": newLinkText,
                                        "marks.0.type.name": "link",
                                        "marks.0.attrs.href":
                                            "https://www.example.com",
                                    },
                                ],
                            },
                        ],
                    });

                    // check that the entire link was highlighted
                    const { from, to } = newView.state.selection;
                    expect(from).toBe(1);
                    expect(to).toBe(10);
                    expect(newView.state.doc.textBetween(from, to)).toBe(
                        newLinkText
                    );

                    return true;
                },
            });
        });

        it("should update existing links on save", () => {
            const newLinkText = "link text";

            view = richTextView(
                "[test](https://www.example.com)",
                () => pluginContainer,
                () => menuContainer
            );

            view.editorView.updateState(
                applySelection(view.editorView.state, 1)
            );

            const currentTextNode = getCurrentTextNode(view.editorView.state);

            // check that the cursor is inside the link
            expect(currentTextNode).toMatchNodeTree({
                "isText": true,
                "text": "test",
                "marks.0.type.name": "link",
                "marks.0.attrs.href": "https://www.example.com",
            });

            return onLinkEditorChange(view.editorView, menuContainer, {
                onOpen: () => {
                    const updatedUploadContainer =
                        pluginContainer.querySelector<HTMLFormElement>(
                            "form.js-link-editor"
                        );

                    expect(formValue(updatedUploadContainer, "href")).toBe(
                        "https://www.example.com"
                    );
                    expect(formValue(updatedUploadContainer, "text")).toBe(
                        "test"
                    );

                    // set the values, then submit the form
                    setFormValue(
                        updatedUploadContainer,
                        "href",
                        "https://www.example.org"
                    );
                    setFormValue(updatedUploadContainer, "text", newLinkText);
                    updatedUploadContainer.submit();

                    return false;
                },
                onClose: (newView) => {
                    expect(newView.state.doc).toMatchNodeTree({
                        content: [
                            {
                                content: [
                                    {
                                        "isText": true,
                                        "text": newLinkText,
                                        "marks.0.type.name": "link",
                                        "marks.0.attrs.href":
                                            "https://www.example.org",
                                    },
                                ],
                            },
                        ],
                    });

                    // check that the entire link was highlighted
                    const { from, to } = newView.state.selection;
                    expect(from).toBe(1);
                    expect(to).toBe(10);
                    expect(newView.state.doc.textBetween(from, to)).toBe(
                        newLinkText
                    );

                    return true;
                },
            });
        });

        it("should use the url as the link text when the text is not provided", () => {
            const newLinkText = "link text";

            view.editorView.updateState(
                applySelection(view.editorView.state, 0)
            );

            return onLinkEditorChange(view.editorView, menuContainer, {
                onOpen: () => {
                    const updatedUploadContainer =
                        pluginContainer.querySelector<HTMLFormElement>(
                            "form.js-link-editor"
                        );

                    expect(formValue(updatedUploadContainer, "href")).toBe("");
                    expect(formValue(updatedUploadContainer, "text")).toBe("");

                    // set the values, then submit the form
                    setFormValue(
                        updatedUploadContainer,
                        "href",
                        "https://www.example.com"
                    );
                    setFormValue(updatedUploadContainer, "text", newLinkText);
                    updatedUploadContainer.submit();

                    return false;
                },
                onClose: (newView) => {
                    // editor is hidden (save was called)
                    expect(newView.state.doc).toMatchNodeTree({
                        content: [
                            {
                                content: [
                                    {
                                        "isText": true,
                                        "text": newLinkText,
                                        "marks.0.type.name": "link",
                                        "marks.0.attrs.href":
                                            "https://www.example.com",
                                    },
                                ],
                            },
                        ],
                    });

                    // check that the entire link was highlighted
                    const { from, to } = newView.state.selection;
                    expect(from).toBe(1);
                    expect(to).toBe(10);
                    expect(newView.state.doc.textBetween(from, to)).toBe(
                        newLinkText
                    );

                    return true;
                },
            });
        });
    });

    describe("dialog presentation", () => {
        let target: HTMLDivElement;
        let view: RichTextEditor;
        const dialogPrototype = HTMLDialogElement.prototype;
        const originalShowModal = Object.getOwnPropertyDescriptor(
            dialogPrototype,
            "showModal"
        );
        const originalClose = Object.getOwnPropertyDescriptor(
            dialogPrototype,
            "close"
        );

        beforeEach(() => {
            // JSDOM does not implement the native dialog's top-layer behavior.
            Object.defineProperties(dialogPrototype, {
                showModal: {
                    configurable: true,
                    value: function (this: HTMLDialogElement) {
                        this.open = true;
                    },
                },
                close: {
                    configurable: true,
                    value: function (this: HTMLDialogElement) {
                        this.open = false;
                    },
                },
            });
            target = document.createElement("div");
            document.body.appendChild(target);
            view = new RichTextEditor(
                target,
                "before selected after",
                externalPluginProvider(),
                { linkEditorDisplay: "dialog" }
            );
            view.editorView.updateState(
                applySelection(view.editorView.state, 7, 15)
            );
        });

        afterEach(() => {
            view.destroy();
            target.remove();
            for (const [name, descriptor] of [
                ["showModal", originalShowModal],
                ["close", originalClose],
            ] as const) {
                if (descriptor) {
                    Object.defineProperty(dialogPrototype, name, descriptor);
                } else {
                    Reflect.deleteProperty(dialogPrototype, name);
                }
            }
        });

        function openDialog(url = "") {
            showLinkEditor(view.editorView, url, "selected");
            return target.querySelector<HTMLDialogElement>(
                ".js-link-editor-dialog"
            );
        }

        it("opens a labelled dialog and focuses the URL without losing selection", () => {
            const selection = view.editorView.state.selection;
            const dialog = openDialog();
            expect(dialog.open).toBe(true);
            expect(dialog.getAttribute("aria-label")).toBe("Link");
            expect(document.activeElement).toBe(
                dialog.querySelector(".js-link-editor-href")
            );
            expect(view.editorView.state.selection.eq(selection)).toBe(true);
            const text = dialog.querySelector<HTMLInputElement>(
                ".js-link-editor-text"
            );
            expect(text.labels[0].htmlFor).toBe(text.id);
        });

        it("does not reset draft fields or focus during editor transactions", () => {
            view.content = "before [selected](https://example.com) after";
            view.editorView.updateState(
                applySelection(view.editorView.state, 9)
            );
            getRenderedDecoration(view.editorView)
                .querySelector(".js-link-tooltip-edit")
                .dispatchEvent(new Event("mousedown"));
            const dialog = target.querySelector<HTMLDialogElement>(
                ".js-link-editor-dialog"
            );
            expect(dialog.open).toBe(true);
            expect(formValue(dialog.querySelector("form"), "href")).toBe(
                "https://example.com"
            );
            const text = dialog.querySelector<HTMLInputElement>(
                ".js-link-editor-text"
            );
            expect(text.value).toBe("selected");
            text.value = "draft";
            text.focus();
            view.editorView.dispatch(view.editorView.state.tr);
            expect(text.value).toBe("draft");
            expect(document.activeElement).toBe(text);
            expect(target.querySelector(".js-link-tooltip")).toBeNull();
        });

        it("saves at the original selection and restores editor focus", () => {
            const dialog = openDialog("https://example.com");
            dialog.querySelector("form").dispatchEvent(
                new Event("submit", { bubbles: true, cancelable: true })
            );
            expect(view.content.trim()).toBe(
                "before [selected](https://example.com) after"
            );
            expect(dialog.open).toBe(false);
            expect(dialog.isConnected).toBe(false);
            expect(view.editorView.hasFocus()).toBe(true);
        });

        it.each(["reset", "cancel", "backdrop"])(
            "dismisses via %s without modifying content",
            (action) => {
                const original = view.content;
                const dialog = openDialog("https://example.com");
                if (action === "reset") {
                    dialog.querySelector("form").dispatchEvent(
                        new Event("reset", { bubbles: true, cancelable: true })
                    );
                } else if (action === "cancel") {
                    dialog.dispatchEvent(
                        new Event("cancel", { cancelable: true })
                    );
                } else {
                    dialog.dispatchEvent(new Event("pointerdown"));
                    dialog.click();
                }
                expect(dialog.open).toBe(false);
                expect(dialog.isConnected).toBe(false);
                expect(view.content).toBe(original);
                expect(view.editorView.hasFocus()).toBe(true);
            }
        );

        it("ignores a backdrop click when the gesture started in the form", () => {
            const dialog = openDialog();
            dialog.querySelector("input").dispatchEvent(
                new Event("pointerdown", { bubbles: true })
            );
            dialog.click();
            expect(dialog.open).toBe(true);
        });

        it("keeps invalid URLs open and resets validation when reopened", () => {
            const dialog = openDialog();
            const href = dialog.querySelector<HTMLInputElement>(
                ".js-link-editor-href"
            );
            const save = dialog.querySelector<HTMLButtonElement>(
                ".js-link-editor-save-btn"
            );
            href.value = "javascript:alert(1)";
            href.dispatchEvent(new Event("input"));
            expect(save.disabled).toBe(true);
            expect(href.getAttribute("aria-invalid")).toBe("true");
            dialog.querySelector("form").dispatchEvent(
                new Event("submit", { cancelable: true })
            );
            expect(dialog.open).toBe(true);
            expect(view.content.trim()).toBe("before selected after");
            hideLinkEditor(view.editorView);
            openDialog();
            expect(href.hasAttribute("aria-invalid")).toBe(false);
            expect(href.value).toBe("");
            expect(save.disabled).toBe(true);
        });

        it("closes and removes an open dialog when the editor is destroyed", () => {
            const dialog = openDialog();
            view.destroy();
            expect(dialog.open).toBe(false);
            expect(dialog.isConnected).toBe(false);
        });
    });

    describe("tooltip", () => {
        it("should not show with no cursor", () => {
            const state = createState(
                `<a href="https://www.example.com">test</a>`,
                [editorPlugin]
            );
            const decorations = getDecorations(state);

            expect(decorations).toEqual(DecorationSet.empty);
        });

        it("should not show with cursor on non-links", () => {
            let state = createState(
                `<p>test<a href="https://www.example.com">link</a></p>`,
                [editorPlugin]
            );
            state = applySelection(state, 0);

            const currentNode = state.doc.nodeAt(state.selection.from);

            const decorations = getDecorations(state);

            expect(currentNode.isText).toBe(true);
            expect(currentNode.text).toBe("test");
            expect(currentNode.marks).toHaveLength(0);

            expect(decorations).toEqual(DecorationSet.empty);
        });

        it("should show with cursor on links", () => {
            let state = createState(
                `<p>test<a href="https://www.example.com">link</a></p>`,
                [editorPlugin]
            );

            state = applySelection(state, 5);

            const currentNode = state.doc.nodeAt(state.selection.from);

            expect(currentNode.isText).toBe(true);
            expect(currentNode.text).toBe("link");
            expect(currentNode.marks).toHaveLength(1);
            expect(currentNode.marks[0].attrs).toHaveProperty("href");

            const decorations = getDecorations(state);
            expect(decorations).not.toEqual(DecorationSet.empty);
        });

        it("should edit on button click", () => {
            const pluginContainer = document.createElement("div");
            const state = applySelection(
                createState(
                    `<p>test<a href="https://www.example.com">link</a></p>`,
                    [
                        interfaceManagerPlugin(() => pluginContainer),
                        linkEditorPlugin({
                            validateLink: () => true,
                        }),
                    ]
                ),
                5
            );
            // we have to create a view so that the decorations are rendered
            const view = createView(state);

            expect(pluginContainer.parentElement).toBeNull();

            // intercept the dispatch
            const promise = onViewDispatch(view, (newView, tr) => {
                if (!tr || !tr.getMeta("LinkEditor$")) {
                    return false;
                }

                // this should open the editor interface
                const updatedUploadContainer =
                    pluginContainer.querySelector(".js-link-editor");
                expect(updatedUploadContainer).toBeTruthy();

                // the decoration should be hidden now
                const decos = getDecorations(newView.state);
                expect(decos).toBe(DecorationSet.empty);

                return true;
            });

            // simulate clicking the button
            const renderedDeco = getRenderedDecoration(view);
            renderedDeco
                .querySelector<HTMLButtonElement>(".js-link-tooltip-edit")
                .dispatchEvent(new Event("mousedown"));

            return promise;
        });

        it("should delete on button click", () => {
            setupPasteSupport();
            const pluginContainer = document.createElement("div");
            const state = applySelection(
                createState(
                    `<p>test<a href="https://www.example.com">link</a></p>`,
                    [
                        interfaceManagerPlugin(() => pluginContainer),
                        linkEditorPlugin({}),
                    ]
                ),
                6
            );

            // we have to create a view so that the decorations are rendered
            const view = createView(state);

            const promise = onViewDispatch(view, (newView, tr) => {
                if (!tr) {
                    return false;
                }

                const currentNode = newView.state.doc.nodeAt(
                    newView.state.selection.from
                );

                expect(currentNode.isText).toBe(true);
                expect(currentNode.text).toBe("testlink");
                expect(currentNode.marks).toHaveLength(0);

                // the decoration should be hidden now
                const decos = getDecorations(newView.state);

                expect(decos).toBe(DecorationSet.empty);

                return true;
            });

            expect(pluginContainer.parentElement).toBeNull();

            const renderedDeco = getRenderedDecoration(view);
            renderedDeco
                .querySelector<HTMLButtonElement>(".js-link-tooltip-remove")
                .dispatchEvent(new Event("mousedown"));

            return promise.then(() => cleanupPasteSupport());
        });
    });

    describe("props", () => {
        it("should open links in a new window on mod-click", () => {
            const mock = jest.fn();

            // mock the window.open function
            window.open = mock;

            const plugin = linkEditorPlugin({});
            const view = createView(
                createState(
                    `<p>test<a href="https://www.example.com">link</a></p>`,
                    [plugin]
                )
            );

            // call the prop fn directly instead of playing around with event dispatching
            // regular click
            let result = plugin.props.handleClick.call(
                plugin,
                view,
                6,
                new MouseEvent("click", {})
            );

            expect(result).toBe(false);
            expect(mock).toHaveBeenCalledTimes(0);

            // mod-click
            result = plugin.props.handleClick.call(
                plugin,
                view,
                6,
                new MouseEvent("click", {
                    ctrlKey: true,
                })
            );

            expect(result).toBe(true);
            expect(mock).toHaveBeenCalledTimes(1);

            // mod-click, but not on a link
            result = plugin.props.handleClick.call(
                plugin,
                view,
                1,
                new MouseEvent("click", {
                    ctrlKey: true,
                })
            );

            expect(result).toBe(false);
            expect(mock).toHaveBeenCalledTimes(1);
        });
    });
});

function getDecorations(state: EditorState) {
    const pState = state.plugins
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error this isn't a public field, but I don't care
        .find((p) => p.spec?.key?.name === "LinkEditor")
        ?.getState(state) as {
        decorations: DecorationSet;
    };
    return pState.decorations;
}

function getRenderedDecoration(editorView: EditorView): HTMLElement {
    const state = editorView.state;
    const decorations = getDecorations(state);
    const decoration = decorations.find(state.selection.from)[0];
    expect(decoration).toBeDefined();

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const pState = state.plugins[0].getState(state);

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore Oh snap, we're going off the grid!
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    const renderer = decoration["type"].toDOM.bind(pState.linkTooltip) as (
        view: EditorView
    ) => HTMLElement;

    const view = editorView;

    return renderer(view);
}

function richTextView(
    markdown: string,
    pluginContainerFn: () => Element,
    menuContainerFn?: () => Element
): RichTextEditor {
    return new RichTextEditor(
        document.createElement("div"),
        markdown,
        externalPluginProvider(),
        {
            pluginParentContainer: pluginContainerFn,
            menuParentContainer: menuContainerFn,
        }
    );
}

function onLinkEditorChange(
    view: EditorView,
    menuContainer: Element,
    callbacks: {
        onOpen: (newView: EditorView, tr: Transaction) => boolean | null;
        onClose: (newView: EditorView, tr: Transaction) => boolean | null;
    }
) {
    const promise = onViewDispatch(view, (newView, tr) => {
        if (!tr) {
            return false;
        }

        const meta = tr.getMeta("LinkEditor$") as {
            shouldShow: boolean;
        };

        // editor is shown
        if (meta && meta.shouldShow) {
            return callbacks.onOpen?.(newView, tr) || false;
        } else if (meta && !meta.shouldShow) {
            // editor is hidden (save was called)
            return callbacks.onClose?.(newView, tr) || false;
        }

        return false;
    });

    menuContainer
        .querySelector<HTMLButtonElement>(".js-insert-link-btn")
        .click();

    return promise;
}

function formValue(form: HTMLFormElement, name: string) {
    return form.querySelector<HTMLInputElement>(`[name="${name}"]`).value;
}

function setFormValue(form: HTMLFormElement, name: string, value: string) {
    return (form.querySelector<HTMLInputElement>(`[name="${name}"]`).value =
        value);
}

function getViewContainer(editor: LinkEditor) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error this isn't a public field, but I don't care
    return editor.viewContainer;
}
