import { ListItem as BaseListItem } from '@tiptap/extension-list-item';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { ChevronRight } from 'lucide-react';

function countSubItems(node: ReactNodeViewProps['node']): number {
  let count = 0;
  for (let i = 1; i < node.childCount; i++) {
    const child = node.child(i);
    if (child.type.name === 'bulletList' || child.type.name === 'orderedList' || child.type.name === 'taskList') {
      count += child.childCount;
    } else {
      count += 1;
    }
  }
  return count;
}

function OutlinerListItemView({ node, updateAttributes, editor, getPos }: ReactNodeViewProps) {
  const collapsed = !!node.attrs.collapsed;
  const nestedCount = countSubItems(node);
  const hasChildren = nestedCount > 0;

  // Detect whether parent list is ordered or bullet
  let isOrdered = false;
  try {
    const pos = typeof getPos === 'function' ? getPos() : null;
    if (typeof pos === 'number' && pos >= 0 && pos <= editor.state.doc.content.size) {
      isOrdered = editor.state.doc.resolve(pos).parent.type.name === 'orderedList';
    }
  } catch {
    /* ignore */
  }

  return (
    <NodeViewWrapper
      as="div"
      className={`outliner-li${isOrdered ? ' is-ordered' : ' is-bullet'}${hasChildren ? ' has-children' : ''}${collapsed && hasChildren ? ' is-collapsed' : ''}`}
      data-collapsed={collapsed && hasChildren ? 'true' : 'false'}
    >
      <div className="outliner-row">
        <span className="outliner-gutter" contentEditable={false}>
          {hasChildren ? (
            <button
              type="button"
              className="outliner-caret"
              title={collapsed ? 'Expand sub-items (Ctrl+.)' : 'Collapse sub-items (Ctrl+.)'}
              aria-expanded={!collapsed}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => updateAttributes({ collapsed: !collapsed })}
            >
              <ChevronRight size={13} />
            </button>
          ) : (
            <span className="outliner-caret-spacer" />
          )}
          {!isOrdered && (
            <button
              type="button"
              className="outliner-dot"
              title={hasChildren ? (collapsed ? 'Expand branch' : 'Collapse branch') : 'Bullet point (Tab to indent)'}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => hasChildren && updateAttributes({ collapsed: !collapsed })}
            />
          )}
        </span>
        <div className="outliner-main">
          <NodeViewContent className="outliner-content" />
          {collapsed && hasChildren && (
            <button
              type="button"
              className="outliner-more"
              contentEditable={false}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => updateAttributes({ collapsed: false })}
              title="Expand hidden sub-items"
            >
              +{nestedCount}
            </button>
          )}
        </div>
      </div>
    </NodeViewWrapper>
  );
}

/**
 * Tana / Workflowy-style collapsible outliner list item.
 * - Tab / Shift+Tab indents & outdents infinitely deep
 * - Any point with sub-items gets a collapse chevron + halo dot + hidden count badge
 * - Ctrl+. / Cmd+. toggles collapse on the active bullet item
 */
export const OutlinerListItem = BaseListItem.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      collapsed: {
        default: false,
        keepOnSplit: false,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-collapsed') === 'true',
        renderHTML: (a: Record<string, any>) => (a.collapsed ? { 'data-collapsed': 'true' } : {}),
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(OutlinerListItemView, { as: 'li', className: 'outliner-li-host' });
  },

  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      Tab: () => {
        if (this.editor.isActive('table')) return false;
        if (this.editor.can().sinkListItem('listItem')) {
          return this.editor.commands.sinkListItem('listItem');
        }
        return false;
      },
      'Shift-Tab': () => {
        if (this.editor.isActive('table')) return false;
        if (this.editor.can().liftListItem('listItem')) {
          return this.editor.commands.liftListItem('listItem');
        }
        return false;
      },
      'Mod-.': () => {
        const { $from } = this.editor.state.selection;
        for (let d = $from.depth; d > 0; d--) {
          const n = $from.node(d);
          if (n.type.name === 'listItem' && n.childCount > 1) {
            const pos = $from.before(d);
            const tr = this.editor.state.tr.setNodeMarkup(pos, undefined, {
              ...n.attrs,
              collapsed: !n.attrs.collapsed,
            });
            this.editor.view.dispatch(tr);
            return true;
          }
        }
        return false;
      },
    };
  },
});
