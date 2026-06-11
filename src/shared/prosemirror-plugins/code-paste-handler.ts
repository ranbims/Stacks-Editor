import { Plugin } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { Slice, Node, DOMParser, Schema } from "prosemirror-model";
import { richTextSchemaSpec } from "../../rich-text/schema";

// create a static, mini schema for detecting code blocks in clipboard content
const miniSchema = new Schema({
    nodes: {
        doc: richTextSchemaSpec.nodes.doc,
        text: richTextSchemaSpec.nodes.text,
        paragraph: richTextSchemaSpec.nodes.paragraph,
        code_block: richTextSchemaSpec.nodes.code_block,
    },
});

function getHtmlClipboardContent(clipboardData: DataTransfer) {
    if (!clipboardData.types.includes("text/html")) {
        return null;
    }

    return new globalThis.DOMParser().parseFromString(
        clipboardData.getData("text/html"),
        "text/html"
    );
}

interface DetectedCode {
    text: string;
    language?: string;
}

/**
 * Detects if code was pasted into the document and returns the text if true
 * @param clipboardData The clipboardData from the ClipboardEvent
 */
function getDetectedCode(
    clipboardData: DataTransfer,
    htmlDoc: Document
): DetectedCode | null {
    // if we're loading a whole document, don't false positive if there's more than just code
    const codeEl = htmlDoc?.querySelector("code");
    if (htmlDoc && codeEl) {
        const text =
            htmlDoc.body.textContent.trim() !== codeEl.textContent
                ? null
                : codeEl.textContent;
        return text ? { text } : null;
    }

    const textContent = clipboardData.getData("text/plain");

    if (!textContent) {
        return null;
    }

    // check if there's ide specific paste data present
    const vscodeData = clipboardData.getData("vscode-editor-data");
    if (vscodeData) {
        let language: string | undefined;
        try {
            const parsed = JSON.parse(vscodeData);
            if (parsed.mode && parsed.mode !== "plaintext") {
                language = parsed.mode;
            }
        } catch {
            // ignore malformed metadata
        }
        return { text: textContent, language };
    }

    return null;
}

/**
 * Parses a code string from pasted text, based on multiple heuristics
 * @param clipboardData The ClipboardEvent.clipboardData from the clipboard paste event
 * @param doc Pre-parsed slice, if already available; otherwise the slice will be parsed from the clipboard's html data
 * @internal
 */
export function parseCodeFromPasteData(
    clipboardData: DataTransfer,
    doc?: Slice | Node
): DetectedCode | null {
    let htmlContent: Document | null = null;
    if (!doc) {
        htmlContent = getHtmlClipboardContent(clipboardData);

        if (htmlContent) {
            doc = DOMParser.fromSchema(miniSchema).parse(htmlContent);
        }
    }

    // if the schema parser already detected a code block, just use that
    if (
        doc &&
        doc.content.childCount === 1 &&
        doc.content.child(0).type.name === "code_block"
    ) {
        const codeNode = doc.content.child(0);
        return {
            text: codeNode.textContent,
            language: codeNode.attrs.params || undefined,
        };
    }

    // if not parsed above, parse here - this allows us to only run the parse when it is necessary
    htmlContent ??= getHtmlClipboardContent(clipboardData);
    return getDetectedCode(clipboardData, htmlContent);
}

/** Plugin for the rich-text editor that auto-detects if code was pasted and handles it specifically */
export const richTextCodePasteHandler = new Plugin({
    props: {
        handlePaste(view: EditorView, event: ClipboardEvent, slice: Slice) {
            // if we're pasting into an existing code block, don't bother checking for code
            const schema = view.state.schema;
            const codeblockType = schema.nodes.code_block;
            const currNodeType = view.state.selection.$from.node().type;
            if (currNodeType === codeblockType) {
                return false;
            }

            const codeData = parseCodeFromPasteData(event.clipboardData, slice);

            if (!codeData) {
                return false;
            }

            const attrs = codeData.language
                ? { params: codeData.language }
                : {};
            const node = codeblockType.createChecked(
                attrs,
                schema.text(codeData.text)
            );
            view.dispatch(view.state.tr.replaceSelectionWith(node));

            return true;
        },
    },
});
