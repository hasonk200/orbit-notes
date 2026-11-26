import { CircleCheck, Repeat, SquareCheckBig } from 'lucide-react';
import { usePane } from '../store/pane';
import { useT } from '../store/uiStore';
import { MobileHeader, MobileSegmented } from './MobileHeader';

/** On phones, To-do, Routines, and Tasks share one tab; this switch in the top bar moves between them. */
export function TaskTabs({ current }: { current: 'todos' | 'routines' | 'tasks' }) {
  const tr = useT();
  const { replace } = usePane();
  return (
    <MobileHeader
      center={
        <MobileSegmented<'todos' | 'routines' | 'tasks'>
          label={tr('To-do, routines and tasks')}
          value={current}
          onChange={(v) => v !== current && replace('/' + v)}
          options={[
            { value: 'todos', icon: <CircleCheck size={16} />, label: tr('To-do') },
            { value: 'routines', icon: <Repeat size={16} />, label: tr('Routines') },
            { value: 'tasks', icon: <SquareCheckBig size={16} />, label: tr('Tasks') },
          ]}
        />
      }
    />
  );
}
