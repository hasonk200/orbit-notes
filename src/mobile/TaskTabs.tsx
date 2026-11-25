import { CircleCheck, SquareCheckBig } from 'lucide-react';
import { usePane } from '../store/pane';
import { useT } from '../store/uiStore';
import { MobileHeader, MobileSegmented } from './MobileHeader';

/** On phones, To-do and Tasks share one tab; this switch in the top bar moves between them. */
export function TaskTabs({ current }: { current: 'todos' | 'tasks' }) {
  const tr = useT();
  const { replace } = usePane();
  return (
    <MobileHeader
      center={
        <MobileSegmented<'todos' | 'tasks'>
          label={tr('To-do and tasks')}
          value={current}
          onChange={(v) => v !== current && replace('/' + v)}
          options={[
            { value: 'todos', icon: <CircleCheck size={17} />, label: tr('To-do') },
            { value: 'tasks', icon: <SquareCheckBig size={17} />, label: tr('Tasks') },
          ]}
        />
      }
    />
  );
}
