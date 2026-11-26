import { ChevronRight, Layers, Ungroup } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { TaskRec } from '../db/schema';
import { ungroupBlockGroup } from '../db/indexers';
import { shortDate, todayISO } from '../lib/dates';
import type { TaskBundle } from '../lib/taskGroups';
import { PRIO_MAP } from '../lib/tasks';
import { displayTitle, useObject, useTypeMap } from '../store/dataStore';
import { objPath, useOpen } from '../store/pane';
import { useT } from '../store/uiStore';

export function TaskBundleCard({
  bundle,
  showSource = true,
  compact = false,
  draggable = false,
  onDragStart,
  onDragEnd,
  renderChild,
}: {
  bundle: TaskBundle;
  showSource?: boolean;
  compact?: boolean;
  draggable?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  renderChild: (task: TaskRec) => ReactNode;
}) {
  const tr = useT();
  const [open, setOpen] = useState(false);
  const srcObj = useObject(bundle.objectId);
  const typeMap = useTypeMap();
  const openObj = useOpen();

  const srcType = srcObj ? typeMap.get(srcObj.typeId) : undefined;
  const heading = bundle.title || (srcObj ? displayTitle(srcObj, tr) : tr('Grouped block'));
  const prioDef = bundle.highestPrio ? PRIO_MAP.get(bundle.highestPrio) : null;
  const today = todayISO();
  const overdue = !!bundle.earliestDue && bundle.earliestDue < today;
  const isToday = !!bundle.earliestDue && bundle.earliestDue === today;

  return (
    <div
      className={`task-bundle${open ? ' is-open' : ''}${compact ? ' is-compact' : ''}`}
      draggable={draggable && !open}
      onDragStart={(e) => {
        if (!draggable) return;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/orbit-task-bundle', JSON.stringify(bundle.tasks.map((t) => t.id)));
        onDragStart?.();
      }}
      onDragEnd={() => onDragEnd?.()}
    >
      <div className="task-bundle-head">
        <button
          type="button"
          className="task-bundle-toggle"
          aria-expanded={open}
          title={open ? tr('Collapse') : tr('Expand')}
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronRight size={15} className="task-bundle-chevron" />
          <Layers size={14} className="task-bundle-icon" />
          <span className="task-bundle-title">{heading}</span>
        </button>

        <div className="task-bundle-meta">
          {showSource && srcObj && (
            <button
              type="button"
              className="task-src"
              style={{ ['--type-color' as any]: srcType?.color }}
              onClick={(e) => openObj(objPath(srcObj.id), e)}
            >
              {srcObj.icon || srcType?.icon} {displayTitle(srcObj, tr)}
            </button>
          )}
          {prioDef && <span className={`prio-chip prio-${prioDef.id}`}>{prioDef.bang}</span>}
          {bundle.earliestDue && (
            <span className={`due-chip${overdue ? ' overdue' : ''}${isToday ? ' today' : ''}`}>
              <span className="due-chip-label">◷ {shortDate(bundle.earliestDue, tr)}</span>
            </span>
          )}
          <div className="proj-progress task-bundle-progress" title={`${bundle.doneCount}/${bundle.totalCount} (${bundle.pct}%)`}>
            <div className="proj-progress-bar">
              <div className="proj-progress-fill" style={{ width: `${bundle.pct}%` }} />
            </div>
            <span className="proj-progress-label">
              {bundle.doneCount}/{bundle.totalCount}
            </span>
          </div>
          <button
            type="button"
            className="icon-btn tiny task-bundle-ungroup"
            title={tr('Ungroup into separate tasks')}
            onClick={(e) => {
              e.stopPropagation();
              void ungroupBlockGroup(bundle.objectId, bundle.groupId);
            }}
          >
            <Ungroup size={13} />
          </button>
        </div>
      </div>

      {open && <div className="task-bundle-body">{bundle.tasks.map(renderChild)}</div>}
    </div>
  );
}
