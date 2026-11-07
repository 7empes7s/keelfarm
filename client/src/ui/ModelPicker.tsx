// The model picker (#198): a coding agent's models from the office's catalog, never a typed id. "Default (Opus 5.5)"
// first, naming what the default is, then the models with plain labels, and "Other…" for a custom id, warned about
// when the catalog doesn't have it. A select on a computer; on a phone, a sheet of choices with a checkmark (HIG Pickers).
import { useId, useState } from 'react';
import { useStore } from '../store';
import { useMode } from '../pocket/mode';
import { inCatalog, OTHER_MODEL, pickerOptions } from '../../../shared/models';
import type { AgentCli } from '../../../shared/types';
import { Sheet } from './Sheet';
import './modelPicker.css';
import { Icon } from './Icon';

interface Props {
  cli: AgentCli;
  value: string; // '' = the default
  onChange: (model: string) => void;
  resolvedDefault: string; // the model '' stands for ('' when the coding agent picks its own)
  id?: string;
  label?: string; // the accessible name, when no <label> points at `id`
  disabled?: boolean;
  defaultLabel?: string; // what '' is called, instead of "Default (…)"
}

export function ModelPicker({ cli, value, onChange, resolvedDefault, id, label = 'Model', disabled, defaultLabel }: Props) {
  const catalog = useStore((s) => s.models);
  const pocket = useMode((s) => s.mode) === 'pocket';
  const options = pickerOptions(cli, catalog, resolvedDefault).map((o) => (o.value === '' && defaultLabel ? { ...o, label: defaultLabel } : o));
  const listed = options.some((o) => o.value === value.trim() && o.value !== OTHER_MODEL);
  const [typing, setTyping] = useState(false);
  const [sheet, setSheet] = useState(false);
  const inputId = useId();
  const other = typing || !listed;
  const selected = other ? OTHER_MODEL : value.trim();
  const pick = (v: string) => {
    setSheet(false);
    if (v === OTHER_MODEL) return setTyping(true);
    setTyping(false);
    if (v !== value) onChange(v);
  };
  const shown = options.find((o) => o.value === selected)?.label ?? value;
  return (
    <span className="model-picker">
      {pocket ? (
        <button type="button" id={id} className="ds-btn model-pick" aria-label={id ? undefined : label} aria-haspopup="dialog" disabled={disabled} onClick={() => setSheet(true)}>
          <span className="model-pick-text">{shown}</span>
          <span aria-hidden="true">▾</span>
        </button>
      ) : (
        <select id={id} value={selected} disabled={disabled} aria-label={id ? undefined : label} onChange={(e) => pick(e.target.value)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      {other && (
        <input
          key={`${cli}:${value}`}
          id={inputId}
          className="model-other"
          defaultValue={listed ? '' : value}
          placeholder="Model id"
          aria-label={`${label}: another model's id`}
          disabled={disabled}
          autoFocus={typing}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          onBlur={(e) => e.target.value.trim() !== value && onChange(e.target.value.trim())}
        />
      )}
      {other && value.trim() && !inCatalog(value, cli, catalog) && <span className="model-warn">Not in this coding agent's list: it may not start.</span>}
      {sheet && (
        <Sheet title={label} onClose={() => setSheet(false)}>
          <div className="model-options" role="radiogroup" aria-label={label}>
            {options.map((o) => (
              <label key={o.value} className="model-option">
                <input type="radio" name={`${inputId}-pick`} checked={o.value === selected} onChange={() => pick(o.value)} />
                <span className="model-option-text">{o.label}</span>
                <span className="model-option-check" aria-hidden="true">
                  {o.value === selected ? <Icon name="check" /> : ''}
                </span>
              </label>
            ))}
          </div>
        </Sheet>
      )}
    </span>
  );
}

/** "not available": a saved model the catalog doesn't have for their coding agent (#198). */
export function ModelMissing({ model, cli }: { model: string; cli: AgentCli }) {
  const catalog = useStore((s) => s.models);
  if (inCatalog(model, cli, catalog)) return null;
  return (
    <span className="model-missing" title={`${model} isn't in this coding agent's list of models`}>
      not available
    </span>
  );
}
