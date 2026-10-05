import { Icon } from '../components/Icon';
import { OperationRow } from '../components/OperationRow';
import type { Me, Operation } from '../lib/api';
import { dayLabel } from '../lib/format';
import { useNav } from '../lib/nav';
import { useHistory } from '../lib/queries';

export function HistoryScreen({ me, hidden }: { me: Me; hidden: boolean }) {
  const nav = useNav();
  const history = useHistory();
  const items = history.data?.pages.flatMap((p) => p.items) ?? [];
  const assets = new Map(me.assets.map((a) => [a.code, a]));

  const groups: Array<{ day: string; items: Operation[] }> = [];
  for (const op of items) {
    const day = dayLabel(op.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(op);
    else groups.push({ day, items: [op] });
  }

  return (
    <div className="page">
      <h1 className="page__title">История</h1>
      {history.isPending && <div className="list glass skel-block" />}
      {history.isSuccess && items.length === 0 && (
        <div className="empty glass">
          <span className="empty__icon">
            <Icon name="clock" size={28} />
          </span>
          <b>Пока пусто</b>
          <span>Пополнения, выводы и обмены появятся здесь</span>
        </div>
      )}
      {groups.map((g) => (
        <section key={g.day} className="section">
          <div className="section__head">
            <span className="section__title section__title--small">{g.day}</span>
          </div>
          <div className="list glass">
            {g.items.map((op) => (
              <OperationRow
                key={op.id}
                op={op}
                assets={assets}
                hidden={hidden}
                onClick={() => nav.open({ name: 'operation', kind: op.type, id: op.id })}
              />
            ))}
          </div>
        </section>
      ))}
      {history.hasNextPage && (
        <button className="btn btn--ghost glass" onClick={() => void history.fetchNextPage()} disabled={history.isFetchingNextPage}>
          {history.isFetchingNextPage ? <span className="spinner" /> : 'Показать ещё'}
        </button>
      )}
    </div>
  );
}
