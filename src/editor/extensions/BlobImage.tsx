import { Node, type Editor } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { saveImage, useBlobUrl } from '../../db/blobs';

function BlobImageView({ node, selected }: ReactNodeViewProps) {
  const url = useBlobUrl(node.attrs.blobId);
  return (
    <NodeViewWrapper className={`blob-image${selected ? ' is-selected' : ''}`} data-drag-handle>
      {url ? <img src={url} alt={node.attrs.alt ?? ''} draggable={false} /> : <div className="blob-image-loading">Loading image…</div>}
    </NodeViewWrapper>
  );
}

export async function insertImageFiles(editor: Editor, files: File[], pos?: number) {
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    const blobId = await saveImage(f);
    const content = { type: 'blobImage', attrs: { blobId, alt: f.name } };
    if (pos != null) editor.chain().focus().insertContentAt(pos, content).run();
    else editor.chain().focus().insertContent(content).run();
  }
}

export function pickImage(editor: Editor) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.onchange = () => void insertImageFiles(editor, [...(input.files ?? [])]);
  input.click();
}

/** Image stored as a binary Blob in IndexedDB; the document only keeps { blobId, alt }. */
export const BlobImage = Node.create({
  name: 'blobImage',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      blobId: { default: null, parseHTML: (el) => el.getAttribute('data-blob-id'), renderHTML: (a) => ({ 'data-blob-id': a.blobId }) },
      alt: { default: '' },
    };
  },
  parseHTML() {
    return [{ tag: 'figure[data-blob-id]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['figure', HTMLAttributes];
  },
  addNodeView() {
    return ReactNodeViewRenderer(BlobImageView);
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey('blobImagePaste'),
        props: {
          handlePaste: (_view, event) => {
            const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
            if (!files.length) return false;
            event.preventDefault();
            void insertImageFiles(editor, files);
            return true;
          },
          handleDrop: (view, event) => {
            const files = [...((event as DragEvent).dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'));
            if (!files.length) return false;
            event.preventDefault();
            const coords = view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY });
            void insertImageFiles(editor, files, coords?.pos);
            return true;
          },
        },
      }),
    ];
  },
});
