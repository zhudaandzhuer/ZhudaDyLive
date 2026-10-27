import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { systemText } from '@zhuda/contracts';
import type {
  GameConfiguration,
  GameEventDefinition,
  GameRule,
  GiftCatalogSnapshot,
} from '@zhuda/contracts';
import { Icon, date, number } from './ui';

function withEvent(rule: GameRule, event: GameEventDefinition, amount = event.default): GameRule {
  return {
    ...rule,
    eventId: event.id,
    amount,
    delta: event.operation === 'effect' ? 0 : event.operation === 'subtract' ? -amount : amount,
  };
}

export function GiftRulesEditor({
  name,
  configuration,
  catalog,
  onSave,
  onClose,
}: {
  name: string;
  configuration: GameConfiguration;
  catalog: GiftCatalogSnapshot;
  onSave: (rules: GameRule[]) => Promise<boolean>;
  onClose: () => void;
}) {
  const [rules, setRules] = useState<GameRule[]>(() => structuredClone(configuration.rules));
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [visible, setVisible] = useState(60);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    if (adding) searchInput.current?.focus();
  }, [adding]);
  const query = search.trim().normalize('NFKC').toLocaleLowerCase();
  const matches = catalog.gifts.filter(
    (gift) =>
      !query || `${gift.name} ${gift.id}`.normalize('NFKC').toLocaleLowerCase().includes(query),
  );
  const configured = new Set(rules.map((rule) => rule.giftId));
  const prices = new Map(catalog.gifts.map((gift) => [gift.id, gift.diamonds]));
  function replace(index: number, rule: GameRule) {
    setRules((current) => current.map((value, i) => (i === index ? rule : value)));
  }
  return createPortal(
    <div className="modal-backdrop" onClick={() => !saving && onClose()}>
      <section
        className="gift-rules-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gift-rules-title"
        tabIndex={-1}
        ref={dialog}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !saving) {
            event.stopPropagation();
            onClose();
          }
          if (event.key === 'Tab') {
            const controls = [
              ...dialog.current!.querySelectorAll<HTMLElement>(
                'button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]',
              ),
            ];
            const first = controls[0],
              last = controls.at(-1);
            if (
              event.shiftKey &&
              (document.activeElement === first || document.activeElement === dialog.current)
            ) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <header className="gift-rules-heading">
          <div>
            <span className="eyebrow">
              {name} · v{configuration.packageVersion}
            </span>
            <h2 id="gift-rules-title">礼物事件设置</h2>
            <p>选择礼物、触发功能与每份礼物的参数。</p>
          </div>
          <button
            className="icon-button"
            aria-label="关闭礼物事件设置"
            disabled={saving}
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </header>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setSaving(true);
            setError('');
            try {
              if (await onSave(rules)) onClose();
              else setError('设置未保存，请检查工作台提示后重试。');
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : '设置未保存，请重试。');
            } finally {
              setSaving(false);
            }
          }}
        >
          <div className="gift-rules-body">
            <div className="gift-rules-toolbar">
              <span>
                已设置 <b>{number(rules.length)}</b> 种礼物 · {configuration.events.length}{' '}
                项玩法功能
              </span>
              <button
                type="button"
                className="button secondary"
                disabled={saving || rules.length >= 500}
                onClick={() => setAdding(!adding)}
              >
                {adding ? '收合礼物目录' : '＋ 添加礼物映射'}
              </button>
            </div>
            {adding && (
              <section className="gift-picker" aria-label="全部抖音礼物">
                <div className="gift-picker-info">
                  <strong>全部礼物 {number(catalog.gifts.length)} 款</strong>
                  <span>
                    {catalog.status === 'syncing'
                      ? '同步官方目录中⋯'
                      : catalog.status === 'offline'
                        ? '目前使用已保存目录'
                        : '官方目录'}{' '}
                    · {date(catalog.updatedAt)}
                  </span>
                </div>
                <input
                  ref={searchInput}
                  aria-label="搜索全部礼物"
                  placeholder="搜索礼物名称或 ID"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setVisible(60);
                  }}
                  disabled={saving}
                />
                <div className="gift-picker-results">
                  {matches.slice(0, visible).map((gift) => (
                    <button
                      type="button"
                      className="gift-picker-item"
                      key={gift.id}
                      disabled={saving || configured.has(gift.id) || rules.length >= 500}
                      onClick={() => {
                        setRules((current) => [
                          ...current,
                          withEvent(
                            { giftId: gift.id, giftName: gift.name, delta: 1 },
                            configuration.events[0]!,
                          ),
                        ]);
                      }}
                    >
                      <span>
                        <strong>{gift.name}</strong>
                        <small>
                          ID {gift.id}
                          {gift.diamonds !== null ? ` · ${number(gift.diamonds)} 抖币` : ''}
                        </small>
                      </span>
                      <b>{configured.has(gift.id) ? '已加入' : '＋'}</b>
                    </button>
                  ))}
                  {!matches.length && <p className="empty">没有符合的礼物，试试其他名称或 ID。</p>}
                </div>
                <div className="gift-picker-bottom">
                  <span>
                    显示 {Math.min(visible, matches.length)} / {number(matches.length)} 款
                  </span>
                  {matches.length > visible && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setVisible(visible + 60)}
                    >
                      显示更多礼物
                    </button>
                  )}
                </div>
              </section>
            )}
            <div className="gift-rule-list" aria-label="已设置礼物事件">
              {rules.map((rule, index) => {
                const selected =
                  configuration.events.find((event) => event.id === rule.eventId) ??
                  configuration.events.find(
                    (event) => event.operation === (rule.delta < 0 ? 'subtract' : 'add'),
                  )!;
                return (
                  <div className="gift-rule-row" key={rule.giftId}>
                    <div className="mapped-gift">
                      <strong>{rule.giftName}</strong>
                      <small>
                        ID {rule.giftId}
                        {prices.get(rule.giftId) != null
                          ? ` · ${number(prices.get(rule.giftId)!)} 抖币`
                          : ''}
                      </small>
                    </div>
                    <label>
                      触发功能
                      <select
                        aria-label={`${rule.giftName}触发功能`}
                        value={selected.id}
                        disabled={saving}
                        onChange={(event) =>
                          replace(
                            index,
                            withEvent(
                              rule,
                              configuration.events.find(
                                (value) => value.id === event.target.value,
                              )!,
                            ),
                          )
                        }
                      >
                        {configuration.events.map((event) => (
                          <option value={event.id} key={event.id}>
                            {systemText(event.label)}
                          </option>
                        ))}
                      </select>
                      <small>{systemText(selected.description)}</small>
                    </label>
                    <label>
                      {selected.amountLabel}
                      <div className="gift-rule-amount">
                        <input
                          type="number"
                          aria-label={`${rule.giftName}${selected.amountLabel}`}
                          min={selected.min}
                          max={selected.max}
                          step="1"
                          required
                          value={rule.amount ?? (Math.abs(rule.delta) || selected.default)}
                          disabled={saving}
                          onChange={(event) =>
                            replace(index, withEvent(rule, selected, Number(event.target.value)))
                          }
                        />
                        <span>{selected.unit}</span>
                      </div>
                    </label>
                    <button
                      type="button"
                      className="remove-rule"
                      aria-label={`删除${rule.giftName}映射`}
                      disabled={saving}
                      onClick={() =>
                        setRules((current) =>
                          current.filter((value) => value.giftId !== rule.giftId),
                        )
                      }
                    >
                      <Icon name="close" size={16} />
                    </button>
                  </div>
                );
              })}
              {!rules.length && (
                <p className="empty">尚未设置礼物事件。添加礼物映射，选择要触发的玩法功能。</p>
              )}
            </div>
          </div>
          <footer className="gift-rules-footer">
            <div>
              <p>保存后套用到后续礼物，并保留供下次开场使用。</p>
              {error && (
                <p className="modal-error" role="alert">
                  {error}
                </p>
              )}
            </div>
            <button type="button" className="button secondary" disabled={saving} onClick={onClose}>
              取消
            </button>
            <button type="submit" className="button" disabled={saving}>
              {saving ? '保存中⋯' : '保存设置'}
            </button>
          </footer>
        </form>
      </section>
    </div>,
    document.body,
  );
}
