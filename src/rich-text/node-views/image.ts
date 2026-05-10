import { Node as ProsemirrorNode } from "prosemirror-model";
import { NodeView } from "prosemirror-view";

//NOTE relies on Stacks classes. Should we separate out so the view is more agnostic?

export class ImageView implements NodeView {
    dom: Node | null;
    img: HTMLImageElement;

    constructor(node: ProsemirrorNode) {
        this.img = document.createElement("img");
        this.img.src = node.attrs.src as string;
        if (node.attrs.alt) this.img.alt = node.attrs.alt as string;
        if (node.attrs.title) this.img.title = node.attrs.title as string;

        this.dom = document.createElement("span");
        this.dom.appendChild(this.img);
    }

    selectNode(): void {
        this.img.classList.add("bs-ring");
    }

    deselectNode(): void {
        this.img.classList.remove("bs-ring");
    }

    ignoreMutation(): boolean {
        return true;
    }

    destroy(): void {
        this.img.remove();
        this.dom = null;
    }
}
